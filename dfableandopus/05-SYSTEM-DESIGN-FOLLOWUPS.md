# Now scale it: system design follow-ups

Each answer starts from what `andie` does today, cites it, and names the trade-off. The target shape is the Express plus SQL sketch in `astraupskill/10-WHAT-THIS-LOOKS-LIKE-IN-A-WEB-APP.md`.

## The shape today, and the shape asked for

```
  TODAY (one operator, one shell)

  fixtures/*.json ──> buildPlan ──> plan.json ──> apply ──> Shopify target
                      (pure)        (reviewed)     │
   planner.js:156                                  ├─ exportSnapshot x2   client.js:148
                                                   ├─ rebuild + compare   planner.js:271-273
                                                   ├─ conflicts? stop     planner.js:274
                                                   └─ createRemote loop   planner.js:282-308
                                                        └─ journalWriter  populate-metaobjects.js:68

  SCALED (many tenants, many concurrent operators)

  browser ─> POST /migrations ─────> plan(source,target) ──> migrations row
                                     (same pure function)     status=planned, hash
                │
                └─> POST /migrations/:id/apply
                          │
                          ├─ UPDATE ... WHERE id=? AND hash=? AND status='planned'   <- compare-and-set
                          │     0 rows -> 409
                          ├─ enqueue run ──> worker ──> operation rows (one per op)
                          │                              │ pending -> sent -> confirmed
                          │                              └─ uncertain (transport lost)
                          └─ GET /migrations/:id  <- poll status, receipts, failed index
```

## 1. Multi-tenant: several merchants using one service

Today tenancy is a pair of environment variables read by `clientFor` at `scripts/populate-metaobjects.js:60-67`, and the only tenancy check is structural: `applyPlan` requires `plan.targetStore === confirmTarget === targetClient.store` and that source and target differ (`scripts/lib/planner.js:261-268`). That is enough for one operator in one shell and useless for a service, because the process would hold every merchant's token at once.

Scaled, tokens move to a per-tenant encrypted store, the client is constructed per request from the authenticated tenant, and every row carries a tenant id that is part of the primary lookup rather than a filter added later. The `confirmTarget` idea survives as a typed confirmation in the apply request body, because the class of accident it prevents, applying to the wrong store, gets more likely with more stores, not less. Trade-off: per-request client construction loses connection reuse and makes rate limiting per tenant rather than per process, which is what you want anyway since Shopify throttles per store.

## 2. Concurrent writers against the same target

The honest starting point: there is no protection. `applyPlan` exports at `scripts/lib/planner.js:269-270`, compares at `:272`, and sends its first create at `:285`. Anything that happens in between is invisible. `astraupskill/02-CONCEPTS.md` states this as a remaining race, and an interview answer that claims the preflight makes apply safe is wrong.

Scaled, the compare-and-set moves into the database where it can actually be atomic: a single `UPDATE migrations SET status='applying' WHERE id=? AND hash=? AND status='planned'`, and zero affected rows means 409. That serializes two operators on the same migration row, including the double-clicked button. It still does not serialize two operators on the same Shopify store, because the store is outside the transaction. The remaining defence is the one already in the code: a duplicate handle comes back as `userErrors`, which `createRemote` refuses to call success at `scripts/lib/client.js:175-183`. So the design is optimistic locally, pessimistic remotely, and reconciliation stays a first-class operation rather than an error path.

## 3. Background jobs instead of a foreground loop

Today apply is a synchronous `for` loop over `current.operations` (`scripts/lib/planner.js:282-308`) whose durable state is a JSON file replaced through a temp-file rename (`scripts/populate-metaobjects.js:77-87`). A hung mutation blocks the operator's terminal, and `astraupskill/VERIFICATION.md` notes the journal carries no power-loss guarantee.

Scaled, each operation becomes a row with a state machine that has to include an `uncertain` state, because that is the state the current code already produces in memory: `result.failed = { index, message }` with `status = 'stopped'` at `scripts/lib/planner.js:295-296`. Modelling `uncertain` as a fourth state next to pending, confirmed and failed is the whole design. Trade-off: a worker gives you retries and restarts, and a naive worker retry is exactly the duplicate-create bug that `const limit = mutation ? 0 : readRetries` at `scripts/lib/client.js:56` exists to prevent. A retried operation must first re-read the target for its natural key, `type` plus `handle`, and only then decide.

## 4. Pagination at a million entries

`pages` at `scripts/lib/client.js:125-147` already does the right client-side thing: cursor in the `$after` variable, a `seen` set rejecting a repeated cursor at `:141-142`, and a hard ceiling of 1000 pages at 100 nodes each, throwing `Pagination limit exceeded; snapshot is incomplete.` at `:146`. What breaks at a million entries is not the loop, it is `exportSnapshot` at `:148-162`, which accumulates every node in memory and pages entries sequentially per definition at `:154`.

Scaled, the export streams to storage instead of returning an array, and the planner consumes two sorted streams keyed on `type` then `handle`, which is a merge join rather than the `find` lookups at `scripts/lib/planner.js:165` and `:209`. On the read API side, the same stall guard belongs on the server: keyset pagination ordered by id with `take: limit + 1` as in `astraupskill/10-WHAT-THIS-LOOKS-LIKE-IN-A-WEB-APP.md`, never `OFFSET`, because offset pagination over a million rows both slows down and skips rows when writes land mid-scan. Trade-off: streaming loses the whole-snapshot hash at `scripts/lib/planner.js:249-250`, so staleness detection has to become per-definition or a running digest.

## 5. Auth, once it is a web app

Today there is no authentication and no authorization; possession of the environment variables is the whole model, and the only credential hygiene is that the token must be a clean string (`scripts/lib/client.js:36-37`), is only ever sent as the `X-Shopify-Access-Token` header at `:65`, and is masked out of error detail by `redact` at `:9-15`.

Scaled, two separate things: user auth on the HTTP boundary, and the merchant credential the service holds on the user's behalf. The second is the dangerous one. `astraupskill/05-PRACTICE.md` item 4 already states the rule, that tokens stay on the server and never reach a browser bundle or a plan artifact, and the plan artifact is the sharp edge here because operators email it around. The plan produced by `buildPlan` contains store names and content values but no credential, and that property has to be kept deliberately. Trade-off: an audit trail that records who applied what needs the actor on the migration row, which means the plan is no longer a portable file you can hand to a colleague.

## 6. Observability

Today the entire output surface is three `out(...)` lines in `main` (`scripts/populate-metaobjects.js:98-100`, `:106`, `:116`) and one stderr line in the top-level handler at `:119-127`, which deliberately prints only `error.message` plus a receipt count. Structured detail exists but only on the thrown error: `detailed` attaches `field`, `code` and `message` from `userErrors` at `scripts/lib/client.js:178-182`.

Scaled, that same redaction path becomes the log formatter rather than an error property, so `redact` at `:9-15` sits between the app and the log sink instead of being called at three throw sites. The metrics that matter follow directly from the state machine: operations by state, and specifically a gauge of `uncertain` operations, because that number is the human queue. The trade-off is the one stated in `astraupskill/04-TESTING-AND-DEBUGGING.md`: a log line must be useful at 2 a.m. and harmless if shared, and the only reason that is achievable here is that the token has a recognisable shape, `shpat_`, which most secrets do not.

## 7. Migrating this to the target stack

The migration is smaller than it looks because `scripts/lib/planner.js` has one import of transport, `exportSnapshot` and `createRemote` at `:3`, used only inside `applyPlan`. `buildPlan` and `normalizeSnapshot` are pure and would move to a service package unchanged, which is the point `astraupskill/10-WHAT-THIS-LOOKS-LIKE-IN-A-WEB-APP.md` makes when it labels `plan(source, target)` the same function as the CLI's.

What changes: snapshot validation at `scripts/lib/planner.js:27-155` becomes a schema validator at the HTTP edge, so bad input is a 400 rather than a thrown `Invalid definition type.`; `newOutput`'s `flag: 'wx'` at `scripts/populate-metaobjects.js:58` becomes a unique constraint and a 409; and `journalWriter`'s rename dance at `:68-88` becomes an insert per receipt. Trade-off: every one of those translations makes the failure mode recoverable and the code harder to read end to end, which is why the CLI is still the better teaching artifact.

## 8. What you would refuse to build first

Deletion. `buildPlan` collects target-only entries at `scripts/lib/planner.js:236-243` and never converts one into an operation, pinned by `test/migration.test.js:131`. Absence from a source export is not evidence that content is unwanted, only that it was not in one projection of one store at one moment. `astraupskill/05-PRACTICE.md` item 6 states the rule: ownership, retention and a reviewed deletion set come before any destructive operation. This is the one place where the cheap feature is the unrecoverable one.

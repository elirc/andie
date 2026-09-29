# Interview questions on the metaobject migration lab

26 questions. Each is marked junior or mid. Every technical answer cites a path relative to the project root.

## Group A: screening

**A1 (junior). Describe the data model this tool moves.**
Two levels. A metaobject definition is the schema: `type`, `name`, optional `description` and `displayNameKey`, `access`, `capabilities` and a list of `fieldDefinitions` each with `key`, `name`, `required` and `type.name`. A metaobject entry is an instance of one definition: a `handle`, a list of `fields` with `key`/`value`/`type`, and an optional `capabilities.publishable.status`. The fixture at `fixtures/source.json` is the whole model in miniature: one definition `size_guide` with a required `title` field of type `single_line_text_field`, and one entry with handle `general`, value `Find your fit`, status `DRAFT`. The normalized shape produced by `normalizeSnapshot` is at `scripts/lib/planner.js:141-147`.

**A2 (junior). What is the business identity of each record, and why does that matter?**
A definition is identified by `type`, an entry by `type` plus `handle`. Resource IDs are not identities because they belong to one store. `buildPlan` matches definitions with `target.definitions.find((d) => d.type === definition.type)` at `scripts/lib/planner.js:165` and entries with `existing?.entries.find((e) => e.handle === entry.handle)` at `scripts/lib/planner.js:209`. Duplicate identities are rejected before planning, at `scripts/lib/planner.js:150-153` for types and `scripts/lib/planner.js:137-140` for handles, because a duplicate would make those two lookups arbitrary.

**A3 (junior). Walk me through the request path for the `plan` command.**
`main` parses argv at `scripts/populate-metaobjects.js:90`, the `plan` branch at `:95-101` calls `readJson` twice, hands both to `buildPlan`, and writes the result with `newOutput`. There is no request path: no client is constructed, so no token is read and no fetch happens. The test `import and offline CLI planning need no network or credentials` at `test/migration.test.js:415` proves it by spawning the CLI with `globalThis.fetch` replaced by a thrower.

**A4 (junior). And the `apply` command?**
`main` falls through to `scripts/populate-metaobjects.js:109-116`: read the plan file, build a source client and a target client from environment variables via `clientFor` (`:60-67`), and pass them plus `--confirm-target` and a `journalWriter` into `applyPlan`. `applyPlan` exports both stores (`scripts/lib/planner.js:269-270`), rebuilds the plan, compares, then loops `createRemote` per operation.

**A5 (mid). Where is the validating boundary?**
Three, deliberately separated. Argument shape at `parse` (`scripts/populate-metaobjects.js:19-46`): allowed flags per command, no duplicates, no missing values, no value starting with `--`. Transport shape at `createClient` (`scripts/lib/client.js:26-49`): bare subdomain per `storeName` at `:21-25`, non-empty token with no CR or LF (`:36-37`), API version equal to `2026-07` (`:38-41`). Domain shape at `normalizeSnapshot` (`scripts/lib/planner.js:27-155`). The planner never sees an unvalidated fetched object.

**A6 (mid). Why does the token check reject `\r` and `\n`?**
`scripts/lib/client.js:36` rejects them because the token goes into an HTTP header at `:65`, and a newline in a header value is an injection vector. Cheap to reject at construction, impossible to reason about later.

**A7 (junior). How does the tool avoid destroying work on disk?**
`newOutput` at `scripts/populate-metaobjects.js:57-59` writes with `flag: 'wx'`, so an existing path throws `EEXIST`, which the top-level handler at `:125` turns into `Output already exists; choose a new path.` and exit code 1 (`:128`). `test/migration.test.js:399` asserts both the `EEXIST` rejection and that the journal file ends up holding the latest receipt.

## Group B: deep dive

**B1 (mid). What was the actual bug the rewrite fixed?**
The load-bearing one: the old script copied fetched objects into mutation variables and deleted fields in place, so preparing variables for the first target mutated the shared source object and corrupted planning for the second. `normalizeSnapshot` now constructs new objects rather than editing inputs (`scripts/lib/planner.js:48-54` for fields, `:61` for the definition input). Regression test: `planning never mutates source objects across multiple targets` at `test/migration.test.js:66`.

**B2 (mid). The old script logged mutations as successful. What does yours require before calling a create successful?**
Layered checks across `query` and `createRemote` in `scripts/lib/client.js`. HTTP must be ok (`:86-89`); a served `X-Shopify-API-Version` header, if present, must match (`:90-94`); the envelope must have no top-level `errors` (`:101-117`) and must carry a `data` object (`:118-119`); the mutation payload must exist with an array `userErrors` (`:173-174`) that is empty (`:175-183`); and the resource ID must be a non-empty string (`:184-186`). `test/migration.test.js:295` covers the last two.

**B3 (mid). Why is `PUBLIC_READ_WRITE` never echoed into the create input?**
Because it is an output-only value for merchant-owned types. `normalizeSnapshot` copies only `storefront` and `customerAccount` into `input.access` (`scripts/lib/planner.js:77-79`, with the comment at `:79`) and keeps `admin` outside the input at `:145`. A non-public `admin` value then becomes a conflict at `:173-179` rather than a guess. Test: `merchant-owned output admin access is not copied into the input enum` at `test/migration.test.js:551`.

**B4 (mid). What breaks if I delete line `scripts/lib/planner.js:159`?**
That line is `if (source.store === target.store) throw`. Remove it and you can plan a store against itself: every definition matches, so the plan looks harmlessly all-unchanged. `applyPlan`'s guard at `:266` is the second net, and the two together make `source and target identities must differ and be bare shop names` (`test/migration.test.js:140`) pass.

**B5 (mid). What breaks if I change `const limit = mutation ? 0 : readRetries;` at `scripts/lib/client.js:56` to just `readRetries`?**
Mutations become retryable. A timeout after the POST has reached Shopify is an unknown outcome, not a failure, so a retry can create a duplicate or hit a handle that already exists. The current code throws `Mutation transport failed; outcome is unknown. Re-export before retrying.` at `:71-75`. Two tests pin this: `mutations are never automatically retried on HTTP failure` at `test/migration.test.js:255` and `mutation document without explicit option still cannot retry` at `:520`, the second because `:55` also sets `mutation` true whenever the document text matches `/\bmutation\b/`.

**B6 (mid). Explain the hash. Is it a security control?**
No. `hash` at `scripts/lib/planner.js:15` is SHA-256 over `canonical`, which is `JSON.stringify` of a recursively key-sorted clone (`:4-14`). It gives order-independent equality so that a reordered export does not look like a change; `normalized plan ignores definition and field ordering` at `test/migration.test.js:147` asserts that. It is not authorization, because a caller can edit operations and keep the old hash. That is why `applyPlan` does not compare hashes at all: it re-exports, rebuilds the whole plan and compares the full artifact with `canonical(plan) !== canonical(current)` at `scripts/lib/planner.js:272-273`. Test: `changed source or forged plan is rejected before mutations` at `test/migration.test.js:339`.

**B7 (mid). Is apply idempotent or transactional?**
Neither, and the code says so. There is no transaction spanning two stores. What exists is a preflight compare-and-set on the whole plan plus sequential ordered creates. A race remains: another writer can change the target between the export at `scripts/lib/planner.js:270` and the first `createRemote` at `:285`. `astraupskill/02-CONCEPTS.md` names that limit explicitly, and the honest answer names it too.

**B8 (mid). Why do conflicts stop everything, including unrelated valid creates?**
`scripts/lib/planner.js:274` throws on any conflict before the loop, because a mixed plan that half-applies hides the unresolved difference behind a partial success. `a plan with conflicts sends no mutations even for other missing entries` at `test/migration.test.js:347` adds an `app--123--owned` definition to a source with valid operations and asserts zero mutations. The trade-off: one unresolvable definition blocks the batch, the right default for a two-store migration and the wrong one for a job queue.

**B9 (mid). Why is a reference field a conflict instead of a dropped field?**
`scripts/lib/planner.js:187-194` conflicts any definition with a field type containing `reference`. A product ID belongs to the source store; copying it into the target creates a dangling pointer. Dropping the field silently would produce an entry that looks migrated and is not. The reason string says exactly that: `no fields will be silently dropped`. Test at `test/migration.test.js:102`.

**B10 (mid). How does pagination avoid an infinite loop, and what does it do with the cursor?**
`pages` at `scripts/lib/client.js:125-147` keeps a `seen` set, rejects a missing, empty or repeated `endCursor` at `:141-142`, and bounds the loop with `maxPages` defaulting to 1000 at `:125`, throwing `Pagination limit exceeded; snapshot is incomplete.` at `:146`. The cursor travels in the `$after` variable at `:130`, never spliced into the document; `pagination passes opaque cursors through variables` at `test/migration.test.js:154` uses a cursor with a quote and a backslash and asserts it never appears in the query text.

**B11 (mid). Which reads retry, and how long do they wait?**
Only reads, on 429, 502, 503 and 504 (`scripts/lib/client.js:77`), and on GraphQL errors where every error has `extensions.code === 'THROTTLED'` (`:102-109`). The delay honours `Retry-After` in seconds capped at 10000 ms, otherwise `250 * 2 ** attempt` (`:79-83`). `test/migration.test.js:213` sends `Retry-After: 999` twice and asserts delays of `[10000, 10000]`.

**B12 (mid). What happens on a partial failure mid-apply?**
The catch at `scripts/lib/planner.js:294-307` sets `result.status = 'stopped'` and `result.failed = { index, message }`, tries one last journal write inside its own try/catch so a disk failure cannot erase the in-memory receipt (`:297-301`), then throws an error carrying `failure.result`. The CLI prints the message plus `Confirmed receipts: N.` at `scripts/populate-metaobjects.js:122-123`. `partial remote failure stops later work and retains confirmed receipts` at `test/migration.test.js:356` asserts one completed receipt and `failed.index === 1`.

**B13 (mid). Why journal before the first create?**
`await journal(structuredClone(result))` at `scripts/lib/planner.js:281` runs before the loop, so a journal destination that cannot be written fails before anything remote happens. `journal failure before first mutation prevents all writes` at `test/migration.test.js:373` asserts zero mutation calls. The counterpart, `journal failure after a create stops before the next create` at `:381`, is the harder case: a real remote object now exists whose receipt may be lost, which is why the recovery instruction is re-export, not retry.

**B14 (mid). How do you keep secrets out of logs while keeping errors useful?**
`SECRET = /shpat_[A-Za-z0-9]+/g` at `scripts/lib/client.js:7` and `redact` at `:9-15` walk strings, arrays and objects. `detailed(message, details)` at `:16-20` attaches only chosen fields: `message` and `extensions.code` for GraphQL errors (`:112-115`), `field`, `code` and `message` for `userErrors` (`:178-182`). Headers are never included. `error detail is attached and redacted, never discarded` at `test/migration.test.js:594` asserts both halves: the code is present and `shpat_secret999` has become `shpat_[redacted]`.

**B15 (mid). `clientFor` reads `SHOPIFY_API_VERSION`. What if I set it?**
`scripts/populate-metaobjects.js:65` passes it through, and `scripts/lib/client.js:38-41` throws `This implementation is reviewed for API 2026-07; review queries before changing versions.` So the variable exists as an explicit failure point, not an upgrade switch. The documents at `scripts/lib/client.js:3-6` were reviewed against `2026-07`, and `astraupskill/VERIFICATION.md` states that a future API upgrade needs a fresh compatibility review.

## Group C: behavioral, STAR form

**C1 (junior). Tell me about a time you found a security problem in code you inherited.**
S: the original `scripts/populate-metaobjects.js` carried literal `shpat_` tokens and wrote to configured stores as soon as it ran. T: remove the credential from active source without pretending it was thereby safe. A: moved credential reading into `clientFor` (`scripts/populate-metaobjects.js:60-67`), gated execution behind `require.main === module` (`:118`), made `help` the default (`:20`), and added the redaction path at `scripts/lib/client.js:7-20`. R: no token literals remain and 43 tests pass, but I wrote into `astraupskill/VERIFICATION.md` that a copy with the literals survives in a backup directory and the account owner must still revoke the token.

**C2 (mid). Tell me about a time you chose to make a tool refuse rather than guess.**
S: existing target entries with the same handle but different content. T: decide between overwrite, skip and stop. A: chose conflict at `scripts/lib/planner.js:211-216` with reason `Existing entry differs; update policy must be reviewed.`, and made any conflict abort the whole apply at `:274`. R: `changed existing entry is a conflict rather than a silent skip or overwrite` (`test/migration.test.js:83`) and the zero-mutation assertion at `:347` lock it in. The cost is that the tool cannot do a partial migration, which I documented in `astraupskill/README.md` as future work.

**C3 (mid). Describe a time you pushed back on an obvious-looking retry.**
S: transport failures during apply. T: decide retry policy. A: separated read retries from mutation retries at `scripts/lib/client.js:56` and added the defensive document sniff at `:55` for callers that forget the option. R: two tests, `test/migration.test.js:255` and `:520`, assert the fetch was called exactly once. The reasoning I gave: a retry is only safe when the previous outcome is known, and a post-send timeout is the definition of not knowing.

**C4 (junior). Tell me about verification evidence you stand behind, and its limits.**
S: a migration tool that is dangerous if believed too much. T: state what is proven. A: `npm test` runs `node --test test/*.test.js`, 43 cases including a real loopback HTTP server (`test/migration.test.js:479`) and child-process runs with network forbidden (`:415`); `npm run check` runs three `node --check` passes. R: all pass on Node 22 with no third-party dependencies. Limit, stated in `astraupskill/VERIFICATION.md`: no test contacted a Shopify account, so live scopes, real throttling and remote schema acceptance are unproven.

**C5 (mid). A time you improved observability without weakening security.**
S: the client threw one-line errors and discarded `userErrors`, so every failure looked identical. T: keep detail, lose secrets. A: added `detailed`/`redact` (`scripts/lib/client.js:9-20`) and attached only `field`, `code`, `message` (`:178-182`). R: one test added, suite went from 42 to 43 green, and the top-level CLI handler at `scripts/populate-metaobjects.js:119-127` still prints only `error.message`, never a response body.

## Group D: the follow-ups an interviewer asks next

**D1 (mid), after B6. "So a caller could just regenerate the hash. Why keep it in the file?"**
As a review artifact, not a gate. `sourceHash` and `targetHash` at `scripts/lib/planner.js:249-250` let a human say which snapshots a plan came from. The gate is the full-artifact comparison at `:272`.

**D2 (mid), after B7. "Then what would make apply safe against concurrent writers?"**
Nothing inside this tool. It needs a conditional create from the remote API, or acceptance that a duplicate-handle rejection is the real serializer. Preflight narrows the window, `createRemote` surfaces the rejection through `userErrors` (`scripts/lib/client.js:175-183`), and reconciliation stays manual.

**D3 (junior), after A3. "How do you know the plan command really sends nothing?"**
Two ways. Structurally, the `plan` branch at `scripts/populate-metaobjects.js:95-101` never calls `clientFor`. Empirically, `test/migration.test.js:415` spawns the CLI with `--require` of a guard file that replaces `globalThis.fetch` with a thrower and asserts exit status 0 with two planned operations.

**D4 (mid), after B12. "Your journal write after a failure is wrapped in an empty catch. Isn't that swallowing an error?"**
It is, deliberately, at `scripts/lib/planner.js:297-301`. At that point the operation failure is the information that matters and `result.completed` already holds the confirmed receipts in memory; letting a disk error replace the real cause would lose it. The thrown error still carries `failure.result` (`:305`), so the caller reports the receipt count.

**D5 (mid), after B8. "What would you change for a production migration service?"**
Per-definition scoping so one conflicting type does not block unrelated types, plus durable run state instead of a JSON journal. That is `astraupskill/05-PRACTICE.md` items 2, 5 and 6, listed rather than built because update policy must be specified before compare-and-swap semantics can be claimed.

**D6 (junior), after A7. "What if the journal path exists but you need to write twice?"**
`journalWriter` at `scripts/populate-metaobjects.js:68-88` owns the destination only on the first write via `newOutput`; later snapshots go to a `.metaobject-journal-<uuid>.tmp` sibling and are moved over with `fs.rename` (`:82-83`). So exclusivity applies once, at creation, and updates are atomic replacements on the same filesystem.

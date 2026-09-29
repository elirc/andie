# Stories, bullets and the spoken summary

## Story 1: the script that wrote to production on import

**Situation.** The inherited `scripts/populate-metaobjects.js` carried three literal `shpat_` access tokens in source, and running it created metaobject definitions and entries in the configured target stores immediately.

**Task.** Make the tool safe to read, run and test without an account, and without pretending the leaked credential had been neutralised.

**Action.** I moved credential reads into `clientFor` (`scripts/populate-metaobjects.js:60-67`), which pulls `SHOPIFY_SOURCE_STORE`/`_TOKEN` or the target pair from `process.env` and nothing else, put execution behind `if (require.main === module)` at `:118`, and made `help` the default command at `:20`. The `plan` command never constructs a client (`:95-101`).

**Result.** `import and offline CLI planning need no network or credentials` (`test/migration.test.js:415`) spawns the CLI with `globalThis.fetch` replaced by a thrower and asserts exit status 0 and a two-operation plan. The suite is 43 `node --test` cases green plus three `node --check` passes. `astraupskill/VERIFICATION.md` now records that a copy with the token literals survives in a backup directory and the owner must still revoke it.

## Story 2: 200 OK was being recorded as success

**Situation.** The old code sent a `metaobjectCreate` mutation and logged it as done, but Shopify returns HTTP 200 for a mutation it refused, with the reason inside `userErrors`.

**Task.** Define what success requires, and prove the definition with tests.

**Action.** `query` now checks layers in order in `scripts/lib/client.js`: HTTP status (`:86-89`), a disagreeing served `X-Shopify-API-Version` header (`:90-94`), unparseable JSON (`:95-100`), top-level `errors` (`:101-117`), missing `data` (`:118-119`). Then `createRemote` requires an array `userErrors` (`:173-174`), empty (`:175-183`), plus a non-empty resource ID (`:184-186`).

**Result.** `mutation userErrors and missing IDs are never called success` (`test/migration.test.js:295`) and `API fallback and malformed successful responses are rejected` (`:281`) pin it. Later I attached the refusal detail rather than discarding it: `detailed`/`redact` at `scripts/lib/client.js:9-20` keeps `field`, `code` and `message` and masks anything matching `/shpat_[A-Za-z0-9]+/g`, verified at `test/migration.test.js:594`.

## Story 3: refusing to guess about an existing entry

**Situation.** A target store already had an entry with the same `type` and `handle` as the source but different field values, and the old behaviour was to skip or copy depending on the loop path.

**Task.** Pick a rule a reviewer could defend, and make half-applying impossible.

**Action.** `buildPlan` now classifies rather than acts: equal content is `unchanged`, different content is a conflict reading `Existing entry differs; update policy must be reviewed.` (`scripts/lib/planner.js:211-216`), absent is a `createEntry` (`:218-232`), target-only content is reported, never deleted (`:236-243`). `applyPlan` throws on any conflict before the loop (`:274`). Same refusal for reference fields (`:187-194`), app-owned types (`:166-171`), non-public admin (`:173-179`) and enabled `onlineStore`/`renderable` (`:180-186`).

**Result.** `a plan with conflicts sends no mutations even for other missing entries` (`test/migration.test.js:347`) builds a source with valid operations plus one `app--123--owned` definition and asserts zero mutation calls. Five more tests at `:83`, `:92`, `:102`, `:110` and `:566` cover the rules individually.

## Resume bullets

- Rebuilt a credential-embedding Shopify migration script into a dependency-free Node 22 CLI with three separated boundaries (argument parsing, GraphQL transport, pure planner), reaching 43 passing `node --test` cases and three `node --check` checks.
- Eliminated hardcoded `shpat_` API tokens from active source, moved credential reads to `process.env`, and gated execution behind a `require.main` check verified by a child-process test that runs the CLI with `fetch` replaced by a throwing stub.
- Replaced implicit writes with a plan-then-apply workflow that re-exports both stores, rebuilds the plan and compares the full canonical artifact before the first mutation, blocking stale, forged and conflict-bearing plans across 7 tests.
- Removed a shared-object mutation defect in which variable preparation deleted fields from fetched source objects and corrupted planning for a second target, covered by a regression test that plans twice from one snapshot.
- Added bounded read retries on 429/502/503/504 and GraphQL `THROTTLED` with a 10-second `Retry-After` cap, and made mutation transport failures non-retryable to avoid duplicate creates after an unknown outcome.

## 60-second spoken summary

I took over a Shopify theme utility with three access tokens written directly into the file, which started copying metaobject definitions into configured stores the moment it ran. I rebuilt it as a Node 22 CLI with no third-party dependencies and three clean boundaries. The planner is pure: it normalizes two JSON snapshots, validates identities and field types, and emits a reviewable plan of proposed creates, conflicts, unchanged entries and target-only entries. The client owns transport: fixed GraphQL documents, cursors passed as variables with a repeated-cursor guard and a page ceiling, and a definition of success covering HTTP status, the envelope, `userErrors` and the returned resource ID. The CLI does nothing on import. The interesting decision is apply: it does not trust the plan file, it re-exports both stores, rebuilds the plan and compares the whole thing, and any conflict stops every create. What I like is what it refuses to claim. There is no transaction across two stores, so a writer can still change the target between the preflight export and the first create. I documented that, and that removing the token literals does not revoke the credential.

## What I would do next

From `astraupskill/05-PRACTICE.md`. First, update planning: an existing handle with different content is always a conflict today, and a reviewed update needs an expected-prior-content rule plus a test that a target edit after planning stops it. Second, durable run state replacing the JSON journal, modelling planned, running, stopped, uncertain and complete. Third, cross-store reference mapping, which would let the conflict at `scripts/lib/planner.js:187-194` become a real migration.

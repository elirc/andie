# Take-home: add a `reconcile` command

Time box: 3 to 4 hours. Work only in `scripts/populate-metaobjects.js`, `scripts/lib/planner.js`, `scripts/lib/client.js` and `test/migration.test.js`. Do not add a runtime dependency; this project runs on Node 22 built-ins only.

## Background we expect you to read first

When `applyPlan` stops partway it sets `result.status = 'stopped'` and `result.failed = { index, message }` at `scripts/lib/planner.js:295-296`, then throws an error carrying `failure.result` at `:302-306`. The journal on disk therefore records which creates were confirmed and which operation failed. What the tool cannot tell you today is the thing the operator actually needs at that moment: did the failing operation reach the store anyway? `astraupskill/02-CONCEPTS.md` calls this the uncertain outcome, and the current instruction is to re-export and reconcile by hand.

## The assignment

Add a fourth command:

```
reconcile --journal journal.json --confirm-target exact-store-name --out report.json
```

It performs a read-only export of the target store and answers, for every operation recorded in the journal, whether the corresponding resource is present in the target now.

### Acceptance criteria

1. `parse` accepts `reconcile` with exactly the three flags above and rejects unknown, duplicated or valueless flags, matching the existing behaviour at `scripts/populate-metaobjects.js:29-42`. `parse(['reconcile', '--journal', 'j.json'])` must throw `/Required/`.
2. The journal file is validated before any network call. Reject a file that is not an object, whose `status` is not one of `running`, `stopped` or `complete`, whose `completed` is not an array, or whose `targetStore` does not equal the `--confirm-target` value. The confirmation mismatch must produce zero client calls, the way `applyPlan` does at `scripts/lib/planner.js:261-268`.
3. Only the target client is constructed, via `clientFor('target', env)` (`scripts/populate-metaobjects.js:60-67`), and only `exportSnapshot` is called on it. No mutation may be sent under any input.
4. The export is normalized with `normalizeSnapshot` before comparison so that field and definition ordering cannot affect the result (`scripts/lib/planner.js:27-155`).
5. The report classifies every journal entry in `completed` as `present` when a definition of that `type` exists, and for `createEntry` when an entry with that `type` and `handle` also exists. Anything recorded as completed but absent from the fresh export is `missing`. If `failed` is non-null, the operation at that index is reported separately as `uncertain` with its recorded `message`, because a failed create may still have committed.
6. The report is written with `newOutput` (`scripts/populate-metaobjects.js:57-59`), so an existing `--out` path fails with `EEXIST` and the handler at `:124-126` prints `Output already exists; choose a new path.` with exit code 1.
7. Stdout on success is one line with the three counts, in the style of the existing `plan` line at `:98-100`. Do not print snapshot contents, tokens or response bodies.
8. `npm run check` and `npm run format:check` pass. The project uses Prettier with 100 columns and single quotes from `.prettierrc`.

### What to submit

A patch or branch containing the code change, new tests appended to `test/migration.test.js`, and a `NOTES.md` of at most one page covering: the validation rules you chose and why, what a `missing` classification does and does not prove, and any race you did not close. Do not submit `node_modules`, a plan file, a journal or an export.

### Tests

Add your cases to `test/migration.test.js` and run them with `npm test`, which is `node --test test/*.test.js`. Reuse the existing `fakeClient` helper at `test/migration.test.js:17`: it records every call in `calls` and serves definitions and entries from a snapshot, so you can assert `client.calls.length === 0` as `test/migration.test.js:331` does, or the narrower `calls.filter((c) => c.options?.mutation).length === 0` used at `test/migration.test.js:347`. For the file cases, copy the `fs.mkdtemp` pattern from `test/migration.test.js:399`. We expect at least: confirmation mismatch sends no calls; a journal recording both creates against a target that has them reports two `present`; a journal recording a create against the empty `fixtures/target.json` shape reports `missing`; a `stopped` journal with `failed.index` set reports one `uncertain`; and an existing `--out` path rejects with `EEXIST`.

## Grading rubric

| Criterion | Strong submission | Weak submission |
|---|---|---|
| Boundary discipline | Only `exportSnapshot` on the target client; a test asserts zero mutation calls even for a malformed journal | Constructs both clients, or calls `buildPlan`/`applyPlan` and relies on them not mutating |
| Input validation | Journal shape and `targetStore` checked before the client is built; `parse` extended in the existing `allowed` table rather than special-cased | Trusts `JSON.parse` output, or validates after the export has already run |
| Honest classification | `missing` is described as evidence about this export only; the `failed` index is `uncertain`, never `missing` | Reports the failed operation as `missing`, implying it definitely did not commit |
| Tests | Five or more cases including the zero-call assertion and the `EEXIST` case; assertions count real calls, not just error strings | One happy-path test, or assertions that only match a message with a regex |
| Error and output hygiene | Errors are short strings; nothing prints a snapshot, token or remote body; `EEXIST` still routes through the existing handler | Logs the export or the raw error object; writes over an existing report |
| Determinism | Normalizes before comparing; report ordering is stable | Compares raw fetched objects, so field order changes the result |
| Code fit | Matches the file's existing style, passes `npm run format:check`, no new dependency | Adds a CLI or assertion library, or reformats unrelated code |

## Reviewer's notes

The first thing the reviewer opens is `test/migration.test.js`, looking for an assertion on `calls`, not on an error message. A test that only checks `assert.rejects(..., /confirmation/)` proves the error happened; a test that also checks `opts.targetClient.calls.length === 0` proves nothing was sent first, and that difference is the whole point of this codebase.

Second, the error paths. Feed the command a journal that is valid JSON but the wrong shape, a `--confirm-target` that disagrees with `targetStore`, and an `--out` path that already exists. All three should fail with a one-line message and exit code 1, and none should have touched the network.

Third, safety of the wording. A `missing` classification means the resource was absent from one sequential, non-atomic export (`astraupskill/VERIFICATION.md` states exports are selected projections and are not atomic while remote writers are active). If `NOTES.md` says reconcile "confirms the migration succeeded", that is the line the reviewer will quote back. The strong answer says it narrows the reconciliation work and names the window between export and any concurrent write.

Finally, scope. Creating, updating or deleting anything from this command is an automatic fail, however convenient it looks.

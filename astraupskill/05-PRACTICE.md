# Progressive integration and CRUD exercises

## 0. Warm-ups against the code as it is

Everything here runs offline with plain Node (the suite is `node --test`, no install). Do these before the extension work below; each has an exact expected observation.

0a. **Predict the plan.** Read `fixtures/source.json` and `fixtures/target.json` (the target is an empty store), predict the operation counts, then run
    `npm run plan:example` (or point `--out` at a temp path).
    **Check**: the CLI prints `Plan written: 2 proposed creates, 0 conflicts, 0 unchanged. No network requests.` and the JSON's `operations` array holds one `createDefinition` and one `createEntry` — in that order. Say why that order is not optional.

0b. **Force every plan category.** Copy both fixtures to a temp dir and edit the *copy* of the target so that, across three runs, you produce: an `unchanged` entry (same handle, same value as the source's `general`), a conflict (same handle, different `title` value), and a `targetOnly` entry (a handle the source lacks).
    **Check**: the printed counts move from `2/0/0` to the distribution you predicted for each edit, and the plan file's `conflicts` / `unchanged` / `targetOnly` arrays name the handles you touched. Note which edits also change `targetHash` — and therefore what `applyPlan`'s re-export comparison would catch.

0c. **Watch a guard fail: exclusive creation.** Run the same plan command twice with the same `--out` path.
    **Check**: the second run prints `Output already exists; choose a new path.` and exits 1, and the file's content is byte-identical to the first run (hash it). Then find the single line in `scripts/populate-metaobjects.js` (`newOutput`) that makes this happen.

0d. **Watch a validator fail: duplicate field key.** In a temp copy of `source.json`, duplicate the `title` field definition and run a plan against it.
    **Check**: the run fails with `Duplicate field key.` and no output file is created — validation happens in `normalizeSnapshot` before any plan is written. State which other validations in `scripts/lib/planner.js` you could trigger the same way (there are at least five).

## Extensions: future learning work

These features are future learning work. The delivered utility already provides offline planning, selected read exports and explicit creates. Build each extension with a user story, a rule for conflicts and a test for a late failure.

## 1. Improve the review artifact

Generate a Markdown summary beside the JSON plan with counts, definition names, entry handles and conflict reasons. Keep the JSON authoritative for machine comparison. Escape user-controlled text so a value containing pipes or Markdown syntax does not corrupt the table. Test an empty plan, a conflict-only plan and a long value. Avoid including credentials or dumping every rich-text field into an ordinary log.

## 2. Add deliberate update planning

Define which entry fields the source owns and which target fields must be preserved. An existing handle with a different value currently conflicts. Replace that rule only after specifying a reviewed update operation with expected prior content. Test that a target edit made after planning stops the update. Do not assume an API's update mutation offers compare-and-swap semantics; verify the supported contract and state any remaining race explicitly.

## 3. Design cross-store reference mapping

Create a mapping from source resource identity to verified target identity. Validate that every required reference resolves before the first create. Distinguish a missing mapping from an intentionally empty optional field. For references between metaobjects, consider dependency order and cycles. Add fixtures with a missing referenced object, two objects referring to each other and a stale mapping. A mapping file is data that needs validation, not an excuse to copy arbitrary IDs.

## 4. Build a local review web app

Wrap offline plan creation in a local HTTP service and a browser page. Upload synthetic snapshots, show validation errors and let the learner inspect creates, conflicts and retained target-only entries. Bound request size and reject malformed JSON. Keep account tokens on the server if you later add authenticated account integration; never put them in browser bundles or plan artifacts. Test the service boundary separately from the planner and add a browser case that retains the user's inputs after a validation error.

## 5. Add durable job state

Persist migration runs and operation receipts in a database. Model planned, running, stopped, uncertain and complete states. A worker restart must reconcile an operation whose remote outcome is unknown. Test a crash after remote success but before the local receipt commit. Explain why a database transaction cannot atomically include an unrelated external HTTP service. Consider an outbox for local scheduling, while keeping remote reconciliation as a separate responsibility.

## 6. Define deletion and rollback policy

Do not equate target-only content with garbage. Specify ownership, retention and a reviewed deletion set before adding destructive operations. A create rollback may be unsafe if another workflow has already referenced the new object. Build a dry-run policy evaluator and test target content owned by another process. Finish with an operational note explaining when automatic compensation is appropriate and when human review is required.

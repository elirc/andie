# Trace an offline plan and a simulated partial apply

Run `npm run plan:example` and inspect the resulting JSON. If the file already exists, select a new output path with the explicit plan command rather than overwriting the earlier review artifact. The source fixture has one `size_guide` definition and a draft entry with handle `general`; the target fixture is empty. Find the definition create followed by the entry create.

Trace `main` into `readJson`, `buildPlan` and `newOutput`. No client is constructed along this branch, and no token is required. In the test suite, the offline CLI is launched in a child process with fetch replaced by a function that throws. It still succeeds. This demonstrates the absence of a network dependency more directly than calling the command a dry run while allowing hidden reads.

Copy the fixtures into a temporary directory. Make the target definition and entry identical to the source except for its store identity. Build a new plan and observe zero operations and one unchanged entry. Change the target title, then build again: the entry becomes a conflict. The planner does not decide which business value should win. Write the update policy you would need before changing that behavior.

Add a reference field in both the source definition and entry. Keep its types consistent so structural validation passes. Planning now reports a reference-mapping conflict and proposes no creates for that definition. Explain the difference between a malformed snapshot and a valid snapshot describing an unsupported migration.

Read the apply tests without running an account command. Follow the fake client's read responses, the fresh plan comparison, the initial journal write and the first confirmed create. In the partial-failure case, the second create throws. The result retains the first receipt and execution stops. In the journal-failure case, a confirmed create can exist while its disk receipt is incomplete. Both situations require re-export and reconciliation.

Draw a small timeline with source export, target export, plan comparison, create request, remote commit, response and journal replacement. Mark the window where a network timeout makes the outcome unknown. Mark the separate window where another writer can change a target after preflight. These are different uncertainties and need different tests.

Finish with a one-page review note: proposed creates, conflicts, retained target-only content, source/target fingerprints, tested recovery paths and unverified live-account assumptions. Include the fact that active credentials were removed from the original script but must be revoked by the account owner. Do not copy token strings into the note. The objective is to explain a reliable workflow, not to perform a live store migration during the course.

## Where the offline plan is built

`buildPlan` takes two snapshots and returns four arrays; no client, token or network call appears on this branch. The app-owned check below is the conflict you will reproduce when you add a `$`-prefixed or `app--` type to the source fixture. From `scripts/lib/planner.js:156-171`:

```js
function buildPlan(sourceRaw, targetRaw) {
  const source = normalizeSnapshot(sourceRaw),
    target = normalizeSnapshot(targetRaw);
  if (source.store === target.store) throw new Error('Source and target stores must differ.');
  const operations = [],
    conflicts = [],
    unchanged = [],
    targetOnly = [];
  for (const definition of source.definitions) {
    const existing = target.definitions.find((d) => d.type === definition.type);
    if (definition.type.startsWith('$') || definition.type.startsWith('app--')) {
      conflicts.push({
        type: definition.type,
        reason: 'App-owned type requires a separate ownership migration.',
      });
      continue;
```


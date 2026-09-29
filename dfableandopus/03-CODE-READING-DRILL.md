# Screen-share code reading drills

Six drills. Cover the answers, set a timer of five minutes each, and speak out loud.

## Drill 1: explain this function

`scripts/lib/client.js:125-147`.

```js
async function pages(client, query, key, variables = {}, maxPages = 1000) {
  let after = null;
  const seen = new Set();
  const nodes = [];
  for (let page = 0; page < maxPages; page++) {
    const data = await client.query(query, { ...variables, after });
    const connection = data[key];
    if (
      !connection ||
      !Array.isArray(connection.nodes) ||
      typeof connection.pageInfo?.hasNextPage !== 'boolean'
    )
      throw new Error('Malformed paginated response.');
    nodes.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return nodes;
    const cursor = connection.pageInfo.endCursor;
    if (typeof cursor !== 'string' || !cursor || seen.has(cursor))
      throw new Error('Pagination cursor did not advance.');
    seen.add(cursor);
    after = cursor;
  }
  throw new Error('Pagination limit exceeded; snapshot is incomplete.');
}
```

<details>
<summary>Answer</summary>

It drains one GraphQL connection into a flat array, defending against three distinct server misbehaviours. The cursor goes in as the `after` variable, never into the document text, so an opaque cursor containing quotes or backslashes is safe; `test/migration.test.js:154` proves it with the cursor `opaque"cursor\value`. A response missing `nodes` or `pageInfo.hasNextPage` is rejected rather than treated as an empty last page, because an incomplete snapshot silently becomes a wrong plan. A repeated or empty `endCursor` is a stall, caught by the `seen` set. Falling out of the loop is an error, not a return: exceeding `maxPages` means the snapshot is incomplete, so proceeding would be worse than failing. Note what it does not do: no concurrency, and no retry of its own, since retry policy lives in `client.query` at `scripts/lib/client.js:56`.
</details>

## Drill 2: explain this function

`scripts/lib/planner.js:208-233`, the entry loop inside `buildPlan`.

```js
    for (const entry of definition.entries) {
      const match = existing?.entries.find((e) => e.handle === entry.handle);
      if (match) {
        if (canonical(match) !== canonical(entry))
          conflicts.push({
            type: definition.type,
            handle: entry.handle,
            reason: 'Existing entry differs; update policy must be reviewed.',
          });
        else unchanged.push({ type: definition.type, handle: entry.handle });
      } else {
        const input = {
          type: definition.type,
          handle: entry.handle,
          fields: entry.fields
            .filter((f) => f.value !== null)
            .map((f) => ({ key: f.key, value: f.value })),
        };
        if (entry.capabilities) input.capabilities = entry.capabilities;
        operations.push({
          kind: 'createEntry',
          type: definition.type,
          handle: entry.handle,
          input,
        });
      }
    }
```

<details>
<summary>Answer</summary>

Three outcomes, never a fourth. Identity is `type` plus `handle`; `existing` may be undefined when the definition is missing from the target entirely, which is why the optional chain is there. Comparison uses `canonical` (`scripts/lib/planner.js:14`), a key-sorted `JSON.stringify`, so field order from the API cannot look like a difference. Equal content is `unchanged` and produces nothing. Different content is a conflict, not an overwrite, because this tool has no update policy. Absent means build an explicit create input. Two details matter in that input: the fetched `type` of each field is dropped, because it is output metadata used for validation at `:111-113` and not part of `MetaobjectCreateInput`; and `null` values are filtered out at `:222-224` rather than sent as nulls. The `capabilities` key is added only when the entry had one, so the mutation does not assert a publication status the source never carried.
</details>

## Drill 3: spot the bug

This is a modified copy of `parse` from `scripts/populate-metaobjects.js:19-46`. One change makes it wrong.

```js
function parse(argv) {
  const command = argv[0] || 'help';
  const options = {};
  const allowed = {
    help: [],
    plan: ['source', 'target', 'out'],
    export: ['role', 'out'],
    apply: ['plan', 'confirm-target', 'journal'],
  }[command];
  if (!allowed) throw new Error('Unknown command. Run help.');
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index]?.slice(2),
      value = argv[index + 1];
    if (!argv[index].startsWith('--') || !allowed.includes(key) || !value || value.startsWith('--'))
      throw new Error('Invalid, duplicate or missing option. Run help.');
    options[key] = value;
  }
  if (allowed.some((key) => !options[key])) throw new Error('Required option missing. Run help.');
  return { command, options };
}
```

<details>
<summary>Answer</summary>

Two removals. The real condition at `scripts/populate-metaobjects.js:32-38` also contains `key in options`, which rejects a repeated flag; without it `plan --source a --source b` silently keeps the last value, and `test/migration.test.js:393` asserts that case throws `/duplicate/`. The real function also has the `export` role check at `:43-44`, so this copy would accept `export --role admin --out x.json` and hand `admin` to `clientFor`, which builds the prefix `SHOPIFY_ADMIN_` and produces a confusing token error from `scripts/lib/client.js:36-37` instead of a clear argument error. The takeaway to say out loud: last-write-wins on a duplicated flag is how someone points `--confirm-target` at the wrong store.
</details>

## Drill 4: spot the bug

A modified copy of the retry region of `client.query`, real code at `scripts/lib/client.js:53-85`.

```js
    async query(query, variables = {}, { mutation = false } = {}) {
      const limit = readRetries;
      for (let attempt = 0; ; attempt++) {
        let response;
        try {
          response = await fetchImpl(/* ...unchanged... */);
        } catch {
          throw new Error(
            mutation
              ? 'Mutation transport failed; outcome is unknown. Re-export before retrying.'
              : 'Read transport failed or timed out.',
          );
        }
        if ([429, 502, 503, 504].includes(response.status) && attempt < limit) {
          const retry = Number(response.headers.get('Retry-After'));
          await delay(Number.isFinite(retry) && retry > 0 ? retry * 1000 : 250 * 2 ** attempt);
          continue;
        }
```

<details>
<summary>Answer</summary>

Three mutations, all real risks. First, the line `mutation = mutation || /\bmutation\b/.test(query);` at `scripts/lib/client.js:55` is gone, so a caller that passes a mutation document without `{ mutation: true }` loses every protection; `test/migration.test.js:520` exists precisely for that. Second, `const limit = mutation ? 0 : readRetries;` at `:56` became unconditional, and the guard at `:77` lost its `!mutation`, so a `metaobjectCreate` that returns 503 is re-sent. Shopify may have committed the first one, so you can get a duplicate entry or a handle-taken `userErrors` rejection, and `test/migration.test.js:255` asserts the fetch count stays at 1. Third, `Math.min(retry * 1000, 10000)` at `:81` lost its cap, so a hostile or mistaken `Retry-After: 999` sleeps the process for over 16 minutes; `test/migration.test.js:213` asserts the recorded delays are `[10000, 10000]`.
</details>

## Drill 5: predict the output

You are on a clean checkout. Predict stdout, stderr and the exit code for each command, in order.

```
node scripts/populate-metaobjects.js
node scripts/populate-metaobjects.js plan --source fixtures/source.json --target fixtures/target.json --out plan.example.json
node scripts/populate-metaobjects.js plan --source fixtures/source.json --target fixtures/target.json --out plan.example.json
node scripts/populate-metaobjects.js apply --plan plan.example.json --confirm-target target-learning --journal j.json
```

<details>
<summary>Answer</summary>

1. `argv[0]` is undefined, so `parse` returns command `help` (`scripts/populate-metaobjects.js:20`) and `main` prints the `HELP` text from `:8-18`. Exit code 0. No network.

2. `buildPlan` runs over `fixtures/source.json` and `fixtures/target.json`. The target has an empty `definitions` array, so the `size_guide` definition is missing and produces a `createDefinition`, then its `general` entry produces a `createEntry`. Stdout is `Plan written: 2 proposed creates, 0 conflicts, 0 unchanged. No network requests.` from `:98-100`. Exit 0. `test/migration.test.js:57` asserts that operation order and `:415` asserts the count of 2.

3. Same arguments, but `newOutput` uses `flag: 'wx'` (`:58`), so `writeFile` rejects with `EEXIST`. The handler at `:124-126` prints `Output already exists; choose a new path.` to stderr and sets exit code 1. This is the `repeat` case in `test/migration.test.js:415`.

4. `apply` needs a client, so `clientFor` reads `SHOPIFY_SOURCE_STORE` and `SHOPIFY_SOURCE_TOKEN`. On a clean shell they are undefined, so `storeName` at `scripts/lib/client.js:21-25` throws `Store must be a bare myshopify subdomain.` on stderr, exit code 1, before any fetch. Note the ordering: `readJson` of the plan file at `:109` happens first, so a missing plan file would fail earlier with `Input must be a JSON file no larger than 20 MiB.` from the `fs.stat` path at `:47-50`.
</details>

## Drill 6: review this diff

A teammate proposes this. Find the defects.

```diff
--- a/scripts/lib/planner.js
+++ b/scripts/lib/planner.js
@@ applyPlan
-  const source = await exportSnapshot(sourceClient),
-    target = await exportSnapshot(targetClient);
-  const current = buildPlan(source, target);
-  if (canonical(plan) !== canonical(current))
-    throw new Error('Plan is stale or changed. Export and review a new plan.');
-  if (current.conflicts.length) throw new Error('Plan has conflicts; no mutation was sent.');
+  const [source, target] = await Promise.all([
+    exportSnapshot(sourceClient),
+    exportSnapshot(targetClient),
+  ]);
+  const current = buildPlan(source, target);
+  if (plan.sourceHash !== current.sourceHash || plan.targetHash !== current.targetHash)
+    throw new Error('Plan is stale or changed. Export and review a new plan.');
+  if (current.conflicts.length)
+    console.warn(`Skipping ${current.conflicts.length} conflicts.`);
@@ apply loop
-  for (let index = 0; index < current.operations.length; index++) {
-    const operation = current.operations[index];
+  for (let index = 0; index < plan.operations.length; index++) {
+    const operation = plan.operations[index];
```

<details>
<summary>Answer</summary>

Three defects, in increasing severity.

Defect one, the hash comparison. `sourceHash` and `targetHash` at `scripts/lib/planner.js:249-250` are hashes of the two normalized snapshots, not of the operations. Comparing only them reintroduces exactly the hole the real line `canonical(plan) !== canonical(current)` at `:272` closes: an operations array edited by hand still matches, because the snapshots are unchanged. `changed source or forged plan is rejected before mutations` (`test/migration.test.js:339`) edits `plan.operations[0].input.name` to `forged` with both stores untouched, and would now pass straight through.

Defect two, the conflict downgrade. `scripts/lib/planner.js:274` throws so that no create runs while an unresolved difference exists. Turning that into a warning means a run can create half a migration while a reference-field or ownership conflict remains, which is the mixed-plan failure `astraupskill/03-WORKED-CHANGE.md` is about. `a plan with conflicts sends no mutations even for other missing entries` (`test/migration.test.js:347`) fails.

Defect three, and the one that makes the whole preflight decorative: the loop now iterates `plan.operations` instead of `current.operations`. The tool re-exports the world, rebuilds the plan, then executes the file the caller handed it. Combined with defect one, that is arbitrary remote creates from an attacker-controlled JSON file.

The `Promise.all` change is defensible on its own but worth flagging: the two exports were sequential, and running them together doubles concurrent load against a rate-limited API whose only relief path is the bounded read retry at `scripts/lib/client.js:77-85`. It also does not buy atomicity, since these are two independent stores. I would leave it sequential and say why.
</details>

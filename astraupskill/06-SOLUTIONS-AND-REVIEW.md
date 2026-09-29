# Solution sketches for a careful reviewer

Use these notes after attempting [practice](05-PRACTICE.md). Review the observable contract and failure sequence instead of prescribing a particular folder structure. A compact implementation can still be rigorous if its boundaries are explicit.

For a human-readable report, derive counts from the plan arrays rather than maintaining separate counters during export. Escape table delimiters, line breaks and markup in displayed values. Include the source and target identities and snapshot fingerprints so a reviewer can connect the report to its JSON artifact. Do not suggest that a fingerprint signs or authorizes the plan; it only identifies normalized content.

For updates, a good first design lists owned keys and expected prior values. Separate “missing” from an empty string or null. Preserve target-managed fields. Reject a stale preflight comparison and document whether the actual remote mutation has an atomic condition. If it does not, a second writer can still race after the comparison. The solution should state this limitation rather than naming a local hash an optimistic lock on a remote service.

For reference mapping, use stable source and target identifiers plus resource type. Verify target existence and compatibility before using a mapping. Plan dependent creates in an order that respects references. Cycles may require a two-phase create-then-link workflow, but that introduces a period of incomplete objects and requires recovery rules. A required reference must not vanish merely because its target has not been created yet. Tests should inspect the whole proposed operation set before allowing any execution.

For a review web app, keep plan construction pure and inject it into the service layer. Validate upload size and schema before expensive normalization. Return structured errors that the browser can display without losing the source and target selections. Use separate transport DTOs rather than exposing configuration objects containing credentials. A browser test should prove that a conflict is visible and that no apply request is sent merely by opening a plan.

For durable jobs, record an operation's intended identity before sending it and its confirmed remote ID afterward. A crash between those steps leaves uncertainty. On restart, inspect the remote resource by its business identity and compare content before deciding whether to accept, retry or stop. This is a reconciliation workflow, not exactly-once delivery. Test all three outcomes with controlled remote state.

For deletion, require evidence that the tool owns the target resource and that deletion will not break current consumers. A target-only report is insufficient. Review a separate deletion artifact and preserve a recovery record. Do not implement automatic rollback by deleting every resource created earlier in a failed run; another process may already be using one.

Ask an author to demonstrate a partial failure, show the last durable receipt and explain what the next run does. Check that errors do not print tokens, that source snapshots remain unchanged, and that unsupported capabilities are visible. Accurate recovery behavior is more valuable than a success message that hides uncertainty.

## What a fingerprint actually covers

Before you put a fingerprint in a report, read how it is produced: keys are sorted recursively, the result is serialized, and that string is hashed. It identifies normalized content and nothing else. From `scripts/lib/planner.js:4-15`:

```js
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
}
const canonical = (value) => JSON.stringify(stable(value));
const hash = (value) => createHash('sha256').update(canonical(value)).digest('hex');
```


# Test boundaries without touching a store

Run `npm test` and `npm run check` from this project root. The 42 Node tests use synthetic snapshots, controlled fetch responses, temporary output files, child processes and one real loopback HTTP server. No Shopify account credentials are required. The local transport case redirects the injected fetch boundary to its own server and uses a fixture-only token; it does not send an account token to a test service.

The pure planner cases verify operation order, source immutability, unchanged content, schema conflicts, value conflicts, target-only content, duplicate identities, required values and unsupported references or ownership. Input/output access mapping and enabled unsupported capabilities have explicit regressions. These tests check the planned behavior before introducing transport timing.

Pagination cases supply two pages and inspect the variables on the second request. The opaque cursor contains characters that would be unsafe to splice into a query string. Other cases repeat a cursor or omit connection metadata and require failure instead of accepting an incomplete snapshot. A finite page cap prevents an accidental endless loop, but exceeding it is an error, not permission to proceed with partial results.

HTTP cases cover bounded retry on selected transient read responses, GraphQL throttling, malformed JSON, version fallback and top-level errors. Mutation cases prove that HTTP or transport failure is not automatically retried, even when the document is passed without an explicit mutation option. User errors and missing IDs cannot become successful receipts. Error assertions also check that credential-like fixture text from a thrown transport error is not copied into the reported message.

Apply cases check exact target confirmation, stale source and target exports, forged operations, global conflict handling, partial remote failure and journal failure before or after a create. The assertions count actual calls through the controlled client. A test that merely checks a final error string would miss the more serious bug of sending writes before rejecting the plan.

For a real operational failure in a future authorized development-store trial, first preserve the plan and journal. Identify whether failure happened before mutation, during an uncertain transport outcome or after a confirmed create while saving its receipt. Re-export before deciding to retry. Do not add a catch-all retry around the whole apply command.

The suite verifies local orchestration and the selected protocol shapes. It does not establish live account scopes, actual Shopify throttling behavior, remote schema acceptance, store-wide consistency or power-loss durability of journals. Those boundaries are recorded in [verification](VERIFICATION.md), so passing tests cannot be confused with a completed live migration.

## How the redaction is implemented

The assertion that fixture credential text never reaches a reported message rests on one helper pair, applied to every thrown transport detail. From `scripts/lib/client.js:7-20`:

```js
const SECRET = /shpat_[A-Za-z0-9]+/g;
// Error detail is kept, never headers, and any token-shaped substring is masked before it can reach a log.
function redact(value) {
  if (typeof value === 'string') return value.replace(SECRET, 'shpat_[redacted]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
  return value;
}
function detailed(message, details) {
  const error = new Error(message);
  error.details = redact(details);
  return error;
}
```

## Safe error detail

The delivered client threw one-line errors ("Shopify returned GraphQL errors") and discarded the payload's `userErrors` and `extensions.code`, which made every failure look the same. The opposite habit, attaching the whole response, leaks tokens into logs. The fix pass takes the middle: `detailed(message, details)` attaches only the fields that help (`field`, `code`, `message`), passes them through `redact()` (which masks anything shaped like `shpat_...` at any depth), and never touches headers. The trade-off is the lesson: a log line must be useful to the person debugging at 2 a.m. and harmless if the log is shared. Test both halves, as `test/migration.test.js` now does: the detail is present, and the token is not.


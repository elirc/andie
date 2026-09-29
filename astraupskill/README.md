# Build judgment around external CRUD integrations

This course turns a small migration script into a study of reliable integration work. The main skill is deciding what can safely be concluded from a request, a response or a snapshot. A junior engineer may focus on making a POST succeed; a mid-level engineer also considers incomplete exports, conflicting records, uncertain outcomes and recovery after the third operation fails.

Begin with [the root setup](../README.md). Node 22 is sufficient; there are no third-party runtime dependencies. Run `npm test`, `npm run check` and `npm run plan:example`. These commands use synthetic fixtures and local test boundaries. You do not need a Shopify account or token to complete the core course. The example plan proposes a definition followed by its entry and reports any conflicts separately.

Read [the code map](01-CODEBASE-MAP.md), then [concepts](02-CONCEPTS.md). Follow [the worked change](03-WORKED-CHANGE.md) while inspecting the planner and API client. Use [testing and debugging](04-TESTING-AND-DEBUGGING.md) to understand what the 42 cases establish. Attempt [practice](05-PRACTICE.md) before consulting [solutions and review](06-SOLUTIONS-AND-REVIEW.md). Finish with [the trace lab](07-TRACE-LAB.md) and [verification](VERIFICATION.md).

## Prerequisites and glossary

**Prerequisites:** Node with `async`/`await`, reading a JSON request and response (GraphQL here), and running a CLI with arguments. No Shopify account is needed for the core course.

| Term | Meaning here | Where in this project |
|---|---|---|
| snapshot | One store read into a file, which is evidence of a moment, not of current truth. | `exportSnapshot` in `scripts/lib/client.js` |
| normalized snapshot | The snapshot reduced to comparable fields before any planning. | `normalizeSnapshot` in `scripts/lib/planner.js` |
| plan | Reviewable intent: the operations that would be sent, produced without sending anything. | `buildPlan` in `scripts/lib/planner.js` |
| operation | One proposed create, ordered so a definition precedes its entries. | the `operations` array in `buildPlan` |
| conflict | A case the tool refuses to guess about, reported instead of silently skipped. | `conflicts.push({ type, reason })` in `buildPlan` |
| userErrors | A 200 response that still refused the mutation; success needs an empty list. | `createRemote` in `scripts/lib/client.js` |
| journal | The append-as-you-go record of what was actually attempted. | `journalWriter` in `scripts/populate-metaobjects.js`, the `journal` callback in `applyPlan` |
| uncertain outcome | A run that stopped partway, recorded with the failing index rather than a total. | `result.status = 'stopped'` and `result.failed` in `applyPlan` |
| cursor pagination | Following `hasNextPage` until the export is complete, with a page ceiling. | `pages` in `scripts/lib/client.js` |
| no-overwrite output | Writing results only to a path that does not already exist. | `newOutput` in `scripts/populate-metaobjects.js` |
| ownership | App-owned or non-public types need a different migration and are refused here. | the `PUBLIC_READ_WRITE` and `app--` checks in `buildPlan` |
| portable identity | A handle or type name travels between stores; a resource id does not. | the reference-field conflict in `buildPlan` |

## A first experiment

Copy the source fixture and change its title value. Build a plan against an empty target fixture: the new value appears in the proposed create. Now make the target contain the same handle with a different value. The plan reports a conflict and does not propose overwriting it. Explain why an existing identity is not proof that the target already contains the intended content.

Next add a reference field to a copied fixture, updating both its definition and entry type consistently. The planner refuses to treat the source store's resource ID as portable. It reports a migration conflict instead of silently omitting the field. This makes an unsupported case visible before any write begins.

The original script contained embedded credentials. Active source now reads credentials only from process environment, and account operations require explicit commands. The old tokens still need revocation by the account owner; this course does not use or reproduce them. Error output avoids dumping request headers or remote bodies. These are responses to an observed source problem, not a claim that the repository's entire history has been sanitized.

The delivered tool supports read, compare and create workflows. Update policy, deletion, cross-store reference mapping, a browser review UI and durable job orchestration remain exercises. Keep that distinction in your notes. A migration plan is reviewable intent; a journal is partial evidence of execution; neither is an atomic transaction across two stores.

# Three boundaries: command, plan and transport

Start at [populate-metaobjects.js](../scripts/populate-metaobjects.js). Its `require.main === module` guard separates importing functions from executing a command. With no arguments, the command displays help. `parse` validates the command's allowed flags, rejects duplicates and requires complete options. The offline plan command reads two JSON snapshots and writes a new output file; it does not construct an authenticated client.

`clientFor` is used only by explicit account commands. It derives source or target configuration from process environment and creates a client. The CLI never contains a real token literal. `newOutput` uses exclusive creation so an existing plan, export or initial journal is not silently overwritten. `journalWriter` owns a newly created destination and replaces later journal snapshots through a temporary sibling file.

[client.js](../scripts/lib/client.js) contains fixed GraphQL documents and the HTTP boundary. Store validation prevents an arbitrary URL from receiving the token header. Query variables carry types and cursors, keeping opaque cursor text out of the document string. The client checks HTTP status, optional served-version headers, JSON parsing and GraphQL errors before accepting data. Mutation handling separately checks `userErrors` and a returned resource ID.

`pages` follows a connection until `hasNextPage` is false. It rejects a missing or repeated cursor and enforces a maximum page count. `exportSnapshot` pages definitions, then pages entries for each definition. It returns a selected metadata projection, not all store resources. The export is sequential and does not represent an atomic snapshot while other writers are active.

[planner.js](../scripts/lib/planner.js) is mostly pure data transformation. `normalizeSnapshot` validates identities, fields, values and supported structure, then sorts collections for deterministic comparison. `buildPlan` identifies missing resources, unchanged entries, conflicts and target-only entries. It never mutates the input fixtures. `applyPlan` performs fresh exports, rebuilds the plan, compares it with the reviewed artifact and rejects any conflict before the first mutation. It then executes creates in order and records receipts.

[The fixtures](../fixtures/source.json) provide a small definition with one title field and one draft entry. [The tests](../test/migration.test.js) cover pure plans, simulated API responses, filesystem behavior, child-process commands and a real local HTTP exchange. Read one case from each group and state which dependency it replaces.

The `shopify` assets and `.storybook` files are retained remnants of a larger theme workspace. They do not provide a complete runnable theme application here. The current package scripts intentionally describe the implemented migration utility. Do not infer a frontend build from the presence of fonts or a Storybook configuration filename.

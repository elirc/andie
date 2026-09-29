# Worked change: replace automatic copying with reviewed intent

The old script immediately iterated configured target stores, created missing definitions and copied missing entries. It fetched only the first definition page, interpolated cursors into GraphQL strings, mutated shared source fields while preparing inputs and logged some mutation requests as successful without checking their business errors. The delivered workflow separates observation, decision and execution.

Open [planner.js](../scripts/lib/planner.js). A source snapshot and target snapshot enter `normalizeSnapshot`. The function checks format and API version, store identity, unique definition types, unique entry handles, unique field keys, required values and agreement between entry field types and their declarations. It constructs new objects, so planning for a second target cannot inherit deletions made while preparing the first target's variables.

`buildPlan` compares normalized definitions by type. A missing supported definition produces a createDefinition operation before its entries. An existing definition with changed structure produces a conflict. For entries, matching type and handle plus equal content becomes unchanged; equal identity with different content becomes a conflict; absence becomes createEntry. Target-only content is listed for review and is never converted into a delete operation.

Consider this small entry input:

```json
{
  "type": "size_guide",
  "handle": "general",
  "fields": [{"key": "title", "value": "Find your fit"}],
  "capabilities": {"publishable": {"status": "DRAFT"}}
}
```

The fetched field's type metadata is used for validation but omitted from this explicit mutation input. Required reference fields are not merely omitted: the whole affected definition is a conflict because cross-store ID mapping has not been implemented. The plan remains useful even when it cannot execute, since it identifies the missing engineering decision.

Apply requires an exact target confirmation and matching source/target clients. It exports both stores again, rebuilds the plan and compares the full artifact. A changed source, changed target or edited operation stops before mutation. Any remaining conflict also stops all creates, including otherwise valid missing resources. This prevents a mixed plan from being partly applied while hiding unresolved differences.

Execution is sequential. A definition must exist before its entry can be created. Each accepted response contributes a resource ID to the journal. If the next mutation or journal write fails, later operations stop. Earlier creates may remain remote, so the next step is a fresh export and reviewed plan, not replaying the old file.

Read the tests for forged plans, changed snapshots, partial failure and journal failure. Explain which would fail if apply only compared stored hashes, or if the loop swallowed an exception and continued. Then describe the remaining race: remote state can change after the preflight export because the utility has no transaction spanning both stores.

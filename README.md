# Andie metaobject migration learning lab

A dependency-free Node 22 utility for learning API boundaries, deterministic migration planning, pagination, conflicts and partial-failure recovery. Start with [the course](astraupskill/README.md).

The legacy script embedded Shopify credentials and immediately wrote to configured stores. The replacement has no automatic network action: importing it or running it without arguments only exposes functions or help. The embedded credentials have been removed from active source. **Revoke and replace the original tokens through the account owner; removing source text does not revoke a credential or erase historical copies.** No original token was used for verification.

## Start entirely offline

```powershell
npm test
npm run check
npm run plan:example
Get-Content plan.example.json
```

No npm install is needed: the project uses Node built-ins. The example plan contains two proposed creates, one definition and one entry. Output files must be new; choose a different `--out` path if an earlier plan already exists. Fixtures are synthetic and contain no credentials.

## Optional account workflow

`node scripts/populate-metaobjects.js help` explains all flags. `export --role source|target --out new-file.json` performs read-only requests using the matching `SHOPIFY_SOURCE_STORE`/`TOKEN` or `SHOPIFY_TARGET_STORE`/`TOKEN` environment variables. Store values are bare myshopify subdomains. `.env.example` is a template; the program does not load it automatically. Use newly provisioned credentials and a development target for any later account testing.

`plan --source source.json --target target.json --out plan.json` remains offline. Review its operations and conflicts. `apply --plan plan.json --confirm-target exact-target-name --journal new-journal.json` is an explicit remote-write command: it re-exports both stores, rebuilds the plan and rejects stale or changed plans before creating anything. Conflicts stop all creates. Successful creates are journaled sequentially. A partial failure can leave earlier resources on the target; re-export and reconcile instead of blindly retrying.

This implementation creates missing supported definitions and entries. It does not update or delete existing content. References, app-owned types, unsupported ownership and enabled online-store/renderable capabilities require a separate migration. The exporter covers the selected metaobject fields, not a full Shopify store backup. Archived theme assets and Storybook configs remain incomplete source remnants; no theme or Storybook build is claimed.

The query/input review targets API `2026-07`. Shopify's API versioning and input/output types need explicit compatibility review when upgrading. See [versioning](https://shopify.dev/docs/api/usage/versioning), [definition creation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/metaobjectDefinitionCreate), and [entry creation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/metaobjectCreate).

Verification passed 42 local tests and three syntax checks. It used controlled API responses and one real loopback HTTP server; it did not contact a live Shopify account. Read [the exact evidence and limits](astraupskill/VERIFICATION.md).

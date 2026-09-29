# Determinism, uncertainty and API contracts

A deterministic planner produces the same operations from equivalent snapshots. This implementation normalizes ordering before hashing and comparison. Definition types and entry handles form business identities; field keys identify values inside an entry. Duplicate identities are rejected because otherwise a later lookup might arbitrarily select one of two records. Stable output makes review and regression testing easier.

A hash detects changed normalized content; it is not authorization or a digital signature. Apply does not trust a caller who edits the operations while keeping an old hash. It re-exports source and target, rebuilds the entire plan and compares the resulting artifact. This prevents a changed plan from becoming a general arbitrary-mutation file. The check is still a preflight snapshot: another writer can change the remote store after export and before a create.

## Three kinds of success

An HTTP 200 means the transport received a response. The GraphQL envelope may still contain top-level errors. A mutation payload may also contain `userErrors` or lack a created resource ID. The client checks these layers before recording success. Shopify's create payloads expose business errors separately from their created resource. See [definition creation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/metaobjectDefinitionCreate) and [entry creation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/metaobjectCreate).

A timeout after sending a mutation creates uncertainty. The remote service may have committed even though the client did not receive its ID. Automatic retry could create a duplicate or encounter an existing handle. Therefore mutation transport failures stop execution and require a fresh export. Read retries are bounded and apply only to selected HTTP status codes or explicit GraphQL throttling. Retrying every error would hide validation problems and amplify outages.

## Output models are not input models

The old script copied fetched objects into mutation variables and deleted fields in place. That both changed the shared source object and assumed every returned field was accepted on create. The new planner constructs explicit inputs. For example, merchant-owned `PUBLIC_READ_WRITE` admin access is an output value absent from the create-input enum, so it is not echoed into the mutation. Non-public ownership is treated as a separate migration case. Compare the [output enum](https://shopify.dev/docs/api/admin-graphql/latest/enums/MetaobjectAdminAccess) with the [input enum](https://shopify.dev/docs/api/admin-graphql/latest/enums/MetaobjectAdminAccessInput).

Reference values add another boundary: a product ID belongs to its source store. Copying it into another store does not establish a valid relationship. The current planner blocks those definitions rather than dropping reference fields. Similarly, target-only entries are reported and retained because absence from a source export is not enough evidence to delete them.

The journal records confirmed creates, but it cannot roll back earlier remote operations. Treat it as a recovery aid. A failed journal write after a successful create leaves a real resource that may be missing from the disk receipt, so reconciliation must still inspect the remote target.

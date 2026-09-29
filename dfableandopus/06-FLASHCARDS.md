# Flashcards

36 cards. Cover the right column. Paths are relative to the project root.

| Question | Answer |
|---|---|
| What is a definition's business identity? | `type`, matched at `scripts/lib/planner.js:165` |
| What is an entry's business identity? | `type` plus `handle`, matched at `scripts/lib/planner.js:209` |
| Which API version is this code reviewed for? | `2026-07`, `API_VERSION` at `scripts/lib/client.js:2` |
| What happens if `SHOPIFY_API_VERSION` is set to anything else? | `createClient` throws at `scripts/lib/client.js:38-41`; it is a failure point, not an upgrade switch |
| Which HTTP statuses are retried? | 429, 502, 503, 504, reads only, `scripts/lib/client.js:77` |
| What caps the `Retry-After` wait? | `Math.min(retry * 1000, 10000)` at `scripts/lib/client.js:81` |
| What is the backoff without a `Retry-After` header? | `250 * 2 ** attempt` at `scripts/lib/client.js:82` |
| How many retries does a mutation get? | Zero: `const limit = mutation ? 0 : readRetries;` at `scripts/lib/client.js:56` |
| What if a caller forgets `{ mutation: true }`? | `scripts/lib/client.js:55` sets it from `/\bmutation\b/.test(query)` |
| Which GraphQL errors are retried? | Only when every error has `extensions.code === 'THROTTLED'`, `scripts/lib/client.js:102-109` |
| What does a mutation transport failure say? | `Mutation transport failed; outcome is unknown. Re-export before retrying.` at `scripts/lib/client.js:73` |
| What is the request timeout and how is it applied? | 15000 ms default, via `AbortSignal.timeout(timeoutMs)` at `scripts/lib/client.js:67` |
| What header carries the token? | `X-Shopify-Access-Token` at `scripts/lib/client.js:65` |
| Why does the token reject `\r` and `\n`? | Header injection; check at `scripts/lib/client.js:36` |
| What does `redirect: 'error'` at `scripts/lib/client.js:64` prevent? | Following a redirect that would resend the token to another host |
| What regex defines a secret? | `/shpat_[A-Za-z0-9]+/g`, `SECRET` at `scripts/lib/client.js:7` |
| What does `detailed(message, details)` attach? | A redacted `error.details`, `scripts/lib/client.js:16-20`; never headers |
| Which fields of a `userErrors` entry are kept? | `field`, `code`, `message` at `scripts/lib/client.js:178-182` |
| Three ways `pages` can fail | Malformed envelope `:137`, repeated or empty cursor `:141-142`, page limit `:146`, all in `scripts/lib/client.js` |
| Default `maxPages` | 1000, `scripts/lib/client.js:125` |
| Where does the cursor travel? | In the `after` variable at `scripts/lib/client.js:130`, never in the document string |
| Four checks before a create is called successful | Payload with array `userErrors` `:173`, empty `userErrors` `:175`, non-empty string id `:184-186`, all in `scripts/lib/client.js`, after `query`'s envelope checks |
| What does `canonical` do? | `JSON.stringify` of a recursively key-sorted clone, `scripts/lib/planner.js:14` with `stable` at `:4-13` |
| Is the plan hash a security control? | No. Order-independent equality only; the gate is full-artifact comparison at `scripts/lib/planner.js:272` |
| Which two hashes are in the plan? | `sourceHash` and `targetHash` at `scripts/lib/planner.js:249-250` |
| Why is `PUBLIC_READ_WRITE` not sent on create? | Output-only value for merchant-owned types; only `storefront` and `customerAccount` are copied, `scripts/lib/planner.js:77-79` |
| Five reasons `buildPlan` raises a conflict | App-owned type `:166`, non-public admin `:173`, enabled onlineStore/renderable `:180`, reference field `:187`, differing definition or entry `:195` and `:211`, in `scripts/lib/planner.js` |
| What happens to target-only entries? | Reported in `targetOnly` at `scripts/lib/planner.js:236-243`, never deleted |
| Do conflicts block unrelated creates? | Yes, `scripts/lib/planner.js:274` throws before the loop |
| What does `applyPlan` compare? | A freshly rebuilt plan against the reviewed one, `canonical(plan) !== canonical(current)` at `scripts/lib/planner.js:272` |
| What does a stopped run record? | `status = 'stopped'` and `failed = { index, message }` at `scripts/lib/planner.js:295-296` |
| Why is the post-failure journal write wrapped in an empty catch? | So a disk error cannot replace the real operation failure; `scripts/lib/planner.js:297-301` |
| Why journal before the first create? | `scripts/lib/planner.js:281`, so an unwritable destination fails before anything remote happens |
| What flag makes output non-destructive? | `flag: 'wx'` in `newOutput` at `scripts/populate-metaobjects.js:58`, surfaced as `Output already exists; choose a new path.` at `:125` |
| How does the journal update after the first write? | Temp sibling `.metaobject-journal-<uuid>.tmp` then `fs.rename`, `scripts/populate-metaobjects.js:77-83` |
| What stops the script acting on import? | `if (require.main === module)` at `scripts/populate-metaobjects.js:118`; default command is `help` at `:20` |
| What does `npm test` run, and how many cases pass? | `node --test test/*.test.js`, 43 passing |
| Which three files does `npm run check` syntax-check? | `scripts/populate-metaobjects.js`, `scripts/lib/client.js`, `scripts/lib/planner.js`, per `package.json` |
| What does the example plan produce from the fixtures? | Two operations, `createDefinition` for `size_guide` then `createEntry` for handle `general`, zero conflicts |
| What race remains after the preflight? | The target can change between `exportSnapshot` at `scripts/lib/planner.js:270` and the first `createRemote` at `:285`; there is no cross-store transaction |
| What is still outstanding outside the code? | The original Shopify token needs revoking by the account owner; `astraupskill/VERIFICATION.md` names the surviving backup copy |

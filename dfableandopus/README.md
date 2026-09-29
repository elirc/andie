# Interview prep built on the metaobject migration lab

This folder turns `andie-metaobject-learning-lab` into job-readiness material. The sibling course in `astraupskill/` teaches how the tool works; this folder teaches how to be questioned about it by a hiring panel and how to answer without overclaiming.

## The pitch

I replaced a Shopify theme script that carried hardcoded `shpat_` tokens and wrote to configured stores on import with a three-boundary Node 22 utility: a pure planner (`scripts/lib/planner.js`), a transport client (`scripts/lib/client.js`) and a CLI that refuses to act without an explicit command (`scripts/populate-metaobjects.js:118`). The old script paged only the first page of definitions, spliced cursors into GraphQL strings, deleted fields off shared fetched objects while building mutation variables, and treated HTTP 200 as success. The replacement produces a reviewable plan with a `sourceHash`/`targetHash` pair (`scripts/lib/planner.js:249-250`), re-exports and rebuilds that plan before the first mutation (`scripts/lib/planner.js:269-273`), and never retries a mutation whose outcome is unknown (`scripts/lib/client.js:56`). Verification is 43 `node --test` cases plus three `node --check` syntax checks, with zero third-party runtime dependencies.

## Target stacks

Node/JavaScript on the backend. The course chapter `astraupskill/10-WHAT-THIS-LOOKS-LIKE-IN-A-WEB-APP.md` already maps the two central ideas (plan-then-apply with a compare-and-set, cursor pagination with a stall guard) onto Express plus a SQL table, so every answer here can be restated for a CRUD web-app role without inventing anything.

## How to use this in two weeks

Week 1, learn to talk: read [01-INTERVIEW-QUESTIONS.md](01-INTERVIEW-QUESTIONS.md) with the source open in a second window, then rehearse [02-STORIES-AND-RESUME.md](02-STORIES-AND-RESUME.md) aloud until the 60-second summary is fluent.

Week 2, learn to perform: run [03-CODE-READING-DRILL.md](03-CODE-READING-DRILL.md) on a timer with the answers collapsed, do [04-TAKE-HOME.md](04-TAKE-HOME.md) in one sitting under four hours, then work [05-SYSTEM-DESIGN-FOLLOWUPS.md](05-SYSTEM-DESIGN-FOLLOWUPS.md) on a whiteboard. Drill [06-FLASHCARDS.md](06-FLASHCARDS.md) daily throughout.

Honesty rule carried over from `astraupskill/VERIFICATION.md`: no live Shopify account was ever contacted, and the original token still needs revocation by the account owner. Say so when asked.

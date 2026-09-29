# 10. What this looks like in a web app

[Course index](README.md)

The migration script's two ideas, *plan then apply* and *cursor pagination with a stall guard*, are exactly what a CRUD API needs for any bulk operation. Here they are as Express routes over a SQL table.

## Plan, then apply

```ts
// POST /migrations  -> compute a plan from source and target snapshots, store it, return it with a hash
app.post('/migrations', async (req, res) => {
  const { source, target } = parseSnapshots(req.body);                     // Zod, strict
  const operations = plan(source, target);                                  // pure, same function as the CLI
  const hash = sha256(JSON.stringify(operations));
  const id = randomUUID();
  await db.migration.create({ data: { id, hash, operations, status: 'planned' } });
  res.status(201).json({ id, hash, operations });
});

// POST /migrations/:id/apply  -> execute exactly the plan the client reviewed; 409 if it is stale
app.post('/migrations/:id/apply', async (req, res) => {
  const { hash } = z.object({ hash: z.string().length(64) }).parse(req.body);
  const claimed = await db.migration.updateMany({ where: { id: req.params.id, hash, status: 'planned' }, data: { status: 'applying' } });
  if (claimed.count === 0) return res.status(409).json({ error: 'Plan is stale or already applied. Re-plan and review again.' });
  const m = await db.migration.findUniqueOrThrow({ where: { id: req.params.id } });
  const results = [];
  for (const op of m.operations) results.push(await applyOne(op));          // each op idempotent by natural key
  await db.migration.update({ where: { id: m.id }, data: { status: 'applied', results } });
  res.json({ id: m.id, results });
});
```

The `hash` is the client saying "this is the plan I looked at"; the conditional `updateMany` on `(id, hash, status)` is the same compare-and-set as the CLI's plan file check, and it also makes a double click safe (the second claim finds `status = 'applying'` and gets 409).

## Cursor pagination with a stall guard

```ts
app.get('/entries', async (req, res) => {
  const after = req.query.after ? decodeCursor(String(req.query.after)) : null;
  const rows = await db.entry.findMany({ where: after ? { id: { gt: after.id } } : {}, orderBy: { id: 'asc' }, take: 101 });
  const page = rows.slice(0, 100);
  const next = rows.length > 100 ? encodeCursor({ id: page[page.length - 1].id }) : null;
  res.json({ items: page, next });
});
```

The client loop is the script's `pages()`: follow `next` until null, keep a `seen` set of cursors, and fail if a cursor repeats or the page count exceeds a limit. A server bug that returns the same cursor forever must be detected by the client, exactly as with Shopify.

## Exercise

Implement both routes against SQLite, then write three tests: applying with a stale hash is 409 and changes nothing; applying twice concurrently yields one 200 and one 409; a paginated read over 250 rows makes exactly three requests and stops.

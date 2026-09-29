'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createServer } = require('node:http');
const { createClient, pages, exportSnapshot, createRemote } = require('../scripts/lib/client');
const { buildPlan, applyPlan } = require('../scripts/lib/planner');
const { parse, newOutput, journalWriter } = require('../scripts/populate-metaobjects');
const sourceFixture = require('../fixtures/source.json'),
  targetFixture = require('../fixtures/target.json');
const fixture = () => [structuredClone(sourceFixture), structuredClone(targetFixture)];
const response = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers });
function fakeClient(
  snapshot,
  onMutation = async () => ({
    metaobjectCreate: { metaobject: { id: 'gid://test/entry' }, userErrors: [] },
    metaobjectDefinitionCreate: {
      metaobjectDefinition: { id: 'gid://test/definition' },
      userErrors: [],
    },
  }),
) {
  const calls = [];
  return {
    store: snapshot.store,
    apiVersion: snapshot.apiVersion,
    calls,
    async query(query, variables, options) {
      calls.push({ query, variables, options });
      if (options?.mutation) return onMutation(query, variables);
      if (query.includes('metaobjectDefinitions('))
        return {
          metaobjectDefinitions: {
            nodes: snapshot.definitions.map(({ metaobjects, ...definition }) => definition),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        };
      return {
        metaobjects: {
          nodes: snapshot.definitions.find((d) => d.type === variables.type).metaobjects,
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      };
    },
  };
}
const options = (source, target, journal) => ({
  sourceClient: fakeClient(source),
  targetClient: fakeClient(target),
  confirmTarget: target.store,
  journal,
});
test('offline plan includes missing definition before its entry', () => {
  const plan = buildPlan(...fixture());
  assert.deepEqual(
    plan.operations.map((o) => o.kind),
    ['createDefinition', 'createEntry'],
  );
  assert.equal(plan.conflicts.length, 0);
  assert.deepEqual(plan.operations[1].input.fields, [{ key: 'title', value: 'Find your fit' }]);
});
test('planning never mutates source objects across multiple targets', () => {
  const [s, t] = fixture(),
    before = JSON.stringify(s);
  buildPlan(s, t);
  t.store = 'third-learning';
  buildPlan(s, t);
  assert.equal(JSON.stringify(s), before);
  assert.equal(s.definitions[0].metaobjects[0].fields[0].type, 'single_line_text_field');
});
test('matching target entries are unchanged and produce no operations', () => {
  const [s] = fixture(),
    t = structuredClone(s);
  t.store = 'target-learning';
  const p = buildPlan(s, t);
  assert.equal(p.operations.length, 0);
  assert.equal(p.unchanged.length, 1);
});
test('changed existing entry is a conflict rather than a silent skip or overwrite', () => {
  const [s] = fixture(),
    t = structuredClone(s);
  t.store = 'target-learning';
  t.definitions[0].metaobjects[0].fields[0].value = 'Target edit';
  const p = buildPlan(s, t);
  assert.equal(p.conflicts.length, 1);
  assert.equal(p.operations.length, 0);
});
test('schema differences block entries under that definition', () => {
  const [s] = fixture(),
    t = structuredClone(s);
  t.store = 'target-learning';
  t.definitions[0].name = 'Different';
  t.definitions[0].metaobjects = [];
  const p = buildPlan(s, t);
  assert.equal(p.operations.length, 0);
  assert.match(p.conflicts[0].reason, /schema migration/);
});
test('reference fields block migration without being silently dropped', () => {
  const [s, t] = fixture();
  s.definitions[0].fieldDefinitions[0].type.name = 'product_reference';
  s.definitions[0].metaobjects[0].fields[0].type = 'product_reference';
  const p = buildPlan(s, t);
  assert.equal(p.operations.length, 0);
  assert.match(p.conflicts[0].reason, /ID mapping/);
});
test('app-owned types require a separate ownership migration', () => {
  const [s, t] = fixture();
  s.definitions[0].type = '$app:private';
  assert.equal(buildPlan(s, t).conflicts.length, 1);
});
test('duplicate definitions and handles are rejected before planning', () => {
  const [s, t] = fixture();
  s.definitions.push(structuredClone(s.definitions[0]));
  assert.throws(() => buildPlan(s, t), /Duplicate definition/);
  s.definitions.pop();
  s.definitions[0].metaobjects.push(structuredClone(s.definitions[0].metaobjects[0]));
  assert.throws(() => buildPlan(s, t), /Duplicate entry handle/);
});
test('required missing values and mismatched field types are rejected', () => {
  const [s, t] = fixture();
  s.definitions[0].metaobjects[0].fields[0].value = null;
  assert.throws(() => buildPlan(s, t), /Required/);
  s.definitions[0].metaobjects[0].fields[0].value = 'x';
  s.definitions[0].metaobjects[0].fields[0].type = 'number_integer';
  assert.throws(() => buildPlan(s, t), /does not match/);
});
test('target-only content is reported and never deleted', () => {
  const [s] = fixture(),
    t = structuredClone(s);
  t.store = 'target-learning';
  t.definitions[0].metaobjects[0].handle = 'target-only';
  const p = buildPlan(s, t);
  assert.equal(p.targetOnly.length, 1);
  assert.ok(p.operations.every((o) => o.kind.startsWith('create')));
});
test('source and target identities must differ and be bare shop names', () => {
  const [s, t] = fixture();
  t.store = s.store;
  assert.throws(() => buildPlan(s, t), /must differ/);
  t.store = 'example.com/path';
  assert.throws(() => buildPlan(s, t), /bare/);
});
test('normalized plan ignores definition and field ordering', () => {
  const [s, t] = fixture();
  s.definitions.push({ ...structuredClone(s.definitions[0]), type: 'another', name: 'Another' });
  const a = buildPlan(s, t);
  s.definitions.reverse();
  assert.deepEqual(buildPlan(s, t), a);
});
test('pagination passes opaque cursors through variables', async () => {
  const calls = [];
  const cursor = 'opaque"cursor\\value';
  const client = {
    async query(q, v) {
      calls.push({ q, v });
      return {
        items: {
          nodes: [calls.length],
          pageInfo: { hasNextPage: calls.length === 1, endCursor: cursor },
        },
      };
    },
  };
  assert.deepEqual(await pages(client, 'query($after:String){items}', 'items'), [1, 2]);
  assert.equal(calls[1].v.after, cursor);
  assert.ok(!calls[1].q.includes(cursor));
});
test('pagination rejects repeated cursors and incomplete envelopes', async () => {
  await assert.rejects(
    pages(
      {
        query: async () => ({
          items: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'same' } },
        }),
      },
      'q',
      'items',
    ),
    /did not advance/,
  );
  await assert.rejects(
    pages({ query: async () => ({ items: { nodes: [] } }) }, 'q', 'items'),
    /Malformed/,
  );
});
test('pagination has a finite page limit', async () => {
  let n = 0;
  await assert.rejects(
    pages(
      {
        query: async () => ({
          items: { nodes: [], pageInfo: { hasNextPage: true, endCursor: String(++n) } },
        }),
      },
      'q',
      'items',
      {},
      2,
    ),
    /limit exceeded/,
  );
  assert.equal(n, 2);
});
test('export retrieves entries for every definition and includes store/version', async () => {
  const [s] = fixture();
  const result = await exportSnapshot(fakeClient(s));
  assert.deepEqual(result, s);
});
test('HTTP reads retry bounded throttling without leaking tokens', async () => {
  let calls = 0;
  const delays = [];
  const client = createClient({
    store: 'local-test',
    token: 'private-fixture-token',
    delay: async (ms) => delays.push(ms),
    fetchImpl: async (url, options) => {
      assert.match(url, /\/2026-07\/graphql.json$/);
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['X-Shopify-Access-Token'], 'private-fixture-token');
      return ++calls < 3
        ? response({}, 429, { 'Retry-After': '999' })
        : response({ data: { ok: true } });
    },
  });
  assert.deepEqual(await client.query('query {ok}'), { ok: true });
  assert.deepEqual(delays, [10000, 10000]);
});
test('GraphQL throttling retries reads but other GraphQL errors fail', async () => {
  let calls = 0;
  const client = createClient({
    store: 'local-test',
    token: 'fixture',
    delay: async () => {},
    fetchImpl: async () =>
      ++calls === 1
        ? response({ errors: [{ extensions: { code: 'THROTTLED' } }] })
        : response({ data: { ok: true } }),
  });
  await client.query('q');
  assert.equal(calls, 2);
  const bad = createClient({
    store: 'local-test',
    token: 'fixture',
    fetchImpl: async () => response({ errors: [{ message: 'remote secret' }] }),
  });
  await assert.rejects(
    bad.query('q'),
    (error) => error.message.includes('GraphQL') && !error.message.includes('remote secret'),
  );
});
test('mutations are never automatically retried on HTTP failure', async () => {
  let calls = 0;
  const client = createClient({
    store: 'local-test',
    token: 'fixture',
    fetchImpl: async () => {
      calls++;
      return response({}, 503);
    },
  });
  await assert.rejects(client.query('mutation {}', {}, { mutation: true }), /outcome/);
  assert.equal(calls, 1);
});
test('network failure preserves unknown mutation outcome without exposing request details', async () => {
  const client = createClient({
    store: 'local-test',
    token: 'private-fixture-token',
    fetchImpl: async () => {
      throw new Error('private-fixture-token in request');
    },
  });
  await assert.rejects(
    client.query('mutation {}', {}, { mutation: true }),
    (error) => /unknown/.test(error.message) && !error.message.includes('private-fixture-token'),
  );
});
test('API fallback and malformed successful responses are rejected', async () => {
  const client = createClient({
    store: 'local-test',
    token: 'fixture',
    fetchImpl: async () => response({ data: {} }, 200, { 'X-Shopify-API-Version': '2099-01' }),
  });
  await assert.rejects(client.query('q'), /different API version/);
  const invalid = createClient({
    store: 'local-test',
    token: 'fixture',
    fetchImpl: async () => new Response('not json'),
  });
  await assert.rejects(invalid.query('q'), /invalid JSON/);
});
test('mutation userErrors and missing IDs are never called success', async () => {
  await assert.rejects(
    createRemote(
      {
        query: async () => ({
          metaobjectCreate: { metaobject: null, userErrors: [{ message: 'bad' }] },
        }),
      },
      { kind: 'createEntry', input: {} },
    ),
    /userErrors/,
  );
  await assert.rejects(
    createRemote(
      { query: async () => ({ metaobjectCreate: { metaobject: null, userErrors: [] } }) },
      { kind: 'createEntry', input: {} },
    ),
    /no resource ID/,
  );
});
test('apply validates the current stores before ordered creates and receipts', async () => {
  const [s, t] = fixture(),
    plan = buildPlan(s, t),
    receipts = [];
  const opts = options(s, t, async (r) => receipts.push(r));
  const result = await applyPlan(plan, opts);
  assert.equal(result.status, 'complete');
  assert.equal(result.completed.length, 2);
  assert.deepEqual(
    opts.targetClient.calls
      .filter((c) => c.options?.mutation)
      .map((c) => Object.keys(c.variables)[0]),
    ['definition', 'metaobject'],
  );
  assert.equal(receipts.at(-1).status, 'complete');
});
test('missing confirmation sends no reads or writes', async () => {
  const [s, t] = fixture(),
    opts = options(s, t);
  opts.confirmTarget = 'wrong';
  await assert.rejects(applyPlan(buildPlan(s, t), opts), /confirmation/);
  assert.equal(opts.sourceClient.calls.length, 0);
  assert.equal(opts.targetClient.calls.length, 0);
});
test('changed source or forged plan is rejected before mutations', async () => {
  const [s, t] = fixture(),
    plan = buildPlan(s, t);
  plan.operations[0].input.name = 'forged';
  const opts = options(s, t);
  await assert.rejects(applyPlan(plan, opts), /stale or changed/);
  assert.equal(opts.targetClient.calls.filter((c) => c.options?.mutation).length, 0);
});
test('a plan with conflicts sends no mutations even for other missing entries', async () => {
  const [s, t] = fixture();
  s.definitions.push({ ...structuredClone(s.definitions[0]), type: 'app--123--owned' });
  const plan = buildPlan(s, t),
    opts = options(s, t);
  assert.ok(plan.operations.length);
  await assert.rejects(applyPlan(plan, opts), /conflicts/);
  assert.equal(opts.targetClient.calls.filter((c) => c.options?.mutation).length, 0);
});
test('partial remote failure stops later work and retains confirmed receipts', async () => {
  const [s, t] = fixture(),
    plan = buildPlan(s, t),
    opts = options(s, t);
  let count = 0;
  opts.targetClient = fakeClient(t, async () => {
    if (++count === 2) throw new Error('outcome unknown');
    return {
      metaobjectDefinitionCreate: { metaobjectDefinition: { id: 'definition-1' }, userErrors: [] },
    };
  });
  await assert.rejects(
    applyPlan(plan, opts),
    (error) => error.result.completed.length === 1 && error.result.failed.index === 1,
  );
  assert.equal(count, 2);
});
test('journal failure before first mutation prevents all writes', async () => {
  const [s, t] = fixture(),
    opts = options(s, t, async () => {
      throw new Error('disk failure');
    });
  await assert.rejects(applyPlan(buildPlan(s, t), opts), /disk failure/);
  assert.equal(opts.targetClient.calls.filter((c) => c.options?.mutation).length, 0);
});
test('journal failure after a create stops before the next create', async () => {
  const [s, t] = fixture();
  let calls = 0;
  const opts = options(s, t, async () => {
    if (++calls > 1) throw new Error('disk failure');
  });
  await assert.rejects(
    applyPlan(buildPlan(s, t), opts),
    (error) => error.result.completed.length === 1,
  );
  assert.equal(opts.targetClient.calls.filter((c) => c.options?.mutation).length, 1);
});
test('CLI parser rejects unknown duplicate and incomplete options', () => {
  assert.equal(parse([]).command, 'help');
  assert.throws(() => parse(['apply', '--plan', 'x']), /Required/);
  assert.throws(() => parse(['plan', '--source', 'a', '--source', 'b']), /duplicate/);
  assert.throws(() => parse(['delete']), /Unknown/);
});
test('new output and journal protect existing files and persist receipts', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'andie-files-'));
  try {
    const file = path.join(directory, 'journal.json');
    const journal = journalWriter(file);
    await journal({ status: 'running' });
    await journal({ status: 'complete', completed: [1] });
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), {
      status: 'complete',
      completed: [1],
    });
    await assert.rejects(newOutput(file, {}), { code: 'EEXIST' });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test('import and offline CLI planning need no network or credentials', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'andie-cli-'));
  try {
    const root = path.resolve(__dirname, '..'),
      guard = path.join(directory, 'guard.cjs');
    await fs.writeFile(
      guard,
      "globalThis.fetch = () => { throw new Error('NETWORK FORBIDDEN'); };\n",
    );
    const imported = spawnSync(
      process.execPath,
      [
        '--require',
        guard,
        '-e',
        "require('./scripts/populate-metaobjects');console.log('imported')",
      ],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(imported.status, 0);
    assert.equal(imported.stdout.trim(), 'imported');
    const run = spawnSync(
      process.execPath,
      [
        '--require',
        guard,
        'scripts/populate-metaobjects.js',
        'plan',
        '--source',
        'fixtures/source.json',
        '--target',
        'fixtures/target.json',
        '--out',
        path.join(directory, 'plan.json'),
      ],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      JSON.parse(await fs.readFile(path.join(directory, 'plan.json'), 'utf8')).operations.length,
      2,
    );
    const repeat = spawnSync(
      process.execPath,
      [
        '--require',
        guard,
        'scripts/populate-metaobjects.js',
        'plan',
        '--source',
        'fixtures/source.json',
        '--target',
        'fixtures/target.json',
        '--out',
        path.join(directory, 'plan.json'),
      ],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(repeat.status, 1);
    assert.match(repeat.stderr, /already exists/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test('real HTTP transport uses variables and accepts a valid GraphQL envelope', async () => {
  let received;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: { ok: true } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = createClient({
      store: 'local-test',
      token: 'fixture-only',
      fetchImpl: (_url, options) => fetch(`http://127.0.0.1:${server.address().port}`, options),
    });
    assert.deepEqual(await client.query('query($after:String){ok}', { after: 'cursor"value' }), {
      ok: true,
    });
    assert.deepEqual(received.variables, { after: 'cursor"value' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('source changes since planning prevent all mutations', async () => {
  const [s, t] = fixture(),
    plan = buildPlan(s, t);
  s.definitions[0].metaobjects[0].fields[0].value = 'New source value';
  const opts = options(s, t);
  await assert.rejects(applyPlan(plan, opts), /stale or changed/);
  assert.equal(opts.targetClient.calls.filter((c) => c.options?.mutation).length, 0);
});
test('target changes since planning prevent all mutations', async () => {
  const [s, t] = fixture(),
    plan = buildPlan(s, t);
  t.definitions = structuredClone(s.definitions);
  const opts = options(s, t);
  await assert.rejects(applyPlan(plan, opts), /stale or changed/);
  assert.equal(opts.targetClient.calls.filter((c) => c.options?.mutation).length, 0);
});
test('mutation document without explicit option still cannot retry', async () => {
  let count = 0;
  const client = createClient({
    store: 'local-test',
    token: 'fixture',
    fetchImpl: async () => {
      count++;
      return response({}, 503);
    },
  });
  await assert.rejects(client.query('mutation Create { example }'), /outcome/);
  assert.equal(count, 1);
});
test('invalid store token and API version fail before transport', () => {
  const fetchImpl = () => {
    throw new Error('unexpected transport');
  };
  assert.throws(
    () => createClient({ store: 'evil.example/path', token: 'fixture', fetchImpl }),
    /bare/,
  );
  assert.throws(
    () => createClient({ store: 'local-test', token: 'bad\nheader', fetchImpl }),
    /environment/,
  );
  assert.throws(
    () => createClient({ store: 'local-test', token: 'fixture', apiVersion: '2023-04', fetchImpl }),
    /review queries/,
  );
});

test('merchant-owned output admin access is not copied into the input enum', () => {
  const [s, t] = fixture();
  s.definitions[0].access.admin = 'PUBLIC_READ_WRITE';
  const plan = buildPlan(s, t);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.operations[0].input.access.admin, undefined);
  assert.equal(plan.operations[0].input.access.storefront, 'PUBLIC_READ');
});
test('non-public admin ownership is explicitly blocked', () => {
  const [s, t] = fixture();
  s.definitions[0].access.admin = 'MERCHANT_READ';
  const plan = buildPlan(s, t);
  assert.equal(plan.operations.length, 0);
  assert.match(plan.conflicts[0].reason, /ownership/);
});
test('enabled online-store or renderable capability is not silently omitted', () => {
  for (const key of ['onlineStore', 'renderable']) {
    const [s, t] = fixture();
    s.definitions[0].capabilities[key] = { enabled: true };
    const plan = buildPlan(s, t);
    assert.equal(plan.operations.length, 0);
    assert.match(plan.conflicts[0].reason, /capability/);
  }
});
test('target ownership differences block otherwise matching definitions', () => {
  const [s] = fixture(),
    t = structuredClone(s);
  t.store = 'target-learning';
  t.definitions[0].access.admin = 'MERCHANT_READ';
  t.definitions[0].metaobjects = [];
  const plan = buildPlan(s, t);
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.conflicts.length, 1);
});
test('unknown capability and access settings require schema review', () => {
  const [s, t] = fixture();
  s.definitions[0].capabilities.future = { enabled: true };
  assert.throws(() => buildPlan(s, t), /Unsupported capability/);
  delete s.definitions[0].capabilities.future;
  s.definitions[0].access.future = 'PUBLIC';
  assert.throws(() => buildPlan(s, t), /Unsupported access/);
});

test('error detail is attached and redacted, never discarded', async () => {
  const { createClient, redact } = require('../scripts/lib/client.js');
  assert.deepEqual(redact({ message: 'token shpat_abc123 leaked', nested: ['shpat_zzz'] }), {
    message: 'token shpat_[redacted] leaked',
    nested: ['shpat_[redacted]'],
  });
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        errors: [
          {
            message: 'Field bad shpat_secret999',
            extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
          },
        ],
      }),
      { status: 200, headers: { 'X-Shopify-API-Version': '2026-07' } },
    );
  const client = createClient({ store: 'demo-store', token: 'shpat_testtoken', fetchImpl });
  await assert.rejects(client.query('query { shop { id } }'), (error) => {
    assert.match(error.message, /GraphQL errors/);
    assert.deepEqual(error.details, [
      { message: 'Field bad shpat_[redacted]', code: 'GRAPHQL_VALIDATION_FAILED' },
    ]);
    return true;
  });
});

'use strict';
const API_VERSION = '2026-07';
const DEFINITIONS = `query Definitions($after: String) { metaobjectDefinitions(first: 100, after: $after) { nodes { name description displayNameKey type access { admin storefront customerAccount } capabilities { publishable { enabled } translatable { enabled } onlineStore { enabled } renderable { enabled } } fieldDefinitions { key name required type { name } validations { name value } } } pageInfo { hasNextPage endCursor } } }`;
const ENTRIES = `query Entries($type: String!, $after: String) { metaobjects(first: 100, type: $type, after: $after) { nodes { handle capabilities { publishable { status } } fields { key value type } } pageInfo { hasNextPage endCursor } } }`;
const CREATE_DEFINITION = `mutation CreateDefinition($definition: MetaobjectDefinitionCreateInput!) { metaobjectDefinitionCreate(definition: $definition) { metaobjectDefinition { id } userErrors { field code message } } }`;
const CREATE_ENTRY = `mutation CreateEntry($metaobject: MetaobjectCreateInput!) { metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field code message } } }`;
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
function storeName(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/.test(value))
    throw new Error('Store must be a bare myshopify subdomain.');
  return value;
}
function createClient({
  store,
  token,
  apiVersion = API_VERSION,
  fetchImpl = globalThis.fetch,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 15000,
  readRetries = 2,
}) {
  storeName(store);
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token))
    throw new Error('A token must be supplied through the environment.');
  if (apiVersion !== API_VERSION)
    throw new Error(
      `This implementation is reviewed for API ${API_VERSION}; review queries before changing versions.`,
    );
  if (
    !Number.isInteger(readRetries) ||
    readRetries < 0 ||
    readRetries > 5 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1
  )
    throw new Error('Invalid client limits.');
  return {
    store,
    apiVersion,
    async query(query, variables = {}, { mutation = false } = {}) {
      // Conservative extra guard for callers using a mutation document without the option.
      mutation = mutation || /\bmutation\b/.test(query);
      const limit = mutation ? 0 : readRetries;
      for (let attempt = 0; ; attempt++) {
        let response;
        try {
          response = await fetchImpl(
            `https://${store}.myshopify.com/admin/api/${apiVersion}/graphql.json`,
            {
              method: 'POST',
              redirect: 'error',
              headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
              body: JSON.stringify({ query, variables }),
              signal: AbortSignal.timeout(timeoutMs),
            },
          );
        } catch {
          throw new Error(
            mutation
              ? 'Mutation transport failed; outcome is unknown. Re-export before retrying.'
              : 'Read transport failed or timed out.',
          );
        }
        if (!mutation && [429, 502, 503, 504].includes(response.status) && attempt < limit) {
          const retry = Number(response.headers.get('Retry-After'));
          await delay(
            Number.isFinite(retry) && retry > 0
              ? Math.min(retry * 1000, 10000)
              : 250 * 2 ** attempt,
          );
          continue;
        }
        if (!response.ok)
          throw new Error(
            `Shopify HTTP ${response.status}${mutation ? '; mutation outcome must be reconciled' : ''}.`,
          );
        const served = response.headers.get('X-Shopify-API-Version');
        if (served && served !== apiVersion)
          throw new Error(
            'Shopify served a different API version; review compatibility before continuing.',
          );
        let payload;
        try {
          payload = await response.json();
        } catch {
          throw new Error('Shopify returned invalid JSON.');
        }
        if (payload?.errors?.length) {
          if (
            !mutation &&
            payload.errors.every((error) => error.extensions?.code === 'THROTTLED') &&
            attempt < limit
          ) {
            await delay(250 * 2 ** attempt);
            continue;
          }
          throw detailed(
            'Shopify returned GraphQL errors; no successful result was accepted.',
            payload.errors.map((error) => ({
              message: error.message,
              code: error.extensions?.code ?? null,
            })),
          );
        }
        if (!payload || !payload.data || typeof payload.data !== 'object')
          throw new Error('Shopify returned no GraphQL data.');
        return payload.data;
      }
    },
  };
}
async function pages(client, query, key, variables = {}, maxPages = 1000) {
  let after = null;
  const seen = new Set();
  const nodes = [];
  for (let page = 0; page < maxPages; page++) {
    const data = await client.query(query, { ...variables, after });
    const connection = data[key];
    if (
      !connection ||
      !Array.isArray(connection.nodes) ||
      typeof connection.pageInfo?.hasNextPage !== 'boolean'
    )
      throw new Error('Malformed paginated response.');
    nodes.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return nodes;
    const cursor = connection.pageInfo.endCursor;
    if (typeof cursor !== 'string' || !cursor || seen.has(cursor))
      throw new Error('Pagination cursor did not advance.');
    seen.add(cursor);
    after = cursor;
  }
  throw new Error('Pagination limit exceeded; snapshot is incomplete.');
}
async function exportSnapshot(client) {
  const definitions = await pages(client, DEFINITIONS, 'metaobjectDefinitions');
  const complete = [];
  for (const definition of definitions)
    complete.push({
      ...definition,
      metaobjects: await pages(client, ENTRIES, 'metaobjects', { type: definition.type }),
    });
  return {
    formatVersion: 1,
    apiVersion: client.apiVersion,
    store: client.store,
    definitions: complete,
  };
}
async function createRemote(client, operation) {
  const definition = operation.kind === 'createDefinition';
  if (!definition && operation.kind !== 'createEntry')
    throw new Error('Unsupported mutation operation.');
  const data = await client.query(
    definition ? CREATE_DEFINITION : CREATE_ENTRY,
    definition ? { definition: operation.input } : { metaobject: operation.input },
    { mutation: true },
  );
  const payload = data[definition ? 'metaobjectDefinitionCreate' : 'metaobjectCreate'];
  if (!payload || !Array.isArray(payload.userErrors))
    throw new Error('Mutation payload is incomplete; reconcile before retrying.');
  if (payload.userErrors.length)
    throw detailed(
      'Shopify rejected the mutation with userErrors; inspect the plan and schema.',
      payload.userErrors.map((error) => ({
        field: error.field ?? null,
        code: error.code ?? null,
        message: error.message,
      })),
    );
  const id = payload[definition ? 'metaobjectDefinition' : 'metaobject']?.id;
  if (typeof id !== 'string' || !id)
    throw new Error('Mutation returned no resource ID; reconcile before retrying.');
  return id;
}
module.exports = {
  API_VERSION,
  redact,
  storeName,
  createClient,
  pages,
  exportSnapshot,
  createRemote,
  DEFINITIONS,
  ENTRIES,
};

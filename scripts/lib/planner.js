'use strict';
const { createHash } = require('node:crypto');
const { API_VERSION, storeName, exportSnapshot, createRemote } = require('./client');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
}
const canonical = (value) => JSON.stringify(stable(value));
const hash = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}.`);
  return value;
};
function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}.`);
}
function normalizeSnapshot(snapshot) {
  if (!snapshot || snapshot.formatVersion !== 1 || snapshot.apiVersion !== API_VERSION)
    throw new Error('Unsupported snapshot format or API version.');
  storeName(snapshot.store);
  const definitions = array(snapshot.definitions, 'definitions')
    .map((def) => {
      text(def.type, 'definition type');
      text(def.name, 'definition name');
      const fields = array(def.fieldDefinitions, 'field definitions')
        .map((field) => {
          text(field.key, 'field key');
          text(field.name, 'field name');
          text(field.type?.name, 'field type');
          if (typeof field.required !== 'boolean')
            throw new Error('Field required must be boolean.');
          const validations = array(field.validations, 'validations')
            .map((v) => ({
              name: text(v.name, 'validation name'),
              value: text(v.value, 'validation value'),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
          return {
            key: field.key,
            name: field.name,
            type: field.type.name,
            required: field.required,
            validations,
          };
        })
        .sort((a, b) => a.key.localeCompare(b.key));
      unique(
        fields.map((f) => f.key),
        'field key',
      );
      const input = { name: def.name, type: def.type, fieldDefinitions: fields };
      if (def.description != null && def.description !== '')
        input.description = text(def.description, 'description');
      if (def.displayNameKey != null && def.displayNameKey !== '') {
        if (!fields.some((f) => f.key === def.displayNameKey))
          throw new Error('Unknown display-name field.');
        input.displayNameKey = def.displayNameKey;
      }
      if (def.access != null) {
        if (
          Object.keys(def.access).some(
            (key) => !['admin', 'storefront', 'customerAccount'].includes(key),
          )
        )
          throw new Error('Unsupported access field.');
        input.access = {};
        for (const key of ['storefront', 'customerAccount'])
          if (def.access[key] != null) input.access[key] = text(def.access[key], 'access setting');
        // PUBLIC_READ_WRITE is an output-only value for merchant-owned types; do not echo it into the input enum.
      }
      const unsupportedCapabilities = [];
      if (def.capabilities != null) {
        if (
          Object.keys(def.capabilities).some(
            (key) => !['publishable', 'translatable', 'onlineStore', 'renderable'].includes(key),
          )
        )
          throw new Error('Unsupported capability field.');
        for (const key of ['onlineStore', 'renderable'])
          if (def.capabilities[key] != null) {
            if (typeof def.capabilities[key].enabled !== 'boolean')
              throw new Error('Invalid capability.');
            if (def.capabilities[key].enabled) unsupportedCapabilities.push(key);
          }
        input.capabilities = {};
        for (const key of ['publishable', 'translatable'])
          if (def.capabilities[key] != null) {
            if (typeof def.capabilities[key].enabled !== 'boolean')
              throw new Error('Invalid capability.');
            input.capabilities[key] = { enabled: def.capabilities[key].enabled };
          }
      }
      const entries = array(def.metaobjects, 'metaobjects')
        .map((entry) => {
          const values = array(entry.fields, 'entry fields')
            .map((field) => {
              text(field.key, 'entry field key');
              text(field.type, 'entry field type');
              if (field.value !== null && typeof field.value !== 'string')
                throw new Error('Entry field value must be text or null.');
              const declaration = fields.find((f) => f.key === field.key);
              if (!declaration || declaration.type !== field.type)
                throw new Error('Entry field does not match its definition.');
              return { key: field.key, value: field.value, type: field.type };
            })
            .sort((a, b) => a.key.localeCompare(b.key));
          unique(
            values.map((f) => f.key),
            'entry field key',
          );
          for (const field of fields)
            if (
              field.required &&
              !values.some((v) => v.key === field.key && v.value !== null && v.value !== '')
            )
              throw new Error('Required entry field is missing.');
          const normalized = { handle: text(entry.handle, 'entry handle'), fields: values };
          if (entry.capabilities?.publishable != null) {
            const status = entry.capabilities.publishable.status;
            if (!['ACTIVE', 'DRAFT'].includes(status))
              throw new Error('Invalid publication status.');
            normalized.capabilities = { publishable: { status } };
          }
          return normalized;
        })
        .sort((a, b) => a.handle.localeCompare(b.handle));
      unique(
        entries.map((e) => e.handle),
        'entry handle',
      );
      return {
        type: def.type,
        input,
        entries,
        admin: def.access?.admin ?? 'PUBLIC_READ_WRITE',
        unsupportedCapabilities,
      };
    })
    .sort((a, b) => a.type.localeCompare(b.type));
  unique(
    definitions.map((d) => d.type),
    'definition type',
  );
  return { formatVersion: 1, apiVersion: snapshot.apiVersion, store: snapshot.store, definitions };
}
function buildPlan(sourceRaw, targetRaw) {
  const source = normalizeSnapshot(sourceRaw),
    target = normalizeSnapshot(targetRaw);
  if (source.store === target.store) throw new Error('Source and target stores must differ.');
  const operations = [],
    conflicts = [],
    unchanged = [],
    targetOnly = [];
  for (const definition of source.definitions) {
    const existing = target.definitions.find((d) => d.type === definition.type);
    if (definition.type.startsWith('$') || definition.type.startsWith('app--')) {
      conflicts.push({
        type: definition.type,
        reason: 'App-owned type requires a separate ownership migration.',
      });
      continue;
    }
    if (definition.admin !== 'PUBLIC_READ_WRITE') {
      conflicts.push({
        type: definition.type,
        reason: 'Admin access requires a separate ownership migration.',
      });
      continue;
    }
    if (definition.unsupportedCapabilities.length || existing?.unsupportedCapabilities.length) {
      conflicts.push({
        type: definition.type,
        reason: 'Online-store or renderable capability needs a dedicated migration.',
      });
      continue;
    }
    if (definition.input.fieldDefinitions.some((f) => f.type.includes('reference'))) {
      conflicts.push({
        type: definition.type,
        reason:
          'Reference fields require cross-store ID mapping; no fields will be silently dropped.',
      });
      continue;
    }
    if (
      existing &&
      (existing.admin !== definition.admin ||
        canonical(existing.input) !== canonical(definition.input))
    ) {
      conflicts.push({
        type: definition.type,
        reason: 'Definition differs; explicit schema migration required.',
      });
      continue;
    }
    if (!existing)
      operations.push({ kind: 'createDefinition', type: definition.type, input: definition.input });
    for (const entry of definition.entries) {
      const match = existing?.entries.find((e) => e.handle === entry.handle);
      if (match) {
        if (canonical(match) !== canonical(entry))
          conflicts.push({
            type: definition.type,
            handle: entry.handle,
            reason: 'Existing entry differs; update policy must be reviewed.',
          });
        else unchanged.push({ type: definition.type, handle: entry.handle });
      } else {
        const input = {
          type: definition.type,
          handle: entry.handle,
          fields: entry.fields
            .filter((f) => f.value !== null)
            .map((f) => ({ key: f.key, value: f.value })),
        };
        if (entry.capabilities) input.capabilities = entry.capabilities;
        operations.push({
          kind: 'createEntry',
          type: definition.type,
          handle: entry.handle,
          input,
        });
      }
    }
  }
  for (const definition of target.definitions)
    for (const entry of definition.entries)
      if (
        !source.definitions
          .find((d) => d.type === definition.type)
          ?.entries.some((e) => e.handle === entry.handle)
      )
        targetOnly.push({ type: definition.type, handle: entry.handle });
  return {
    formatVersion: 1,
    apiVersion: API_VERSION,
    sourceStore: source.store,
    targetStore: target.store,
    sourceHash: hash(source),
    targetHash: hash(target),
    operations,
    conflicts,
    unchanged,
    targetOnly,
  };
}
async function applyPlan(
  plan,
  { sourceClient, targetClient, confirmTarget, journal = async () => {} },
) {
  if (
    !plan ||
    plan.targetStore !== confirmTarget ||
    targetClient.store !== confirmTarget ||
    sourceClient.store !== plan.sourceStore ||
    sourceClient.store === targetClient.store
  )
    throw new Error('Explicit target confirmation and matching clients are required.');
  const source = await exportSnapshot(sourceClient),
    target = await exportSnapshot(targetClient);
  const current = buildPlan(source, target);
  if (canonical(plan) !== canonical(current))
    throw new Error('Plan is stale or changed. Export and review a new plan.');
  if (current.conflicts.length) throw new Error('Plan has conflicts; no mutation was sent.');
  const result = {
    status: 'running',
    targetStore: targetClient.store,
    completed: [],
    failed: null,
  };
  await journal(structuredClone(result));
  for (let index = 0; index < current.operations.length; index++) {
    const operation = current.operations[index];
    try {
      const id = await createRemote(targetClient, operation);
      result.completed.push({
        index,
        kind: operation.kind,
        type: operation.type,
        handle: operation.handle,
        id,
      });
      await journal(structuredClone(result));
    } catch (error) {
      result.status = 'stopped';
      result.failed = { index, message: error.message };
      try {
        await journal(structuredClone(result));
      } catch {
        /* Preserve the operation failure and completed in-memory receipt. */
      }
      const failure = new Error(
        'Apply stopped; earlier creates may exist. Re-export before retrying.',
      );
      failure.result = result;
      throw failure;
    }
  }
  result.status = 'complete';
  await journal(structuredClone(result));
  return result;
}
module.exports = { canonical, normalizeSnapshot, buildPlan, applyPlan };

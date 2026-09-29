#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createClient, exportSnapshot, API_VERSION } = require('./lib/client');
const { buildPlan, applyPlan } = require('./lib/planner');
const HELP = `Metaobject learning utility (Node 22; API ${API_VERSION})
  plan --source source.json --target target.json --out plan.json
    Offline: reads snapshots, creates a reviewable plan, sends no requests.
  export --role source|target --out snapshot.json
    Read-only network export using SHOPIFY_SOURCE_* or SHOPIFY_TARGET_* environment variables.
  apply --plan plan.json --confirm-target exact-store-name --journal new-journal.json
    Explicit remote CREATE operations after fresh source/target validation. No updates or deletes.
  help

Outputs must be new files. Tokens are read only from process environment.
No command runs automatically on import or with no arguments.`;
function parse(argv) {
  const command = argv[0] || 'help';
  const options = {};
  const allowed = {
    help: [],
    plan: ['source', 'target', 'out'],
    export: ['role', 'out'],
    apply: ['plan', 'confirm-target', 'journal'],
  }[command];
  if (!allowed) throw new Error('Unknown command. Run help.');
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index]?.slice(2),
      value = argv[index + 1];
    if (
      !argv[index].startsWith('--') ||
      !allowed.includes(key) ||
      key in options ||
      !value ||
      value.startsWith('--')
    )
      throw new Error('Invalid, duplicate or missing option. Run help.');
    options[key] = value;
  }
  if (allowed.some((key) => !options[key])) throw new Error('Required option missing. Run help.');
  if (command === 'export' && !['source', 'target'].includes(options.role))
    throw new Error('Export role must be source or target.');
  return { command, options };
}
async function readJson(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 20 * 1024 * 1024)
    throw new Error('Input must be a JSON file no larger than 20 MiB.');
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    throw new Error('Input JSON could not be parsed.');
  }
}
async function newOutput(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
}
function clientFor(role, env) {
  const prefix = `SHOPIFY_${role.toUpperCase()}_`;
  return createClient({
    store: env[`${prefix}STORE`],
    token: env[`${prefix}TOKEN`],
    apiVersion: env.SHOPIFY_API_VERSION || API_VERSION,
  });
}
function journalWriter(file) {
  const destination = path.resolve(file);
  let owned = false;
  return async (value) => {
    if (!owned) {
      await newOutput(destination, value);
      owned = true;
      return;
    }
    const temporary = path.join(
      path.dirname(destination),
      `.metaobject-journal-${randomUUID()}.tmp`,
    );
    try {
      await newOutput(temporary, value);
      await fs.rename(temporary, destination);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  };
}
async function main(argv = process.argv.slice(2), env = process.env, out = console.log) {
  const { command, options } = parse(argv);
  if (command === 'help') {
    out(HELP);
    return;
  }
  if (command === 'plan') {
    const plan = buildPlan(await readJson(options.source), await readJson(options.target));
    await newOutput(options.out, plan);
    out(
      `Plan written: ${plan.operations.length} proposed creates, ${plan.conflicts.length} conflicts, ${plan.unchanged.length} unchanged. No network requests.`,
    );
    return;
  }
  if (command === 'export') {
    const snapshot = await exportSnapshot(clientFor(options.role, env));
    await newOutput(options.out, snapshot);
    out(`Read-only export written: ${snapshot.definitions.length} definitions.`);
    return;
  }
  const plan = await readJson(options.plan);
  const result = await applyPlan(plan, {
    sourceClient: clientFor('source', env),
    targetClient: clientFor('target', env),
    confirmTarget: options['confirm-target'],
    journal: journalWriter(options.journal),
  });
  out(`Apply complete: ${result.completed.length} confirmed creates. See the journal.`);
}
if (require.main === module)
  main().catch((error) => {
    // Do not print request objects, tokens, remote response bodies or full snapshots.
    console.error(
      error.result
        ? `${error.message} Confirmed receipts: ${error.result.completed.length}.`
        : error.code === 'EEXIST'
          ? 'Output already exists; choose a new path.'
          : error.message,
    );
    process.exitCode = 1;
  });
module.exports = { parse, readJson, newOutput, journalWriter, main };

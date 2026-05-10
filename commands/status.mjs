/**
 * commands/status.mjs — via status
 * Unified ecosystem health check. Reads live DB counts.
 *
 * Usage:
 *   via status
 *   via status --json
 */

import { existsSync } from 'fs';
import { homedir }    from 'os';
import { join }       from 'path';
import { detectTools } from '../utils/detect.mjs';
import { readConfig, hasSlipstream } from '../utils/config.mjs';
import { getDb, viaDir } from '../utils/db.mjs';
import { bold, dim, green, yellow } from '../utils/format.mjs';

function tick(ok) { return ok ? green('✓') : dim('–'); }

async function dbCount(dbName, sql) {
  try {
    const db = await getDb(dbName);
    const row = db.prepare(sql).get();
    return row ? Object.values(row)[0] : 0;
  } catch { return 0; }
}

export async function run(args) {
  const asJSON = args.includes('--json');

  const tools      = detectTools();
  const slipstream = hasSlipstream();
  const config     = readConfig();

  // Live DB reads
  const [tasksOpen, tasksInProg, tasksDone, spendToday, auditTotal] = await Promise.all([
    dbCount('tasks', `SELECT COUNT(*) as n FROM tasks WHERE status='open'`),
    dbCount('tasks', `SELECT COUNT(*) as n FROM tasks WHERE status='in_progress'`),
    dbCount('tasks', `SELECT COUNT(*) as n FROM tasks WHERE status='done'`),
    dbCount('spend', `SELECT ROUND(SUM(cost_usd),4) as n FROM spend WHERE date(logged_at)=date('now')`),
    dbCount('audit', `SELECT COUNT(*) as n FROM audit`),
  ]);

  const spendWeek = await dbCount('spend',
    `SELECT ROUND(SUM(cost_usd),4) as n FROM spend WHERE date(logged_at)>=date('now','-7 days')`);

  const memFacts = slipstream
    ? (config.slipstream_fact_count ?? '?')
    : await dbCount('memory', `SELECT COUNT(*) as n FROM memory`);

  const status = {
    version: '0.1.0',
    tools,
    slipstream,
    memory: { backend: slipstream ? 'slipstream' : 'sqlite', facts: memFacts },
    tasks:  { open: tasksOpen, in_progress: tasksInProg, done: tasksDone },
    spend:  { today: spendToday ?? 0, week: spendWeek ?? 0 },
    audit:  { decisions: auditTotal },
  };

  if (asJSON) { console.log(JSON.stringify(status, null, 2)); return; }

  const toolLine = Object.entries(tools)
    .map(([k, v]) => `${k} ${tick(v)}`)
    .join('   ');

  const memLine = slipstream
    ? `slipstream · ${memFacts} facts`
    : `local SQLite · ${memFacts} facts`;

  const slipLine = slipstream
    ? green('connected ✓')
    : `not connected  →  ${dim('via upgrade')}`;

  const spendLine = `today $${(spendToday ?? 0).toFixed(4)} · week $${(spendWeek ?? 0).toFixed(4)}`;

  console.log(`
  Via v0.1.0 — Vektor Memory

    tools       ${toolLine}
    memory      ${memLine}
    slipstream  ${slipLine}
    tasks       ${tasksOpen} open · ${tasksInProg} in-progress · ${tasksDone} done
    spend       ${spendLine}
    audit       ${auditTotal} decisions logged

  Run 'via --help' for all commands.
  Docs: https://github.com/Vektor-Memory/Via
`);
}

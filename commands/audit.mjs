/**
 * commands/audit.mjs — via audit
 * Compliance memory. Logs every significant AI decision with rationale,
 * timestamps, and tool source. Queryable and exportable.
 *
 * Usage:
 *   via audit                         # list recent decisions
 *   via audit log "chose Postgres"    # log a decision
 *   via audit log "used GPT-4o" --tool cursor --rationale "cheaper for this task"
 *   via audit query "database"        # search decisions
 *   via audit export                  # export to .vaudit.jsonl
 *   via audit --json
 */

import { createWriteStream, existsSync } from 'fs';
import { join } from 'path';
import { getDb, viaDir } from '../utils/db.mjs';
import { table, heading, blank, green, bold, dim } from '../utils/format.mjs';

async function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    decision    TEXT NOT NULL,
    rationale   TEXT DEFAULT '',
    tool        TEXT DEFAULT 'unknown',
    model       TEXT DEFAULT '',
    tags        TEXT DEFAULT '',
    logged_at   TEXT DEFAULT (datetime('now'))
  )`);
}

export async function run(args) {
  const db     = await getDb('audit');
  await ensureSchema(db);

  const subcmd = args[0];
  const asJSON = args.includes('--json');

  // Default: list recent
  if (!subcmd || subcmd === '--json') {
    const rows = db.prepare(`SELECT * FROM audit ORDER BY logged_at DESC LIMIT 20`).all();
    if (asJSON) { console.log(JSON.stringify(rows, null, 2)); return; }
    if (!rows.length) {
      console.log('\n  No decisions logged. Start with: via audit log "your decision"\n');
      return;
    }
    const display = rows.map(r => ({
      id:        String(r.id),
      decision:  r.decision.slice(0, 50),
      tool:      r.tool,
      logged:    r.logged_at.slice(0, 16),
    }));
    console.log(table(display, ['id', 'decision', 'tool', 'logged']));
    return;
  }

  // log
  if (subcmd === 'log') {
    const textArgs    = args.slice(1).filter(a => !a.startsWith('--'));
    const decision    = textArgs.join(' ');
    const toolIdx     = args.indexOf('--tool');
    const rationaleIdx= args.indexOf('--rationale');
    const modelIdx    = args.indexOf('--model');
    const tool        = toolIdx     !== -1 ? args[toolIdx + 1]      : 'unknown';
    const rationale   = rationaleIdx!== -1 ? args[rationaleIdx + 1] : '';
    const model       = modelIdx    !== -1 ? args[modelIdx + 1]     : '';

    if (!decision) { console.error('  via audit log requires a decision string'); process.exit(1); }

    const r = db.prepare(
      `INSERT INTO audit (decision, rationale, tool, model) VALUES (?,?,?,?)`
    ).run(decision, rationale, tool, model);

    console.log(`\n  ${green('✓')} Decision #${r.lastInsertRowid} logged\n`);
    if (rationale) console.log(dim(`    rationale: ${rationale}`));
    blank();
    return;
  }

  // query
  if (subcmd === 'query') {
    const q    = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    const rows = db.prepare(
      `SELECT * FROM audit WHERE decision LIKE ? OR rationale LIKE ? ORDER BY logged_at DESC LIMIT 20`
    ).all(`%${q}%`, `%${q}%`);

    if (asJSON) { console.log(JSON.stringify(rows, null, 2)); return; }
    if (!rows.length) { console.log(`\n  No decisions matching '${q}'\n`); return; }

    console.log(`\n  ${bold('Decisions matching:')} ${q}\n`);
    rows.forEach(r => {
      console.log(`  #${r.id}  ${r.logged_at.slice(0,16)}  [${r.tool}]`);
      console.log(`    ${r.decision}`);
      if (r.rationale) console.log(dim(`    → ${r.rationale}`));
      blank();
    });
    return;
  }

  // export
  if (subcmd === 'export') {
    const rows    = db.prepare(`SELECT * FROM audit ORDER BY logged_at ASC`).all();
    const outPath = join(viaDir(), `audit-export-${Date.now()}.vaudit.jsonl`);
    const stream  = createWriteStream(outPath, 'utf8');
    rows.forEach(r => stream.write(JSON.stringify(r) + '\n'));
    stream.on('finish', () => {
      console.log(`\n  ${green('✓')} Exported ${rows.length} decisions → ${outPath}\n`);
    });
    stream.end();
    return;
  }

  console.log(`
  Usage: via audit [subcommand] [options]

  Subcommands:
    (none)                   List recent decisions
    log <decision>           Log a decision  [--tool] [--rationale] [--model]
    query <term>             Search decisions
    export                   Export to .vaudit.jsonl

  Options:
    --json                   JSON output
`);
}


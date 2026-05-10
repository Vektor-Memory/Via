/**
 * commands/audit.mjs — via audit
 */
import { createWriteStream } from 'fs';
import { join }              from 'path';
import { getDb, viaDir }     from '../utils/db.mjs';
import { heading, headingEnd, label, blank, table, green, dim, yellow } from '../utils/format.mjs';

async function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, decision TEXT NOT NULL, rationale TEXT DEFAULT '', tool TEXT DEFAULT 'unknown', model TEXT DEFAULT '', tags TEXT DEFAULT '', logged_at TEXT DEFAULT (datetime('now')))`);
}

function lastId(db) { return db.prepare(`SELECT MAX(id) as id FROM audit`).get()?.id ?? 0; }

export async function run(args) {
  const db     = await getDb('audit');
  await ensureSchema(db);
  const subcmd = args[0];
  const asJSON = args.includes('--json');

  if (!subcmd || subcmd === '--json') {
    const rows = db.prepare(`SELECT * FROM audit ORDER BY logged_at DESC LIMIT 20`).all();
    if (asJSON) { console.log(JSON.stringify(rows, null, 2)); return; }
    if (!rows.length) {
      heading('AUDIT'); blank();
      console.log('  │  No decisions logged. Start with: ' + dim('via audit log "your decision"'));
      blank(); headingEnd(); return;
    }
    heading('AUDIT — RECENT');
    console.log(table(rows.map(r => ({ id: String(r.id), decision: r.decision.slice(0, 48), tool: r.tool, logged: r.logged_at.slice(0, 16) })), ['id', 'decision', 'tool', 'logged']));
    headingEnd(); return;
  }

  if (subcmd === 'log') {
    const flagValues = new Set([args[args.indexOf('--tool')+1], args[args.indexOf('--rationale')+1], args[args.indexOf('--model')+1]].filter(Boolean));
    const decision  = args.slice(1).filter(a => !a.startsWith('--') && !flagValues.has(a)).join(' ');
    const toolIdx   = args.indexOf('--tool');
    const ratIdx    = args.indexOf('--rationale');
    const modIdx    = args.indexOf('--model');
    const tool      = toolIdx !== -1 ? args[toolIdx + 1] : 'unknown';
    const rationale = ratIdx  !== -1 ? args[ratIdx  + 1] : '';
    const model     = modIdx  !== -1 ? args[modIdx  + 1] : '';
    if (!decision) { console.error('  via audit log requires a decision string'); process.exit(1); }
    db.prepare(`INSERT INTO audit (decision, rationale, tool, model) VALUES (?,?,?,?)`).run(decision, rationale, tool, model);
    const id = lastId(db);
    heading('AUDIT LOGGED');
    label('id', green('#' + id)); label('decision', decision); label('tool', tool);
    if (rationale) label('rationale', rationale);
    headingEnd(); return;
  }

  if (subcmd === 'query') {
    const q    = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    const rows = db.prepare(`SELECT * FROM audit WHERE decision LIKE ? OR rationale LIKE ? ORDER BY logged_at DESC LIMIT 20`).all(`%${q}%`, `%${q}%`);
    if (asJSON) { console.log(JSON.stringify(rows, null, 2)); return; }
    heading('AUDIT — QUERY: ' + q);
    if (!rows.length) { blank(); console.log('  │  No matches.'); blank(); headingEnd(); return; }
    console.log(table(rows.map(r => ({ id: String(r.id), decision: r.decision.slice(0, 48), tool: r.tool, logged: r.logged_at.slice(0, 16) })), ['id', 'decision', 'tool', 'logged']));
    headingEnd(); return;
  }

  if (subcmd === 'export') {
    const rows    = db.prepare(`SELECT * FROM audit ORDER BY logged_at ASC`).all();
    const outPath = join(viaDir(), `audit-export-${Date.now()}.vaudit.jsonl`);
    const stream  = createWriteStream(outPath, 'utf8');
    rows.forEach(r => stream.write(JSON.stringify(r) + '\n'));
    stream.end(() => { heading('AUDIT EXPORTED'); label('file', outPath); label('records', String(rows.length)); headingEnd(); });
    return;
  }

  heading('AUDIT — USAGE');
  label('via audit',              'list recent decisions');
  label('via audit log <text>',   '[--tool] [--rationale] [--model]');
  label('via audit query <term>', 'search decisions');
  label('via audit export',       'export to .vaudit.jsonl');
  label('--json',                 'JSON output');
  headingEnd();
}

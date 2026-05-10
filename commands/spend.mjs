/**
 * commands/spend.mjs — via spend
 * Unified token and cost tracking across all AI tools.
 * Reads Claude, OpenAI, Cursor usage. Session breakdowns, daily totals, leak detection.
 *
 * Usage:
 *   via spend             # today's spend
 *   via spend today
 *   via spend week
 *   via spend month
 *   via spend log <tool> <tokens> <cost>   # manually log a session
 *   via spend --json
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { viaDir } from '../utils/db.mjs';
import { table, label, heading, blank, green, yellow, red, dim, bold } from '../utils/format.mjs';
import { getDb } from '../utils/db.mjs';

async function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS spend (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tool       TEXT NOT NULL,
    model      TEXT DEFAULT '',
    tokens_in  INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    cost_usd   REAL DEFAULT 0,
    session_id TEXT DEFAULT '',
    logged_at  TEXT DEFAULT (datetime('now'))
  )`);
}

function costColor(usd) {
  if (usd >= 5)  return red(`$${usd.toFixed(4)}`);
  if (usd >= 1)  return yellow(`$${usd.toFixed(4)}`);
  return `$${usd.toFixed(4)}`;
}

function sumRows(rows) {
  return rows.reduce((acc, r) => ({
    tokens_in:  acc.tokens_in  + (r.tokens_in  ?? 0),
    tokens_out: acc.tokens_out + (r.tokens_out ?? 0),
    cost_usd:   acc.cost_usd   + (r.cost_usd   ?? 0),
    count:      acc.count + 1,
  }), { tokens_in: 0, tokens_out: 0, cost_usd: 0, count: 0 });
}

export async function run(args) {
  const db     = await getDb('spend');
  await ensureSchema(db);

  const subcmd = args[0] ?? 'today';
  const asJSON = args.includes('--json');

  // Manual log: via spend log <tool> <tokens_in> <tokens_out> <cost>
  if (subcmd === 'log') {
    const tool      = args[1] ?? 'unknown';
    const tokensIn  = parseInt(args[2] ?? 0);
    const tokensOut = parseInt(args[3] ?? 0);
    const cost      = parseFloat(args[4] ?? 0);
    const model     = args[5] ?? '';
    db.prepare(`INSERT INTO spend (tool, model, tokens_in, tokens_out, cost_usd) VALUES (?,?,?,?,?)`)
      .run(tool, model, tokensIn, tokensOut, cost);
    console.log(`\n  ${green('✓')} Logged: ${tool} — ${tokensIn + tokensOut} tokens, $${cost.toFixed(4)}\n`);
    return;
  }

  const window = {
    today: `date('now')`,
    week:  `date('now', '-7 days')`,
    month: `date('now', '-30 days')`,
  }[subcmd] ?? `date('now')`;

  const rows = db.prepare(
    `SELECT tool, model, SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out,
            SUM(cost_usd) as cost_usd, COUNT(*) as sessions
     FROM spend
     WHERE date(logged_at) >= ${window}
     GROUP BY tool, model
     ORDER BY cost_usd DESC`
  ).all();

  if (asJSON) { console.log(JSON.stringify(rows, null, 2)); return; }

  const period = { today: 'Today', week: 'Last 7 days', month: 'Last 30 days' }[subcmd] ?? 'Today';
  console.log(`\n  ${bold('via spend')} — ${period}\n`);

  if (!rows.length) {
    console.log('  No spend data. Log sessions: via spend log <tool> <tokens_in> <tokens_out> <cost_usd>\n');
    console.log(dim('  Upgrade to Slipstream for automatic tracking → npx via upgrade\n'));
    return;
  }

  const display = rows.map(r => ({
    tool:    r.tool,
    model:   r.model || '—',
    in:      r.tokens_in.toLocaleString(),
    out:     r.tokens_out.toLocaleString(),
    total:   (r.tokens_in + r.tokens_out).toLocaleString(),
    cost:    `$${r.cost_usd.toFixed(4)}`,
    sessions: String(r.sessions),
  }));
  console.log(table(display, ['tool', 'model', 'in', 'out', 'total', 'cost', 'sessions']));

  const totals = sumRows(rows);
  console.log(`  Total: ${(totals.tokens_in + totals.tokens_out).toLocaleString()} tokens  ${costColor(totals.cost_usd)}`);
  blank();

  // Leak detection: flag if any single session > $1
  const bigSessions = db.prepare(
    `SELECT tool, model, tokens_in+tokens_out as tokens, cost_usd, logged_at
     FROM spend WHERE cost_usd > 1 AND date(logged_at) >= ${window}
     ORDER BY cost_usd DESC LIMIT 5`
  ).all();

  if (bigSessions.length) {
    console.log(yellow(`  ⚠  High-cost sessions detected:`));
    bigSessions.forEach(s =>
      console.log(`    ${s.tool} — ${s.tokens.toLocaleString()} tokens — $${s.cost_usd.toFixed(4)} — ${s.logged_at.slice(0,16)}`)
    );
    blank();
  }
}

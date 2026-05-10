/**
 * commands/log.mjs — via log
 * Unified activity log + auto-capture from Claude Code session files.
 *
 * Usage:
 *   via log                              # show recent
 *   via log "decided to use postgres"    # manual entry
 *   via log --watch                      # auto-capture Claude Code sessions
 *   via log --scan                       # one-shot scan of all sessions now
 *   via log --today
 *   via log search "postgres"
 */
import { existsSync, readdirSync, readFileSync, statSync, watch } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getDb } from '../utils/db.mjs';
import { heading, headingEnd, label, blank, table, green, red, yellow, dim, steel } from '../utils/format.mjs';

const HOME = homedir();
const WIN  = process.platform === 'win32';

async function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    entry      TEXT NOT NULL,
    tool       TEXT DEFAULT 'unknown',
    cost_usd   REAL DEFAULT 0,
    tokens     INTEGER DEFAULT 0,
    type       TEXT DEFAULT 'manual',
    session_id TEXT DEFAULT '',
    logged_at  TEXT DEFAULT (datetime('now'))
  )`);
  try { db.exec(`ALTER TABLE log ADD COLUMN session_id TEXT DEFAULT ''`); } catch {}
}

function lastId(db) { return db.prepare(`SELECT MAX(id) as id FROM log`).get()?.id ?? 0; }

// ── Claude Code session paths ─────────────────────────────────────────────
function claudeSessionDir() {
  return WIN
    ? join(HOME, 'AppData', 'Roaming', 'Claude', 'claude-code-sessions')
    : join(HOME, '.config', 'claude', 'claude-code-sessions');
}

// Walk all session JSON files
function findSessionFiles(baseDir) {
  const files = [];
  if (!existsSync(baseDir)) return files;
  try {
    readdirSync(baseDir).forEach(a => {
      const aPath = join(baseDir, a);
      if (!statSync(aPath).isDirectory()) return;
      readdirSync(aPath).forEach(b => {
        const bPath = join(aPath, b);
        if (!statSync(bPath).isDirectory()) return;
        readdirSync(bPath).forEach(f => {
          if (f.endsWith('.json')) files.push(join(bPath, f));
        });
      });
    });
  } catch {}
  return files;
}

function parseSession(filePath) {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    return {
      sessionId:    raw.sessionId ?? '',
      title:        raw.title ?? 'Untitled session',
      model:        raw.model ?? 'unknown',
      cwd:          raw.cwd ?? '',
      turns:        raw.completedTurns ?? 0,
      lastActivity: raw.lastActivityAt ? new Date(raw.lastActivityAt).toISOString() : null,
      archived:     raw.isArchived ?? false,
    };
  } catch { return null; }
}

// ── Scan all sessions, log new ones ──────────────────────────────────────────
async function scanSessions(db, verbose = false) {
  const baseDir = claudeSessionDir();
  if (!existsSync(baseDir)) return 0;

  const files   = findSessionFiles(baseDir);
  let   captured = 0;

  for (const file of files) {
    const session = parseSession(file);
    if (!session || !session.sessionId || session.archived) continue;

    // check if already logged
    const exists = db.prepare(`SELECT id FROM log WHERE session_id=?`).get(session.sessionId);
    if (exists) continue;

    const entry = `[claude-code] ${session.title} — ${session.turns} turns — ${session.model}`;
    db.prepare(`INSERT INTO log (entry, tool, type, session_id) VALUES (?,?,?,?)`).run(
      entry, 'claude-code', 'auto', session.sessionId
    );
    captured++;
    if (verbose) console.log('  │  ' + green('captured') + '  ' + session.title.slice(0, 50));
  }
  return captured;
}

// ── Watch mode ────────────────────────────────────────────────────────────────
async function startWatch(db) {
  const baseDir = claudeSessionDir();
  if (!existsSync(baseDir)) {
    console.log('  │  ' + yellow('Claude Code session dir not found:'));
    console.log('  │  ' + dim(baseDir));
    blank(); return;
  }

  // initial scan
  const initial = await scanSessions(db, false);
  label('initial scan', green(`${initial} new session(s) captured`));
  blank();
  console.log('  │  ' + dim('Watching for new sessions... Ctrl+C to stop'));
  blank();

  // watch the base dir for new subdirs
  try {
    watch(baseDir, { recursive: true }, async (event, filename) => {
      if (!filename || !filename.endsWith('.json')) return;
      // debounce — wait 2s for file to finish writing
      setTimeout(async () => {
        const captured = await scanSessions(db, false);
        if (captured > 0) {
          console.log('  │  ' + green(`+${captured} session(s) captured`) + '  ' + dim(new Date().toLocaleTimeString()));
        }
      }, 2000);
    });
  } catch {
    console.log('  │  ' + yellow('Recursive watch not supported — using polling'));
    setInterval(async () => { await scanSessions(db, false); }, 10000);
  }

  await new Promise(() => {}); // keep alive
}

// ── Main ─────────────────────────────────────────────────────────────────────
export async function run(args) {
  const db = await getDb('log');
  await ensureSchema(db);

  const asJSON = args.includes('--json');
  const today  = args.includes('--today');

  // --watch
  if (args.includes('--watch')) {
    heading('LOG — WATCH MODE');
    await startWatch(db);
    headingEnd(); return;
  }

  // --scan (one-shot)
  if (args.includes('--scan')) {
    heading('LOG — SCAN');
    const n = await scanSessions(db, true);
    blank();
    label('captured', n > 0 ? green(`${n} new session(s)`) : dim('0 — all sessions already logged'));
    headingEnd(); return;
  }

  // search
  if (args[0] === 'search') {
    const q    = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    const rows = db.prepare(`SELECT * FROM log WHERE entry LIKE ? ORDER BY logged_at DESC LIMIT 20`).all(`%${q}%`);
    if (asJSON) { console.log(JSON.stringify(rows, null, 2)); return; }
    heading('LOG — SEARCH: ' + q);
    if (!rows.length) { blank(); console.log('  │  No results.'); blank(); headingEnd(); return; }
    console.log(table(rows.map(r => ({ id: String(r.id), entry: r.entry.slice(0, 50), tool: r.tool, logged: r.logged_at.slice(0, 16) })), ['id', 'entry', 'tool', 'logged']));
    headingEnd(); return;
  }

  // clear
  if (args[0] === 'clear') {
    if (!args.includes('--confirm')) { console.log('\n  ' + yellow('! Add --confirm to clear all entries\n')); return; }
    db.prepare(`DELETE FROM log`).run();
    heading('LOG CLEARED'); label('status', red('all entries deleted')); headingEnd(); return;
  }

  // manual entry
  const toolIdx  = args.indexOf('--tool');
  const costIdx  = args.indexOf('--cost');
  const tokIdx   = args.indexOf('--tokens');
  const flagVals = new Set([
    toolIdx !== -1 ? args[toolIdx  + 1] : null,
    costIdx !== -1 ? args[costIdx  + 1] : null,
    tokIdx  !== -1 ? args[tokIdx   + 1] : null,
  ].filter(Boolean));

  const entryArgs = args.filter(a => !a.startsWith('--') && !flagVals.has(a));

  if (entryArgs.length > 0) {
    const entry  = entryArgs.join(' ').trim();
    const tool   = toolIdx !== -1 ? args[toolIdx  + 1] : 'unknown';
    const cost   = costIdx !== -1 ? parseFloat(args[costIdx + 1]) : 0;
    const tokens = tokIdx  !== -1 ? parseInt(args[tokIdx   + 1])  : 0;
    db.prepare(`INSERT INTO log (entry, tool, cost_usd, tokens, type) VALUES (?,?,?,?,?)`).run(entry, tool, cost, tokens, 'manual');
    const id = lastId(db);
    heading('LOG ENTRY');
    label('id',    green('#' + id));
    label('entry', entry.slice(0, 60));
    label('tool',  tool);
    if (cost)   label('cost',   '$' + cost.toFixed(4));
    if (tokens) label('tokens', String(tokens));
    headingEnd(); return;
  }

  // default: list
  const where = today ? `WHERE date(logged_at) = date('now')` : '';
  const rows  = db.prepare(`SELECT * FROM log ${where} ORDER BY logged_at DESC LIMIT 30`).all();
  if (asJSON) { console.log(JSON.stringify(rows, null, 2)); return; }

  heading('LOG — ' + (today ? 'TODAY' : 'RECENT'));
  if (!rows.length) {
    blank();
    console.log('  │  No entries yet.');
    console.log('  │  Manual:      ' + steel('via log "your note"'));
    console.log('  │  Auto-scan:   ' + steel('via log --scan'));
    console.log('  │  Auto-watch:  ' + steel('via log --watch'));
    blank(); headingEnd(); return;
  }

  const totalCost   = rows.reduce((a, r) => a + (r.cost_usd ?? 0), 0);
  const totalTokens = rows.reduce((a, r) => a + (r.tokens ?? 0), 0);
  if (totalCost > 0)   label('spend',  '$' + totalCost.toFixed(4));
  if (totalTokens > 0) label('tokens', totalTokens.toLocaleString());
  blank();

  console.log(table(rows.map(r => ({
    id:     String(r.id),
    type:   r.type === 'auto' ? dim('auto') : green('manual'),
    entry:  r.entry.slice(0, 46),
    tool:   r.tool,
    logged: r.logged_at.slice(0, 16),
  })), ['id', 'type', 'entry', 'tool', 'logged']));

  headingEnd();
}

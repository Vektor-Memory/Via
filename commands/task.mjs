/**
 * commands/task.mjs — via task
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { getDb } from '../utils/db.mjs';
import { heading, headingEnd, label, blank, table, green, red, yellow, dim, steel } from '../utils/format.mjs';

const VIA_BOARD_FILE = '.via-board.json';

async function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'open',
    priority   TEXT DEFAULT 'normal',
    tags       TEXT DEFAULT '',
    assignee   TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  // migrate old DBs
  try { db.exec(`ALTER TABLE tasks ADD COLUMN assignee TEXT DEFAULT ''`); } catch {}
}

function lastId(db, tbl) { return db.prepare(`SELECT MAX(id) as id FROM ${tbl}`).get()?.id ?? 0; }

const ICON = { open: dim('o'), in_progress: yellow('>'), done: green('x'), blocked: red('!') };
const PRIO = { high: red('high'), normal: dim('normal'), low: dim('low') };


// ── Team board export/import ────────────────────────────────────────────────
function exportBoard(db) {
  const tasks = db.prepare(`SELECT * FROM tasks ORDER BY priority DESC, created_at ASC`).all();
  return {
    via_board_version: '0.4.0',
    exported_at: new Date().toISOString(),
    tasks,
  };
}

function importBoard(db, data) {
  if (!data.tasks) throw new Error('Invalid board file — missing tasks array');
  const upsert = db.prepare(`
    INSERT INTO tasks (id, title, status, priority, tags, assignee, created_at, updated_at)
    VALUES (@id, @title, @status, @priority, @tags, @assignee, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, status=excluded.status, priority=excluded.priority,
      tags=excluded.tags, assignee=excluded.assignee, updated_at=excluded.updated_at
  `);
  const tx = db.transaction(tasks => tasks.forEach(t => upsert.run({
    id: t.id, title: t.title, status: t.status || 'open',
    priority: t.priority || 'normal', tags: t.tags || '',
    assignee: t.assignee || '', created_at: t.created_at, updated_at: t.updated_at,
  })));
  tx(data.tasks);
  return data.tasks.length;
}

function printBoard(db, heading, headingEnd, label, blank, green, yellow, red, dim, steel) {
  const open     = db.prepare(`SELECT * FROM tasks WHERE status='open' ORDER BY priority DESC, created_at ASC`).all();
  const inProg   = db.prepare(`SELECT * FROM tasks WHERE status='in-progress' ORDER BY updated_at DESC`).all();
  const done     = db.prepare(`SELECT * FROM tasks WHERE status='done' ORDER BY updated_at DESC LIMIT 5`).all();

  const priIcon = p => p === 'high' ? red('!') : p === 'low' ? dim('·') : '○';
  const row = t => {
    const pri  = priIcon(t.priority);
    const who  = t.assignee ? dim(' @' + t.assignee) : '';
    const tags = t.tags ? dim(' [' + t.tags + ']') : '';
    return `  │  ${pri} #${t.id} ${t.title.slice(0, 50)}${who}${tags}`;
  };

  heading('TASK BOARD');
  blank();
  console.log('  │  ' + yellow('OPEN (' + open.length + ')'));
  open.forEach(t => console.log(row(t)));
  blank();
  console.log('  │  ' + green('IN PROGRESS (' + inProg.length + ')'));
  inProg.forEach(t => console.log(row(t)));
  blank();
  console.log('  │  ' + dim('DONE (recent ' + done.length + ')'));
  done.forEach(t => console.log(row(t)));
  blank();
  headingEnd();
}

export async function run(args) {
  const db = await getDb('tasks');
  await ensureSchema(db);

  const subcmd = args[0];
  const asJSON = args.includes('--json');
  const showAll= args.includes('--all');

  if (!subcmd || subcmd === 'list' || subcmd === '--all' || subcmd === '--json') {
    const where = showAll ? '' : `WHERE status != 'done'`;
    const rows  = db.prepare(`SELECT * FROM tasks ${where} ORDER BY updated_at DESC`).all();
    if (asJSON) { console.log(JSON.stringify(rows, null, 2)); return; }
    if (!rows.length) {
      heading('TASKS'); blank();
      console.log('  │  No tasks. Add one: ' + steel('via task add "your task"'));
      blank(); headingEnd(); return;
    }
    heading(showAll ? 'TASKS — ALL' : 'TASKS — OPEN');
    console.log(table(rows.map(r => ({
      id:       String(r.id),
      st:       ICON[r.status] ?? '?',
      title:    r.title,
      priority: PRIO[r.priority] ?? r.priority,
      updated:  r.updated_at.slice(0, 10),
    })), ['id', 'st', 'title', 'priority', 'updated']));
    if (!showAll) console.log('  ' + dim("Run 'via task --all' to include completed tasks"));
    headingEnd(); return;
  }

  if (subcmd === 'add') {
    const title    = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    const priority = args.includes('--high') ? 'high' : args.includes('--low') ? 'low' : 'normal';
    const tags     = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : '';
    if (!title) { console.error('  via task add requires a title'); process.exit(1); }
    db.prepare(`INSERT INTO tasks (title, priority, tags) VALUES (?, ?, ?)`).run(title, priority, tags);
    const id = lastId(db, 'tasks');
    heading('TASK ADDED');
    label('id', green('#' + id)); label('title', title); label('priority', priority);
    headingEnd(); return;
  }

  if (subcmd === 'done') {
    const id = parseInt(args[1]);
    if (isNaN(id)) { console.error('  via task done requires an id'); process.exit(1); }
    db.prepare(`UPDATE tasks SET status='done', updated_at=datetime('now') WHERE id=?`).run(id);
    heading('TASK DONE'); label('id', String(id)); label('status', green('done')); headingEnd(); return;
  }

  if (subcmd === 'start') {
    const id = parseInt(args[1]);
    if (isNaN(id)) { console.error('  via task start requires an id'); process.exit(1); }
    db.prepare(`UPDATE tasks SET status='in_progress', updated_at=datetime('now') WHERE id=?`).run(id);
    heading('TASK STARTED'); label('id', String(id)); label('status', yellow('in-progress')); headingEnd(); return;
  }

  if (subcmd === 'update') {
    const id    = parseInt(args[1]);
    const title = args.slice(2).filter(a => !a.startsWith('--')).join(' ').trim();
    if (isNaN(id) || !title) { console.error('  via task update requires an id and new title'); process.exit(1); }
    db.prepare(`UPDATE tasks SET title=?, updated_at=datetime('now') WHERE id=?`).run(title, id);
    heading('TASK UPDATED'); label('id', String(id)); label('title', title); headingEnd(); return;
  }

  if (subcmd === 'rm' || subcmd === 'delete') {
    const id = parseInt(args[1]);
    if (isNaN(id)) { console.error('  via task rm requires an id'); process.exit(1); }
    db.prepare(`DELETE FROM tasks WHERE id=?`).run(id);
    heading('TASK DELETED'); label('id', red('#' + id)); headingEnd(); return;
  }

  // board — kanban view
  if (subcmd === 'board') {
    printBoard(db, heading, headingEnd, label, blank, green, yellow, red, dim, steel);
    return;
  }

  // assign <id> <who>
  if (subcmd === 'assign') {
    const id  = parseInt(args[1]);
    const who = args[2];
    if (isNaN(id) || !who) { console.error('  Usage: via task assign <id> <name>'); process.exit(1); }
    db.prepare(`UPDATE tasks SET assignee=?, updated_at=datetime('now') WHERE id=?`).run(who, id);
    heading('TASK ASSIGNED');
    label('id', '#' + id);
    label('assigned to', green(who));
    headingEnd(); return;
  }

  // share — export board to .via-board.json
  if (subcmd === 'share') {
    const board = exportBoard(db);
    writeFileSync(VIA_BOARD_FILE, JSON.stringify(board, null, 2));
    heading('TASK BOARD SHARED');
    blank();
    console.log('  │  Board exported to ' + steel(VIA_BOARD_FILE));
    console.log('  │  Commit to Git or share with team:');
    blank();
    console.log('  │  ' + dim('git add .via-board.json && git commit -m "sync task board"'));
    console.log('  │  Teammates run: ' + steel('via task import .via-board.json'));
    blank();
    label('tasks', String(board.tasks.length));
    headingEnd(); return;
  }

  // sync — read .via-board.json if it exists (auto-sync on startup)
  if (subcmd === 'sync') {
    const boardFile = existsSync(VIA_BOARD_FILE) ? VIA_BOARD_FILE : null;
    if (!boardFile) {
      heading('TASK SYNC');
      blank();
      console.log('  │  No ' + steel(VIA_BOARD_FILE) + ' found in current directory.');
      console.log('  │  Generate one: ' + steel('via task share'));
      blank();
      headingEnd(); return;
    }
    try {
      const data    = JSON.parse(readFileSync(boardFile, 'utf8'));
      const imported = importBoard(db, data);
      heading('TASK BOARD SYNCED');
      label('source',  boardFile);
      label('imported', green(String(imported)) + ' tasks');
      label('exported', data.exported_at || 'unknown');
      headingEnd();
    } catch (e) {
      console.error('  ' + red('✗') + ' ' + e.message);
    }
    return;
  }

  // import <file>
  if (subcmd === 'import') {
    const file = resolve(args[1] || VIA_BOARD_FILE);
    if (!existsSync(file)) { console.error('  File not found: ' + file); process.exit(1); }
    try {
      const data     = JSON.parse(readFileSync(file, 'utf8'));
      const imported = importBoard(db, data);
      heading('TASK BOARD IMPORTED');
      label('source',   file);
      label('imported', green(String(imported)) + ' tasks');
      headingEnd();
    } catch (e) {
      console.error('  ' + red('✗') + ' ' + e.message);
    }
    return;
  }

  heading('TASK — USAGE');
  label('via task',              'list open tasks');
  label('via task add <title>',  '[--high|--low] [--tag]');
  label('via task start <id>',   'mark in-progress');
  label('via task done <id>',    'mark done');
  label('via task update <id>',  'rename');
  label('via task rm <id>',      'delete');
  label('--all',                 'include completed');
  label('--json',                'JSON output');
  headingEnd();
}

/**
 * commands/task.mjs — via task
 */
import { getDb } from '../utils/db.mjs';
import { heading, headingEnd, label, blank, table, green, red, yellow, dim, steel } from '../utils/format.mjs';

async function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'open',
    priority   TEXT DEFAULT 'normal',
    tags       TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
}

function lastId(db, tbl) { return db.prepare(`SELECT MAX(id) as id FROM ${tbl}`).get()?.id ?? 0; }

const ICON = { open: dim('o'), in_progress: yellow('>'), done: green('x'), blocked: red('!') };
const PRIO = { high: red('high'), normal: dim('normal'), low: dim('low') };

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

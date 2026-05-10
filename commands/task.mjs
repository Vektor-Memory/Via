/**
 * commands/task.mjs — via task
 * Shared persistent task board. SQLite locally, Slipstream-linked when upgraded.
 *
 * Usage:
 *   via task                          # list open tasks
 *   via task add "refactor auth"      # add task
 *   via task done <id>                # mark done
 *   via task update <id> "new title"  # rename
 *   via task rm <id>                  # delete
 *   via task --all                    # list all including done
 *   via task --json                   # JSON output
 */

import { getDb } from '../utils/db.mjs';
import { table, label, blank, green, red, dim, bold } from '../utils/format.mjs';

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

const STATUS_ICON = { open: '○', in_progress: '◐', done: '●', blocked: '✗' };

export async function run(args) {
  const db     = await getDb('tasks');
  await ensureSchema(db);

  const subcmd = args[0];
  const asJSON = args.includes('--json');
  const showAll= args.includes('--all');

  // Default: list
  if (!subcmd || subcmd === '--all' || subcmd === '--json') {
    const where = showAll ? '' : `WHERE status != 'done'`;
    const rows  = db.prepare(`SELECT * FROM tasks ${where} ORDER BY updated_at DESC`).all();

    if (asJSON) { console.log(JSON.stringify(rows, null, 2)); return; }
    if (!rows.length) {
      console.log('\n  No tasks. Add one: via task add "your task"\n');
      return;
    }
    const display = rows.map(r => ({
      id:       String(r.id),
      status:   (STATUS_ICON[r.status] ?? '?') + ' ' + r.status,
      title:    r.title,
      priority: r.priority,
      updated:  r.updated_at.slice(0, 10),
    }));
    console.log(table(display, ['id', 'status', 'title', 'priority', 'updated']));
    if (!showAll) console.log(dim('  Run \'via task --all\' to include completed tasks\n'));
    return;
  }

  // add
  if (subcmd === 'add') {
    const title    = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    const priority = args.includes('--high') ? 'high' : args.includes('--low') ? 'low' : 'normal';
    const tags     = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : '';
    if (!title) { console.error('  via task add requires a title'); process.exit(1); }
    const r = db.prepare(`INSERT INTO tasks (title, priority, tags) VALUES (?, ?, ?)`).run(title, priority, tags);
    console.log(`\n  ${green('✓')} Task #${r.lastInsertRowid} added: ${title}\n`);
    return;
  }

  // done
  if (subcmd === 'done') {
    const id = parseInt(args[1]);
    if (isNaN(id)) { console.error('  via task done requires an id'); process.exit(1); }
    db.prepare(`UPDATE tasks SET status='done', updated_at=datetime('now') WHERE id=?`).run(id);
    console.log(`\n  ${green('✓')} Task #${id} marked done\n`);
    return;
  }

  // start / in-progress
  if (subcmd === 'start') {
    const id = parseInt(args[1]);
    if (isNaN(id)) { console.error('  via task start requires an id'); process.exit(1); }
    db.prepare(`UPDATE tasks SET status='in_progress', updated_at=datetime('now') WHERE id=?`).run(id);
    console.log(`\n  ${green('✓')} Task #${id} marked in-progress\n`);
    return;
  }

  // update
  if (subcmd === 'update') {
    const id    = parseInt(args[1]);
    const title = args.slice(2).join(' ');
    if (isNaN(id) || !title) { console.error('  via task update requires an id and new title'); process.exit(1); }
    db.prepare(`UPDATE tasks SET title=?, updated_at=datetime('now') WHERE id=?`).run(title, id);
    console.log(`\n  ${green('✓')} Task #${id} updated\n`);
    return;
  }

  // rm / delete
  if (subcmd === 'rm' || subcmd === 'delete') {
    const id = parseInt(args[1]);
    if (isNaN(id)) { console.error('  via task rm requires an id'); process.exit(1); }
    db.prepare(`DELETE FROM tasks WHERE id=?`).run(id);
    console.log(`\n  ${red('✗')} Task #${id} deleted\n`);
    return;
  }

  console.log(`
  Usage: via task [subcommand] [options]

  Subcommands:
    (none)              List open tasks
    add <title>         Add a new task  [--high|--low] [--tag <tag>]
    start <id>          Mark in-progress
    done <id>           Mark as done
    update <id> <title> Rename a task
    rm <id>             Delete a task

  Options:
    --all               Include completed tasks
    --json              JSON output
`);
}

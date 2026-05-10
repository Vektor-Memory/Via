/**
 * commands/handoff.mjs — via handoff
 * Export or import full working state as .vstate.json
 *
 * Usage:
 *   via handoff --export                    # writes ~/.via/handoffs/<timestamp>.vstate.json
 *   via handoff --export --out ./my.vstate.json
 *   via handoff --import ./my.vstate.json
 *   via handoff --list
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { viaDir } from '../utils/db.mjs';
import { readConfig } from '../utils/config.mjs';
import { table, label, heading, blank, bold, dim, green } from '../utils/format.mjs';

function handoffDir() {
  const d = join(viaDir(), 'handoffs');
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function exportHandoff(outPath) {
  const config = readConfig();

  // Gather open tasks from DB if available
  let tasks = [];
  try {
    const { getDb } = await import('../utils/db.mjs');
    const db = await getDb('tasks');
    tasks = db.prepare(`SELECT * FROM tasks WHERE status != 'done' ORDER BY updated_at DESC LIMIT 20`).all();
  } catch {}

  const state = {
    via_version: '0.1.0',
    exported_at: new Date().toISOString(),
    machine:     process.env.COMPUTERNAME || process.env.HOSTNAME || 'unknown',
    tool:        config.last_tool ?? 'unknown',
    task:        config.current_task ?? '',
    decisions:   config.recent_decisions ?? [],
    open_questions: config.open_questions ?? [],
    tasks,
    notes:       config.handoff_notes ?? '',
    env: {
      cwd: process.cwd(),
      node: process.version,
    },
  };

  const filePath = outPath ?? join(handoffDir(), `${timestamp()}.vstate.json`);
  writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
  return filePath;
}

async function importHandoff(filePath) {
  const abs = resolve(filePath);
  if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);
  const state = JSON.parse(readFileSync(abs, 'utf8'));
  return state;
}

export async function run(args) {
  const isExport = args.includes('--export');
  const isImport = args.includes('--import');
  const isList   = args.includes('--list');
  const asJSON   = args.includes('--json');
  const outIdx   = args.indexOf('--out');
  const outPath  = outIdx !== -1 ? args[outIdx + 1] : null;

  if (!isExport && !isImport && !isList) {
    console.log(`
  Usage: via handoff <action> [options]

  Actions:
    --export                Export current working state
    --import <file>         Import a .vstate.json into this session
    --list                  List saved handoffs

  Options:
    --out <path>            Custom output path for --export
    --json                  JSON output

  Examples:
    via handoff --export
    via handoff --export --out ./sprint3.vstate.json
    via handoff --import ./sprint3.vstate.json
    via handoff --list
`);
    return;
  }

  if (isList) {
    const dir   = handoffDir();
    const files = readdirSync(dir).filter(f => f.endsWith('.vstate.json')).reverse();
    if (!files.length) {
      console.log('\n  No handoffs yet. Run: via handoff --export\n');
      return;
    }
    const rows = files.slice(0, 20).map(f => {
      try {
        const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        return { file: f, tool: s.tool ?? '—', task: (s.task ?? '').slice(0, 40), exported: s.exported_at?.slice(0, 16) ?? '—' };
      } catch {
        return { file: f, tool: '—', task: '—', exported: '—' };
      }
    });
    console.log(table(rows, ['file', 'tool', 'task', 'exported']));
    return;
  }

  if (isExport) {
    const filePath = await exportHandoff(outPath);
    if (asJSON) {
      const state = JSON.parse(readFileSync(filePath, 'utf8'));
      console.log(JSON.stringify({ exported: filePath, state }, null, 2));
    } else {
      console.log(`\n  ${green('✓')} Handoff exported\n`);
      label('file', filePath);
      blank();
      console.log(dim('  Share this file with any AI tool that supports via handoff --import'));
      blank();
    }
    return;
  }

  if (isImport) {
    const filePath = args[args.indexOf('--import') + 1];
    if (!filePath) { console.error('  via handoff --import requires a file path'); process.exit(1); }
    const state = await importHandoff(filePath);
    if (asJSON) { console.log(JSON.stringify(state, null, 2)); return; }

    console.log(`\n  ${green('✓')} Handoff imported\n`);
    label('from',     state.machine ?? '—');
    label('exported', state.exported_at?.slice(0, 16) ?? '—');
    label('tool',     state.tool ?? '—');
    label('task',     state.task ?? '—');
    if (state.tasks?.length)       label('open tasks', String(state.tasks.length));
    if (state.open_questions?.length) {
      heading('Open questions:');
      state.open_questions.forEach(q => console.log(`    • ${q}`));
    }
    if (state.notes) {
      heading('Notes:');
      console.log(`    ${state.notes}`);
    }
    blank();
  }
}

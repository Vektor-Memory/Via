#!/usr/bin/env node
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * via.mjs — CLI entry point
 * Via by Vektor Memory — Route anything. Remember everything. Works everywhere.
 */

import { readFileSync } from 'fs';
const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version;

// ── PALETTE ────────────────────────────────────────────────────────────────
const _ = {
  reset:  '\x1b[0m',  bold:   '\x1b[1m',
  white:  '\x1b[97m', silver: '\x1b[37m', grey:   '\x1b[90m',
  cobalt: '\x1b[38;5;26m',  steel: '\x1b[38;5;67m',
  sky:    '\x1b[38;5;117m', ice:   '\x1b[38;5;153m',
  green:  '\x1b[38;5;78m',  red:   '\x1b[38;5;203m', amber: '\x1b[38;5;221m',
};

const p  = (col, s) => `${col}${s}${_.reset}`;
const W  = s => p(_.white + _.bold, s);
const Si = s => p(_.silver, s);
const Gr = s => p(_.grey, s);
const Sk = s => p(_.sky, s);
const Ic = s => p(_.ice, s);
const St = s => p(_.steel, s);
const G  = s => p(_.green, s);
const R  = s => p(_.red, s);
const Y  = s => p(_.amber, s);
const Co = s => p(_.cobalt, s);

// ── BANNER ─────────────────────────────────────────────────────────────────
function banner() {
  console.log('');
  console.log('  ' + Co('██╗   ██╗') + St(' ██╗') + Sk('  █████╗ '));
  console.log('  ' + Co('██║   ██║') + St(' ██║') + Sk(' ██╔══██╗'));
  console.log('  ' + Co('██║   ██║') + St(' ██║') + Sk(' ███████║'));
  console.log('  ' + Co('╚██╗ ██╔╝') + St(' ██║') + Sk(' ██╔══██║'));
  console.log('  ' + Co(' ╚████╔╝ ') + St(' ██║') + Sk(' ██║  ██║') + '  ' + W('by Vektor Memory') + '  ' + Gr(`v${VERSION}`));
  console.log('  ' + Co('  ╚═══╝  ') + St(' ╚═╝') + Sk(' ╚═╝  ╚═╝'));
  console.log('');
  console.log('  ' + Si('Route anything. Remember everything. Works everywhere.') + '  ' + Gr('· Apache 2.0'));
  console.log('');
}

// ── BOX HELPERS ────────────────────────────────────────────────────────────
const BAR = St('│');
const TL  = St('┌─');
const BL  = St('└');
const HR  = St('─');

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
function box(label) {
  const raw = stripAnsi(label);
  console.log('  ' + TL + ' ' + Ic(label) + ' ' + HR.repeat(Math.max(2, 44 - raw.length)));
}
function boxEnd() { console.log('  ' + BL + HR.repeat(47)); console.log(''); }
function row(label, value) {
  const raw = stripAnsi(label);
  const pad = ' '.repeat(Math.max(1, 18 - raw.length));
  console.log('  ' + BAR + ' ' + label + pad + value);
}
function blank() { console.log('  ' + BAR); }

// ── COMMANDS ───────────────────────────────────────────────────────────────
const COMMANDS = {
  init:    'Wire via into Claude Desktop, Cursor, Windsurf automatically',
  memory:  'Store and search facts across all your AI tools',
  task:    'Shared persistent task board',
  handoff: 'Transfer working state between AI tools',
  log:     'Unified activity log — decisions, spend, events',
  ask:     'Route a question to the right tool and open it',
  diff:    'Compare responses from two AI tools side by side',
  serve:   'Run as MCP server (Claude Desktop, Cursor, Windsurf)',
  // legacy — kept for compat
  context: 'Inject memory into any AI tool',
  scaffold:'Deploy AI config files to a project',
  audit:   'Compliance log — decisions and rationale',
};

// ── HELP ───────────────────────────────────────────────────────────────────
function cmdHelp() {
  banner();

  box('COMMANDS');
  const primary = ['init','memory','task','handoff','log','ask','diff','serve'];
  for (const cmd of primary) {
    row(W(cmd), Gr(COMMANDS[cmd]));
  }
  boxEnd();

  box('OPTIONS');
  row(Sk('--help'),    Si('Show this help'));
  row(Sk('--version'), Si('Print version'));
  row(Sk('--json'),    Si('JSON output (all commands)'));
  row(Sk('--dry-run'), Si('Preview without writing'));
  boxEnd();

  box('QUICK START');
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Wire via into your AI tools'));
  console.log('  ' + BAR + '  ' + Sk('via init'));
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Store a fact'));
  console.log('  ' + BAR + '  ' + Sk('via memory add "JWT tokens expire in 1h"'));
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Add a task'));
  console.log('  ' + BAR + '  ' + Sk('via task add "refactor auth module"'));
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Route a question to the best tool'));
  console.log('  ' + BAR + '  ' + Sk('via ask "should I use postgres or sqlite?"'));
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Compare two AI responses'));
  console.log('  ' + BAR + '  ' + Sk('via diff "explain microservices"'));
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Export state before switching tools'));
  console.log('  ' + BAR + '  ' + Sk('via handoff --export'));
  blank();
  boxEnd();

  box('LINKS');
  row(Si('Docs'),    Sk('https://github.com/Vektor-Memory/Via'));
  row(Si('Upgrade'), Sk('https://vektormemory.com'));
  boxEnd();
}

// ── DISPATCH ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cmd  = args[0];

if (!cmd || cmd === '--help' || cmd === '-h') { cmdHelp(); process.exit(0); }
if (cmd === '--version' || cmd === '-v') { console.log(`via v${VERSION}`); process.exit(0); }

const known = Object.keys(COMMANDS);

if (!known.includes(cmd)) {
  banner();
  console.error('  ' + R(`✗  Unknown command: ${cmd}`) + '  ' + Gr('· run via --help') + '\n');
  process.exit(1);
}

try {
  const modPath = join(__dirname, 'commands', `${cmd}.mjs`);
  if (!existsSync(modPath)) {
    banner();
    console.log('  ' + Y('◌') + '  ' + W(`via ${cmd}`) + Gr('  — coming soon'));
    console.log('  ' + Gr('    ') + Sk('https://github.com/Vektor-Memory/Via') + '\n');
    process.exit(0);
  }
  const mod = await import(`./commands/${cmd}.mjs`);
  await mod.run(args.slice(1));
} catch (err) {
  console.error('  ' + R(`✗  ${err.message}`));
  if (process.env.VIA_DEBUG) console.error(err.stack);
  process.exit(1);
}

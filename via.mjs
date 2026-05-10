#!/usr/bin/env node
/**
 * via.mjs — CLI entry point
 * Via by Vektor Memory — Route anything. Remember everything. Works everywhere.
 * github.com/Vektor-Memory/Via
 */

const VERSION = '0.1.0';

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

// ── BANNER ──────────────────────────────────────────────────────────────────
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

// ── COMMANDS ────────────────────────────────────────────────────────────────
const COMMANDS = {
  context:  'Inject the right memory into any AI tool',
  handoff:  'Transfer your working state between tools',
  task:     'Shared persistent task board',
  persona:  'Named agent personas with role memory',
  spend:    'Unified token and cost tracking',
  scaffold: 'Deploy a complete AI setup to any project',
  watch:    'Event routing when AI tools complete tasks',
  audit:    'Compliance memory — log every AI decision',
  sync:     'Backup and restore your AI setup',
  ingest:   'Universal knowledge intake',
  route:    'Which AI tool should handle this task?',
  status:   'Full ecosystem health check',
  serve:    'Run as MCP server (stdio or --sse)',
  upgrade:  'Connect Vektor Slipstream for full intelligence',
};

// ── HELP ────────────────────────────────────────────────────────────────────
function cmdHelp() {
  banner();

  box('COMMANDS');
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    row(W(cmd), Gr(desc));
  }
  boxEnd();

  box('OPTIONS');
  row(Sk('--help'),    Si('Show this help'));
  row(Sk('--version'), Si('Print version'));
  row(Sk('--json'),    Si('JSON output (all commands)'));
  boxEnd();

  box('EXAMPLES');
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Full ecosystem health check'));
  console.log('  ' + BAR + '  ' + Sk('via status'));
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Pull memory into Cursor'));
  console.log('  ' + BAR + '  ' + Sk('via context --query "current project" --for cursor'));
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Add a task to the shared board'));
  console.log('  ' + BAR + '  ' + Sk('via task add "refactor auth module"'));
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Export your working state before switching tools'));
  console.log('  ' + BAR + '  ' + Sk('via handoff --export'));
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Track token spend across all AI tools'));
  console.log('  ' + BAR + '  ' + Sk('via spend today'));
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Connect Via to Claude Desktop as an MCP server'));
  console.log('  ' + BAR + '  ' + Sk('via serve'));
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Unlock semantic recall with Slipstream'));
  console.log('  ' + BAR + '  ' + Sk('via upgrade'));
  blank();
  boxEnd();

  box('LINKS');
  row(Si('Docs'),    Sk('https://github.com/Vektor-Memory/Via'));
  row(Si('Upgrade'), Sk('https://vektormemory.com'));
  boxEnd();
}

// ── DISPATCH ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cmd  = args[0];

if (!cmd || cmd === '--help' || cmd === '-h') {
  cmdHelp();
  process.exit(0);
}

if (cmd === '--version' || cmd === '-v') {
  console.log(`via v${VERSION}`);
  process.exit(0);
}

const known = Object.keys(COMMANDS);

if (!known.includes(cmd)) {
  banner();
  console.error('  ' + R(`✗  Unknown command: ${cmd}`) + '  ' + Gr('· run via --help') + '\n');
  process.exit(1);
}

try {
  const mod = await import(`./commands/${cmd}.mjs`);
  await mod.run(args.slice(1));
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND') {
    banner();
    console.log('  ' + Y('◌') + '  ' + W(`via ${cmd}`) + Gr('  — coming in v0.2'));
    console.log('  ' + Gr('    Roadmap: ') + Sk('https://github.com/Vektor-Memory/Via') + '\n');
  } else {
    console.error('  ' + R(`✗  ${err.message}`));
    process.exit(1);
  }
}

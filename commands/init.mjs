/**
 * commands/init.mjs — via init
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { detectTools } from '../utils/detect.mjs';
import { heading, headingEnd, label, blank, green, red, yellow, dim, steel } from '../utils/format.mjs';

const HOME = homedir();
const WIN  = process.platform === 'win32';

function readJSON(p)      { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
function writeJSON(p, obj){ mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8'); }

function wireClaude(dry) {
  const cfgPath = WIN
    ? join(HOME, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
    : join(HOME, '.config', 'claude', 'claude_desktop_config.json');
  if (!existsSync(dirname(cfgPath))) return { ok: false, reason: 'Claude Desktop not found' };
  const cfg = readJSON(cfgPath) ?? {};
  cfg.mcpServers = cfg.mcpServers ?? {};
  if (cfg.mcpServers.via) return { ok: true, reason: 'already configured' };
  cfg.mcpServers.via = { command: 'via', args: ['serve'] };
  if (!dry) writeJSON(cfgPath, cfg);
  return { ok: true, reason: dry ? 'would configure' : 'configured' };
}

function wireCursor(dry) {
  const cfgPath = WIN
    ? join(HOME, 'AppData', 'Roaming', 'Cursor', 'User', 'settings.json')
    : join(HOME, '.cursor', 'settings.json');
  if (!existsSync(cfgPath)) return { ok: false, reason: 'Cursor settings not found' };
  const cfg = readJSON(cfgPath) ?? {};
  cfg['mcp.servers'] = cfg['mcp.servers'] ?? {};
  if (cfg['mcp.servers'].via) return { ok: true, reason: 'already configured' };
  cfg['mcp.servers'].via = { command: 'via', args: ['serve'] };
  if (!dry) writeJSON(cfgPath, cfg);
  return { ok: true, reason: dry ? 'would configure' : 'configured' };
}

function wireWindsurf(dry) {
  const cfgPath = WIN
    ? join(HOME, 'AppData', 'Roaming', 'Windsurf', 'User', 'settings.json')
    : join(HOME, '.windsurf', 'settings.json');
  if (!existsSync(cfgPath)) return { ok: false, reason: 'Windsurf settings not found' };
  const cfg = readJSON(cfgPath) ?? {};
  cfg['mcp.servers'] = cfg['mcp.servers'] ?? {};
  if (cfg['mcp.servers'].via) return { ok: true, reason: 'already configured' };
  cfg['mcp.servers'].via = { command: 'via', args: ['serve'] };
  if (!dry) writeJSON(cfgPath, cfg);
  return { ok: true, reason: dry ? 'would configure' : 'configured' };
}

export async function run(args) {
  const dry    = args.includes('--dry-run') || args.includes('--dry');
  const asJSON = args.includes('--json');
  const tools  = detectTools();

  heading('INIT' + (dry ? ' — DRY RUN' : ''));
  blank();

  const results = {};

  if (tools.claude) {
    const r = wireClaude(dry);
    results.claude = r;
    label('Claude Desktop', r.ok ? green(r.reason) : red(r.reason));
  } else {
    label('Claude Desktop', dim('not detected'));
  }

  if (tools.cursor) {
    const r = wireCursor(dry);
    results.cursor = r;
    label('Cursor', r.ok ? green(r.reason) : red(r.reason));
  } else {
    label('Cursor', dim('not detected'));
  }

  if (tools.windsurf) {
    const r = wireWindsurf(dry);
    results.windsurf = r;
    label('Windsurf', r.ok ? green(r.reason) : red(r.reason));
  } else {
    label('Windsurf', dim('not detected'));
  }

  blank();
  const wired   = Object.values(results).filter(r => r.ok && r.reason !== 'already configured').length;
  const already = Object.values(results).filter(r => r.reason === 'already configured').length;

  if (wired > 0 && !dry) {
    console.log('  │  ' + green(`${wired} tool(s) wired.`) + ' Restart your AI tools to activate.');
  } else if (already > 0 && already === Object.keys(results).length) {
    console.log('  │  ' + dim('All tools already configured.'));
  } else if (dry) {
    console.log('  │  ' + yellow('Dry run — no files written.'));
  }

  blank();
  console.log('  │  ' + dim('Test: via serve'));
  headingEnd();

  if (asJSON) console.log(JSON.stringify({ tools, results, dry }, null, 2));
}

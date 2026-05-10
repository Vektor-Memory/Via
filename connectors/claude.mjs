/**
 * connectors/claude.mjs — Claude connector
 * Formats context blocks for Claude Code, claude.ai, and Claude Desktop.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const name    = 'claude';
export const version = '0.1.0';

export function formatContext(block, opts = {}) {
  const { namespace = 'via', sections = [] } = opts;
  const parts = [`<memory source="${namespace}">`];
  if (sections.length) {
    sections.forEach(s => parts.push(`  <section name="${s.name}">\n${s.content}\n  </section>`));
  } else {
    parts.push(block);
  }
  parts.push('</memory>');
  return parts.join('\n');
}

export function formatPersona(persona) {
  return [
    '<persona>',
    `  <name>${persona.name}</name>`,
    `  <role>${persona.role}</role>`,
    `  <instructions>${persona.system_prompt}</instructions>`,
    '</persona>',
  ].join('\n');
}

export function detect() {
  return existsSync(join(homedir(), '.claude'));
}

export function mcpConfigPath() {
  const WIN = process.platform === 'win32';
  return WIN
    ? join(homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
    : join(homedir(), '.config', 'claude', 'claude_desktop_config.json');
}

export async function wireMcp(viaPath) {
  const configPath = mcpConfigPath();
  if (!existsSync(configPath)) throw new Error(`Claude config not found at ${configPath}`);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.mcpServers = config.mcpServers ?? {};
  if (config.mcpServers.via) return false;
  config.mcpServers.via = { command: 'node', args: [viaPath, 'serve'] };
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  return true;
}

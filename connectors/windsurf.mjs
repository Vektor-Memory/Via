/**
 * connectors/windsurf.mjs — Windsurf connector
 */

import { existsSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const name    = 'windsurf';
export const version = '0.1.0';

export function formatContext(block) {
  return `<!-- via context\n${block}\n-->`;
}

export function formatPersona(persona) {
  return `<!-- persona: ${persona.name} — ${persona.role}\n${persona.system_prompt}\n-->`;
}

export function rulesPath(projectDir = process.cwd()) {
  return join(projectDir, '.windsurfrules');
}

export async function appendRules(block, projectDir = process.cwd()) {
  appendFileSync(rulesPath(projectDir), '\n\n' + formatContext(block), 'utf8');
}

export function detect() {
  const WIN = process.platform === 'win32';
  return existsSync(
    WIN ? join(homedir(), 'AppData', 'Roaming', 'Windsurf') : join(homedir(), '.windsurf')
  );
}

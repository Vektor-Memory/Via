/**
 * connectors/cursor.mjs — Cursor connector
 */

import { existsSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const name    = 'cursor';
export const version = '0.1.0';

export function formatContext(block) {
  return block.split('\n').map(l => `// ${l}`).join('\n');
}

export function formatPersona(persona) {
  return [
    `// PERSONA: ${persona.name}`,
    `// ROLE: ${persona.role}`,
    '//',
    ...persona.system_prompt.split('\n').map(l => `// ${l}`),
  ].join('\n');
}

export function rulesPath(projectDir = process.cwd()) {
  return join(projectDir, '.cursorrules');
}

export async function appendRules(block, projectDir = process.cwd()) {
  appendFileSync(rulesPath(projectDir), '\n\n' + formatContext(block), 'utf8');
}

export function detect() {
  const WIN = process.platform === 'win32';
  return existsSync(
    WIN ? join(homedir(), 'AppData', 'Roaming', 'Cursor') : join(homedir(), '.cursor')
  );
}

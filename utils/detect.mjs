/**
 * utils/detect.mjs — detect installed AI tools by filesystem footprint + PATH
 */
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

const HOME = homedir();
const WIN  = process.platform === 'win32';
const ROAM = WIN ? join(HOME, 'AppData', 'Roaming') : '';

function tryExec(c) {
  try { execSync(c, { stdio: 'pipe' }); return true; } catch { return false; }
}

export function detectTools() {
  return {
    claude:     existsSync(join(HOME, '.claude'))    || tryExec('claude --version'),
    cursor:     existsSync(join(HOME, '.cursor'))    || (WIN && existsSync(join(ROAM, 'Cursor'))),
    windsurf:   existsSync(join(HOME, '.windsurf'))  || (WIN && existsSync(join(ROAM, 'Windsurf'))),
    chatgpt:    WIN && existsSync(join(ROAM, 'ChatGPT')),
    slipstream: tryExec('vektor --version'),
  };
}

export function detectOS() {
  return WIN ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
}

/** Return config file path for a given tool */
export function toolConfigPath(tool) {
  const paths = {
    claude: WIN
      ? join(ROAM, 'Claude', 'claude_desktop_config.json')
      : join(HOME, '.config', 'claude', 'config.json'),
    cursor: WIN
      ? join(ROAM, 'Cursor', 'User', 'settings.json')
      : join(HOME, '.cursor', 'settings.json'),
    windsurf: WIN
      ? join(ROAM, 'Windsurf', 'User', 'settings.json')
      : join(HOME, '.windsurf', 'settings.json'),
  };
  return paths[tool] ?? null;
}

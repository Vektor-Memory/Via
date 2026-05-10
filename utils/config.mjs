/**
 * utils/config.mjs — ~/.via/config.json reader/writer
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { viaDir } from './db.mjs';

const configPath = () => join(viaDir(), 'config.json');

export function readConfig() {
  const p = configPath();
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

export function writeConfig(data) {
  writeFileSync(configPath(), JSON.stringify(data, null, 2), 'utf8');
}

export function getConfig(key, fallback = null) {
  return readConfig()[key] ?? fallback;
}

export function setConfig(key, value) {
  const cfg = readConfig();
  cfg[key] = value;
  writeConfig(cfg);
}

export function hasSlipstream() {
  return !!(process.env.VEKTOR_API_KEY || getConfig('slipstream_key'));
}

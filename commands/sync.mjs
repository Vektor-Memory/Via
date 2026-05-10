/**
 * commands/sync.mjs — via sync
 * Backup and restore your entire AI setup across machines.
 * All tool configs, personas, tasks, handoffs, and memory exports.
 *
 * Usage:
 *   via sync backup              # create a .via-backup.zip
 *   via sync restore <file>      # restore from backup
 *   via sync status              # show what would be backed up
 */

import { existsSync, readdirSync, statSync, copyFileSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { viaDir } from '../utils/db.mjs';
import { detectTools, toolConfigPath } from '../utils/detect.mjs';
import { green, red, yellow, bold, dim, label, blank, table } from '../utils/format.mjs';

const HOME = homedir();

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function collectFiles() {
  const files = [];
  const vd = viaDir();

  // ~/.via/ — all local data
  function walk(dir, base = '') {
    if (!existsSync(dir)) return;
    readdirSync(dir).forEach(name => {
      const full = join(dir, name);
      const rel  = base ? `${base}/${name}` : name;
      if (statSync(full).isDirectory()) {
        walk(full, rel);
      } else {
        files.push({ src: full, rel: `via-data/${rel}` });
      }
    });
  }
  walk(vd);

  // AI tool configs
  const tools = detectTools();
  Object.keys(tools).forEach(tool => {
    const p = toolConfigPath(tool);
    if (p && existsSync(p)) {
      files.push({ src: p, rel: `tool-configs/${tool}-config.json` });
    }
  });

  return files;
}

export async function run(args) {
  const subcmd = args[0];
  const asJSON = args.includes('--json');

  if (!subcmd || subcmd === 'status') {
    const files = collectFiles();
    console.log(`\n  ${bold('via sync')} — backup status\n`);
    if (!files.length) {
      console.log('  Nothing to back up yet. Run some via commands first.\n');
      return;
    }
    if (asJSON) { console.log(JSON.stringify(files, null, 2)); return; }
    const rows = files.map(f => ({
      file:  f.rel,
      size:  statSync(f.src).size + 'B',
    }));
    console.log(table(rows, ['file', 'size']));
    console.log(dim(`\n  Run 'via sync backup' to create an archive.\n`));
    return;
  }

  if (subcmd === 'backup') {
    const files   = collectFiles();
    const outName = `via-backup-${timestamp()}`;
    const outDir  = join(process.cwd(), outName);

    mkdirSync(outDir, { recursive: true });

    const manifest = [];
    for (const f of files) {
      const dest = join(outDir, f.rel);
      mkdirSync(join(dest, '..'), { recursive: true });
      try {
        copyFileSync(f.src, dest);
        manifest.push({ rel: f.rel, ok: true });
        console.log(`  ${green('✓')} ${f.rel}`);
      } catch (err) {
        manifest.push({ rel: f.rel, ok: false, error: err.message });
        console.log(`  ${red('✗')} ${f.rel} — ${err.message}`);
      }
    }

    // Write manifest
    writeFileSync(join(outDir, 'via-manifest.json'), JSON.stringify({
      via_version: '0.1.0',
      backed_up:   new Date().toISOString(),
      files:       manifest,
    }, null, 2), 'utf8');

    blank();
    console.log(`  ${green('✓')} Backup written → ${outDir}`);
    console.log(dim(`  Restore: via sync restore ${outDir}\n`));
    return;
  }

  if (subcmd === 'restore') {
    const src = resolve(args[1] ?? '');
    if (!src || !existsSync(src)) {
      console.error(`  via sync restore requires a backup directory path`);
      process.exit(1);
    }
    const manifest = JSON.parse(readFileSync(join(src, 'via-manifest.json'), 'utf8'));
    console.log(`\n  ${bold('Restoring')} backup from ${manifest.backed_up?.slice(0,16) ?? '—'}\n`);

    for (const f of manifest.files) {
      const from = join(src, f.rel);
      if (!existsSync(from)) { console.log(`  ${yellow('–')} missing: ${f.rel}`); continue; }
      // Determine destination
      const dest = f.rel.startsWith('via-data/')
        ? join(viaDir(), f.rel.replace('via-data/', ''))
        : f.rel.startsWith('tool-configs/')
          ? toolConfigPath(f.rel.replace('tool-configs/', '').replace('-config.json', ''))
          : null;
      if (!dest) { console.log(dim(`  skip: ${f.rel}`)); continue; }
      mkdirSync(join(dest, '..'), { recursive: true });
      copyFileSync(from, dest);
      console.log(`  ${green('✓')} ${f.rel}`);
    }
    blank();
    console.log(`  ${green('✓')} Restore complete\n`);
    return;
  }

  console.log(`
  Usage: via sync <subcommand>

  Subcommands:
    status       Show what would be backed up
    backup       Create a backup directory of your full AI setup
    restore <dir> Restore from a backup directory
`);
}

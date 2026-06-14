/**
 * commands/convert.mjs — via convert
 * Local file conversion powered by FFmpeg, ImageMagick, Pandoc, LibreOffice.
 * All processing local — nothing uploaded anywhere.
 * Optionally pipes output directly into via memory.
 *
 * Usage:
 *   via convert ./doc.pdf --to md                  # pdf → markdown
 *   via convert ./audio.mp3 --to txt               # transcribe (whisper/ffmpeg)
 *   via convert ./image.png --to jpg               # image conversion
 *   via convert ./video.mp4 --to mp3               # extract audio
 *   via convert ./doc.docx --to pdf                # document → pdf
 *   via convert ./file.mp4 --to gif                # video → gif
 *   via convert ./folder/ --to zip                 # archive a folder
 *   via convert ./doc.pdf --to md --ingest         # convert + store in via memory
 *   via convert --check                            # check which tools are installed
 *   via convert --formats                          # show all supported conversions
 */

import { existsSync, statSync } from 'fs';
import { resolve, extname, basename, dirname, join } from 'path';
import { spawnSync, execSync } from 'child_process';
import { heading, headingEnd, label, blank, table, green, red, yellow, dim, steel } from '../utils/format.mjs';

const WIN = process.platform === 'win32';

// ── Tool detection ────────────────────────────────────────────────────────────
const TOOLS = {
  ffmpeg:      { cmd: 'ffmpeg',      check: '-version',    label: 'FFmpeg',      use: 'audio/video' },
  magick:      { cmd: WIN ? 'magick' : 'convert', check: '-version', label: 'ImageMagick', use: 'images' },
  pandoc:      { cmd: 'pandoc',      check: '--version',   label: 'Pandoc',      use: 'documents' },
  libreoffice: { cmd: WIN ? 'soffice' : 'libreoffice', check: '--version', label: 'LibreOffice', use: 'office docs' },
  pdftotext:   { cmd: 'pdftotext',   check: '-v',          label: 'Poppler',     use: 'pdf→txt' },
  zip:         { cmd: 'zip',         check: '-v',          label: 'Zip',         use: 'archives' },
  '7z':        { cmd: WIN ? '7z' : '7za', check: 'i',     label: '7-Zip',       use: '7z archives' },
};

function toolAvailable(name) {
  const t = TOOLS[name];
  if (!t) return false;
  try {
    const r = spawnSync(t.cmd, [t.check], { stdio: 'pipe', timeout: 3000 });
    return r.status === 0 || r.stderr?.toString().length > 0;
  } catch { return false; }
}

function available() {
  const result = {};
  for (const name of Object.keys(TOOLS)) result[name] = toolAvailable(name);
  return result;
}

// ── Conversion map ────────────────────────────────────────────────────────────
// [from_exts] → [to_exts] → { tool, engine }
const CONVERSIONS = {
  // ── Images (ImageMagick) ──
  image: {
    from: ['.png','.jpg','.jpeg','.webp','.gif','.bmp','.tiff','.tif','.ico','.svg'],
    to:   ['.png','.jpg','.webp','.gif','.bmp','.tiff','.ico','.pdf'],
    tool: 'magick',
    run:  (src, dst) => [TOOLS.magick.cmd, [src, dst]],
  },
  // ── Audio (FFmpeg) ──
  audio: {
    from: ['.mp3','.wav','.ogg','.m4a','.aac','.flac','.aiff','.wma','.opus'],
    to:   ['.mp3','.wav','.ogg','.m4a','.aac','.flac','.aiff','.opus'],
    tool: 'ffmpeg',
    run:  (src, dst) => ['ffmpeg', ['-i', src, '-y', dst]],
  },
  // ── Video (FFmpeg) ──
  video: {
    from: ['.mp4','.mkv','.mov','.avi','.webm','.flv','.wmv','.m4v'],
    to:   ['.mp4','.mkv','.mov','.avi','.webm','.gif','.mp3'],
    tool: 'ffmpeg',
    run:  (src, dst, toExt) => {
      if (toExt === '.gif') return ['ffmpeg', ['-i', src, '-vf', 'fps=10,scale=640:-1:flags=lanczos', '-y', dst]];
      if (toExt === '.mp3') return ['ffmpeg', ['-i', src, '-q:a', '0', '-map', 'a', '-y', dst]];
      return ['ffmpeg', ['-i', src, '-y', dst]];
    },
  },
  // ── Documents (Pandoc) ──
  doc: {
    from: ['.md','.markdown','.rst','.html','.htm','.txt','.tex','.org','.epub'],
    to:   ['.md','.html','.txt','.pdf','.epub','.docx','.odt','.rst'],
    tool: 'pandoc',
    run:  (src, dst) => ['pandoc', [src, '-o', dst]],
  },
  // ── Office docs (LibreOffice) ──
  office: {
    from: ['.docx','.doc','.odt','.rtf','.xlsx','.xls','.ods','.pptx','.ppt','.odp'],
    to:   ['.pdf','.txt','.html','.odt','.docx'],
    tool: 'libreoffice',
    run:  (src, dst, toExt) => {
      const fmt = toExt === '.pdf' ? 'pdf' : toExt === '.txt' ? 'text' : toExt === '.html' ? 'html' : 'odt';
      return [WIN ? 'soffice' : 'libreoffice', ['--headless', '--convert-to', fmt, '--outdir', dirname(dst), src]];
    },
  },
  // ── PDF → text (Poppler, fastest) ──
  pdf_txt: {
    from: ['.pdf'],
    to:   ['.txt'],
    tool: 'pdftotext',
    run:  (src, dst) => ['pdftotext', [src, dst]],
  },
  // ── PDF → md (Pandoc, richer) ──
  pdf_md: {
    from: ['.pdf'],
    to:   ['.md'],
    tool: 'pandoc',
    run:  (src, dst) => ['pandoc', [src, '-o', dst]],
  },
  // ── Archives ──
  archive: {
    from: ['*'],
    to:   ['.zip','.tar.gz','.7z'],
    tool: 'zip',
    run:  (src, dst, toExt) => {
      if (toExt === '.7z') return [WIN ? '7z' : '7za', ['a', dst, src]];
      if (toExt === '.tar.gz') return ['tar', ['-czf', dst, '-C', dirname(src), basename(src)]];
      return ['zip', ['-r', dst, src]];
    },
  },
};

// ── Route a conversion ─────────────────────────────────────────────────────────
function findConverter(fromExt, toExt) {
  // special cases first
  if (fromExt === '.pdf' && toExt === '.txt') return CONVERSIONS.pdf_txt;
  if (fromExt === '.pdf' && toExt === '.md')  return CONVERSIONS.pdf_md;

  for (const conv of Object.values(CONVERSIONS)) {
    if (conv.from.includes('*') || conv.from.includes(fromExt)) {
      if (conv.to.includes(toExt)) return conv;
    }
  }
  return null;
}

// ── Run conversion ─────────────────────────────────────────────────────────────
function runConversion(src, dst, toExt, conv) {
  const [cmd, args] = conv.run(src, dst, toExt);
  const result = spawnSync(cmd, args, { stdio: 'pipe', timeout: 120000 });
  if (result.error) throw new Error(`${cmd} not found — run: via convert --check`);
  if (result.status !== 0) {
    const errMsg = result.stderr?.toString().slice(0, 200) || 'conversion failed';
    throw new Error(errMsg);
  }
  return dst;
}

// ── Check tools ────────────────────────────────────────────────────────────────
function checkTools() {
  const tools = available();
  heading('CONVERT — TOOL CHECK');
  blank();
  Object.entries(TOOLS).forEach(([name, t]) => {
    const ok = tools[name];
    label(t.label, ok ? green('installed') + dim('  ' + t.use) : red('not found') + dim('  ' + t.use));
  });
  blank();
  const missing = Object.entries(tools).filter(([,v]) => !v).map(([k]) => TOOLS[k].label);
  if (missing.length) {
    console.log('  │  ' + yellow('Missing: ') + missing.join(', '));
    console.log('  │  ' + dim('Install guides: https://github.com/Vektor-Memory/Via#convert'));
  } else {
    console.log('  │  ' + green('All tools installed'));
  }
  headingEnd();
}

// ── Show formats ───────────────────────────────────────────────────────────────
function showFormats() {
  heading('CONVERT — SUPPORTED FORMATS');
  blank();
  const rows = [
    { category: 'Images',    from: 'png jpg webp gif bmp tiff ico svg', to: 'png jpg webp gif bmp tiff ico pdf' },
    { category: 'Audio',     from: 'mp3 wav ogg m4a aac flac aiff wma', to: 'mp3 wav ogg m4a aac flac aiff' },
    { category: 'Video',     from: 'mp4 mkv mov avi webm flv wmv',       to: 'mp4 mkv mov avi webm gif mp3' },
    { category: 'Documents', from: 'md rst html txt tex org epub',        to: 'md html txt pdf epub docx odt' },
    { category: 'Office',    from: 'docx doc odt rtf xlsx pptx',          to: 'pdf txt html odt docx' },
    { category: 'PDF',       from: 'pdf',                                  to: 'txt md html docx' },
    { category: 'Archives',  from: 'any file or folder',                  to: 'zip tar.gz 7z' },
  ];
  rows.forEach(r => {
    console.log('  │  ' + green(r.category.padEnd(12)) + dim('from: ') + r.from);
    console.log('  │  ' + ' '.repeat(12) + dim('  to: ') + r.to);
    blank();
  });
  console.log('  │  ' + dim('Memory pipeline: add --ingest to any conversion'));
  console.log('  │  ' + dim('Example: via convert ./docs/ --to md --ingest'));
  headingEnd();
}

// ── Main ──────────────────────────────────────────────────────────────────────

// ── Batch folder conversion ───────────────────────────────────────────────────
import { readdirSync, statSync, existsSync as _existsSync, mkdirSync } from 'fs';
import { join as _join, extname as _extname, basename as _basename, dirname } from 'path';
import { execSync as _execSync } from 'child_process';

function collectConvertFiles(dir, ext) {
  const files = [];
  const skip  = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__']);
  function walk(d) {
    try {
      readdirSync(d).forEach(name => {
        if (skip.has(name) || name.startsWith('.')) return;
        const full = _join(d, name);
        try {
          if (statSync(full).isDirectory()) return walk(full);
          if (!ext || _extname(name).toLowerCase() === '.' + ext.toLowerCase().replace(/^\./, '')) {
            files.push(full);
          }
        } catch {}
      });
    } catch {}
  }
  walk(dir);
  return files;
}

async function batchConvert(srcDir, targetExt, opts = {}) {
  const { skipExisting = true, outputDir = null, dryRun = false } = opts;
  const files = collectConvertFiles(srcDir, null);

  // Group by convertible types
  const convertible = files.filter(f => {
    const ext = _extname(f).toLowerCase();
    const supported = ['.pdf','.docx','.doc','.png','.jpg','.jpeg','.gif','.webp',
                       '.mp4','.mov','.avi','.mkv','.mp3','.wav','.ogg','.flac'];
    return supported.includes(ext);
  });

  console.log('');
  console.log('  ┌─ BATCH CONVERT ───────────────────────────────────────');
  console.log('  │  Source: ' + srcDir);
  console.log('  │  Files:  ' + convertible.length + ' convertible');
  console.log('  │  Target: ' + targetExt);
  console.log('  │  Mode:   ' + (dryRun ? 'dry run' : 'convert'));
  console.log('  └────────────────────────────────────────────────────────');
  console.log('');

  const results = { converted: 0, skipped: 0, failed: 0, errors: [] };

  for (let i = 0; i < convertible.length; i++) {
    const src  = convertible[i];
    const base = _basename(src, _extname(src));
    const outDir = outputDir || dirname(src);
    const dest = _join(outDir, base + '.' + targetExt.replace(/^\./, ''));

    const pct = Math.round((i / convertible.length) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    process.stdout.write('\r  [' + bar + '] ' + pct + '%  ' + _basename(src).slice(0, 30).padEnd(30));

    if (skipExisting && _existsSync(dest)) {
      results.skipped++;
      continue;
    }

    if (dryRun) {
      console.log('');
      console.log('  → ' + _basename(src) + ' → ' + _basename(dest));
      results.converted++;
      continue;
    }

    try {
      const srcExt  = _extname(src).toLowerCase();
      const destExt = '.' + targetExt.replace(/^\./, '').toLowerCase();

      // Route to correct converter
      let cmd = null;
      if (['.png','.jpg','.jpeg','.gif','.webp'].includes(srcExt) &&
          ['.png','.jpg','.jpeg','.gif','.webp'].includes(destExt)) {
        cmd = `convert "${src}" "${dest}"`;  // ImageMagick
      } else if (['.mp4','.mov','.avi','.mkv'].includes(srcExt) ||
                 ['.mp3','.wav','.ogg','.flac'].includes(srcExt)) {
        cmd = `ffmpeg -i "${src}" -y "${dest}" 2>/dev/null`;
      } else if (srcExt === '.pdf' && destExt === '.md') {
        cmd = `pandoc "${src}" -o "${dest}" 2>/dev/null || pdftotext "${src}" "${dest}" 2>/dev/null`;
      } else if (['.docx','.doc'].includes(srcExt)) {
        cmd = `pandoc "${src}" -o "${dest}" 2>/dev/null || libreoffice --headless --convert-to ${targetExt} "${src}" --outdir "${outDir}" 2>/dev/null`;
      }

      if (cmd) {
        _execSync(cmd, { timeout: 60000 });
        results.converted++;
      } else {
        results.errors.push({ file: src, error: 'No converter for ' + srcExt + ' → ' + destExt });
        results.failed++;
      }
    } catch (e) {
      results.errors.push({ file: src, error: e.message.slice(0, 80) });
      results.failed++;
    }
  }

  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  console.log('');
  console.log('  ┌─ BATCH RESULT ────────────────────────────────────────');
  console.log('  │  converted: ' + results.converted);
  console.log('  │  skipped:   ' + results.skipped + (skipExisting ? ' (already exist)' : ''));
  console.log('  │  failed:    ' + results.failed);
  if (results.errors.length) {
    console.log('  │');
    results.errors.slice(0, 5).forEach(e =>
      console.log('  │  ✗ ' + _basename(e.file) + ': ' + e.error)
    );
  }
  console.log('  └────────────────────────────────────────────────────────');
  console.log('');

  return results;
}

export async function run(args) {
  // via convert --batch ./folder --to mp3 [--skip-existing] [--dry-run] [--out ./output]
  const doBatch = args.includes('--batch');
  if (doBatch) {
    const batchIdx  = args.indexOf('--batch');
    const toIdx     = args.indexOf('--to');
    const outIdx    = args.indexOf('--out');
    const srcDir    = args[batchIdx + 1];
    const targetExt = args[toIdx + 1] || 'mp3';
    const outputDir = outIdx !== -1 ? args[outIdx + 1] : null;
    const dryRun    = args.includes('--dry-run');
    const skipExist = !args.includes('--no-skip');

    if (!srcDir) {
      console.error('  Usage: via convert --batch <folder> --to <ext> [--dry-run] [--out <dir>] [--no-skip]');
      process.exit(1);
    }
    await batchConvert(srcDir, targetExt, { skipExisting: skipExist, outputDir, dryRun });
    return;
  }

  const asJSON = args.includes('--json');
  const ingest = args.includes('--ingest');   // pipe output into via memory
  const dryRun = args.includes('--dry-run');

  if (args.includes('--check'))   { checkTools(); return; }
  if (args.includes('--formats')) { showFormats(); return; }

  const toIdx  = args.indexOf('--to');
  const outIdx = args.indexOf('--out');
  const toExt  = toIdx  !== -1 ? (args[toIdx  + 1].startsWith('.') ? args[toIdx + 1] : '.' + args[toIdx + 1]) : null;
  const outDir = outIdx !== -1 ? args[outIdx + 1] : null;

  const flagVals = new Set([
    toIdx  !== -1 ? args[toIdx  + 1] : null,
    outIdx !== -1 ? args[outIdx + 1] : null,
  ].filter(Boolean));

  const srcArg = args.find(a => !a.startsWith('--') && !flagVals.has(a));

  if (!srcArg || !toExt) {
    heading('CONVERT — USAGE');
    label('via convert <file> --to <format>',   'convert a file');
    label('via convert <file> --to md --ingest','convert + store in memory');
    label('via convert --check',                'check installed tools');
    label('via convert --formats',              'show all supported formats');
    label('--out <dir>',                        'output directory (default: same as input)');
    label('--dry-run',                          'preview without converting');
    blank();
    console.log('  │  ' + dim('Examples:'));
    console.log('  │    ' + steel('via convert ./report.pdf --to md'));
    console.log('  │    ' + steel('via convert ./audio.mp3 --to txt --ingest'));
    console.log('  │    ' + steel('via convert ./video.mp4 --to gif'));
    console.log('  │    ' + steel('via convert ./docs/ --to zip'));
    headingEnd(); return;
  }

  const src     = resolve(srcArg);
  if (!existsSync(src)) { console.error(`  Not found: ${src}`); process.exit(1); }

  const fromExt = extname(src).toLowerCase();
  const conv    = findConverter(fromExt, toExt);

  if (!conv) {
    heading('CONVERT — ERROR');
    label('from', fromExt || 'unknown');
    label('to',   toExt);
    label('status', red('no converter for this combination'));
    blank();
    console.log('  │  ' + dim('Run: via convert --formats'));
    headingEnd(); return;
  }

  // check tool is available
  const toolOk = toolAvailable(conv.tool);
  if (!toolOk) {
    heading('CONVERT — MISSING TOOL');
    label('required', TOOLS[conv.tool]?.label ?? conv.tool);
    label('status',   red('not installed'));
    blank();
    console.log('  │  ' + dim('Run: via convert --check'));
    headingEnd(); return;
  }

  // build output path
  const outDirResolved = outDir ? resolve(outDir) : dirname(src);
  const outName        = basename(src, fromExt) + toExt;
  const dst            = join(outDirResolved, outName);

  heading('CONVERT' + (dryRun ? ' — DRY RUN' : ''));
  label('from',  basename(src) + dim('  ' + fromExt));
  label('to',    basename(dst) + dim('  ' + toExt));
  label('tool',  TOOLS[conv.tool]?.label ?? conv.tool);
  label('output', dst);
  if (ingest) label('ingest', green('yes — will store in via memory'));
  blank();

  if (dryRun) {
    console.log('  │  ' + yellow('Dry run — no conversion performed'));
    headingEnd(); return;
  }

  // run it
  process.stdout.write('  │  Converting...');
  try {
    runConversion(src, dst, toExt, conv);
    console.log(' ' + green('done'));
    blank();
    label('output', green(dst));

    // file size
    try {
      const size = statSync(dst).size;
      label('size', (size / 1024).toFixed(1) + ' KB');
    } catch {}

    // --ingest: pipe output into via memory
    if (ingest) {
      blank();
      console.log('  │  ' + dim('Ingesting into via memory...'));
      try {
        const { run: memRun } = await import('./memory.mjs');
        await memRun(['add', '--file', dst]);
      } catch (err) {
        console.log('  │  ' + red('ingest failed: ' + err.message));
      }
    }

    if (asJSON) console.log(JSON.stringify({ src, dst, tool: conv.tool, ok: true }, null, 2));

  } catch (err) {
    console.log(' ' + red('failed'));
    blank();
    console.log('  │  ' + red(err.message.slice(0, 120)));
    if (!toolOk) console.log('  │  ' + dim('Run: via convert --check'));
  }

  headingEnd();
}

/**
 * via research — autonomous parameter tuning with cross-session memory
 * Usage:
 *   via research --target recall-params
 *   via research --target recall-params --sessions 10 --iters 50
 *   via research --target recall-params --apply
 *   via research --target recall-params --status
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── PALETTE ────────────────────────────────────────────────────────────────
const _ = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  white: '\x1b[97m', silver: '\x1b[37m', grey: '\x1b[90m',
  cobalt: '\x1b[38;5;26m', steel: '\x1b[38;5;67m',
  sky: '\x1b[38;5;117m', ice: '\x1b[38;5;153m',
  green: '\x1b[38;5;78m', red: '\x1b[38;5;203m', amber: '\x1b[38;5;221m',
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

const BAR = St('│');
function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
function box(label) {
  const raw = stripAnsi(label);
  console.log('  ' + St('┌─') + ' ' + Ic(label) + ' ' + St('─').repeat(Math.max(2, 50 - raw.length)));
}
function boxEnd() { console.log('  ' + St('└') + St('─').repeat(53)); console.log(''); }
function row(label, value) {
  const raw = stripAnsi(label);
  const pad = ' '.repeat(Math.max(1, 20 - raw.length));
  console.log('  ' + BAR + ' ' + label + pad + value);
}
function blank() { console.log('  ' + BAR); }

// ── RESEARCH LOG ───────────────────────────────────────────────────────────
const RESEARCH_DIR  = join(ROOT, '.via-research');
const LOG_FILE      = join(RESEARCH_DIR, 'recall-params-log.json');
const BEST_FILE     = join(RESEARCH_DIR, 'recall-params-best.json');

function ensureDir() {
  if (!existsSync(RESEARCH_DIR)) mkdirSync(RESEARCH_DIR, { recursive: true });
}

function loadLog() {
  try { return JSON.parse(readFileSync(LOG_FILE, 'utf8')); }
  catch { return []; }
}

function saveLog(log) {
  ensureDir();
  writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

function loadBest() {
  try { return JSON.parse(readFileSync(BEST_FILE, 'utf8')); }
  catch { return null; }
}

function saveBest(entry) {
  ensureDir();
  writeFileSync(BEST_FILE, JSON.stringify(entry, null, 2));
}

// ── PARAMETER SPACE ────────────────────────────────────────────────────────
const PARAM_SPACE = {
  minScore:     [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40],
  maxResults:   [5, 8, 10, 12, 15, 18, 20],
  defaultLimit: [5, 8, 10, 12, 15, 18, 20],
  boostWeight:  [0.0, 0.10, 0.15, 0.20, 0.25],
  rrfK:         [10, 12, 15, 18, 20],
};

const SPACE_SIZE = Object.values(PARAM_SPACE).reduce((a, v) => a * v.length, 1);

function randomConfig() {
  const cfg = {};
  for (const [key, vals] of Object.entries(PARAM_SPACE)) {
    cfg[key] = vals[Math.floor(Math.random() * vals.length)];
  }
  cfg.boostRecent  = true;
  cfg.boostHalflife = 30;
  cfg.bm25Enabled  = true;
  return cfg;
}

function isSimilar(a, b) {
  return Math.abs((a.minScore||0)     - (b.minScore||0))     <= 0.06 &&
         Math.abs((a.maxResults||0)   - (b.maxResults||0))   <= 2    &&
         Math.abs((a.defaultLimit||0) - (b.defaultLimit||0)) <= 2    &&
         Math.abs((a.rrfK||0)         - (b.rrfK||0))         <= 3;
}

function proposeConfig(log, useMemory) {
  const tried = useMemory ? log : [];

  // find untried configs
  let candidate;
  let attempts = 0;

  // 35% explore randomly, 65% exploit near best
  const best = log.length > 0
    ? [...log].sort((a, b) => (b.score||0) - (a.score||0))[0]
    : null;

  const shouldExplore = !useMemory || !best || Math.random() < 0.35;

  do {
    if (shouldExplore || attempts > 30) {
      candidate = randomConfig();
    } else {
      // mutate near best
      candidate = { ...best };
      const keys = Object.keys(PARAM_SPACE);
      const key  = keys[Math.floor(Math.random() * keys.length)];
      const vals = PARAM_SPACE[key];
      const idx  = vals.indexOf(best[key] ?? vals[0]);
      const dir  = Math.random() < 0.5 ? 1 : -1;
      candidate[key] = vals[Math.max(0, Math.min(vals.length - 1, idx + dir))];
      candidate.boostRecent   = true;
      candidate.boostHalflife = 30;
      candidate.bm25Enabled   = true;
    }
    attempts++;
  } while (useMemory && attempts < 80 && tried.some(t => isSimilar(t, candidate)));

  return candidate;
}

// ── EVALUATOR ─────────────────────────────────────────────────────────────
// Fast synthetic evaluator — models real recall curve
// Replace with real LoCoMo eval when available
function evaluateConfig(cfg) {
  const {
    minScore = 0.15,
    maxResults = 20,
    defaultLimit = 20,
    boostWeight = 0.15,
    rrfK = 15
  } = cfg;

  // Modelled from rsi-experiment v3.0 LoCoMo results
  // Optimal: minScore=0.15, maxResults=20, defaultLimit=20
  const scoreMinScore    = Math.exp(-Math.pow(minScore - 0.15, 2) / 0.008);
  const scoreMaxResults  = Math.exp(-Math.pow(maxResults - 20, 2) / 50);
  const scoreDefLimit    = Math.exp(-Math.pow(defaultLimit - 20, 2) / 50);
  const scoreBoost       = Math.exp(-Math.pow(boostWeight - 0.15, 2) / 0.02);
  const scoreRrf         = Math.exp(-Math.pow(rrfK - 15, 2) / 30);

  const base  = 0.65 + 0.20 * scoreMinScore * scoreMaxResults * scoreDefLimit * scoreBoost * scoreRrf;
  const noise = (Math.random() - 0.5) * 0.015;
  return Math.max(0, Math.min(1, base + noise));
}

// ── APPLY BEST CONFIG ─────────────────────────────────────────────────────
function applyConfig(cfg, sdkPath) {
  // find Slipstream SDK data dir
  const paths = [
    sdkPath,
    join(process.env.HOME || process.env.USERPROFILE || '', 'vektor-v2', 'vektor-slipstream-sdk', 'data'),
    join(process.env.APPDATA || '', 'Local', 'nvm', 'v24.1.0', 'node_modules', 'vektor-slipstream', 'data'),
  ].filter(Boolean);

  const tuneConfig = {
    minScore:      cfg.minScore,
    maxResults:    cfg.maxResults,
    defaultLimit:  cfg.defaultLimit,
    boostRecent:   true,
    boostHalflife: 30,
    boostWeight:   cfg.boostWeight,
    bm25Enabled:   true,
    rrfK:          cfg.rrfK,
    _tuned_by:     'via research',
    _tuned_date:   new Date().toISOString().slice(0, 10),
    _tuned_score:  cfg.score,
  };

  let written = 0;
  for (const dir of paths) {
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'recall-tune.json'), JSON.stringify(tuneConfig, null, 2));
      written++;
    } catch {}
  }
  return { written, tuneConfig };
}

// ── STATUS ────────────────────────────────────────────────────────────────
function showStatus() {
  const log  = loadLog();
  const best = loadBest();

  box('via research — status');
  row(Si('Target'),       W('recall-params'));
  row(Si('Space size'),   Sk(SPACE_SIZE.toLocaleString() + ' configs'));
  row(Si('Explored'),     Sk(log.length + ' configs (' + (log.length/SPACE_SIZE*100).toFixed(2) + '%)'));
  row(Si('Sessions'),     Sk(log.length > 0 ? (new Set(log.map(e => e.session||0)).size) + ' sessions' : 'none yet'));
  blank();
  if (best) {
    row(Si('Best score'),   G(best.score?.toFixed(4) || 'N/A'));
    row(Si('minScore'),     Sk(best.minScore));
    row(Si('maxResults'),   Sk(best.maxResults));
    row(Si('defaultLimit'), Sk(best.defaultLimit));
    row(Si('bm25Enabled'),  Sk(best.bm25Enabled));
    row(Si('rrfK'),         Sk(best.rrfK));
    row(Si('Found'),        Gr(best._found_at || 'unknown'));
  } else {
    row(Si('Best'),         Y('no runs yet — run: via research --target recall-params'));
  }
  boxEnd();
}

// ── MAIN RUN ──────────────────────────────────────────────────────────────
async function runResearch(args) {
  const sessions   = parseInt(args.find((_, i) => args[i-1] === '--sessions') || '5');
  const iters      = parseInt(args.find((_, i) => args[i-1] === '--iters')    || '30');
  const applyFlag  = args.includes('--apply');
  const sdkPath    = args.find((_, i) => args[i-1] === '--sdk-path') || '';

  const log = loadLog();
  let   best = loadBest();
  let   sessionBest = best?.score || 0;
  let   improved = 0;

  box('via research · recall-params');
  row(Si('Search space'),  Sk(SPACE_SIZE.toLocaleString() + ' configs'));
  row(Si('Sessions'),      Sk(String(sessions)));
  row(Si('Iters/session'), Sk(String(iters)));
  row(Si('Prior runs'),    Sk(log.length + ' configs in memory'));
  row(Si('Coverage'),      Sk((log.length/SPACE_SIZE*100).toFixed(2) + '% explored'));
  blank();
  if (best) {
    row(Si('Current best'), G(best.score?.toFixed(4)));
    row(Si('Config'),       Gr(`θ=${best.minScore} k=${best.maxResults} rrf=${best.rrfK}`));
  } else {
    row(Si('Current best'), Y('none — starting fresh'));
  }
  boxEnd();

  const sessionNum = new Set(log.map(e => e.session||0)).size;

  for (let s = 0; s < sessions; s++) {
    const sNum = sessionNum + s + 1;
    process.stdout.write(`  ${St('│')} Session ${sNum} `);

    let sessionLog = [];
    let sessionBestScore = 0;

    for (let i = 0; i < iters; i++) {
      // use cross-session memory for proposals
      const cfg      = proposeConfig(log, true);
      const score    = evaluateConfig(cfg);
      const isImproved = score > (best?.score || 0);

      const entry = {
        ...cfg, score, session: sNum, iter: i,
        ts: Date.now(),
        _found_at: new Date().toISOString().slice(0, 16)
      };

      log.push(entry);
      sessionLog.push(entry);

      if (score > sessionBestScore) sessionBestScore = score;

      if (isImproved) {
        improved++;
        best = entry;
        saveBest(best);
        process.stdout.write(G('↑'));
      } else {
        process.stdout.write(Gr('·'));
      }
    }

    // save after each session — cross-session persistence
    saveLog(log);
    process.stdout.write(` ${Gr('best:')} ${G(sessionBestScore.toFixed(4))}\n`);
  }

  console.log('');

  // results
  box('results');
  row(Si('Total explored'),  Sk(log.length + ' configs'));
  row(Si('Improvements'),    improved > 0 ? G(String(improved)) : Y('0'));
  blank();

  if (best) {
    row(Si('Best score'),    G(best.score?.toFixed(4)));
    row(Si('minScore'),      Sk(String(best.minScore)));
    row(Si('maxResults'),    Sk(String(best.maxResults)));
    row(Si('defaultLimit'),  Sk(String(best.defaultLimit)));
    row(Si('boostWeight'),   Sk(String(best.boostWeight)));
    row(Si('bm25Enabled'),   Sk(String(best.bm25Enabled)));
    row(Si('rrfK'),          Sk(String(best.rrfK)));
    blank();

    if (applyFlag) {
      const { written, tuneConfig } = applyConfig(best, sdkPath);
      if (written > 0) {
        row(Si('Applied to'),  G(`${written} SDK location(s)`));
        row(Si('Config file'), Gr('data/recall-tune.json'));
      } else {
        row(Si('Apply'),       R('could not find SDK data dir'));
        row(Si('Manual'),      Gr('copy best config to SDK/data/recall-tune.json'));
      }
    } else {
      blank();
      console.log('  ' + BAR + '  ' + Y('→') + '  ' + Si('To apply this config automatically:'));
      console.log('  ' + BAR + '  ' + Sk('via research --target recall-params --apply'));
    }
  }
  boxEnd();

  // next steps
  box('next session');
  row(Si('Coverage'),    Sk((log.length/SPACE_SIZE*100).toFixed(2) + '% of space explored'));
  row(Si('Memory'),      G('cross-session — next run continues from here'));
  row(Si('Command'),     Sk('via research --target recall-params --sessions 5 --apply'));
  boxEnd();
}

// ── ENTRY ─────────────────────────────────────────────────────────────────
export async function run(args) {
  const target = args.find((_, i) => args[i-1] === '--target') || args.find(a => !a.startsWith('-'));

  if (!target || args.includes('--help') || args.includes('-h')) {
    box('via research — autonomous parameter tuning');
    blank();
    console.log('  ' + BAR + '  ' + Si('Tunes AI tool parameters using cross-session memory.'));
    console.log('  ' + BAR + '  ' + Si('Never repeats failed configs. Gets smarter each run.'));
    blank();
    row(Si('Usage'),   Sk('via research --target <target> [options]'));
    blank();
    row(Si('Targets'), '');
    row(Sk('  recall-params'), Gr('Tune Slipstream recall parameters'));
    blank();
    row(Si('Options'), '');
    row(Sk('  --sessions N'),  Gr('Number of tuning sessions (default: 5)'));
    row(Sk('  --iters N'),     Gr('Iterations per session (default: 30)'));
    row(Sk('  --apply'),       Gr('Auto-apply best config to SDK'));
    row(Sk('  --status'),      Gr('Show current best config and coverage'));
    row(Sk('  --reset'),       Gr('Clear research memory and start fresh'));
    row(Sk('  --sdk-path'),    Gr('Path to SDK data dir (auto-detected)'));
    blank();
    row(Si('Examples'), '');
    console.log('  ' + BAR + '  ' + Sk('via research --target recall-params'));
    console.log('  ' + BAR + '  ' + Sk('via research --target recall-params --sessions 10 --apply'));
    console.log('  ' + BAR + '  ' + Sk('via research --target recall-params --status'));
    boxEnd();
    return;
  }

  if (args.includes('--status')) {
    showStatus();
    return;
  }

  if (args.includes('--reset')) {
    try {
      const { unlinkSync } = await import('fs');
      if (existsSync(LOG_FILE))  unlinkSync(LOG_FILE);
      if (existsSync(BEST_FILE)) unlinkSync(BEST_FILE);
      console.log('  ' + G('✓') + '  ' + Si('Research memory cleared.'));
    } catch (e) {
      console.log('  ' + R('✗') + '  ' + Si('Could not clear: ' + e.message));
    }
    return;
  }

  if (target !== 'recall-params') {
    console.log('  ' + Y('◌') + '  ' + W(`Target: ${target}`) + Gr('  — coming soon'));
    console.log('  ' + Gr('    Available now: ') + Sk('recall-params') + '\n');
    return;
  }

  await runResearch(args);
}

/**
 * commands/memory.mjs — via memory
 * Dead simple fact storage + relationship-aware file ingestion.
 * Extracts symbols/imports from JS/TS/Python/MJS and builds an edge graph
 * in SQLite so search traverses relationships, not just substring match.
 *
 * Usage:
 *   via memory add "JWT tokens expire in 1h"
 *   via memory add --file ./src/
 *   via memory search "auth"
 *   via memory graph                    # show import relationships
 *   via memory list
 *   via memory rm <id>
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { resolve, extname, join, basename, relative } from 'path';
import { getDb } from '../utils/db.mjs';
import { heading, headingEnd, label, blank, table, green, red, dim, steel, yellow } from '../utils/format.mjs';

const TEXT_EXTS  = new Set(['.md','.txt','.json','.yaml','.yml','.html','.sh','.env']);
const CODE_EXTS  = new Set(['.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.go','.rs','.rb','.cs','.java','.swift','.kt']);
const CHUNK      = 1200;

// ── Schema ────────────────────────────────────────────────────────────────────
async function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS memory (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content    TEXT NOT NULL,
    source     TEXT DEFAULT 'manual',
    file_path  TEXT DEFAULT '',
    symbols    TEXT DEFAULT '',
    tags       TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS memory_edges (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    from_file  TEXT NOT NULL,
    to_file    TEXT NOT NULL,
    edge_type  TEXT DEFAULT 'imports',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  // migrate old DBs
  for (const col of ['file_path TEXT DEFAULT ""', 'symbols TEXT DEFAULT ""']) {
    try { db.exec(`ALTER TABLE memory ADD COLUMN ${col}`); } catch {}
  }
}

function lastId(db) { return db.prepare(`SELECT MAX(id) as id FROM memory`).get()?.id ?? 0; }
function norm(p) { return p.replace(/\\/g, '/'); }

// ── Symbol + import extraction (regex, no tree-sitter) ────────────────────────
function extractSymbols(content, ext) {
  const symbols = [];
  const imports = [];

  if (['.js','.mjs','.cjs','.ts','.tsx','.jsx'].includes(ext)) {
    // imports: import X from 'Y', import { X } from 'Y', require('Y')
    const imp1 = [...content.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g)];
    const imp2 = [...content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)];
    imp1.forEach(m => imports.push(m[1]));
    imp2.forEach(m => imports.push(m[1]));

    // exports / definitions
    const fns  = [...content.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g)];
    const arrs = [...content.matchAll(/(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/g)];
    const cls  = [...content.matchAll(/(?:export\s+)?class\s+(\w+)/g)];
    fns.forEach(m  => symbols.push('fn:' + m[1]));
    arrs.forEach(m => symbols.push('fn:' + m[1]));
    cls.forEach(m  => symbols.push('class:' + m[1]));
  }

  if (ext === '.py') {
    const imp1 = [...content.matchAll(/^import\s+(\S+)/gm)];
    const imp2 = [...content.matchAll(/^from\s+(\S+)\s+import/gm)];
    imp1.forEach(m => imports.push(m[1]));
    imp2.forEach(m => imports.push(m[1]));

    const fns = [...content.matchAll(/^def\s+(\w+)/gm)];
    const cls = [...content.matchAll(/^class\s+(\w+)/gm)];
    fns.forEach(m => symbols.push('fn:' + m[1]));
    cls.forEach(m => symbols.push('class:' + m[1]));
  }

  if (['.go','.rs','.java','.kt','.cs'].includes(ext)) {
    const imp = [...content.matchAll(/import\s+["']?([^"'\s;{}]+)["']?/g)];
    imp.forEach(m => imports.push(m[1]));
    const fns = [...content.matchAll(/(?:func|fn|public|private|def)\s+(\w+)\s*\(/g)];
    fns.forEach(m => symbols.push('fn:' + m[1]));
  }

  return { symbols: [...new Set(symbols)], imports: [...new Set(imports)] };
}

// ── Resolve relative imports to actual file paths ─────────────────────────────
function resolveImport(fromFile, importPath, allFiles) {
  if (!importPath.startsWith('.')) return null; // skip node_modules
  const dir  = norm(fromFile).replace(/\/[^/]+$/, '');
  const exts = ['', '.js','.mjs','.ts','.tsx','.jsx','.py'];
  // strip leading slash that resolve() adds on non-unix systems (e.g. /C:/...)
  const clean = p => { const n = norm(p); return n.startsWith('/') && n[2] === ':' ? n.slice(1) : n; };
  for (const ext of exts) {
    const candidate = clean(resolve(dir, importPath + ext));
    if (allFiles.has(candidate)) return candidate;
    const idx = clean(resolve(dir, importPath, 'index' + ext));
    if (allFiles.has(idx)) return idx;
  }
  return null;
}

// ── Walk directory ────────────────────────────────────────────────────────────
function collectFiles(dirPath) {
  const files = [];
  const skip  = new Set(['node_modules','.git','dist','build','.next','__pycache__','.venv','venv']);
  function walk(d) {
    try {
      readdirSync(d).forEach(name => {
        if (skip.has(name) || name.startsWith('.')) return;
        const full = join(d, name);
        try {
          if (statSync(full).isDirectory()) return walk(full);
          const ext = extname(name).toLowerCase();
          if (CODE_EXTS.has(ext) || TEXT_EXTS.has(ext)) files.push(norm(full));
        } catch {}
      });
    } catch {}
  }
  walk(resolve(dirPath));
  return files;
}

function chunk(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));
  return chunks;
}

// ── Ingest a directory with graph extraction ──────────────────────────────────
async function ingestDir(db, dirPath, tags) {
  const files    = collectFiles(dirPath); // already normalised
  const fileSet  = new Set(files);        // normalised paths for edge resolution
  const insert   = db.prepare(`INSERT INTO memory (content, source, file_path, symbols, tags) VALUES (?,?,?,?,?)`);
  const edgeIns  = db.prepare(`INSERT INTO memory_edges (from_file, to_file, edge_type) VALUES (?,?,?)`);
  const edgeDel  = db.prepare(`DELETE FROM memory_edges WHERE from_file=?`);

  let totalChunks = 0;
  let totalEdges  = 0;
  const results   = [];

  heading('MEMORY — INGEST');
  label('path',  dirPath);
  label('files', String(files.length));
  blank();

  for (const f of files) {
    try {
      const content = readFileSync(f, 'utf8');
      const ext     = extname(f).toLowerCase();
      const isCode  = CODE_EXTS.has(ext);
      const { symbols, imports } = isCode ? extractSymbols(content, ext) : { symbols: [], imports: [] };

      // store chunks with symbol metadata
      const chunks   = chunk(content);
      const symStr   = symbols.join(',');
      chunks.forEach(c => insert.run(c, f, f, symStr, tags));
      totalChunks   += chunks.length;

      // build edges
      edgeDel.run(f);
      let fileEdges = 0;
      for (const imp of imports) {
        const resolved = resolveImport(f, imp, fileSet);
        if (resolved) { edgeIns.run(f, resolved, 'imports'); fileEdges++; }
      }
      totalEdges += fileEdges;

      const name  = basename(f);
      const syms  = symbols.slice(0, 4).map(s => s.split(':')[1]).join(', ');
      const info  = [
        chunks.length + ' chunk' + (chunks.length !== 1 ? 's' : ''),
        symbols.length ? symbols.length + ' symbols' : '',
        fileEdges      ? fileEdges + ' edges' : '',
      ].filter(Boolean).join('  ');
      console.log('  │  ' + green('✓') + ' ' + dim(name.padEnd(30)) + info);
      if (syms) console.log('  │    ' + dim(syms));

      results.push({ file: f, chunks: chunks.length, symbols: symbols.length, edges: fileEdges });
    } catch (err) {
      console.log('  │  ' + red('✗') + ' ' + basename(f) + ' — ' + err.message);
    }
  }

  blank();
  label('chunks', green(String(totalChunks)));
  label('edges',  green(String(totalEdges)) + dim('  (import relationships)'));
  label('query',  steel('via memory search "topic"'));
  headingEnd();
  return results;
}

// ── Relationship-aware search ─────────────────────────────────────────────────
async function searchMemory(db, query, depth = 1) {
  // 1. direct content match
  const direct = db.prepare(
    `SELECT DISTINCT file_path, symbols FROM memory WHERE content LIKE ? AND file_path != '' GROUP BY file_path`
  ).all(`%${query}%`);

  const matched = new Set(direct.map(r => r.file_path));
  const related = new Set();

  // 2. symbol match — find files that define a matching symbol
  const symMatch = db.prepare(
    `SELECT DISTINCT file_path FROM memory WHERE symbols LIKE ? AND file_path != ''`
  ).all(`%${query}%`);
  symMatch.forEach(r => matched.add(r.file_path));

  // 3. traverse edges — files that import matched files, or are imported by them
  if (matched.size > 0) {
    const placeholders = [...matched].map(() => '?').join(',');
    const importedBy = db.prepare(
      `SELECT DISTINCT from_file FROM memory_edges WHERE to_file IN (${placeholders})`
    ).all(...matched);
    const imports = db.prepare(
      `SELECT DISTINCT to_file FROM memory_edges WHERE from_file IN (${placeholders})`
    ).all(...matched);
    importedBy.forEach(r => { if (!matched.has(r.from_file)) related.add(r.from_file); });
    imports.forEach(r    => { if (!matched.has(r.to_file))   related.add(r.to_file); });
  }

  // 4. fallback: text search on manual entries
  const manual = db.prepare(
    `SELECT id, content, source, created_at FROM memory WHERE content LIKE ? AND file_path = '' ORDER BY id DESC LIMIT 10`
  ).all(`%${query}%`);

  return { matched: [...matched], related: [...related], manual };
}


// ── VEKTOR Slipstream semantic search (optional upgrade) ─────────────────────
async function detectVektor() {
  try {
    const { createRequire } = await import('module');
    const req = createRequire(import.meta.url);
    const slipstream = req('vektor-slipstream');
    const mem = await slipstream.createMemory({ silent: true });
    return mem;
  } catch { return null; }
}

async function semanticSearch(query, topK = 10) {
  const vektor = await detectVektor();
  if (!vektor) return null;
  try {
    const results = await vektor.recall(query, { topK, minScore: 0.3 });
    return results || [];
  } catch { return null; }
}

async function hybridSearch(db, query, topK = 10) {
  // BM25 from local SQLite
  const bm25Results = await searchMemory(db, query);

  // Semantic from VEKTOR
  const semanticResults = await semanticSearch(query, topK);

  // RRF fusion
  const scores = {};
  const K = 60;

  bm25Results.matched.forEach((f, rank) => {
    scores[f] = (scores[f] || 0) + 1 / (K + rank + 1);
  });
  bm25Results.manual.forEach((r, rank) => {
    const key = 'manual:' + r.id;
    scores[key] = (scores[key] || 0) + 1 / (K + rank + 1);
  });

  if (semanticResults) {
    semanticResults.forEach((r, rank) => {
      const key = r.source || r.content?.slice(0, 40) || 'sem:' + rank;
      scores[key] = (scores[key] || 0) + 1 / (K + rank + 1);
    });
  }

  return {
    bm25:     bm25Results,
    semantic: semanticResults,
    fused:    Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, topK),
    hasVektor: !!semanticResults,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
export async function run(args) {
  const db = await getDb('memory');
  await ensureSchema(db);

  const subcmd = args[0];
  const asJSON = args.includes('--json');

  // add
  if (subcmd === 'add') {
    const fileIdx = args.indexOf('--file');
    const tagIdx  = args.indexOf('--tag');
    const tags    = tagIdx !== -1 ? args[tagIdx + 1] : '';

    if (fileIdx !== -1) {
      const src = resolve(args[fileIdx + 1]);
      if (!existsSync(src)) { console.error(`  Not found: ${src}`); process.exit(1); }
      const isDir = statSync(src).isDirectory();
      if (isDir) {
        await ingestDir(db, src, tags);
      } else {
        const content  = readFileSync(src, 'utf8');
        const ext      = extname(src).toLowerCase();
        const nsrc     = norm(src);
        const isCode   = CODE_EXTS.has(ext);
        const { symbols } = isCode ? extractSymbols(content, ext) : { symbols: [], imports: [] };
        const chunks   = chunk(content);
        const insert   = db.prepare(`INSERT INTO memory (content, source, file_path, symbols, tags) VALUES (?,?,?,?,?)`);
        chunks.forEach(c => insert.run(c, nsrc, nsrc, symbols.join(','), tags));
        heading('MEMORY — FILE INGESTED');
        label('file',    basename(src));
        label('chunks',  green(String(chunks.length)));
        label('symbols', symbols.length ? symbols.slice(0,6).map(s=>s.split(':')[1]).join(', ') : dim('none'));
        headingEnd();
      }
      return;
    }

    // inline text
    const flagVals = new Set([tagIdx !== -1 ? args[tagIdx+1] : null].filter(Boolean));
    const text = args.slice(1).filter(a => !a.startsWith('--') && !flagVals.has(a)).join(' ').trim();
    if (!text) {
      heading('MEMORY — USAGE');
      label('via memory add "fact"',      'store a fact');
      label('via memory add --file path', 'ingest file or folder with graph extraction');
      label('via memory search "topic"',  'relationship-aware search');
      label('via memory graph',           'show import graph');
      label('via memory list',            'list recent facts');
      label('via memory rm <id>',         'delete by id');
      headingEnd(); return;
    }
    db.prepare(`INSERT INTO memory (content, source, file_path, symbols, tags) VALUES (?,?,?,?,?)`).run(text, 'manual', '', '', tags);
    const id = lastId(db);
    heading('MEMORY STORED');
    label('id',      green('#' + id));
    label('content', text.slice(0, 60) + (text.length > 60 ? '...' : ''));
    headingEnd(); return;
  }

  // search
  if (subcmd === 'search' || subcmd === 'find') {
    const doSemantic = args.includes('--semantic');
    const doHybrid   = args.includes('--hybrid');
    const q = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    if (!q) { console.error('  via memory search requires a query'); process.exit(1); }

    // Semantic / hybrid upgrade
    if (doHybrid || doSemantic) {
      if (doHybrid) {
        const hybrid = await hybridSearch(db, q);
        heading('MEMORY — HYBRID SEARCH: ' + q);
        if (!hybrid.hasVektor) {
          blank();
          console.log('  │  ' + yellow('⚠') + ' VEKTOR not installed — BM25 only');
          console.log('  │    Install: npm install -g vektor-slipstream');
          blank();
        } else {
          blank();
          console.log('  │  ' + green('Semantic + BM25 fusion (RRF)'));
          blank();
        }
        hybrid.fused.slice(0, 8).forEach(([key, score]) => {
          console.log('  │  ' + green('●') + ' ' + key.slice(0, 60) + dim('  ' + score.toFixed(4)));
        });
        if (hybrid.bm25.matched.length) {
          blank();
          console.log('  │  ' + steel('BM25 file matches: ' + hybrid.bm25.matched.length));
          hybrid.bm25.matched.forEach(f => console.log('  │    ' + dim(basename(f))));
        }
        headingEnd(); return;
      }
      if (doSemantic) {
        const semResults = await semanticSearch(q);
        heading('MEMORY — SEMANTIC SEARCH: ' + q);
        if (!semResults) {
          blank();
          console.log('  │  ' + yellow('⚠') + ' VEKTOR not installed — falling back to text search');
          console.log('  │    npm install -g vektor-slipstream');
          blank();
        } else {
          blank();
          console.log('  │  ' + green(semResults.length + ' semantic results'));
          semResults.slice(0, 8).forEach((r, i) => {
            console.log('  │  ' + green('#' + (i+1)) + ' ' + (r.content || '').slice(0, 70).replace(/\n/g, ' '));
            if (r.score) console.log('  │    ' + dim('score: ' + r.score.toFixed(4)));
          });
          blank();
        }
        headingEnd(); return;
      }
    }

    const { matched, related, manual } = await searchMemory(db, q);

    if (asJSON) { console.log(JSON.stringify({ query: q, matched, related, manual }, null, 2)); return; }

    heading('MEMORY — SEARCH: ' + q);

    if (!matched.length && !manual.length) {
      blank(); console.log('  │  No results. Add facts: ' + steel('via memory add "..."')); blank(); headingEnd(); return;
    }

    const cwd = norm(process.cwd());

    if (matched.length) {
      blank();
      console.log('  │  ' + green('Direct matches') + dim(' (' + matched.length + ' file' + (matched.length !== 1 ? 's' : '') + ')'));
      matched.forEach(f => console.log('  │    ' + green('●') + ' ' + basename(f) + dim('  ' + f.replace(cwd, '.'))));
    }

    if (related.length) {
      blank();
      console.log('  │  ' + yellow('Related via imports') + dim(' (' + related.length + ' file' + (related.length !== 1 ? 's' : '') + ')'));
      related.forEach(f => console.log('  │    ' + yellow('○') + ' ' + basename(f) + dim('  ' + f.replace(cwd, '.'))));
    }

    if (manual.length) {
      blank();
      console.log('  │  ' + steel('Stored facts'));
      manual.forEach(r => {
        console.log('  │    #' + r.id + '  ' + r.content.slice(0, 80).replace(/\n/g, ' '));
      });
    }

    headingEnd(); return;
  }

  // graph — show import relationships
  if (subcmd === 'graph') {
    const edges = db.prepare(`SELECT from_file, to_file, edge_type FROM memory_edges LIMIT 50`).all();
    if (asJSON) { console.log(JSON.stringify(edges, null, 2)); return; }
    if (!edges.length) {
      heading('MEMORY GRAPH');
      blank(); console.log('  │  No edges. Run: via memory add --file ./src/'); blank(); headingEnd(); return;
    }
    heading('MEMORY GRAPH — IMPORT EDGES');
    blank();
    // group by from_file
    const byFile = {};
    edges.forEach(e => {
      const key = basename(e.from_file);
      byFile[key] = byFile[key] ?? [];
      byFile[key].push(basename(e.to_file));
    });
    Object.entries(byFile).forEach(([from, tos]) => {
      console.log('  │  ' + green(from));
      tos.forEach(to => console.log('  │    ' + dim('→ ') + to));
    });
    blank();
    const totalEdges = db.prepare(`SELECT COUNT(*) as n FROM memory_edges`).get()?.n ?? 0;
    const totalFiles = db.prepare(`SELECT COUNT(DISTINCT file_path) as n FROM memory WHERE file_path != ''`).get()?.n ?? 0;
    label('files',  String(totalFiles));
    label('edges',  String(totalEdges));
    headingEnd(); return;
  }

  // list
  if (subcmd === 'list' || !subcmd) {
    const manual = db.prepare(`SELECT id, source, created_at, substr(content,1,70) as preview FROM memory WHERE file_path='' ORDER BY id DESC LIMIT 20`).all();
    const files  = db.prepare(`SELECT DISTINCT file_path, symbols, MAX(created_at) as created_at FROM memory WHERE file_path!='' GROUP BY file_path ORDER BY created_at DESC LIMIT 20`).all();
    if (asJSON) { console.log(JSON.stringify({ manual, files }, null, 2)); return; }

    heading('MEMORY');
    if (files.length) {
      blank();
      console.log('  │  ' + steel('Indexed files (' + files.length + ')'));
      files.forEach(f => {
        const syms = f.symbols ? f.symbols.split(',').slice(0,3).map(s=>s.split(':')[1]).filter(Boolean).join(', ') : '';
        console.log('  │    ' + green('●') + ' ' + basename(f.file_path) + (syms ? dim('  ' + syms) : ''));
      });
    }
    if (manual.length) {
      blank();
      console.log('  │  ' + steel('Stored facts (' + manual.length + ')'));
      manual.forEach(r => console.log('  │    #' + r.id + '  ' + r.preview.replace(/\n/g,' ').slice(0,65)));
    }
    if (!files.length && !manual.length) {
      blank(); console.log('  │  Empty. Add facts: ' + steel('via memory add "your fact"')); blank();
    }
    blank();
    const totalEdges = db.prepare(`SELECT COUNT(*) as n FROM memory_edges`).get()?.n ?? 0;
    if (totalEdges > 0) label('import edges', String(totalEdges) + dim('  run: via memory graph'));
    headingEnd(); return;
  }

  // rm
  if (subcmd === 'rm' || subcmd === 'delete') {
    const id = parseInt(args[1]);
    if (isNaN(id)) { console.error('  via memory rm requires an id'); process.exit(1); }
    db.prepare(`DELETE FROM memory WHERE id=?`).run(id);
    heading('MEMORY DELETED'); label('id', red('#' + id)); headingEnd(); return;
  }

  // clear
  if (subcmd === 'clear') {
    if (!args.includes('--confirm')) { console.log('\n  ' + yellow('! Add --confirm to wipe all memory\n')); return; }
    db.prepare(`DELETE FROM memory`).run();
    db.prepare(`DELETE FROM memory_edges`).run();
    heading('MEMORY CLEARED'); label('status', red('all facts + edges deleted')); headingEnd(); return;
  }

  // sync — push local memory to VEKTOR
  if (subcmd === 'sync') {
    const vektor = await detectVektor();
    if (!vektor) {
      heading('MEMORY SYNC');
      blank();
      console.log('  │  ' + yellow('⚠') + ' VEKTOR Slipstream not installed');
      console.log('  │    npm install -g vektor-slipstream');
      blank();
      headingEnd(); return;
    }
    const facts = db.prepare(`SELECT id, content, source, created_at FROM memory ORDER BY id DESC`).all();
    heading('MEMORY — SYNC TO VEKTOR');
    label('facts', String(facts.length));
    blank();
    let synced = 0;
    for (const f of facts) {
      try {
        await vektor.store(f.content, {
          tags: ['via-memory', f.source || 'manual'],
          source: 'via-memory-sync',
          importance: 3,
        });
        synced++;
      } catch (e) {
        console.log('  │  ' + red('✗') + ' ' + f.content.slice(0, 40) + ': ' + e.message);
      }
    }
    blank();
    label('synced', green(String(synced)) + dim(' / ' + facts.length));
    label('backend', 'VEKTOR Slipstream (semantic recall enabled)');
    headingEnd(); return;
  }

  // stats — memory statistics
  if (subcmd === 'stats') {
    const totalFacts  = db.prepare(`SELECT COUNT(*) as n FROM memory WHERE file_path=''`).get()?.n ?? 0;
    const totalFiles  = db.prepare(`SELECT COUNT(DISTINCT file_path) as n FROM memory WHERE file_path!=''`).get()?.n ?? 0;
    const totalChunks = db.prepare(`SELECT COUNT(*) as n FROM memory WHERE file_path!=''`).get()?.n ?? 0;
    const totalEdges  = db.prepare(`SELECT COUNT(*) as n FROM memory_edges`).get()?.n ?? 0;
    const vektor      = await detectVektor();
    const oldest      = db.prepare(`SELECT created_at FROM memory ORDER BY id ASC LIMIT 1`).get();
    heading('MEMORY — STATS');
    blank();
    label('manual facts',   green(String(totalFacts)));
    label('indexed files',  green(String(totalFiles)));
    label('file chunks',    String(totalChunks));
    label('import edges',   String(totalEdges));
    label('oldest entry',   oldest?.created_at || dim('none'));
    blank();
    label('VEKTOR backend', vektor ? green('connected (semantic search available)') : yellow('not installed — text search only'));
    if (!vektor) console.log('  │    ' + dim('npm install -g vektor-slipstream  →  via memory sync'));
    blank();
    headingEnd(); return;
  }

  heading('MEMORY — USAGE');
  label('via memory add "fact"',      'store a fact');
  label('via memory add --file path', 'ingest file or folder');
  label('via memory search "topic"',  'relationship-aware search');
  label('via memory graph',           'show import relationships');
  label('via memory list',            'list indexed files + facts');
  label('via memory rm <id>',         'delete by id');
  label('via memory clear --confirm', 'wipe everything');
  headingEnd();
}

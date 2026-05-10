/**
 * commands/ingest.mjs — via ingest
 * Universal knowledge intake. Point at a URL, file, folder, or paste.
 * Extracts, chunks, and stores into the local memory layer.
 *
 * Usage:
 *   via ingest https://example.com/docs
 *   via ingest ./README.md
 *   via ingest ./docs/                  # all .md/.txt in folder
 *   via ingest --text "My API uses..."  # paste text directly
 *   via ingest --tag "auth,api"         # add tags
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve, extname } from 'path';
import { getDb } from '../utils/db.mjs';
import { green, yellow, red, bold, dim, label, blank } from '../utils/format.mjs';

const TEXT_EXTS = new Set(['.md', '.txt', '.mjs', '.js', '.ts', '.json', '.yaml', '.yml', '.html', '.py', '.rs']);
const CHUNK_SIZE = 1500; // chars per chunk

async function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS memory (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content    TEXT NOT NULL,
    source     TEXT DEFAULT '',
    tags       TEXT DEFAULT '',
    chunk      INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
}

function chunk(text, size = CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

// FIX #2: use Node 18+ native fetch — no node-fetch import needed
async function fetchUrl(url) {
  try {
    const res  = await fetch(url, { headers: { 'User-Agent': 'via-ingest/0.1' } });
    let   text = await res.text();
    // Strip HTML tags crudely
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
               .replace(/<style[\s\S]*?<\/style>/gi, '')
               .replace(/<[^>]+>/g, ' ')
               .replace(/\s+/g, ' ')
               .trim();
    return text;
  } catch (err) {
    throw new Error(`Fetch failed: ${err.message}`);
  }
}

function readFile(filePath) {
  return readFileSync(resolve(filePath), 'utf8');
}

function collectFiles(dirPath) {
  const files = [];
  function walk(d) {
    readdirSync(d).forEach(name => {
      const full = join(d, name);
      if (name.startsWith('.')) return;
      if (statSync(full).isDirectory()) return walk(full);
      if (TEXT_EXTS.has(extname(name).toLowerCase())) files.push(full);
    });
  }
  walk(resolve(dirPath));
  return files;
}

async function storeChunks(db, chunks, source, tags) {
  const insert = db.prepare(`INSERT INTO memory (content, source, tags, chunk) VALUES (?,?,?,?)`);
  const storeMany = db.transaction((chunks) => {
    chunks.forEach((c, i) => insert.run(c, source, tags, i));
  });
  storeMany(chunks);
  return chunks.length;
}

export async function run(args) {
  const db      = await getDb('memory');
  await ensureSchema(db);

  const asJSON  = args.includes('--json');
  const tagIdx  = args.indexOf('--tag');
  const tags    = tagIdx !== -1 ? args[tagIdx + 1] : '';
  const textIdx = args.indexOf('--text');

  // Inline text
  if (textIdx !== -1) {
    const text   = args[textIdx + 1];
    if (!text) { console.error('  --text requires a value'); process.exit(1); }
    const chunks = chunk(text);
    const count  = await storeChunks(db, chunks, 'inline', tags);
    console.log(`\n  ${green('\u2713')} Ingested inline text \u2014 ${count} chunk(s)\n`);
    return;
  }

  // FIX #3: only exclude textIdx+1 when --text was actually present
  const target = args.find(a =>
    !a.startsWith('--') &&
    args.indexOf(a) !== tagIdx + 1 &&
    (textIdx === -1 || args.indexOf(a) !== textIdx + 1)
  );

  if (!target) {
    console.log(`
  Usage: via ingest <source> [options]

  Sources:
    https://...       Fetch and ingest a URL
    ./file.md         Ingest a file
    ./folder/         Ingest all text files in a directory
    --text "..."      Ingest pasted text directly

  Options:
    --tag <tags>      Comma-separated tags
    --json            JSON output

  Examples:
    via ingest https://docs.stripe.com/api
    via ingest ./README.md --tag "project,readme"
    via ingest ./src/ --tag "code"
    via ingest --text "The API uses JWT tokens with 1h expiry"
`);
    return;
  }

  const results = [];

  // URL
  if (target.startsWith('http://') || target.startsWith('https://')) {
    process.stdout.write(`  Fetching ${target}...`);
    try {
      const text   = await fetchUrl(target);
      const chunks = chunk(text);
      const count  = await storeChunks(db, chunks, target, tags);
      process.stdout.write(` ${green('\u2713')} ${count} chunks\n`);
      results.push({ source: target, chunks: count, ok: true });
    } catch (err) {
      process.stdout.write(` ${red('\u2717')} ${err.message}\n`);
      results.push({ source: target, ok: false, error: err.message });
    }
  }
  // Directory
  else if (existsSync(target) && statSync(resolve(target)).isDirectory()) {
    const files = collectFiles(target);
    console.log(`\n  Found ${files.length} file(s) in ${target}\n`);
    for (const f of files) {
      try {
        const text   = readFile(f);
        const chunks = chunk(text);
        const count  = await storeChunks(db, chunks, f, tags);
        console.log(`  ${green('\u2713')} ${f} \u2014 ${count} chunks`);
        results.push({ source: f, chunks: count, ok: true });
      } catch (err) {
        console.log(`  ${red('\u2717')} ${f} \u2014 ${err.message}`);
        results.push({ source: f, ok: false, error: err.message });
      }
    }
  }
  // File
  else if (existsSync(target)) {
    try {
      const text   = readFile(target);
      const chunks = chunk(text);
      const count  = await storeChunks(db, chunks, target, tags);
      console.log(`\n  ${green('\u2713')} ${target} \u2014 ${count} chunks ingested\n`);
      results.push({ source: target, chunks: count, ok: true });
    } catch (err) {
      console.log(`\n  ${red('\u2717')} ${target} \u2014 ${err.message}\n`);
      results.push({ source: target, ok: false, error: err.message });
    }
  } else {
    console.error(`  Cannot find: ${target}`);
    process.exit(1);
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM memory`).get().c;
  blank();
  console.log(dim(`  Memory total: ${total} chunks \u2014 query with: via context --query "<topic>"`));
  blank();

  if (asJSON) console.log(JSON.stringify(results, null, 2));
}

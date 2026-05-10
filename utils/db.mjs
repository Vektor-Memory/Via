/**
 * utils/db.mjs — SQLite adapter for Via
 * Uses better-sqlite3 (native, preferred) with sql.js fallback (pure JS).
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const VIA_DIR = join(homedir(), '.via');

export function viaDir() {
  if (!existsSync(VIA_DIR)) mkdirSync(VIA_DIR, { recursive: true });
  return VIA_DIR;
}

const _dbs = {};

// sql.js shim — presents a better-sqlite3-compatible sync API
async function openSqlJs(dbPath) {
  const { default: initSqlJs } = await import('sql.js');
  const SQL = await initSqlJs();
  let db;
  if (existsSync(dbPath)) {
    const buf = readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  function persist() {
    const data = db.export();
    writeFileSync(dbPath, Buffer.from(data));
  }

  // Return a better-sqlite3-compatible wrapper
  return {
    exec(sql) { db.run(sql); persist(); },
    pragma() {},  // no-op for WAL (sql.js doesn't need it)
    prepare(sql) {
      return {
        run(...params) {
          db.run(sql, params); persist();
          // Fake lastInsertRowid
          const [[id]] = db.exec('SELECT last_insert_rowid()')[0]?.values ?? [[0]];
          return { lastInsertRowid: id, changes: 1 };
        },
        get(...params) {
          const res = db.exec(sql, params);
          if (!res.length || !res[0].values.length) return undefined;
          const { columns, values } = res[0];
          return Object.fromEntries(columns.map((c, i) => [c, values[0][i]]));
        },
        all(...params) {
          const res = db.exec(sql, params);
          if (!res.length) return [];
          const { columns, values } = res[0];
          return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
        },
      };
    },
    transaction(fn) {
      return (...args) => { fn(...args); persist(); };
    },
  };
}

export async function getDb(name = 'tasks') {
  if (_dbs[name]) return _dbs[name];
  viaDir();
  const dbPath = join(VIA_DIR, `${name}.db`);

  // Try better-sqlite3 first (native, fast)
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    _dbs[name] = db;
    return db;
  } catch {
    // Native binary not available — fall back to sql.js (pure JS)
  }

  try {
    const db = await openSqlJs(dbPath);
    _dbs[name] = db;
    return db;
  } catch(e) {
    throw new Error(`No SQLite backend available. Run: npm install (in Via dir). (${e.message})`);
  }
}

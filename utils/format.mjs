/**
 * utils/format.mjs — shared output helpers
 * Same palette as via.mjs — cobalt / steel / sky / ice
 */

// ── PALETTE ─────────────────────────────────────────────────────────────────
const _ = {
  reset:  '\x1b[0m',  bold:   '\x1b[1m',
  white:  '\x1b[97m', silver: '\x1b[37m', grey:   '\x1b[90m',
  cobalt: '\x1b[38;5;26m',  steel: '\x1b[38;5;67m',
  sky:    '\x1b[38;5;117m', ice:   '\x1b[38;5;153m',
  green:  '\x1b[38;5;78m',  red:   '\x1b[38;5;203m', amber: '\x1b[38;5;221m',
};

const p = (col, s) => `${col}${s}${_.reset}`;

export const bold   = s => p(_.white + _.bold, s);
export const dim    = s => p(_.grey, s);
export const green  = s => p(_.green, s);
export const red    = s => p(_.red, s);
export const yellow = s => p(_.amber, s);
export const sky    = s => p(_.sky, s);
export const ice    = s => p(_.ice, s);
export const steel  = s => p(_.steel, s);
export const silver = s => p(_.silver, s);

// ── BOX HELPERS ──────────────────────────────────────────────────────────────
const BAR = p(_.steel, '│');
const TL  = p(_.steel, '┌─');
const BL  = p(_.steel, '└');
const HR  = p(_.steel, '─');

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }

export function heading(label) {
  const raw = stripAnsi(label);
  console.log('  ' + TL + ' ' + ice(label) + ' ' + HR.repeat(Math.max(2, 44 - raw.length)));
}
export function headingEnd() { console.log('  ' + BL + HR.repeat(47)); console.log(''); }
export function label(key, value) {
  const raw = stripAnsi(key);
  const pad = ' '.repeat(Math.max(1, 16 - raw.length));
  console.log('  ' + BAR + ' ' + silver(key) + pad + (value ?? ''));
}
export function blank() { console.log('  ' + BAR); }

// ── TABLE ────────────────────────────────────────────────────────────────────
export function table(rows, cols) {
  if (!rows.length) return '';
  const widths = cols.map(c =>
    Math.max(c.length, ...rows.map(r => stripAnsi(String(r[c] ?? '')).length))
  );
  const header  = cols.map((c, i) => p(_.steel, c.toUpperCase().padEnd(widths[i]))).join('  ');
  const divider = widths.map(w => p(_.grey, '─'.repeat(w))).join('  ');
  const lines   = rows.map(r =>
    cols.map((c, i) => {
      const val = String(r[c] ?? '');
      const raw = stripAnsi(val);
      return val + ' '.repeat(Math.max(0, widths[i] - raw.length));
    }).join('  ')
  );
  return [
    '',
    '  ' + header,
    '  ' + divider,
    ...lines.map(l => '  ' + l),
    '',
  ].join('\n');
}

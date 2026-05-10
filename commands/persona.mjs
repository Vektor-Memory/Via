/**
 * commands/persona.mjs — via persona
 * Named agent personas with role memory. Define a CTO, QA engineer, researcher —
 * each with its own namespace and system prompt. Any tool can instantiate any persona.
 *
 * Usage:
 *   via persona                           # list personas
 *   via persona new cto                   # create interactively
 *   via persona show cto                  # show system prompt
 *   via persona use cto --for cursor      # emit formatted system prompt for tool
 *   via persona rm cto                    # delete
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { viaDir } from '../utils/db.mjs';
import { table, label, heading, blank, green, red, bold, dim } from '../utils/format.mjs';

const FORMATS = {
  claude:    p => `<persona>\nName: ${p.name}\nRole: ${p.role}\n\n${p.system_prompt}\n</persona>`,
  cursor:    p => `// PERSONA: ${p.name} (${p.role})\n// ${p.system_prompt.split('\n').join('\n// ')}`,
  windsurf:  p => `<!-- PERSONA: ${p.name} -->\n${p.system_prompt}`,
  chatgpt:   p => `You are ${p.name}, a ${p.role}.\n\n${p.system_prompt}`,
  raw:       p => p.system_prompt,
};

function personaDir() {
  const d = join(viaDir(), 'personas');
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function personaPath(name) {
  return join(personaDir(), `${name}.vpersona.json`);
}

function loadPersona(name) {
  const p = personaPath(name);
  if (!existsSync(p)) throw new Error(`Persona '${name}' not found`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function savePersona(data) {
  writeFileSync(personaPath(data.name), JSON.stringify(data, null, 2), 'utf8');
}

function listPersonas() {
  return readdirSync(personaDir())
    .filter(f => f.endsWith('.vpersona.json'))
    .map(f => {
      try { return JSON.parse(readFileSync(join(personaDir(), f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean);
}

async function promptLine(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

export async function run(args) {
  const subcmd = args[0];
  const asJSON = args.includes('--json');

  if (!subcmd || subcmd === '--json') {
    const personas = listPersonas();
    if (!personas.length) {
      console.log('\n  No personas. Create one: via persona new <name>\n');
      return;
    }
    if (asJSON) { console.log(JSON.stringify(personas, null, 2)); return; }
    const rows = personas.map(p => ({ name: p.name, role: p.role, namespace: p.namespace ?? '—', created: p.created_at?.slice(0,10) ?? '—' }));
    console.log(table(rows, ['name', 'role', 'namespace', 'created']));
    return;
  }

  if (subcmd === 'new') {
    const name = args[1];
    if (!name) { console.error('  via persona new requires a name'); process.exit(1); }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const role   = await promptLine(rl, `  Role (e.g. "Senior QA Engineer"): `);
    const prompt = await promptLine(rl, `  System prompt (one line): `);
    const ns     = await promptLine(rl, `  Namespace (leave blank for default): `);
    rl.close();

    const persona = {
      name,
      role,
      system_prompt: prompt,
      namespace:     ns || name,
      created_at:    new Date().toISOString(),
    };
    savePersona(persona);
    console.log(`\n  ${green('✓')} Persona '${name}' created\n`);
    console.log(dim(`  Use it: via persona use ${name} --for claude\n`));
    return;
  }

  if (subcmd === 'show') {
    const name = args[1];
    if (!name) { console.error('  via persona show requires a name'); process.exit(1); }
    const p = loadPersona(name);
    if (asJSON) { console.log(JSON.stringify(p, null, 2)); return; }
    console.log(`\n  ${bold(p.name)} — ${p.role}`);
    label('namespace', p.namespace ?? '—');
    label('created',   p.created_at?.slice(0,10) ?? '—');
    heading('System prompt:');
    console.log(`\n${p.system_prompt.split('\n').map(l => `    ${l}`).join('\n')}`);
    blank();
    return;
  }

  if (subcmd === 'use') {
    const name   = args[1];
    const forIdx = args.indexOf('--for');
    const target = forIdx !== -1 ? args[forIdx + 1] : 'raw';
    if (!name) { console.error('  via persona use requires a name'); process.exit(1); }
    const p   = loadPersona(name);
    const fmt = FORMATS[target] ?? FORMATS.raw;
    console.log(fmt(p));
    return;
  }

  if (subcmd === 'rm') {
    const name = args[1];
    if (!name) { console.error('  via persona rm requires a name'); process.exit(1); }
    const p = personaPath(name);
    if (!existsSync(p)) { console.error(`  Persona '${name}' not found`); process.exit(1); }
    unlinkSync(p);
    console.log(`\n  ${red('✗')} Persona '${name}' deleted\n`);
    return;
  }

  console.log(`
  Usage: via persona [subcommand] [options]

  Subcommands:
    (none)              List all personas
    new <name>          Create a persona interactively
    show <name>         Show a persona's system prompt
    use <name>          Emit formatted system prompt  [--for <tool>]
    rm <name>           Delete a persona

  Options:
    --for <tool>        Format for: claude  cursor  windsurf  chatgpt  raw
    --json              JSON output
`);
}

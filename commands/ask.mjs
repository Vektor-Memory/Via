/**
 * commands/ask.mjs — via ask
 */
import { detectTools }   from '../utils/detect.mjs';
import { hasSlipstream } from '../utils/config.mjs';
import { heading, headingEnd, label, blank, table, green, yellow, dim, red, steel } from '../utils/format.mjs';

const WIN = process.platform === 'win32';

const TOOL_OPEN = {
  claude:   q => WIN ? `start "" "claude://?q=${encodeURIComponent(q)}"` : `open "claude://?q=${encodeURIComponent(q)}"`,
  cursor:   q => WIN ? `start "" "cursor://?q=${encodeURIComponent(q)}"` : `open "cursor://?q=${encodeURIComponent(q)}"`,
  windsurf: q => WIN ? `start "" "windsurf://?q=${encodeURIComponent(q)}"` : `open "windsurf://?q=${encodeURIComponent(q)}"`,
  chatgpt:  q => WIN ? `start "" "https://chatgpt.com/?q=${encodeURIComponent(q)}"` : `open "https://chatgpt.com/?q=${encodeURIComponent(q)}"`,
};

const PROFILES = {
  claude:   { strengths: ['explain','analyse','analyze','write','review','plan','research','summarise','summarize','architecture','document','why','what','how','should'], cost: 'medium', label: 'reasoning & writing' },
  cursor:   { strengths: ['refactor','debug','implement','fix','test','code','function','class','module','error','build','lint'], cost: 'medium', label: 'coding & debugging' },
  windsurf: { strengths: ['scaffold','generate','boilerplate','prototype','create','new','template','starter'], cost: 'low', label: 'generation & scaffolding' },
  chatgpt:  { strengths: ['image','draw','dalle','vision','search','browse','plugin'], cost: 'medium', label: 'image & browsing' },
};

function score(q, profile) {
  const t = q.toLowerCase();
  return profile.strengths.reduce((a, kw) => a + (t.includes(kw) ? 2 : 0), 0);
}

function recommend(question, available) {
  return Object.entries(PROFILES)
    .filter(([t]) => available[t])
    .map(([t, p]) => ({ tool: t, score: score(question, p), cost: p.cost, label: p.label }))
    .sort((a, b) => b.score - a.score || (a.cost === 'low' ? -1 : 1));
}

async function openTool(tool, question) {
  const { execSync } = await import('child_process');
  const cmd = TOOL_OPEN[tool]?.(question);
  if (!cmd) return false;
  try { execSync(cmd, { stdio: 'ignore', timeout: 3000 }); return true; }
  catch { return false; }
}

export async function run(args) {
  // strip all flags first, then remaining args are the question
  const flags   = new Set(['--tool', '--all', '--no-open', '--dry-run', '--json']);
  const noOpen  = args.includes('--no-open') || args.includes('--dry-run');
  const openAll = args.includes('--all');
  const asJSON  = args.includes('--json');

  const toolIdx   = args.indexOf('--tool');
  const forceTool = toolIdx !== -1 ? args[toolIdx + 1] : null;

  // question = all non-flag args, excluding flag values
  const flagVals = new Set([forceTool].filter(Boolean));
  const question = args.filter(a => !a.startsWith('--') && !flagVals.has(a)).join(' ').trim();

  if (!question) {
    heading('ASK — USAGE');
    label('via ask "<question>"',        'route to best tool + open it');
    label('via ask "..." --tool claude', 'force a specific tool');
    label('via ask "..." --all',         'open in all detected tools');
    label('via ask "..." --no-open',     'recommend only, do not open');
    label('--json',                      'JSON output');
    headingEnd(); return;
  }

  const tools  = detectTools();
  const ranked = recommend(question, tools);

  if (asJSON) { console.log(JSON.stringify({ question, ranked }, null, 2)); return; }

  heading('ASK');
  label('question', question);
  blank();

  if (!ranked.length) {
    console.log('  │  No AI tools detected. Run: ' + steel('via init'));
    blank(); headingEnd(); return;
  }

  const targets = forceTool ? [forceTool] : openAll ? ranked.map(r => r.tool) : [ranked[0].tool];
  const top     = ranked[0];

  label('recommended', green(top.tool) + '  ' + dim(top.label));

  if (ranked.length > 1 && !forceTool) {
    blank();
    console.log(table(
      ranked.map((r, i) => ({
        rank:  i === 0 ? '*' : String(i + 1),
        tool:  r.tool,
        match: '#'.repeat(Math.min(r.score, 5)) || '-',
        for:   r.label,
      })),
      ['rank', 'tool', 'match', 'for']
    ));
  }

  blank();

  if (noOpen) {
    label('action', dim('recommend only — not opening'));
  } else {
    for (const tool of targets) {
      const ok = await openTool(tool, question);
      label(tool, ok ? green('opened') : yellow('could not open automatically'));
    }
  }

  headingEnd();
}

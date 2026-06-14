#!/usr/bin/env node
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

import { readFileSync } from 'fs';
const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version;

// ─── ANSI colours ─────────────────────────────────────────────────────────────
const _ = {
  reset:'\x1b[0m', bold:'\x1b[1m', white:'\x1b[97m', silver:'\x1b[37m', grey:'\x1b[90m',
  cobalt:'\x1b[38;5;26m', steel:'\x1b[38;5;67m', sky:'\x1b[38;5;117m', ice:'\x1b[38;5;153m',
  green:'\x1b[38;5;78m', red:'\x1b[38;5;203m', amber:'\x1b[38;5;221m',
};
const p=(col,s)=>`${col}${s}${_.reset}`;
const W=s=>p(_.white+_.bold,s); const Si=s=>p(_.silver,s); const Gr=s=>p(_.grey,s);
const Sk=s=>p(_.sky,s); const Ic=s=>p(_.ice,s); const St=s=>p(_.steel,s);
const G=s=>p(_.green,s); const R=s=>p(_.red,s); const Y=s=>p(_.amber,s);
const Co=s=>p(_.cobalt,s);

// ─── Banner ───────────────────────────────────────────────────────────────────
function banner(){
  console.log('');
  console.log('  '+Co('██╗   ██╗')+St(' ██╗')+Sk('  █████╗ '));
  console.log('  '+Co('██║   ██║')+St(' ██║')+Sk(' ██╔══██╗'));
  console.log('  '+Co('██║   ██║')+St(' ██║')+Sk(' ███████║'));
  console.log('  '+Co('╚██╗ ██╔╝')+St(' ██║')+Sk(' ██╔══██║'));
  console.log('  '+Co(' ╚████╔╝ ')+St(' ██║')+Sk(' ██║  ██║')+'  '+W('by Vektor Memory')+'  '+Gr(`v${VERSION}`));
  console.log('  '+Co('  ╚═══╝  ')+St(' ╚═╝')+Sk(' ╚═╝  ╚═╝'));
  console.log('');
  console.log('  '+Si('Route anything. Remember everything. Works everywhere.')+'  '+Gr('· Apache 2.0'));
  console.log('');
}

// ─── Box drawing ──────────────────────────────────────────────────────────────
const BAR=St('│'); const TL=St('┌─'); const BL=St('└'); const HR=St('─');
function stripAnsi(s){return s.replace(/\x1b\[[0-9;]*m/g,'');}
function box(label){const raw=stripAnsi(label);console.log('  '+TL+' '+Ic(label)+' '+HR.repeat(Math.max(2,44-raw.length)));}
function boxEnd(){console.log('  '+BL+HR.repeat(47));console.log('');}
function row(label,value){const raw=stripAnsi(label);const pad=' '.repeat(Math.max(1,18-raw.length));console.log('  '+BAR+' '+label+pad+value);}
function blank(){console.log('  '+BAR);}

// ─── Commands registry ────────────────────────────────────────────────────────
const COMMANDS = {
  init:    'Wire via into Claude Desktop, Cursor, Windsurf automatically',
  memory:  'Store and search facts across all your AI tools',
  prompt:  'Self-improving historically-informed prompt engine',
  convert: 'Convert any file locally — image, audio, video, doc, archive',
  task:    'Shared persistent task board',
  handoff: 'Transfer working state between AI tools',
  log:     'Unified activity log — decisions, spend, events',
  ask:     'Route a question to the right tool and open it',
  diff:    'Compare responses from two AI tools side by side',
  serve:   'Run as MCP server (Claude Desktop, Cursor, Windsurf)',
  research:'Autonomous parameter tuning with cross-session memory',
  context: 'Inject memory into any AI tool',
  scaffold:'Deploy AI config files to a project',
  audit:   'Compliance log — decisions and rationale',
};

// ─── Plain-text help (unchanged) ──────────────────────────────────────────────
function cmdHelp(){
  banner();
  box('COMMANDS');
  const primary=['init','memory','prompt','convert','task','handoff','log','ask','diff','serve','research'];
  for(const cmd of primary) row(W(cmd),Gr(COMMANDS[cmd]));
  boxEnd();
  box('OPTIONS');
  row(Sk('--help'),Si('Show this help'));
  row(Sk('--version'),Si('Print version'));
  row(Sk('--json'),Si('JSON output (all commands)'));
  row(Sk('--dry-run'),Si('Preview without writing'));
  boxEnd();
  box('QUICK START');
  blank();
  console.log('  '+BAR+'  '+Gr('# Wire via into your AI tools'));
  console.log('  '+BAR+'  '+Sk('via init'));
  blank();
  console.log('  '+BAR+'  '+Gr('# Generate memory-enriched prompt'));
  console.log('  '+BAR+'  '+Sk('via prompt "add authentication to the API"'));
  blank();
  console.log('  '+BAR+'  '+Gr('# Record outcome to improve future prompts'));
  console.log('  '+BAR+'  '+Sk('via prompt --learn success'));
  blank();
  console.log('  '+BAR+'  '+Gr('# Store a fact'));
  console.log('  '+BAR+'  '+Sk('via memory add "JWT tokens expire in 1h"'));
  blank();
  console.log('  '+BAR+'  '+Gr('# Export state before switching tools'));
  console.log('  '+BAR+'  '+Sk('via handoff --export'));
  blank();
  boxEnd();
  box('LINKS');
  row(Si('Docs'),Sk('https://github.com/Vektor-Memory/Via'));
  row(Si('Upgrade'),Sk('https://vektormemory.com'));
  boxEnd();
}

// ─── Ink TUI ──────────────────────────────────────────────────────────────────
async function launchTUI() {
  const ink                      = await import('ink');
  const { render, Box, Text, useApp, useInput, Static } = ink;
  const { default: SelectInput } = await import('ink-select-input');
  const { default: TextInput }   = await import('ink-text-input');
  const React                    = await import('react');
  const { useState, useEffect, useRef } = React;
  const h = React.createElement;

  // ── Shared helpers ─────────────────────────────────────────────────────────

  const Header = ({ cmd }) => h(Box, { flexDirection:'column', paddingLeft:2, paddingBottom:1 },
    h(Text, { color:'blueBright', bold:true }, `via ${cmd}`),
    h(Text, { color:'gray', dimColor:true }, COMMANDS[cmd] || '')
  );

  const Footer = ({ hint='esc · back' }) =>
    h(Text, { color:'gray', dimColor:true, marginLeft:2 }, hint);

  const Ask = ({ prompt, placeholder, onSubmit, onBack, hint }) => {
    const [val, setVal] = useState('');
    useInput((_, key) => { if (key.escape) onBack(); });
    return h(Box, { flexDirection:'column', paddingLeft:2 },
      h(Text, { color:'cyan' }, prompt),
      hint && h(Text, { color:'gray', dimColor:true }, hint),
      h(Box, { marginTop:1 },
        h(Text, { color:'cyan' }, '❯ '),
        h(TextInput, { value:val, placeholder, onChange:setVal,
          onSubmit: v => { if(v.trim()) onSubmit(v.trim()); }
        })
      ),
      h(Footer, { hint:'enter · confirm   esc · back' })
    );
  };

  // ── Progress bar component ─────────────────────────────────────────────────
  const ProgressBar = ({ label, pct, color='cyan', width=30 }) => {
    const filled = Math.round((pct / 100) * width);
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
    return h(Box, { marginLeft:2, marginBottom:0 },
      h(Text, { color:'gray' }, label.padEnd(20)),
      h(Text, { color }, bar),
      h(Text, { color:'gray' }, ` ${String(Math.round(pct)).padStart(3)}%`)
    );
  };

  // ── Research live dashboard ────────────────────────────────────────────────
  const ResearchDashboard = ({ sessions, apply, onDone }) => {
    const ITERS_PER_SESSION = 30;
    const [sessionNum, setSessionNum] = useState(0);
    const [dotsInSession, setDots]    = useState(0);
    const [bestScore, setBest]        = useState(0);
    const [sessionScores, setScores]  = useState([]);
    const [done, setDone]             = useState(false);
    // buffer for partial stdout lines (dots come char by char)
    const buf = useRef('');

    useEffect(() => {
      // research uses process.stdout.write for dots — intercept that
      const origWrite = process.stdout.write.bind(process.stdout);
      const origLog   = console.log;

      const parseLine = (line) => {
        const clean = stripAnsi(line).trim();
        if (!clean) return;

        // "Session 11 ····  best: 0.7499"
        const mSession = clean.match(/Session\s+(\d+)/i);
        if (mSession) setSessionNum(parseInt(mSession[1]));

        const mBest = clean.match(/best:\s*([\d.]+)/i);
        if (mBest) {
          const score = parseFloat(mBest[1]);
          setBest(prev => Math.max(prev, score));
          setScores(prev => [...prev.slice(-4), { s: parseInt(mSession?.[1]||0), score }]);
          setDots(0); // reset dots for next session
        }

        // count dots = iterations within current session
        const dots = (clean.match(/[·.]/g) || []).length;
        if (dots > 0) setDots(dots);
      };

      // intercept stdout.write — research writes dots with this
      process.stdout.write = (chunk, enc, cb) => {
        const str = typeof chunk === 'string' ? chunk : chunk.toString();
        buf.current += str;
        // flush complete lines
        const lines = buf.current.split('\n');
        buf.current = lines.pop(); // keep incomplete tail
        for (const line of lines) parseLine(line);
        // also parse partial line for dot counting
        if (buf.current) {
          const dots = (stripAnsi(buf.current).match(/[·.]/g) || []).length;
          if (dots > 0) setDots(dots);
        }
        return origWrite(chunk, enc, cb);
      };

      // also intercept console.log for the summary box output
      console.log = (...a) => {
        parseLine(a.join(' '));
        // suppress to keep TUI clean — it will all show after exit
      };

      import('./commands/research.mjs').then(mod => {
        const args = ['--target', 'recall-params',
          '--sessions', String(sessions),
          ...(apply ? ['--apply'] : [])
        ];
        return mod.run(args);
      }).then(() => {
        process.stdout.write = origWrite;
        console.log = origLog;
        setDone(true);
        onDone();
      }).catch(err => {
        process.stdout.write = origWrite;
        console.log = origLog;
        setScores(prev => [...prev, { s:0, score:0, err: err.message }]);
        setDone(true);
        onDone();
      });

      return () => {
        process.stdout.write = origWrite;
        console.log = origLog;
      };
    }, []);

    const sessionPct  = sessions > 0 ? Math.min(100, (sessionNum / sessions) * 100) : 0;
    const iterPct     = Math.min(100, (dotsInSession / ITERS_PER_SESSION) * 100);

    return h(Box, { flexDirection:'column', paddingTop:1 },
      h(Text, { color: done ? 'green' : 'blueBright', bold:true, marginLeft:2 },
        done ? 'via research — complete ✓' : 'via research — running'
      ),
      h(Box, { marginTop:1 }),
      h(ProgressBar, { label:`Sessions ${sessionNum}/${sessions}`, pct: sessionPct, color: done ? 'green' : 'cyan' }),
      h(ProgressBar, { label:`Current session`, pct: iterPct, color:'blue' }),
      h(Box, { marginLeft:2, marginTop:1 },
        h(Text, { color:'gray' }, 'Best score    '),
        h(Text, { color: bestScore >= 0.8 ? 'green' : bestScore >= 0.7 ? 'cyan' : 'yellow', bold:true },
          bestScore > 0 ? bestScore.toFixed(4) : '—'
        ),
        bestScore > 0 && h(Text, { color:'gray', dimColor:true },
          bestScore >= 0.8 ? '  excellent' : bestScore >= 0.7 ? '  good' : '  tuning...'
        )
      ),
      h(Box, { marginTop:1, marginLeft:2, flexDirection:'column' },
        h(Text, { color:'gray', dimColor:true }, 'session scores:'),
        ...sessionScores.map((s, i) =>
          h(Box, { key:i },
            h(Text, { color:'gray', dimColor:true }, `  session ${String(s.s).padStart(2)}  `),
            h(Text, { color: s.score >= 0.8 ? 'green' : 'cyan' }, s.score.toFixed(4)),
            s.score === bestScore && h(Text, { color:'green' }, '  ← best')
          )
        )
      ),
      done && h(Box, { marginLeft:2, marginTop:1 },
        h(Text, { color:'green' }, '✓ done  '),
        h(Text, { color:'gray' }, apply ? 'config applied to SDK' : 'run with --apply to write config')
      )
    );
  };

  // ── WIZARDS ────────────────────────────────────────────────────────────────
  const WIZARDS = {

    // INIT ───────────────────────────────────────────────────────────────────
    init: ({ onRun, onBack }) => {
      useInput((_, key) => { if (key.escape) onBack(); });
      return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'init' }),
        h(Text, { color:'cyan', marginLeft:2, marginBottom:1 }, 'What do you want to do?'),
        h(SelectInput, { items:[
          { label:'Auto-detect and wire all AI tools  ← recommended', value:[] },
          { label:'Dry run — preview without writing',                 value:['--dry-run'] },
          { label:'Force re-wire even if already configured',          value:['--force'] },
        ], onSelect: item => onRun(item.value) }),
        h(Footer, {})
      );
    },

    // PROMPT ─────────────────────────────────────────────────────────────────
    prompt: ({ onRun, onBack }) => {
      const [step, setStep]   = useState('goal');
      const [goal, setGoal]   = useState('');
      useInput((_, key) => {
        if (key.escape) step === 'goal' ? onBack() : setStep('goal');
      });

      if (step === 'goal') return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'prompt' }),
        h(Ask, {
          prompt: 'What are you trying to do?',
          placeholder: 'e.g. add JWT authentication to the Express API',
          hint: 'tip: be specific — the more detail the better the prompt',
          onSubmit: v => { setGoal(v); setStep('outcome'); },
          onBack
        })
      );

      return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'prompt' }),
        h(Text, { color:'gray', marginLeft:2, marginBottom:1 }, `"${goal}"`),
        h(Text, { color:'cyan', marginLeft:2 }, 'Did the last prompt run work well?'),
        h(Box, { marginTop:1 },
          h(SelectInput, { items:[
            { label:'Just generate — no feedback yet',      value:[] },
            { label:'Yes it worked  → --learn success',     value:['--learn','success'] },
            { label:'No it failed   → --learn fail',        value:['--learn','fail'] },
            { label:'I want to avoid something  → --avoid', value:'__avoid' },
          ], onSelect: item => {
            if (item.value === '__avoid') setStep('avoid');
            else onRun([goal, ...item.value]);
          }})
        ),
        h(Footer, {})
      );
    },

    // MEMORY ─────────────────────────────────────────────────────────────────
    memory: ({ onRun, onBack }) => {
      const [step, setStep] = useState('action');
      const [action, setAction] = useState('');
      useInput((_, key) => {
        if (key.escape) step === 'action' ? onBack() : setStep('action');
      });

      if (step === 'action') return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'memory' }),
        h(Text, { color:'cyan', marginLeft:2, marginBottom:1 }, 'What do you want to do?'),
        h(SelectInput, { items:[
          { label:'Remember a fact',                value:'add' },
          { label:'Search memory',                  value:'search' },
          { label:'List all stored facts',          value:'list' },
          { label:'Show import graph',              value:'graph' },
          { label:'Ingest a file or folder',        value:'file' },
          { label:'Remove a fact by id',            value:'rm' },
        ], onSelect: item => {
          setAction(item.value);
          if (item.value === 'list' || item.value === 'graph') onRun([item.value]);
          else setStep('text');
        }}),
        h(Footer, {})
      );

      const prompts = {
        add:    { q:'What should via remember?',      ph:'e.g. JWT tokens expire in 1h' },
        search: { q:'What are you looking for?',      ph:'e.g. auth token expiry' },
        file:   { q:'File or folder path to ingest?', ph:'e.g. ./src/ or ./README.md' },
        rm:     { q:'ID to remove?',                  ph:'e.g. 42' },
      };
      const { q, ph } = prompts[action] || prompts.add;
      return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'memory' }),
        h(Ask, {
          prompt: q, placeholder: ph,
          onSubmit: v => action === 'file'
            ? onRun(['add', '--file', v])
            : onRun([action, v]),
          onBack: () => setStep('action')
        })
      );
    },

    // TASK ───────────────────────────────────────────────────────────────────
    task: ({ onRun, onBack }) => {
      const [step, setStep] = useState('action');
      const [action, setAction] = useState('');
      useInput((_, key) => {
        if (key.escape) step === 'action' ? onBack() : setStep('action');
      });

      if (step === 'action') return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'task' }),
        h(Text, { color:'cyan', marginLeft:2, marginBottom:1 }, 'What do you want to do?'),
        h(SelectInput, { items:[
          { label:'View all tasks',     value:'list' },
          { label:'Add a new task',     value:'add' },
          { label:'Mark a task done',   value:'done' },
        ], onSelect: item => {
          setAction(item.value);
          if (item.value === 'list') onRun(['list']);
          else setStep('text');
        }}),
        h(Footer, {})
      );

      return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'task' }),
        h(Ask, {
          prompt: action === 'add' ? 'Describe the task:' : 'Which task? (name or id)',
          placeholder: action === 'add' ? 'e.g. refactor the auth module' : 'e.g. 3 or "auth module"',
          onSubmit: v => onRun([action, v]),
          onBack: () => setStep('action')
        })
      );
    },

    // HANDOFF ────────────────────────────────────────────────────────────────
    handoff: ({ onRun, onBack }) => {
      const [step, setStep] = useState('action');
      useInput((_, key) => {
        if (key.escape) step === 'action' ? onBack() : setStep('action');
      });

      if (step === 'action') return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'handoff' }),
        h(Text, { color:'cyan', marginLeft:2, marginBottom:1 }, 'What do you want to do?'),
        h(SelectInput, { items:[
          { label:'Export current state to file',  value:'export' },
          { label:'Import a saved state file',     value:'import' },
          { label:'List saved handoffs',           value:'list' },
        ], onSelect: item => {
          if (item.value === 'list')   onRun(['--list']);
          else if (item.value === 'export') onRun(['--export']);
          else setStep('file');
        }}),
        h(Footer, {})
      );

      return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'handoff' }),
        h(Ask, {
          prompt: 'Path to .vstate.json file to import:',
          placeholder: 'e.g. ./my.vstate.json',
          onSubmit: v => onRun(['--import', v]),
          onBack: () => setStep('action')
        })
      );
    },

    // LOG ────────────────────────────────────────────────────────────────────
    log: ({ onRun, onBack }) => {
      const [step, setStep] = useState('action');
      const [action, setAction] = useState('');
      useInput((_, key) => {
        if (key.escape) step === 'action' ? onBack() : setStep('action');
      });

      if (step === 'action') return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'log' }),
        h(Text, { color:'cyan', marginLeft:2, marginBottom:1 }, 'What do you want to do?'),
        h(SelectInput, { items:[
          { label:'Show recent entries',           value:'show' },
          { label:'Add a manual log entry',        value:'add' },
          { label:'Show today only',               value:'today' },
          { label:'Search the log',                value:'search' },
          { label:'Watch Claude Code sessions live', value:'watch' },
          { label:'One-shot scan of all sessions', value:'scan' },
        ], onSelect: item => {
          setAction(item.value);
          if (item.value === 'show')  onRun([]);
          else if (item.value === 'today') onRun(['--today']);
          else if (item.value === 'watch') onRun(['--watch']);
          else if (item.value === 'scan')  onRun(['--scan']);
          else setStep('text');
        }}),
        h(Footer, {})
      );

      return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'log' }),
        h(Ask, {
          prompt: action === 'add' ? 'What do you want to log?' : 'Search term?',
          placeholder: action === 'add' ? 'e.g. decided to use Postgres' : 'e.g. postgres',
          onSubmit: v => action === 'add' ? onRun([v]) : onRun(['search', v]),
          onBack: () => setStep('action')
        })
      );
    },

    // ASK ────────────────────────────────────────────────────────────────────
    ask: ({ onRun, onBack }) => {
      const [step, setStep]  = useState('question');
      const [question, setQ] = useState('');
      useInput((_, key) => {
        if (key.escape) step === 'question' ? onBack() : setStep('question');
      });

      if (step === 'question') return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'ask' }),
        h(Ask, {
          prompt: 'What do you want to ask?',
          placeholder: 'e.g. how do I reverse a linked list in Python?',
          hint: 'tip: via will open the best AI tool and pre-fill this question',
          onSubmit: v => { setQ(v); setStep('tool'); },
          onBack
        })
      );

      return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'ask' }),
        h(Text, { color:'gray', marginLeft:2, marginBottom:1 }, `"${question}"`),
        h(Text, { color:'cyan', marginLeft:2 }, 'Which AI tool should answer?'),
        h(Box, { marginTop:1 },
          h(SelectInput, { items:[
            { label:'Auto-detect best available tool', value:[] },
            { label:'Claude Desktop',                  value:['--tool','claude'] },
            { label:'Cursor',                          value:['--tool','cursor'] },
            { label:'Windsurf',                        value:['--tool','windsurf'] },
            { label:'ChatGPT',                         value:['--tool','chatgpt'] },
          ], onSelect: item => onRun([question, ...item.value])
          })
        ),
        h(Footer, {})
      );
    },

    // DIFF ───────────────────────────────────────────────────────────────────
    diff: ({ onRun, onBack }) => {
      const [step, setStep]  = useState('prompt');
      const [prompt, setPr]  = useState('');
      useInput((_, key) => {
        if (key.escape) step === 'prompt' ? onBack() : setStep('prompt');
      });

      if (step === 'prompt') return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'diff' }),
        h(Ask, {
          prompt: 'What prompt should both AI tools answer?',
          placeholder: 'e.g. explain async/await in JavaScript',
          hint: 'tip: via sends this to two tools and shows responses side by side',
          onSubmit: v => { setPr(v); setStep('tools'); },
          onBack
        })
      );

      return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'diff' }),
        h(Text, { color:'gray', marginLeft:2, marginBottom:1 }, `"${prompt}"`),
        h(Text, { color:'cyan', marginLeft:2 }, 'Which two tools to compare?'),
        h(Box, { marginTop:1 },
          h(SelectInput, { items:[
            { label:'Claude vs Cursor',    value:['--tools','claude,cursor'] },
            { label:'Claude vs Windsurf',  value:['--tools','claude,windsurf'] },
            { label:'Claude vs ChatGPT',   value:['--tools','claude,chatgpt'] },
            { label:'Cursor vs Windsurf',  value:['--tools','cursor,windsurf'] },
            { label:'Last two tools used', value:[] },
          ], onSelect: item => onRun([prompt, ...item.value])
          })
        ),
        h(Footer, {})
      );
    },

    // CONVERT ────────────────────────────────────────────────────────────────
    convert: ({ onRun, onBack }) => {
      const [step, setStep]  = useState('file');
      const [file, setFile]  = useState('');
      const [ingest, setIngest] = useState(false);
      useInput((_, key) => {
        if (key.escape) step === 'file' ? onBack() : setStep('file');
      });

      if (step === 'file') return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'convert' }),
        h(Ask, {
          prompt: 'File or folder to convert?',
          placeholder: 'e.g. C:\\Users\\you\\report.pdf  or  ./audio.mp3',
          hint: 'tip: via converts locally — nothing is uploaded',
          onSubmit: v => { setFile(v); setStep('format'); },
          onBack
        })
      );

      if (step === 'format') return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'convert' }),
        h(Text, { color:'gray', marginLeft:2, marginBottom:1 }, `file: "${file}"`),
        h(Text, { color:'cyan', marginLeft:2 }, 'Convert to?'),
        h(Box, { marginTop:1 },
          h(SelectInput, { items:[
            { label:'PDF   — document',        value:'pdf' },
            { label:'MD    — markdown',        value:'md' },
            { label:'DOCX  — Word',            value:'docx' },
            { label:'TXT   — plain text',      value:'txt' },
            { label:'MP3   — audio extract',   value:'mp3' },
            { label:'MP4   — video',           value:'mp4' },
            { label:'JPG   — image',           value:'jpg' },
            { label:'PNG   — image',           value:'png' },
            { label:'WEBP  — image',           value:'webp' },
            { label:'GIF   — animated',        value:'gif' },
            { label:'ZIP   — archive folder',  value:'zip' },
          ], onSelect: item => { setIngest(false); setStep('ingest'); setFile(f => { file; return f; }); onRun([file, '--to', item.value]); }
          })
        ),
        h(Footer, {})
      );
    },

    // SERVE ──────────────────────────────────────────────────────────────────
    serve: ({ onRun, onBack }) => {
      const [step, setStep] = useState('action');
      useInput((_, key) => {
        if (key.escape) step === 'action' ? onBack() : setStep('action');
      });

      if (step === 'action') return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'serve' }),
        h(Text, { color:'cyan', marginLeft:2, marginBottom:1 }, 'How do you want to run the MCP server?'),
        h(SelectInput, { items:[
          { label:'stdio  — for Claude Desktop / Cursor / Windsurf config  ← default', value:[] },
          { label:'SSE    — HTTP server for remote MCP clients',                        value:['--sse'] },
          { label:'SSE on a custom port →',                                             value:'__port' },
        ], onSelect: item => {
          if (item.value === '__port') setStep('port');
          else onRun(item.value);
        }}),
        h(Footer, {})
      );

      return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'serve' }),
        h(Ask, {
          prompt: 'Port number?',
          placeholder: 'e.g. 3333',
          hint: 'default is 3000',
          onSubmit: v => onRun(['--sse', '--port', v]),
          onBack: () => setStep('action')
        })
      );
    },

    // RESEARCH — with live progress bar ───────────────────────────────────────
    research: ({ onRun, onBack }) => {
      const [step, setStep]       = useState('action');
      const [sessions, setSessions] = useState(5);
      const [apply, setApply]     = useState(false);
      const [running, setRunning] = useState(false);

      useInput((_, key) => {
        if (key.escape && !running) step === 'action' ? onBack() : setStep('action');
      });

      if (running) return h(ResearchDashboard, {
        sessions, apply,
        onDone: () => { setRunning(false); onRun(null); } // null = already ran inside dashboard
      });

      if (step === 'action') return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'research' }),
        h(Text, { color:'cyan', marginLeft:2, marginBottom:1 }, 'What do you want to do?'),
        h(SelectInput, { items:[
          { label:'Tune recall parameters — 5 sessions  ← recommended', value:'run_5' },
          { label:'Quick tune — 2 sessions (faster)',                    value:'run_2' },
          { label:'Deep tune  — 10 sessions (thorough)',                 value:'run_10' },
          { label:'Tune + auto-apply best config when done',             value:'run_apply' },
          { label:'Show current best config + coverage',                 value:'status' },
          { label:'Custom session count →',                              value:'custom' },
          { label:'Reset research memory and start fresh',               value:'reset' },
        ], onSelect: item => {
          if (item.value === 'status') { onRun(['--target','recall-params','--status']); return; }
          if (item.value === 'reset')  { onRun(['--target','recall-params','--reset']);  return; }
          if (item.value === 'custom') { setStep('custom'); return; }
          const n = item.value === 'run_2' ? 2 : item.value === 'run_10' ? 10 : 5;
          const a = item.value === 'run_apply';
          setSessions(n); setApply(a); setRunning(true);
        }}),
        h(Footer, {})
      );

      return h(Box, { flexDirection:'column' },
        h(Header, { cmd:'research' }),
        h(Ask, {
          prompt: 'How many sessions?',
          placeholder: 'e.g. 10   (each session = 30 iterations)',
          hint: 'more sessions = better results but takes longer',
          onSubmit: v => {
            const n = parseInt(v) || 5;
            setSessions(n); setApply(false); setRunning(true);
          },
          onBack: () => setStep('action')
        })
      );
    },
  };

  // ── Main palette app ───────────────────────────────────────────────────────
  const ViaApp = () => {
    const { exit }              = useApp();
    const [screen, setScreen]   = useState('palette');
    const [selectedCmd, setSel] = useState(null);
    const [done, setDone]       = useState(false);

    useInput((input) => {
      if (input === 'q' && screen === 'palette') exit();
    });

    const PRIMARY = ['init','memory','prompt','convert','task','handoff','log','ask','diff','serve','research'];
    const paletteItems = PRIMARY.map(k => ({
      label: `${k.padEnd(12)} ${COMMANDS[k]}`,
      value: k
    }));

    // selectedCmd passed explicitly — avoids stale React state closure
    const runCmd = async (cmd, args) => {
      // null args means the wizard already ran the command internally (research dashboard)
      if (args === null) { exit(); return; }
      exit();
      await new Promise(r => setTimeout(r, 80));
      const filePath = join(__dirname, 'commands', `${cmd}.mjs`);
      if (!existsSync(filePath)) {
        console.log('\n  ' + Y('◌') + '  ' + W(`via ${cmd}`) + Gr('  — coming soon\n'));
        return;
      }
      const mod = await import(`./commands/${cmd}.mjs`);
      await mod.run(args);
    };

    if (screen === 'palette') return h(Box, { flexDirection:'column', paddingTop:1 },
      h(Text, { color:'blueBright', bold:true, marginLeft:2 }, `VIA  v${VERSION}`),
      h(Text, { color:'gray', marginLeft:2 }, 'Route anything. Remember everything.'),
      h(Box, { marginTop:1 }),
      h(Text, { color:'gray', dimColor:true, marginLeft:2 }, '↑↓ navigate   enter · select   q · quit'),
      h(Box, { marginTop:1 },
        h(SelectInput, {
          items: paletteItems,
          onSelect: item => {
            setSel(item.value);
            setScreen('wizard');
          }
        })
      )
    );

    if (screen === 'wizard' && selectedCmd && WIZARDS[selectedCmd]) {
      const Wizard = WIZARDS[selectedCmd];
      return h(Wizard, {
        onRun:  (args) => { setScreen('done'); runCmd(selectedCmd, args); },
        onBack: () => setScreen('palette'),
      });
    }

    return h(Box, { padding:1 },
      h(Text, { color:'cyan' }, `  running via ${selectedCmd}...`)
    );
  };

  render(h(ViaApp, null));
}

// ─── Entry point ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cmd  = args[0];

if (!cmd && process.stdout.isTTY && !process.env.CI) {
  launchTUI().catch(err => {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      console.error(R('  ✗  Ink not installed. Run: npm i ink react ink-select-input ink-text-input'));
      cmdHelp();
    } else {
      console.error(R(`✗  ${err.message}`));
      process.exit(1);
    }
  });
} else {
  if (!cmd || cmd === '--help' || cmd === '-h') { cmdHelp(); process.exit(0); }
  if (cmd === '--version' || cmd === '-v') { console.log(`via v${VERSION}`); process.exit(0); }

  const known = Object.keys(COMMANDS);
  if (!known.includes(cmd)) {
    banner();
    console.error('  '+R(`✗  Unknown command: ${cmd}`)+'  '+Gr('· run via --help')+'\n');
    process.exit(1);
  }

  try {
    const modPath = join(__dirname, 'commands', `${cmd}.mjs`);
    if (!existsSync(modPath)) {
      banner();
      console.log('  '+Y('◌')+'  '+W(`via ${cmd}`)+Gr('  — coming soon'));
      console.log('  '+Gr('    ')+Sk('https://github.com/Vektor-Memory/Via')+'\n');
      process.exit(0);
    }
    const mod = await import(`./commands/${cmd}.mjs`);
    await mod.run(args.slice(1));
  } catch(err) {
    console.error('  '+R(`✗  ${err.message}`));
    if (process.env.VIA_DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

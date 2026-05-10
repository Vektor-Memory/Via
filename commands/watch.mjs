/**
 * commands/watch.mjs — via watch
 * Event routing — desktop, webhook, Slack, Discord notifications.
 * Uses Node 18+ built-in fetch (no external dependency).
 *
 * Usage:
 *   via watch
 *   via watch add slack <webhook-url>
 *   via watch add discord <webhook-url>
 *   via watch add webhook <url>
 *   via watch add desktop
 *   via watch rm <id>
 *   via watch fire "task complete"
 *   via watch test
 */

import { readConfig, writeConfig } from '../utils/config.mjs';
import { table, blank, green, red, bold } from '../utils/format.mjs';

function getRoutes() { return readConfig().watch_routes ?? []; }
function saveRoutes(routes) {
  const cfg = readConfig();
  cfg.watch_routes = routes;
  writeConfig(cfg);
}

async function fireDesktop(message) {
  const { execSync } = await import('child_process');
  try {
    if (process.platform === 'darwin') {
      execSync(`osascript -e 'display notification "${message}" with title "Via"'`);
    } else if (process.platform === 'win32') {
      execSync(
        `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; ` +
        `$n = New-Object System.Windows.Forms.NotifyIcon; ` +
        `$n.Icon = [System.Drawing.SystemIcons]::Information; ` +
        `$n.Visible = $true; ` +
        `$n.ShowBalloonTip(3000, 'Via', '${message}', 'Info')"`,
        { stdio: 'ignore' }
      );
    } else {
      execSync(`notify-send "Via" "${message}"`, { stdio: 'ignore' });
    }
    return true;
  } catch { return false; }
}

async function fireWebhook(url, message, type = 'webhook') {
  const body = (type === 'slack' || type === 'discord')
    ? JSON.stringify({ text: `[Via] ${message}`, content: `[Via] ${message}` })
    : JSON.stringify({ source: 'via', message, timestamp: new Date().toISOString() });
  try {
    // Node 18+ global fetch — no node-fetch needed
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return res.ok;
  } catch { return false; }
}

async function fireAll(routes, message) {
  const results = [];
  for (const route of routes) {
    const ok = route.type === 'desktop'
      ? await fireDesktop(message)
      : await fireWebhook(route.url, message, route.type);
    results.push({ route: route.id, type: route.type, ok });
  }
  return results;
}

export async function run(args) {
  const subcmd = args[0];

  if (!subcmd) {
    const routes = getRoutes();
    console.log(`\n  ${bold('via watch')} — event routes\n`);
    if (!routes.length) {
      console.log('  No routes configured.\n');
      console.log('    via watch add slack    <webhook-url>');
      console.log('    via watch add discord  <webhook-url>');
      console.log('    via watch add webhook  <url>');
      console.log('    via watch add desktop');
      blank(); return;
    }
    console.log(table(routes.map(r => ({ id: r.id, type: r.type, target: r.url ?? 'desktop' })), ['id', 'type', 'target']));
    return;
  }

  if (subcmd === 'add') {
    const type = args[1], url = args[2];
    if (!type) { console.error('  via watch add: type required — slack | discord | webhook | desktop'); process.exit(1); }
    if (type !== 'desktop' && !url) { console.error(`  via watch add ${type} requires a URL`); process.exit(1); }
    const routes = getRoutes();
    routes.push({ id: `${type}-${Date.now()}`, type, url: url ?? null, added_at: new Date().toISOString() });
    saveRoutes(routes);
    console.log(`\n  ${green('✓')} Route added: ${type} ${url ?? ''}\n`);
    return;
  }

  if (subcmd === 'rm') {
    const id = args[1];
    if (!id) { console.error('  via watch rm requires an id'); process.exit(1); }
    saveRoutes(getRoutes().filter(r => r.id !== id));
    console.log(`\n  ${red('✗')} Route ${id} removed\n`);
    return;
  }

  if (subcmd === 'fire') {
    const message = args.slice(1).join(' ') || 'Via event fired';
    const routes  = getRoutes();
    if (!routes.length) { console.log('\n  No routes configured.\n'); return; }
    const results = await fireAll(routes, message);
    results.forEach(r => console.log(`  ${r.ok ? green('✓') : red('✗')} ${r.type}`));
    blank(); return;
  }

  if (subcmd === 'test') {
    const routes = getRoutes();
    if (!routes.length) { console.log('\n  No routes. Add one: via watch add slack <url>\n'); return; }
    console.log(`\n  Testing ${routes.length} route(s)...\n`);
    const results = await fireAll(routes, 'Via watch test — all systems go');
    results.forEach(r => console.log(`  ${r.ok ? green('✓') : red('✗')} ${r.type} ${r.ok ? 'delivered' : 'failed'}`));
    blank(); return;
  }

  console.log(`
  Usage: via watch [subcommand]

  Subcommands:
    (none)              Show configured routes
    add <type> [url]    Add route: slack | discord | webhook | desktop
    rm <id>             Remove a route
    fire <message>      Fire all routes manually
    test                Send test notification to all routes
`);
}


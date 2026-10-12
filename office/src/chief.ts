// Sends a request to the Chief of Staff as a headless Claude Code run.
// Used by the dashboard command bar, and from the shell: node office/src/chief.ts "request"
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './paths.ts';
import { taskCreate, taskUpdate } from './db.ts';
import { brainWrite } from './brain.ts';

// Pass the project allowlist explicitly so headless runs work even before the workspace trust dialog is accepted.
const allow = (): string[] => JSON.parse(fs.readFileSync(path.join(ROOT, '.claude/settings.json'), 'utf8')).permissions.allow;

export function askChief(request: string, onDone?: (r: { ok: boolean; text: string; taskId: number }) => void) {
  const task = taskCreate({ agent: 'chief-of-staff', title: request.slice(0, 120), status: 'running' });
  const child = spawn(process.env.CLAUDE_BIN ?? 'claude',
    ['-p', request, '--agent', 'chief-of-staff', '--output-format', 'json', '--allowedTools', allow().join(',')],
    // Foreground subagents: in headless mode a lead would otherwise finish before its background members report back.
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' } });
  let out = '', err = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (err += d));
  const finish = (ok: boolean, text: string) => {
    const report = `## ${new Date().toISOString()} — "${request}"\n\n${text}`;
    const { path: p } = brainWrite('chief/reports.md', report, 'chief-of-staff');
    taskUpdate(task.id, { status: ok ? 'done' : 'failed', output: `brain/${p}`, notes: text.slice(0, 2000) });
    onDone?.({ ok, text, taskId: task.id });
  };
  child.on('error', e => finish(false, `Could not start Claude Code (${e.message}). Is the \`claude\` CLI installed and logged in?`));
  child.on('close', code => {
    try {
      const r = JSON.parse(out);
      finish(!r.is_error && code === 0, r.result ?? JSON.stringify(r));
    } catch { finish(false, `claude exited ${code}: ${(err || out).slice(-1500)}`); }
  });
  return task;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const request = process.argv.slice(2).join(' ');
  if (!request) { console.error('usage: node office/src/chief.ts "your request"'); process.exit(1); }
  askChief(request, r => { console.log(r.text); process.exitCode = r.ok ? 0 : 1; });
}

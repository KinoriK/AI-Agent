// SQLite store for the task board, approval queue and live event stream.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH } from './paths.ts';
import { teamOf } from './org.ts';

process.removeAllListeners('warning'); // silence node:sqlite ExperimentalWarning on stderr

export const TASK_STATUSES = ['queued', 'running', 'done', 'failed', 'awaiting_approval'] as const;
export const APPROVAL_KINDS = ['post', 'email', 'purchase', 'deploy', 'schedule', 'listing', 'refund', 'publish', 'other'] as const;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team TEXT NOT NULL, agent TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  parent_id INTEGER, notes TEXT, output TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL, team TEXT NOT NULL, agent TEXT NOT NULL, title TEXT NOT NULL,
  draft TEXT NOT NULL, reason TEXT NOT NULL, task_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', result TEXT,
  created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL, type TEXT NOT NULL, agent TEXT, team TEXT,
  tool TEXT, label TEXT, session TEXT, instance TEXT, data TEXT
);
`);

const now = () => new Date().toISOString();
type Row = Record<string, any>;

export function logEvent(e: { type: string; agent?: string; tool?: string; label?: string; session?: string; instance?: string; data?: unknown }) {
  db.prepare('INSERT INTO events (ts,type,agent,team,tool,label,session,instance,data) VALUES (?,?,?,?,?,?,?,?,?)').run(
    now(), e.type, e.agent ?? null, e.agent ? teamOf(e.agent) : null, e.tool ?? null, e.label ?? null, e.session ?? null, e.instance ?? null,
    e.data === undefined ? null : JSON.stringify(e.data),
  );
}

export function eventsAfter(id: number, limit = 500): Row[] {
  return db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?').all(id, limit) as Row[];
}

export function taskCreate(t: { agent: string; title: string; team?: string; status?: string; parent_id?: number; notes?: string }) {
  const status = t.status ?? 'queued';
  if (!TASK_STATUSES.includes(status as any)) throw new Error(`bad status ${status}`);
  const team = t.team ?? teamOf(t.agent);
  const r = db.prepare('INSERT INTO tasks (team,agent,title,status,parent_id,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(team, t.agent, t.title, status, t.parent_id ?? null, t.notes ?? null, now(), now());
  const task = taskGet(Number(r.lastInsertRowid));
  logEvent({ type: 'task', agent: t.agent, label: t.title, data: task });
  return task;
}

export function taskGet(id: number): Row {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
  if (!t) throw new Error(`task ${id} not found`);
  return t;
}

export function taskUpdate(id: number, patch: { status?: string; output?: string; notes?: string; agent?: string }) {
  if (patch.status && !TASK_STATUSES.includes(patch.status as any)) throw new Error(`bad status ${patch.status}`);
  const t = { ...taskGet(id), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  db.prepare('UPDATE tasks SET status=?, output=?, notes=?, agent=?, updated_at=? WHERE id=?').run(t.status, t.output ?? null, t.notes ?? null, t.agent, now(), id);
  const task = taskGet(id);
  logEvent({ type: 'task', agent: task.agent, label: task.title, data: task });
  return task;
}

export function taskList(f: { team?: string; status?: string; since?: string; limit?: number } = {}): Row[] {
  return db.prepare(`SELECT * FROM tasks WHERE (?1 IS NULL OR team = ?1) AND (?2 IS NULL OR status = ?2) AND (?3 IS NULL OR updated_at >= ?3)
    ORDER BY id DESC LIMIT ?4`).all(f.team ?? null, f.status ?? null, f.since ?? null, f.limit ?? 50) as Row[];
}

export function approvalRequest(a: { kind: string; agent: string; title: string; draft: unknown; reason: string; task_id?: number }) {
  if (!APPROVAL_KINDS.includes(a.kind as any)) throw new Error(`bad kind ${a.kind}`);
  const r = db.prepare('INSERT INTO approvals (kind,team,agent,title,draft,reason,task_id,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(a.kind, teamOf(a.agent), a.agent, a.title, JSON.stringify(a.draft), a.reason, a.task_id ?? null, now());
  if (a.task_id) taskUpdate(a.task_id, { status: 'awaiting_approval' });
  const item = approvalGet(Number(r.lastInsertRowid));
  logEvent({ type: 'approval', agent: a.agent, label: a.title, data: item });
  return item;
}

export function approvalGet(id: number): Row {
  const a = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Row | undefined;
  if (!a) throw new Error(`approval ${id} not found`);
  return { ...a, draft: JSON.parse(a.draft) };
}

export function approvalList(f: { status?: string; limit?: number } = {}): Row[] {
  return (db.prepare('SELECT id FROM approvals WHERE (?1 IS NULL OR status = ?1) ORDER BY id DESC LIMIT ?2').all(f.status ?? null, f.limit ?? 50) as Row[])
    .map(r => approvalGet(r.id));
}

// Only the dashboard (the human) calls this; it is deliberately not exposed over MCP.
export function approvalDecide(id: number, status: 'approved' | 'rejected', patch: { draft?: unknown; result?: string } = {}) {
  const a = approvalGet(id);
  if (a.status !== 'pending') throw new Error(`approval ${id} already ${a.status}`);
  db.prepare('UPDATE approvals SET status=?, draft=?, result=?, decided_at=? WHERE id=?')
    .run(status, JSON.stringify(patch.draft ?? a.draft), patch.result ?? null, now(), id);
  if (a.task_id) taskUpdate(a.task_id, { status: status === 'approved' ? 'done' : 'failed' });
  const item = approvalGet(id);
  logEvent({ type: 'approval', agent: a.agent, label: `${status}: ${a.title}`, data: item });
  return item;
}

export function approvalSetResult(id: number, result: string) {
  db.prepare('UPDATE approvals SET result=? WHERE id=?').run(result, id);
}

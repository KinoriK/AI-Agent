// Dashboard backend: REST for state + actions, WebSocket for the live event stream (hook events from SQLite).
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { ROOT, MEDIA } from '../../office/src/paths.ts';
import * as db from '../../office/src/db.ts';
import { TEAMS, AGENTS } from '../../office/src/org.ts';
import { brainRead, brainRecent } from '../../office/src/brain.ts';
import { integrationStatus, execute } from '../../office/src/integrations.ts';
import { askChief } from '../../office/src/chief.ts';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '127.0.0.1'; // local only: this server can approve real actions
const app = express();
app.use(express.json({ limit: '1mb' }));

const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const latestEventId = () => (db.db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM events').get() as any).id as number;

app.get('/api/state', (_req, res) => {
  const last = latestEventId();
  res.json({
    teams: TEAMS,
    agents: AGENTS.map(({ name, team, title, does }) => ({ name, team, title, does })),
    tasks: db.taskList({ limit: 200 }).filter(t => t.status === 'running' || t.status === 'queued' || t.status === 'awaiting_approval' || t.updated_at >= startOfDay()),
    approvals: db.approvalList({ limit: 100 }),
    integrations: integrationStatus(),
    events: db.eventsAfter(Math.max(0, last - 400), 400), // replayed by the client to rebuild who is working
  });
});

app.get('/api/team/:id', (req, res) => {
  const team = TEAMS.find(t => t.id === req.params.id);
  if (!team) return res.status(404).json({ error: 'no such team' });
  const brain = brainRecent(team.id, 8).map(e => ({ ...e, preview: (brainRead(e.path).content ?? '').slice(-600) }));
  res.json({ team, agents: AGENTS.filter(a => a.team === team.id), tasks: db.taskList({ team: team.id, limit: 30 }), brain });
});

app.get('/api/brain', (req, res) => {
  try { res.json(brainRead(String(req.query.path ?? ''))); } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// Approval queue: the owner's controls. Edit keeps it pending; approve executes; reject closes it.
app.post('/api/approvals/:id/edit', (req, res) => {
  try {
    const a = db.approvalGet(Number(req.params.id));
    if (a.status !== 'pending') throw new Error(`already ${a.status}`);
    db.db.prepare('UPDATE approvals SET draft=? WHERE id=?').run(JSON.stringify(req.body.draft), a.id);
    db.logEvent({ type: 'approval', agent: a.agent, label: `edited: ${a.title}` });
    res.json(db.approvalGet(a.id));
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.post('/api/approvals/:id/approve', async (req, res) => {
  try {
    const a = db.approvalDecide(Number(req.params.id), 'approved', { draft: req.body?.draft });
    const result = await execute(a).catch(e => `approved, but execution failed: ${e.message}`);
    db.approvalSetResult(a.id, result);
    db.logEvent({ type: 'approval', agent: a.agent, label: `executed: ${a.title}`, data: { result } });
    res.json({ ...db.approvalGet(a.id) });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.post('/api/approvals/:id/reject', (req, res) => {
  try { res.json(db.approvalDecide(Number(req.params.id), 'rejected', { result: req.body?.reason ?? 'rejected by owner' })); }
  catch (e: any) { res.status(400).json({ error: e.message }); }
});

// Command bar -> Chief of Staff
app.post('/api/command', (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'empty request' });
  const task = askChief(text, r => broadcast({ kind: 'chief_report', ...r }));
  res.json({ task });
});

app.use('/media', express.static(MEDIA));
const dist = path.join(ROOT, 'dashboard/web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|media|ws).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
function broadcast(msg: object) {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s);
}

// Hooks and MCP servers write events to SQLite from other processes; tail the table and fan out.
let cursor = latestEventId();
setInterval(() => {
  const rows = db.eventsAfter(cursor);
  if (rows.length) { cursor = rows[rows.length - 1].id; broadcast({ kind: 'events', events: rows }); }
}, 250);

const onListenError = (e: any) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`Port ${PORT} is already in use (an earlier dashboard, or another app). Stop it, or run: PORT=${PORT + 10} npm run dashboard`);
  process.exit(1);
};
server.on('error', onListenError);
wss.on('error', onListenError); // ws re-emits the http server's listen error
server.listen(PORT, HOST, () => console.log(`Agent HQ dashboard on http://${HOST}:${PORT}`));

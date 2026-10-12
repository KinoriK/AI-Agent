// Phase 1 check: drive the real office MCP server over stdio.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-'));
const env = { ...process.env, OFFICE_DB: path.join(tmp, 'office.db') } as Record<string, string>;
const client = new Client({ name: 'test', version: '1' });
await client.connect(new StdioClientTransport({ command: 'node', args: ['office/src/server.ts'], env }));
const call = async (name: string, args: object = {}) => {
  const r: any = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(r.content[0].text);
  return JSON.parse(r.content[0].text);
};
after(async () => { await client.close(); fs.rmSync('brain/chief/_test.md', { force: true }); });

test('lists all office tools', async () => {
  const names = (await client.listTools()).tools.map(t => t.name);
  for (const n of ['brain_read', 'brain_write', 'brain_search', 'task_create', 'task_update', 'task_list', 'approval_request', 'approval_list', 'media_cut'])
    assert.ok(names.includes(n), n);
  assert.ok(!names.includes('approval_decide'), 'agents must not be able to approve');
});

test('brain write/read/search and path guard', async () => {
  await call('brain_write', { path: 'chief/_test', content: 'The owner prefers amber captions.', agent: 'chief-of-staff' });
  assert.match((await call('brain_read', { path: 'chief/_test.md' })).content, /amber captions/);
  assert.ok((await call('brain_search', { query: 'AMBER CAPTIONS' })).some((h: any) => h.path === 'chief/_test.md'));
  await assert.rejects(call('brain_read', { path: '../.env' }), /escapes the brain/);
});

test('task lifecycle and approval queue', async () => {
  const t = await call('task_create', { agent: 'github-scout', title: 'scan' });
  assert.equal(t.team, 'research');
  assert.equal(t.status, 'queued');
  assert.equal((await call('task_update', { id: t.id, status: 'running' })).status, 'running');
  await assert.rejects(call('task_update', { id: t.id, status: 'bogus' }));
  const a = await call('approval_request', { kind: 'post', agent: 'social-lead', title: 'X post', draft: { platform: 'x', text: 'hi' }, reason: 'test', task_id: t.id });
  assert.equal(a.status, 'pending');
  assert.equal((await call('task_list', { status: 'awaiting_approval' }))[0].id, t.id);
  assert.equal((await call('approval_list', { status: 'pending' })).length, 1);
});

test('media path guard', async () => {
  await assert.rejects(call('media_probe', { path: '.env' }), /inside media/);
});

// Phase 2 check: every integration starts in mock mode and returns realistic data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Strip credentials so this always exercises mock mode.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/TOKEN|GOOGLE_|SLACK_|API_KEY/.test(k))) as Record<string, string>;
async function call(server: string, name: string, args: object = {}) {
  const c = new Client({ name: 'test', version: '1' });
  await c.connect(new StdioClientTransport({ command: 'node', args: ['office/src/integrations.ts', server], env, stderr: 'ignore' }));
  try {
    const r: any = await c.callTool({ name, arguments: args });
    if (r.isError) throw new Error(r.content[0].text);
    return JSON.parse(r.content[0].text);
  } finally { await c.close(); }
}

test('github mock search', async () => {
  const r = await call('github', 'search_repositories', { query: 'mcp' });
  assert.equal(r.mode, 'mock');
  assert.ok(r.data.length > 0 && r.data[0].stars > 0);
});

test('drive mock lists 3 clips and downloads one', { timeout: 60000 }, async () => {
  const r = await call('drive', 'drive_list_files', { only_new: false });
  assert.equal(r.data.length, 3);
  assert.equal((await call('drive', 'drive_download', { file_id: r.data[0].id })).data.path, 'media/work/clip-1.mp4');
});

test('gmail has no send tool and drafts are not sent', async () => {
  const c = new Client({ name: 'test', version: '1' });
  await c.connect(new StdioClientTransport({ command: 'node', args: ['office/src/integrations.ts', 'gmail'], env, stderr: 'ignore' }));
  const names = (await c.listTools()).tools.map(t => t.name);
  await c.close();
  assert.deepEqual(names.sort(), ['gmail_create_draft', 'gmail_read', 'gmail_search']);
  assert.match((await call('gmail', 'gmail_create_draft', { to: 'a@b.c', subject: 's', body: 'b' })).data.status, /not sent/);
});

test('calendar, shop, analytics mocks respond', async () => {
  assert.ok((await call('calendar', 'calendar_free_slots', { days: 3 })).data.length > 0);
  assert.ok((await call('shop', 'shop_list_tickets')).data.length > 0);
  assert.ok((await call('analytics', 'analytics_post_stats')).data.length > 0);
});

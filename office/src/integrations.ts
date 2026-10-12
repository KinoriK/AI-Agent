// External integrations as small MCP servers: `node office/src/integrations.ts <github|drive|calendar|slack|gmail|shop|analytics>`.
// Each runs LIVE when its keys are in the environment/.env, otherwise in MOCK MODE with realistic fake data,
// so the office runs end to end with zero credentials. Only read/draft tools are exposed to agents;
// the `execute()` side (posting, sending, scheduling) is called by the dashboard after the owner approves.
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { DATA, MEDIA } from './paths.ts';
import { createServer } from './mcp.ts';
import { mediaPath, extractMediaPath } from './media.ts';

const run = promisify(execFile);
const KEYS: Record<string, string[]> = {
  github: ['GITHUB_TOKEN'],
  drive: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
  calendar: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
  gmail: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
  slack: ['SLACK_BOT_TOKEN', 'SLACK_CHANNEL'],
  shop: ['SHOP_API_KEY'], // shortcut: shop & analytics are mock-only; add a real adapter when a store/analytics platform is chosen
  analytics: ['ANALYTICS_API_KEY'],
  whisper: ['OPENAI_API_KEY'],
  higgsfield: ['HF_API_KEY'],
};
const LIVE_ADAPTERS = new Set(['github', 'drive', 'calendar', 'gmail', 'slack', 'whisper', 'higgsfield']);
export const isLive = (name: string) => LIVE_ADAPTERS.has(name) && KEYS[name].every(k => process.env[k]);
export const integrationStatus = () => Object.entries(KEYS).map(([name, keys]) => ({
  name, mode: isLive(name) ? 'live' : 'mock', missing: keys.filter(k => !process.env[k]), liveSupported: LIVE_ADAPTERS.has(name),
}));

const day = (offset = 0, hour = 10) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
async function http(url: string, init: RequestInit = {}, as: 'json' | 'text' | 'buffer' = 'json') {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${url} -> ${r.status} ${(await r.text()).slice(0, 300)}`);
  return as === 'json' ? r.json() : as === 'text' ? r.text() : Buffer.from(await r.arrayBuffer());
}
function outbox(entry: object) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.appendFileSync(path.join(DATA, 'outbox.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

// ---------- GitHub ----------
const gh = (p: string, raw = false) => http(`https://api.github.com${p}`, {
  headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'User-Agent': 'agent-hq' },
}, raw ? 'text' : 'json');
const MOCK_REPOS = [
  { full_name: 'lanternlabs/mcp-forge', description: 'Scaffold, test and hot-reload MCP servers in TypeScript or Python', stars: 4820, language: 'TypeScript', created: -9, topics: ['mcp', 'developer-tools'] },
  { full_name: 'quietbyte/localpilot', description: 'Offline coding assistant that runs 7B models on a laptop GPU', stars: 3110, language: 'Rust', created: -14, topics: ['local-llm', 'coding-assistant'] },
  { full_name: 'fernhollow/agent-ledger', description: 'Cost and token accounting for multi-agent systems with per-agent budgets', stars: 2045, language: 'Python', created: -6, topics: ['ai-agents', 'observability'] },
  { full_name: 'tidewater-oss/evalkit', description: 'Snapshot tests for LLM prompts: diff outputs across model versions in CI', stars: 1760, language: 'TypeScript', created: -20, topics: ['llm', 'testing'] },
  { full_name: 'ironmoth/shellsage', description: 'Explains and safety-checks shell commands before an agent runs them', stars: 1390, language: 'Go', created: -4, topics: ['ai-agents', 'security'] },
  { full_name: 'paperkite/ragdoll', description: 'Tiny retrieval pipeline you can read in one sitting (~600 lines)', stars: 980, language: 'Python', created: -11, topics: ['rag', 'llm'] },
  { full_name: 'northgate-dev/promptfs', description: 'Mount prompt libraries as a filesystem with versioning', stars: 640, language: 'Go', created: -3, topics: ['llm', 'developer-tools'] },
  { full_name: 'copperfield/trace-lens', description: 'Visual timeline of tool calls for any MCP client', stars: 455, language: 'TypeScript', created: -2, topics: ['mcp', 'observability'] },
].map(r => ({ ...r, url: `https://github.com/${r.full_name}`, created_at: day(r.created), pushed_at: day(-Math.ceil(Math.random() * 2)), open_issues: Math.round(r.stars / 60) }));

// ---------- Google (Drive, Calendar, Gmail) ----------
let googleToken: { value: string; exp: number } | undefined;
async function google(url: string, init: RequestInit = {}, as: 'json' | 'buffer' = 'json') {
  if (!googleToken || googleToken.exp < Date.now()) {
    const t = await http('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: process.env.GOOGLE_REFRESH_TOKEN!, grant_type: 'refresh_token',
    }) });
    googleToken = { value: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
  }
  return http(url, { ...init, headers: { Authorization: `Bearer ${googleToken.value}`, 'Content-Type': 'application/json', ...init.headers } }, as);
}
const WORK = path.join(MEDIA, 'work');
const MOCK_DRIVE = path.join(MEDIA, 'drive');
const safeName = (n: string) => n.replace(/[^\w.-]+/g, '_').replace(/\.(?=.*\.)/g, '_'); // one dot only: keeps media stems clean
const MOCK_CLIPS = [
  { name: 'clip-1.mp4', src: 'testsrc2=size=1280x720:rate=30', tone: 220, text: 'This tiny tool scaffolds an MCP server in one command. You get hot reload, typed tools and a test harness. I had a working server in under two minutes. Link in the description.' },
  { name: 'clip-2.mp4', src: 'mandelbrot=size=1280x720:rate=30', tone: 330, text: 'Stop paying for tokens you never see. Agent Ledger tracks cost per agent and stops runaway loops before they burn your budget. Here is the dashboard after one week.' },
  { name: 'clip-3.mp4', src: 'life=size=1280x720:rate=30:mold=10:ratio=0.1:death_color=#0b0b0d:life_color=#c9a227', tone: 165, text: 'Before your agent runs a shell command, Shell Sage explains it and flags anything risky. Three seconds of checking saved me from deleting a whole folder.' },
];
async function ensureMockClips() {
  fs.mkdirSync(MOCK_DRIVE, { recursive: true });
  for (const c of MOCK_CLIPS) {
    const f = path.join(MOCK_DRIVE, c.name);
    if (fs.existsSync(f)) continue;
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', c.src, '-f', 'lavfi', '-i', `sine=frequency=${c.tone}:sample_rate=44100`,
      '-t', '18', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f]);
    fs.writeFileSync(f.replace(/\.mp4$/, '.txt'), c.text);
  }
}

// ---------- Gmail ----------
const MOCK_MAIL = [
  { id: 'm1', from: 'Priya Natarajan <partnerships@cobaltcloud.example>', subject: 'Sponsorship: 60s integration in your next short', date: day(0, 8), snippet: 'We would love to sponsor a 60-second segment...', body: 'Hi! We are Cobalt Cloud, a GPU hosting platform for AI developers. We would love to sponsor a 60-second integration in one of your upcoming shorts. Budget is $1,200 flat, 30-day exclusivity in the "AI infrastructure" category, script approval on our side. Could you do it within two weeks?\n\nPriya' },
  { id: 'm2', from: 'Dev Okafor <dev.okafor@example.com>', subject: 'Your MCP video helped me ship', date: day(0, 7), snippet: 'Just wanted to say thanks...', body: 'Just wanted to say thanks - your video on MCP servers got my team unblocked. Any chance you will cover testing MCP servers next?' },
  { id: 'm3', from: 'Growth Rocket <hello@growthrocket.example>', subject: 'Guaranteed 100k followers in 30 days!!!', date: day(-1, 22), snippet: 'Limited offer...', body: 'Buy our growth package for $499 and get 100k followers guaranteed. Reply YES to start today.' },
  { id: 'm4', from: 'Maya Lindqvist <maya@quietbyte.example>', subject: 'Localpilot maintainer here - happy to help', date: day(-1, 15), snippet: 'Saw you might be covering...', body: 'Hi, I maintain Localpilot. If you cover it, I am happy to answer questions or share benchmark numbers. No strings attached.' },
  { id: 'm5', from: 'Ledgerline Billing <billing@ledgerline.example>', subject: 'Invoice #4471 overdue', date: day(-2, 9), snippet: 'Your invoice is 5 days overdue...', body: 'Your invoice #4471 for $39.00 (editing software subscription) is 5 days overdue. Please pay to avoid interruption.' },
  { id: 'm6', from: 'Sam Reyes <sam@brightfoundry.example>', subject: 'Paid series? 3 videos on our devtools', date: day(-3, 11), snippet: 'We are planning a 3-part series...', body: 'We are planning a 3-part sponsored series about our open-source devtools. Offering $4,500 total, no exclusivity, you keep full creative control. Interested?' },
];
const b64url = (s: string) => Buffer.from(s).toString('base64url');
const rfc822 = (d: any) => `To: ${d.to}\r\nSubject: ${d.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${d.body}`;
function partText(p: any): string {
  if (p?.mimeType === 'text/plain' && p.body?.data) return Buffer.from(p.body.data, 'base64url').toString();
  return (p?.parts ?? []).map(partText).find(Boolean) ?? '';
}

// ---------- Shop & Analytics (mock only) ----------
const MOCK_LISTINGS = [
  { id: 'p1', title: 'Noir Desk Mat - Brass Grid', price: 34, stock: 42, views_7d: 1830, sales_7d: 21 },
  { id: 'p2', title: 'Prompt Engineering Field Guide (PDF)', price: 19, stock: null, views_7d: 2410, sales_7d: 64 },
  { id: 'p3', title: '"Ship It" Enamel Pin', price: 9, stock: 3, views_7d: 640, sales_7d: 17 },
];
const MOCK_ORDERS = [
  { id: 'o-1042', item: 'p1', customer: 'J. Moreau', status: 'paid', placed: day(0, 6) },
  { id: 'o-1041', item: 'p3', customer: 'A. Chen', status: 'shipped', placed: day(-1, 13) },
  { id: 'o-1037', item: 'p1', customer: 'R. Patel', status: 'paid', placed: day(-5, 10), note: 'not shipped after 5 days' },
];
const MOCK_TICKETS = [
  { id: 't-88', order: 'o-1037', from: 'R. Patel', text: 'Ordered the desk mat 5 days ago, still no shipping email. Is it on the way?' },
  { id: 't-87', order: null, from: 'L. Brooks', text: 'Does the field guide cover tool use / function calling?' },
];
const MOCK_POSTS = [
  { id: 's1', platform: 'shorts', title: 'MCP server in 2 minutes', hook: 'You can build an MCP server before your coffee cools.', length_s: 48, posted: day(-6, 17), views: 48200, likes: 3100, avg_watch_pct: 71 },
  { id: 's2', platform: 'shorts', title: '5 AI tools you should know', hook: 'Here are five AI tools.', length_s: 58, posted: day(-5, 9), views: 6100, likes: 210, avg_watch_pct: 34 },
  { id: 's3', platform: 'tiktok', title: 'Local LLM on a laptop', hook: 'This laptop runs a 7B model offline. No cloud.', length_s: 44, posted: day(-4, 18), views: 31500, likes: 2400, avg_watch_pct: 66 },
  { id: 's4', platform: 'x', title: 'Thread: agent cost traps', hook: 'Your agent is quietly burning money. 4 traps:', length_s: 0, posted: day(-3, 12), views: 12800, likes: 540, avg_watch_pct: null },
  { id: 's5', platform: 'shorts', title: 'Reviewing an AI repo live', hook: 'Today we look at a repo.', length_s: 75, posted: day(-2, 8), views: 3900, likes: 120, avg_watch_pct: 28 },
];

// ---------- Tools exposed to agents ----------
type ToolDef = { desc: string; shape: z.ZodRawShape; live?: (a: any) => unknown; mock: (a: any) => unknown };
export const TOOLS: Record<string, Record<string, ToolDef>> = {
  github: {
    search_repositories: { desc: 'Search GitHub repositories (GitHub search syntax, e.g. "mcp created:>2026-10-01"). Sorted by stars.',
      shape: { query: z.string(), per_page: z.number().int().default(10) },
      live: async a => (await gh(`/search/repositories?q=${encodeURIComponent(a.query)}&sort=stars&order=desc&per_page=${a.per_page}`)).items
        .map((r: any) => ({ full_name: r.full_name, description: r.description, stars: r.stargazers_count, language: r.language, created_at: r.created_at, pushed_at: r.pushed_at, topics: r.topics, url: r.html_url, open_issues: r.open_issues_count })),
      mock: a => { const words = a.query.toLowerCase().split(/[\s+]+/).filter((w: string) => !w.includes(':'));
        const hits = MOCK_REPOS.filter(r => words.some((w: string) => (r.full_name + r.description + r.topics.join(' ')).toLowerCase().includes(w)));
        return (hits.length ? hits : MOCK_REPOS).slice(0, a.per_page); } },
    get_repo: { desc: 'Repository metadata.', shape: { owner: z.string(), repo: z.string() },
      live: a => gh(`/repos/${a.owner}/${a.repo}`),
      mock: a => MOCK_REPOS.find(r => r.full_name === `${a.owner}/${a.repo}`) ?? (() => { throw new Error('repo not found'); })() },
    get_readme: { desc: 'Repository README as text.', shape: { owner: z.string(), repo: z.string() },
      live: a => gh(`/repos/${a.owner}/${a.repo}/readme`, true),
      mock: a => { const r = MOCK_REPOS.find(x => x.full_name === `${a.owner}/${a.repo}`); if (!r) throw new Error('repo not found');
        return `# ${a.repo}\n\n${r.description}.\n\n## Install\n\n\`\`\`\n${({ Rust: 'cargo install ', Go: 'go install github.com/' + a.owner + '/', Python: 'pip install ' } as any)[r.language] ?? 'npm i '}${a.repo}\n\`\`\`\n\n## Why\n\nBuilt because existing tools were too heavy. ${r.stars} stars in ${-Math.round((Date.parse(r.created_at) - Date.now()) / 864e5)} days.\n\nLicense: MIT`; } },
  },
  drive: {
    drive_list_files: { desc: 'List video files in the shared Drive folder. only_new=true hides clips already downloaded to media/work.',
      shape: { only_new: z.boolean().default(true) },
      live: async a => { const q = `'${process.env.DRIVE_FOLDER_ID ?? 'root'}' in parents and mimeType contains 'video/' and trashed=false`;
        const files = (await google(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&fields=files(id,name,size,createdTime,mimeType)`)).files;
        return files.filter((f: any) => !a.only_new || !fs.existsSync(path.join(WORK, safeName(f.name)))); },
      mock: async a => { await ensureMockClips();
        return MOCK_CLIPS.map((c, i) => ({ id: `mock-${c.name}`, name: c.name, mimeType: 'video/mp4', size: fs.statSync(path.join(MOCK_DRIVE, c.name)).size, createdTime: day(0, 7 + i) }))
          .filter(f => !a.only_new || !fs.existsSync(path.join(WORK, f.name))); } },
    drive_download: { desc: 'Download a Drive file into media/work and return the local path.', shape: { file_id: z.string() },
      live: async a => { const meta = await google(`https://www.googleapis.com/drive/v3/files/${a.file_id}?fields=name`);
        const dst = path.join(WORK, safeName(meta.name)); fs.mkdirSync(WORK, { recursive: true });
        fs.writeFileSync(dst, await google(`https://www.googleapis.com/drive/v3/files/${a.file_id}?alt=media`, {}, 'buffer') as Buffer);
        return { path: path.relative(path.dirname(MEDIA), dst) }; },
      mock: async a => { await ensureMockClips(); const name = String(a.file_id).replace(/^mock-/, '');
        if (!MOCK_CLIPS.some(c => c.name === name)) throw new Error(`no such file ${a.file_id}`);
        fs.mkdirSync(WORK, { recursive: true });
        for (const f of [name, name.replace(/\.mp4$/, '.txt')]) fs.copyFileSync(path.join(MOCK_DRIVE, f), path.join(WORK, f));
        return { path: `media/work/${name}` }; } },
  },
  calendar: {
    calendar_list_events: { desc: 'Upcoming calendar events.', shape: { days: z.number().int().default(7) },
      live: async a => (await google(`https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${new Date().toISOString()}&timeMax=${day(a.days, 23)}`)).items
        .map((e: any) => ({ id: e.id, title: e.summary, start: e.start.dateTime ?? e.start.date, end: e.end.dateTime ?? e.end.date })),
      mock: () => [
        { id: 'e1', title: 'Record: weekly roundup', start: day(1, 10), end: day(1, 12) },
        { id: 'e2', title: 'Publish: MCP testing short', start: day(1, 17), end: day(1, 18) },
        { id: 'e3', title: 'Sponsor call (tentative)', start: day(2, 14), end: day(2, 15) },
      ] },
    calendar_free_slots: { desc: 'Free 30-minute publishing slots between 08:00 and 21:00 in the next N days.', shape: { days: z.number().int().default(3) },
      mock: async a => freeSlots(await TOOLS.calendar.calendar_list_events.mock(a) as any[], a.days),
      live: async a => freeSlots(await TOOLS.calendar.calendar_list_events.live!(a) as any[], a.days) },
  },
  gmail: {
    gmail_search: { desc: 'Search mail (Gmail syntax, e.g. "is:unread newer_than:2d"). Returns id, from, subject, date, snippet.',
      shape: { query: z.string().default('is:unread'), max: z.number().int().default(10) },
      live: async a => { const list = (await google(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(a.query)}&maxResults=${a.max}`)).messages ?? [];
        return Promise.all(list.map(async (m: any) => { const g = await google(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
          const h = (n: string) => g.payload.headers.find((x: any) => x.name === n)?.value;
          return { id: m.id, thread_id: g.threadId, from: h('From'), subject: h('Subject'), date: h('Date'), snippet: g.snippet }; })); },
      mock: a => MOCK_MAIL.slice(0, a.max).map(({ body, ...m }) => m) },
    gmail_read: { desc: 'Read one email in full.', shape: { id: z.string() },
      live: async a => { const g = await google(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${a.id}?format=full`);
        const h = (n: string) => g.payload.headers.find((x: any) => x.name === n)?.value;
        return { id: a.id, thread_id: g.threadId, from: h('From'), subject: h('Subject'), date: h('Date'), body: partText(g.payload) || g.snippet }; },
      mock: a => MOCK_MAIL.find(m => m.id === a.id) ?? (() => { throw new Error('no such message'); })() },
    gmail_create_draft: { desc: 'Save a reply as a Gmail DRAFT (never sent). Also file an approval request (kind "email") so the owner can review it.',
      shape: { to: z.string(), subject: z.string(), body: z.string(), thread_id: z.string().optional() },
      live: async a => { const d = await google('https://gmail.googleapis.com/gmail/v1/users/me/drafts', { method: 'POST', body: JSON.stringify({ message: { raw: b64url(rfc822(a)), threadId: a.thread_id } }) });
        return { draft_id: d.id, status: 'draft saved, not sent' }; },
      mock: a => { outbox({ channel: 'gmail-draft', ...a }); return { draft_id: `mock-draft-${Date.now()}`, status: 'draft saved, not sent (mock)' }; } },
  },
  slack: {
    slack_notify: { desc: 'Send a short internal notification to the owner\'s office channel (fixed channel, internal only).',
      shape: { text: z.string().max(1000) },
      live: a => slackPost(a.text),
      mock: a => { outbox({ channel: 'slack', text: a.text }); return { ok: true, mode: 'mock' }; } },
  },
  shop: {
    shop_list_listings: { desc: 'Product listings with price, stock, 7-day views and sales.', shape: {}, mock: () => MOCK_LISTINGS },
    shop_list_orders: { desc: 'Recent orders.', shape: { status: z.string().optional() }, mock: a => MOCK_ORDERS.filter(o => !a.status || o.status === a.status) },
    shop_list_tickets: { desc: 'Open customer support tickets.', shape: {}, mock: () => MOCK_TICKETS },
  },
  analytics: {
    analytics_post_stats: { desc: 'Per-post stats for the last N days.', shape: { days: z.number().int().default(7) }, mock: () => MOCK_POSTS },
    analytics_channel_summary: { desc: 'Channel totals for the last 7 days.', shape: {},
      mock: () => ({ followers: 18420, followers_7d: 1260, views_7d: MOCK_POSTS.reduce((s, p) => s + p.views, 0), best_post: 's1', worst_post: 's5' }) },
  },
};

function freeSlots(events: { start: string; end: string }[], days: number) {
  const slots: string[] = [];
  for (let d = 0; d <= days && slots.length < 12; d++) for (let h = 8; h < 21; h += 0.5) {
    const s = new Date(day(d, 0)); s.setMinutes(h * 60); const e = new Date(+s + 30 * 60e3);
    if (s > new Date() && !events.some(ev => new Date(ev.start) < e && new Date(ev.end) > s)) slots.push(s.toISOString());
  }
  return slots.filter((_, i) => i % 3 === 0).slice(0, 8);
}

async function slackPost(text: string) {
  const r = await http('https://slack.com/api/chat.postMessage', { method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: process.env.SLACK_CHANNEL, text }) });
  if (!r.ok) throw new Error(`slack: ${r.error}`);
  return { ok: true, ts: r.ts };
}

// ---------- Executor: runs ONLY after the owner approves in the dashboard ----------
export async function execute(a: { id: number; kind: string; title: string; agent?: string; draft: any }): Promise<string> {
  const d = a.draft;
  let result: string;
  if (a.kind === 'purchase' && d.provider === 'higgsfield') {
    result = await (await import('./higgsfield.ts')).executeGeneration(a as any); // lazy: the other MCP servers never open the DB
  } else if ((a.kind === 'post' || a.kind === 'schedule') && isLive('calendar') && d.time) {
    const start = new Date(d.time);
    await google('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', body: JSON.stringify({
      summary: `Publish: ${a.title}`, description: `${d.platform ?? ''}\n\n${d.text ?? JSON.stringify(d, null, 2)}`,
      start: { dateTime: start.toISOString() }, end: { dateTime: new Date(+start + 15 * 60e3).toISOString() } }) });
    result = `scheduled on Google Calendar for ${start.toISOString()} (post it from the calendar reminder; no social platform API is connected)`;
  } else if (a.kind === 'email' && isLive('gmail')) {
    const raw = b64url(rfc822(d));
    if (process.env.GMAIL_ALLOW_SEND === '1') {
      await google('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', body: JSON.stringify({ raw, threadId: d.thread_id }) });
      result = `sent to ${d.to}`;
    } else {
      await google('https://gmail.googleapis.com/gmail/v1/users/me/drafts', { method: 'POST', body: JSON.stringify({ message: { raw, threadId: d.thread_id } }) });
      result = 'approved draft placed in Gmail Drafts (set GMAIL_ALLOW_SEND=1 to send automatically)';
    }
  } else if (a.kind === 'publish') {
    const dir = path.join(MEDIA, 'published', `approval-${a.id}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const k of ['video', 'thumbnail', 'captions'].filter(k => d[k])) {
      const f = extractMediaPath(d[k], `draft.${k}`);
      fs.copyFileSync(mediaPath(f), path.join(dir, path.basename(f)));
    }
    result = `final files copied to ${path.relative(path.dirname(MEDIA), dir)} ready to upload`;
  } else {
    result = 'recorded in data/outbox.jsonl (no live executor for this kind/integration; mock mode)';
  }
  outbox({ channel: 'approved', approval: a.id, kind: a.kind, title: a.title, draft: d, result });
  if (isLive('slack')) await slackPost(`Approved #${a.id}: ${a.title} - ${result}`).catch(() => {});
  return result;
}

// ---------- Entry point ----------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { // argv[1] is unset under node -e
  const name = process.argv[2];
  const tools = TOOLS[name];
  if (!tools) { console.error(`usage: integrations.ts <${Object.keys(TOOLS).join('|')}>`); process.exit(1); }
  const live = isLive(name);
  const { tool, start } = createServer(name);
  for (const [tname, t] of Object.entries(tools)) {
    tool(tname, `${t.desc}${live ? '' : ' [MOCK MODE: fake data]'}`, t.shape, async a => {
      const data = await (live && t.live ? t.live(a) : t.mock(a));
      return live ? data : { mode: 'mock', data };
    });
  }
  console.error(`${name}: ${live ? 'LIVE' : `MOCK MODE (add ${KEYS[name].join(', ')} to .env for live)`}`);
  await start();
}

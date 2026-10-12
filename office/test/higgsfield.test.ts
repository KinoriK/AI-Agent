// Higgsfield client and approval runner against a stubbed fetch (no network, no real key).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-'));
fs.mkdirSync(path.join(tmp, 'media'));
Object.assign(process.env, { AGENT_HQ_ROOT: tmp, OFFICE_DB: path.join(tmp, 'office.db'), HF_API_KEY: 'kid:ksecret', HIGGSFIELD_MAX_USD_PER_DAY: '10' });
delete process.env.HF_API_BASE_URL;
const hf = await import('../src/higgsfield.ts');
const db = await import('../src/db.ts');
Object.assign(hf.POLL, { first: 1, max: 2, timeout: 300 });

type Call = { url: string; method: string; headers: Record<string, string>; body?: any };
let calls: Call[] = [];
let route: (c: Call) => { status?: number; json?: unknown; body?: Buffer; headers?: Record<string, string> } | 'network' = () => ({ json: {} });
globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
  const c: Call = { url: String(url), method: init.method ?? 'GET', headers: { ...(init.headers as any) }, body: init.body };
  calls.push(c);
  const r = route(c);
  if (r === 'network') throw new TypeError('fetch failed');
  return new Response(r.body ?? (r.json === undefined ? null : JSON.stringify(r.json)), { status: r.status ?? 200, headers: r.headers });
}) as any;
const reset = (fn: typeof route) => { calls = []; route = fn; };
const statusCalls = () => calls.filter(c => c.url.endsWith('/status'));
const posts = () => calls.filter(c => c.method === 'POST'); // background pollers from earlier tests may still GET status
let approvalId = 1000;
const t2v = (input: object = { prompt: 'rain on a neon sign', duration: 5, aspect_ratio: '9:16' }) =>
  ({ id: ++approvalId, agent: 'video-editor', draft: { provider: 'higgsfield', model_path: 'kling-video/v3.0/std/text-to-video', input } });

test('submit sends Key auth, JSON body and an Idempotency-Key', async () => {
  reset(() => ({ json: { request_id: 'r1', status: 'queued' } }));
  await hf.submit('bytedance/seedance-2.5/text-to-video', { prompt: 'x' }, 'idem-1');
  const [c] = calls;
  assert.equal(c.url, 'https://api.higgsfield.ai/bytedance/seedance-2.5/text-to-video');
  assert.equal(c.method, 'POST');
  assert.equal(c.headers.Authorization, 'Key kid:ksecret');
  assert.equal(c.headers['Content-Type'], 'application/json');
  assert.equal(c.headers['Idempotency-Key'], 'idem-1');
  assert.deepEqual(JSON.parse(c.body), { prompt: 'x' });
  await assert.rejects(hf.submit('requests/r1/cancel', {}), /not a model path/);
});

for (const final of ['completed', 'failed', 'nsfw', 'canceled']) {
  test(`polling stops on ${final}`, async () => {
    const seq = ['queued', 'in_progress', final];
    reset(c => c.url.startsWith('https://cdn.example') ? { body: Buffer.from('VIDEO'), headers: { 'content-type': 'video/mp4' } }
      : { json: { status: seq.shift() ?? 'queued', video: { url: 'https://cdn.example/v/out.mp4?x=1' }, error: final === 'failed' ? 'boom' : undefined } });
    const g = db.generationCreate({ approval_id: ++approvalId, agent: 'video-editor', model_path: 'm/x', input: {}, status: 'queued', est_usd: 1, mock: false });
    db.generationUpdate(g.id, { request_id: `req-${final}` });
    const done = await hf.watch(g.id);
    assert.equal(done.status, final);
    assert.equal(statusCalls().length, 3);
    assert.match(statusCalls()[0].url, new RegExp(`/requests/req-${final}/status$`));
    if (final === 'completed') {
      assert.equal(done.local_path, `media/out/gen-${approvalId}.mp4`);
      assert.equal(fs.readFileSync(path.join(tmp, done.local_path)).toString(), 'VIDEO');
      assert.equal(calls.at(-1)!.headers.Authorization, undefined, 'no API key sent to the CDN');
    }
    if (final === 'failed') assert.equal(done.error, 'boom');
  });
}

test('cancel POSTs to the cancel endpoint; a started job reports why it cannot cancel', async () => {
  reset(() => ({ status: 202 }));
  const g = db.generationCreate({ approval_id: ++approvalId, agent: 'video-editor', model_path: 'm/x', input: {}, status: 'queued', est_usd: 1, mock: false });
  db.generationUpdate(g.id, { request_id: 'req-c' });
  assert.equal((await hf.cancelGeneration(g.id)).status, 'canceled');
  assert.deepEqual([calls[0].method, calls[0].url], ['POST', 'https://api.higgsfield.ai/requests/req-c/cancel']);
  await assert.rejects(hf.cancelGeneration(g.id), /already canceled/);

  reset(() => ({ status: 400, json: { detail: 'processing' } }));
  const g2 = db.generationCreate({ approval_id: ++approvalId, agent: 'video-editor', model_path: 'm/x', input: {}, status: 'in_progress', est_usd: 1, mock: false });
  db.generationUpdate(g2.id, { request_id: 'req-d' });
  await assert.rejects(hf.cancelGeneration(g2.id), /already started processing/);
});

test('reference upload PUTs with the returned headers and no Authorization', async () => {
  fs.writeFileSync(path.join(tmp, 'media/still.png'), 'PNG');
  reset(c => c.url.endsWith('/files/generate-upload-url')
    ? { json: { upload_url: 'https://storage.example/put?sig=secret', upload_headers: { 'x-amz-tagging': 'a=b' }, public_url: 'https://cdn.example/still.png' } }
    : { status: 200 });
  assert.equal(await hf.uploadReference('media/still.png'), 'https://cdn.example/still.png');
  assert.deepEqual(JSON.parse(calls[0].body), { content_type: 'image/png' });
  const put = calls[1];
  assert.equal(put.method, 'PUT');
  assert.equal(put.headers['x-amz-tagging'], 'a=b');
  assert.equal(put.headers['Content-Type'], 'image/png');
  assert.equal(put.headers.Authorization, undefined);
});

test('approved image-to-video uploads the local still and submits its public URL', async () => {
  reset(c => c.url.endsWith('/files/generate-upload-url') ? { json: { upload_url: 'https://storage.example/put', upload_headers: {}, public_url: 'https://cdn.example/s.png' } }
    : c.method === 'PUT' ? { status: 200 } : c.url.endsWith('/status') ? { json: { status: 'queued' } } : { json: { request_id: 'r-i2v', status: 'queued' } });
  const a = { id: ++approvalId, agent: 'video-editor', draft: { provider: 'higgsfield', model_path: 'kling-video/v3.0-turbo/image-to-video', input: { prompt: 'slow push in', image_url: 'media/still.png', duration: 5 } } };
  assert.match(await hf.executeGeneration(a), /submitted to Higgsfield \(request r-i2v/);
  const sub = calls.find(c => c.url.endsWith('/kling-video/v3.0-turbo/image-to-video'))!;
  assert.equal(JSON.parse(sub.body).image_url, 'https://cdn.example/s.png');
});

test('daily cap blocks before anything is sent', async () => {
  process.env.HIGGSFIELD_MAX_USD_PER_DAY = '0.5';
  try {
    reset(() => ({ json: { request_id: 'never' } }));
    assert.match(await hf.executeGeneration(t2v()), /refused: daily Higgsfield cap \$0.5/);
    assert.equal(posts().length, 0);
    assert.equal(db.generationList({ limit: 1 })[0].status, 'not_submitted');
  } finally { process.env.HIGGSFIELD_MAX_USD_PER_DAY = '10'; }
});

test('the same approval never submits twice', async () => {
  reset(c => c.url.endsWith('/status') ? { json: { status: 'queued' } } : { json: { request_id: 'r-dup', status: 'queued' } });
  const a = t2v();
  await hf.executeGeneration(a);
  await assert.rejects(hf.executeGeneration(a), /already has a generation/);
  assert.equal(posts().length, 1);
});

test('ambiguous submit: one resend with the same Idempotency-Key, then unknown', async () => {
  reset(() => 'network');
  assert.match(await hf.executeGeneration(t2v()), /submit outcome unknown/);
  const [p1, p2, ...rest] = posts();
  assert.equal(rest.length, 0);
  assert.equal(p1.headers['Idempotency-Key'], p2.headers['Idempotency-Key']);
  assert.equal(db.generationList({ limit: 1 })[0].status, 'unknown');
  reset(() => ({ status: 401, json: { detail: 'bad key' } }));
  assert.match(await hf.executeGeneration(t2v()), /not submitted: .*401 \(invalid HF_API_KEY/);
  assert.equal(posts().length, 1, 'a clear rejection is not retried');
});

test('schema validation rejects bad input before an approval is filed', () => {
  const before = db.approvalList().length;
  assert.throws(() => hf.requestGeneration({ agent: 'video-editor', model: 'kling-3.0-turbo-i2v', input: { image_url: 'https://x.example/a.png' }, why: 't' }), /missing required field "prompt"/);
  assert.throws(() => hf.requestGeneration({ agent: 'video-editor', model: 'seedance-2.5-t2v', input: { prompt: 'p', duration: 60, aspect_ratio: '2:1' }, why: 't' }), /duration must be <= 30.*aspect_ratio must be one of/);
  assert.throws(() => hf.requestGeneration({ agent: 'video-editor', model: 'seedance-2.5-r2v', input: { prompt: 'p' }, why: 't' }), /at least one of image_urls/);
  assert.throws(() => hf.requestGeneration({ agent: 'video-editor', model: 'kling-3.0-std-i2v', input: { image_url: '../.env' }, why: 't' }), /media\/\.\.\. file or an https URL/);
  assert.equal(db.approvalList().length, before);
  const ok = hf.requestGeneration({ agent: 'video-editor', model: 'kling-3.0-turbo-i2v', input: { prompt: 'p', image_url: 'media/still.png', duration: 10 }, why: 'hero shot' });
  assert.equal(ok.est_usd, 1.19);
  const a = db.approvalGet(ok.approval_id);
  assert.deepEqual([a.kind, a.draft.provider, a.draft.references[0]], ['purchase', 'higgsfield', 'media/still.png']);
  const unknown = hf.requestGeneration({ agent: 'video-editor', model: 'some-vendor/new-model/text-to-video', input: { prompt: 'p', duration: 5 }, why: 't' });
  assert.equal(unknown.est_usd, 2);
  assert.match(unknown.checks.join(), /basic checks only/);
});

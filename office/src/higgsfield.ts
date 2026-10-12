// Higgsfield generative media: REST client, input checks, cost estimates, and the approval-time runner.
// Agents only reach requestGeneration() (files a purchase approval). Uploading, submitting, polling and cancelling
// happen in the dashboard process after the owner approves. Without HF_API_KEY a local ffmpeg placeholder is made.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as db from './db.ts';
import { MEDIA } from './paths.ts';
import { mediaPath } from './media.ts';
import { MODELS, UNMAPPED_PRICES, type Model } from './higgsfield-models.ts';

const run = promisify(execFile);
const base = () => (process.env.HF_API_BASE_URL ?? 'https://api.higgsfield.ai').replace(/\/+$/, '');
export const isLiveHF = () => !!process.env.HF_API_KEY;
const unknownRate = () => Number(process.env.HIGGSFIELD_UNKNOWN_USD_PER_SEC ?? 0.4);
export const POLL = { first: 2000, max: 15000, timeout: 20 * 60e3 }; // tests shrink these
const ACTIVE = ['submitting', 'queued', 'in_progress'];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------- REST ----------
export class HFError extends Error {
  status?: number; retryAfter?: number;
  constructor(msg: string, status?: number, retryAfter?: number) { super(msg); this.status = status; this.retryAfter = retryAfter; }
}
const HINT: Record<number, string> = {
  401: 'invalid HF_API_KEY: paste the complete key from open.higgsfield.ai/api-keys', 403: 'forbidden or not enough credits',
  422: 'input rejected by the model schema', 429: 'rate/concurrency limit',
};
async function hf(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base() + p, {
    method, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60e3),
    headers: { Authorization: `Key ${process.env.HF_API_KEY}`, 'Content-Type': 'application/json', ...headers },
  });
  const text = await r.text();
  if (!r.ok) throw new HFError(`${method} ${p} -> ${r.status}${HINT[r.status] ? ` (${HINT[r.status]})` : ''} ${text.slice(0, 300)}`.trim(),
    r.status, Number(r.headers.get('retry-after')) || undefined);
  return text ? JSON.parse(text) : {};
}

// Agents choose the path; keep it to a model path so it can never hit /requests or /files.
function checkPath(p: string) {
  if (!/^[a-z0-9][\w.-]*(\/[\w.-]+)+$/i.test(p) || p.includes('..') || /^(requests|files)\//.test(p)) throw new Error(`not a model path: ${p}`);
  return p;
}
export const submit = async (modelPath: string, input: object, idempotencyKey?: string) =>
  hf('POST', `/${checkPath(modelPath)}`, input, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {});
export const status = (requestId: string) => hf('GET', `/requests/${encodeURIComponent(requestId)}/status`);
export const cancel = (requestId: string) => hf('POST', `/requests/${encodeURIComponent(requestId)}/cancel`);

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const typeOf = (p: string) => TYPES[path.extname(p).toLowerCase()] ?? (() => { throw new Error(`unsupported reference type: ${p}`); })();

// Signed-URL upload: the PUT gets only the returned headers (never our API key), and the URL is never logged.
export async function uploadReference(localMediaPath: string) {
  const type = typeOf(localMediaPath);
  const u = await hf('POST', '/files/generate-upload-url', { content_type: type });
  const r = await fetch(u.upload_url, { method: 'PUT', headers: { 'Content-Type': type, ...(u.upload_headers ?? {}) }, body: fs.readFileSync(mediaPath(localMediaPath)) });
  if (!r.ok) throw new Error(`reference upload of ${localMediaPath} failed: HTTP ${r.status}`);
  return u.public_url as string;
}

// ---------- Catalog, validation, cost ----------
export const findModel = (x: string) => MODELS.find(m => m.id === x || m.model_path === x.replace(/^\/+/, ''));
export const catalog = (kind?: string) => ({
  models: MODELS.filter(m => !kind || m.kind === kind).map(m => ({ ...m,
    price: m.usd_per_second ? `$${m.usd_per_second}/s` : m.usd_per_image ? `$${m.usd_per_image}/image` : `price unverified (estimated at $${unknownRate()}/s)` })),
  unmapped_prices_usd_per_second: UNMAPPED_PRICES,
  note: 'No entry is verified against the live docs yet: check `source`. Any other model path from docs.higgsfield.ai can be passed as `model` (basic checks, estimated price).',
});

const isLocal = (v: unknown): v is string => typeof v === 'string' && /^media\//.test(v);
const isRefKey = (k: string) => /_urls?$/.test(k); // only image_url, video_urls, ... carry reference files
const localRefs = (input: Record<string, unknown>) => Object.entries(input).filter(([k]) => isRefKey(k)).flatMap(([, v]) => [v].flat()).filter(isLocal);

export function validate(modelPath: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input must be a JSON object');
  const inp = input as Record<string, any>;
  const model = findModel(modelPath);
  const errors: string[] = [], notes: string[] = [];
  checkPath(model?.model_path ?? modelPath);
  if (!model) notes.push('model not in the catalog: basic checks only, price unverified');
  else {
    if (!model.verified) notes.push(`schema unverified (see ${model.source})`);
    for (const k of model.required) if (inp[k] === undefined || inp[k] === null || inp[k] === '') errors.push(`missing required field "${k}"`);
    if (model.required_one_of && !model.required_one_of.some(k => Array.isArray(inp[k]) && inp[k].length))
      errors.push(`provide at least one of ${model.required_one_of.join(', ')}`);
    for (const [k, v] of Object.entries(inp)) {
      const f = model.fields[k];
      if (!f) { notes.push(`field "${k}" is not in the captured schema`); continue; }
      if (f.enum && !f.enum.includes(v)) errors.push(`${k} must be one of ${f.enum.join(', ')}`);
      if ((f.type === 'integer' && !Number.isInteger(v)) || (f.type === 'number' && typeof v !== 'number') || (f.type === 'boolean' && typeof v !== 'boolean')
        || (f.type === 'string' && typeof v !== 'string') || (f.type === 'array' && !Array.isArray(v))) { errors.push(`${k} must be ${f.type}`); continue; }
      const n = Array.isArray(v) ? v.length : v;
      if (f.min !== undefined && typeof n === 'number' && n < f.min) errors.push(`${k} must be >= ${f.min}`);
      if (f.max !== undefined && typeof n === 'number' && n > f.max) errors.push(`${k} must be <= ${f.max}${Array.isArray(v) ? ' items' : ''}`);
      if (f.maxLength && typeof v === 'string' && v.length > f.maxLength) errors.push(`${k} is longer than ${f.maxLength} characters`);
    }
  }
  if (!Object.keys(inp).length) errors.push('input is empty');
  for (const [k, v] of Object.entries(inp)) for (const x of [v].flat())
    if (isRefKey(k) && typeof x === 'string' && !isLocal(x) && !/^https:\/\//.test(x)) errors.push(`${k}: use a media/... file or an https URL`);
  for (const r of localRefs(inp)) {
    typeOf(r);
    if (!fs.existsSync(mediaPath(r))) errors.push(`reference file not found: ${r}`);
  }
  if (errors.length) throw new Error(`invalid input for ${modelPath}: ${errors.join('; ')}`);
  return { model, notes };
}

export function estimate(model: Model | undefined, input: Record<string, any>) {
  const image = model?.kind === 'text-to-image';
  const units = image ? 1 : Number(input.duration ?? model?.fields.duration?.default ?? 5);
  const rate = image ? model?.usd_per_image : model?.usd_per_second;
  // shortcut: an unpriced image is estimated like one second of unpriced video; add usd_per_image when known.
  return { est_usd: Math.round(units * (rate ?? unknownRate()) * 10000) / 10000, priced: rate !== undefined, seconds: image ? undefined : units };
}

// ---------- Agent side: file the approval (no network) ----------
export function requestGeneration(a: { agent: string; model: string; input: Record<string, any>; why: string; title?: string; task_id?: number }) {
  const model_path = findModel(a.model)?.model_path ?? a.model.replace(/^\/+/, '');
  const { model, notes } = validate(model_path, a.input);
  const est = estimate(model, a.input);
  const draft = {
    provider: 'higgsfield', model: model?.name ?? model_path, model_path, kind: model?.kind ?? 'unknown', input: a.input,
    references: localRefs(a.input), est_usd: est.est_usd, duration: est.seconds,
    price: est.priced ? 'listed price' : `price unverified (estimated at $${unknownRate()}/s)`, checks: notes, why: a.why,
    mode: isLiveHF() ? 'live: approving spends money on Higgsfield' : 'mock: no HF_API_KEY, approving renders a local placeholder',
  };
  const item = db.approvalRequest({ kind: 'purchase', agent: a.agent, title: a.title ?? `AI ${draft.kind}: ${draft.model} (~$${est.est_usd})`, draft, reason: a.why, task_id: a.task_id });
  return { approval_id: item.id, est_usd: est.est_usd, status: 'pending owner approval in the dashboard', checks: notes };
}

// ---------- Owner side: runs only from execute() after Approve ----------
function spentToday(excludeId: number) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  // failed/nsfw are refunded and canceled ones never ran, so they don't count against the cap
  return (db.db.prepare(`SELECT COALESCE(SUM(est_usd),0) AS s FROM generations WHERE mock = 0 AND id != ? AND created_at >= ?
    AND status NOT IN ('not_submitted','failed','nsfw','canceled')`).get(excludeId, d.toISOString()) as any).s as number;
}

export async function executeGeneration(a: { id: number; agent: string; draft: any }): Promise<string> {
  const d = a.draft;
  const { model } = validate(d.model_path, d.input); // the owner may have edited the draft
  const { est_usd, seconds } = estimate(model, d.input);
  const live = isLiveHF();
  const g = db.generationCreate({ approval_id: a.id, agent: a.agent, model_path: d.model_path, input: d.input, status: 'submitting', est_usd, mock: !live, idem_key: crypto.randomUUID() });
  if (!live) {
    void mockRun(g.id, model?.kind === 'text-to-image', String(d.input.aspect_ratio ?? '16:9'), seconds ?? 5);
    return `MOCK (no HF_API_KEY): nothing sent to Higgsfield; rendering a placeholder to media/out/gen-${a.id}.*`;
  }
  const cap = Number(process.env.HIGGSFIELD_MAX_USD_PER_DAY ?? 10), spent = spentToday(g.id);
  if (spent + est_usd > cap) {
    const msg = `refused: daily Higgsfield cap $${cap} would be exceeded ($${spent.toFixed(2)} already today + $${est_usd}). Raise HIGGSFIELD_MAX_USD_PER_DAY or wait until tomorrow.`;
    db.generationUpdate(g.id, { status: 'not_submitted', error: msg });
    return msg;
  }
  let input: Record<string, any>;
  try {
    input = Object.fromEntries(await Promise.all(Object.entries(d.input).map(async ([k, v]) =>
      [k, !isRefKey(k) ? v : Array.isArray(v) ? await Promise.all(v.map(x => isLocal(x) ? uploadReference(x) : x)) : isLocal(v) ? await uploadReference(v) : v])));
  } catch (e: any) {
    db.generationUpdate(g.id, { status: 'not_submitted', error: e.message });
    return `not submitted: ${e.message}`;
  }
  let res: any;
  for (let attempt = 1; !res; attempt++) {
    try { res = await submit(d.model_path, input, g.idem_key); }
    catch (e: any) {
      if (e.status && e.status < 500) { db.generationUpdate(g.id, { status: 'not_submitted', error: e.message }); return `not submitted: ${e.message}`; }
      // Network error/timeout/5xx: it may have been accepted. Docs: a resend with the same Idempotency-Key returns the
      // original request instead of a second (paid) one. Try that once, never a fresh submit.
      if (attempt >= 2) {
        const msg = `submit outcome unknown (${e.message}). Check the Higgsfield dashboard before trying again.`;
        db.generationUpdate(g.id, { status: 'unknown', error: msg });
        return msg;
      }
    }
  }
  if (!res.request_id) {
    const msg = 'Higgsfield answered without a request_id; check the Higgsfield dashboard';
    db.generationUpdate(g.id, { status: 'unknown', error: msg });
    return msg;
  }
  db.generationUpdate(g.id, { request_id: res.request_id, status: res.status ?? 'queued' });
  void watch(g.id);
  return `submitted to Higgsfield (request ${res.request_id}, est $${est_usd}); the result lands in media/out/gen-${a.id}.* when done`;
}

export async function watch(id: number) {
  let wait = POLL.first;
  const deadline = Date.now() + POLL.timeout;
  for (;;) {
    await sleep(wait);
    wait = Math.min(wait * 1.5, POLL.max);
    const g = db.generationGet(id);
    if (!ACTIVE.includes(g.status)) return g; // canceled from the dashboard meanwhile
    if (Date.now() > deadline) return db.generationUpdate(id, { status: 'unknown', error: `still ${g.status} after ${POLL.timeout / 60e3} min of polling; check the Higgsfield dashboard (request ${g.request_id})` });
    let s: any;
    try { s = await status(g.request_id); }
    catch (e: any) {
      if (e.status === 429) { wait = Math.max(wait, (e.retryAfter ?? 0) * 1000); continue; }
      if (e.status && e.status < 500) return db.generationUpdate(id, { status: 'unknown', error: `polling stopped: ${e.message}` });
      continue; // 5xx / network: keep trying until the deadline
    }
    if (s.status === 'completed') return finish(id, s);
    if (['failed', 'nsfw', 'canceled'].includes(s.status)) return db.generationUpdate(id, { status: s.status, error: s.error ?? s.detail ?? s.status });
    if (s.status && s.status !== g.status) db.generationUpdate(id, { status: s.status });
  }
}

// Provider URLs may expire, so keep a local copy in media/out.
async function finish(id: number, s: any) {
  const url = s.video?.url ?? s.images?.[0]?.url;
  if (!url) return db.generationUpdate(id, { status: 'completed', error: 'completed without a media URL' });
  const g = db.generationGet(id);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ext = path.extname(new URL(url).pathname).toLowerCase().match(/^\.(mp4|mov|webm|png|jpe?g|webp)$/)?.[0] ?? (s.video ? '.mp4' : '.png');
    const rel = `media/out/gen-${g.approval_id}${ext}`;
    fs.mkdirSync(path.join(MEDIA, 'out'), { recursive: true });
    fs.writeFileSync(mediaPath(rel), Buffer.from(await r.arrayBuffer()));
    return db.generationUpdate(id, { status: 'completed', result_url: url, local_path: rel, error: null });
  } catch (e: any) {
    return db.generationUpdate(id, { status: 'completed', result_url: url, error: `download failed (${e.message}); the provider URL may expire` });
  }
}

function dims(ar: string) {
  const [w, h] = ar.split(':').map(Number);
  if (!(w > 0 && h > 0)) return [1280, 720];
  const even = (n: number) => Math.round(n / 2) * 2;
  return w >= h ? [even(720 * w / h), 720] : [720, even(720 * h / w)];
}
async function mockRun(id: number, image: boolean, aspect: string, seconds: number) {
  const g = db.generationUpdate(id, { status: 'in_progress', error: 'mock: local placeholder, not a Higgsfield render' });
  const [w, h] = dims(aspect);
  const rel = `media/out/gen-${g.approval_id}.${image ? 'png' : 'mp4'}`;
  fs.mkdirSync(path.join(MEDIA, 'out'), { recursive: true });
  try {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=24`,
      ...(image ? ['-frames:v', '1'] : ['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100', '-t', String(seconds),
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']), mediaPath(rel)]);
    if (ACTIVE.includes(db.generationGet(id).status)) db.generationUpdate(id, { status: 'completed', local_path: rel, error: 'mock: local placeholder, not a Higgsfield render' });
  } catch (e: any) {
    db.generationUpdate(id, { status: 'failed', error: `mock render failed: ${e.message}` });
  }
}

// Dashboard start: pick up anything that was still running when the server stopped.
export function resumeGenerations() {
  for (const g of db.generationList({ limit: 500 }).filter(g => ACTIVE.includes(g.status))) {
    if (g.mock) void mockRun(g.id, findModel(g.model_path)?.kind === 'text-to-image', String(g.input.aspect_ratio ?? '16:9'), Number(g.input.duration ?? 5));
    else if (g.request_id) void watch(g.id);
    else db.generationUpdate(g.id, { status: 'unknown', error: 'the server stopped while submitting; check the Higgsfield dashboard' });
  }
}

const cancelling = new Set<number>();
export async function cancelGeneration(id: number) {
  const g = db.generationGet(id);
  if (!ACTIVE.includes(g.status)) throw new Error(`generation ${id} is already ${g.status}`);
  if (cancelling.has(id)) throw new Error('cancel already in progress');
  cancelling.add(id);
  try {
    if (!g.mock) {
      if (!g.request_id) throw new Error('not submitted yet; try again in a moment');
      try { await cancel(g.request_id); }
      catch (e: any) { throw new Error(e.status === 400 ? 'Higgsfield refused: it has already started processing and can no longer be canceled' : e.message); }
    }
    return db.generationUpdate(id, { status: 'canceled', error: g.mock ? 'canceled by owner (mock)' : 'canceled by owner' });
  } finally { cancelling.delete(id); }
}

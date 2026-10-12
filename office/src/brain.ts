// The shared brain: plain markdown files under /brain, one folder per team plus /brain/company.
import fs from 'node:fs';
import path from 'node:path';
import { BRAIN } from './paths.ts';

// Trust boundary: agent-supplied paths must stay inside /brain.
export function brainPath(rel = '') {
  const p = path.resolve(BRAIN, rel.replace(/^\/?brain\//, '').replace(/^\//, ''));
  if (p !== BRAIN && !p.startsWith(BRAIN + path.sep)) throw new Error(`path escapes the brain: ${rel}`);
  return p;
}

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.md') ? [path.join(dir, d.name)] : []);
const rel = (p: string) => path.relative(BRAIN, p);

export function brainRead(target = '') {
  const p = brainPath(target);
  if (!fs.existsSync(p)) throw new Error(`no such brain entry: ${target}`);
  if (fs.statSync(p).isDirectory()) return { path: rel(p) || '.', files: walk(p).map(rel) };
  return { path: rel(p), content: fs.readFileSync(p, 'utf8') };
}

export function brainWrite(target: string, content: string, agent: string, mode: 'append' | 'overwrite' = 'append') {
  const p = brainPath(target.endsWith('.md') ? target : `${target}.md`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const stamp = `\n\n<!-- ${new Date().toISOString()} · ${agent} -->\n`;
  if (mode === 'overwrite' || !fs.existsSync(p)) fs.writeFileSync(p, content.trimEnd() + stamp);
  else fs.appendFileSync(p, '\n' + content.trimEnd() + stamp);
  return { path: rel(p), bytes: fs.statSync(p).size };
}

export function brainSearch(query: string, folder = '', limit = 30) {
  const q = query.toLowerCase();
  const hits: { path: string; line: number; text: string }[] = [];
  for (const f of walk(brainPath(folder))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((text, i) => {
      if (hits.length < limit && text.toLowerCase().includes(q)) hits.push({ path: rel(f), line: i + 1, text: text.trim() });
    });
  }
  return hits;
}

export function brainRecent(folder = '', limit = 10) {
  return walk(brainPath(folder)).map(f => ({ path: rel(f), mtime: fs.statSync(f).mtime.toISOString() }))
    .sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, limit);
}

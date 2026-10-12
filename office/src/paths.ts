import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const ROOT = process.env.AGENT_HQ_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA = path.join(ROOT, 'data');
export const BRAIN = path.join(ROOT, 'brain');
export const MEDIA = path.join(ROOT, 'media');
export const DB_PATH = process.env.OFFICE_DB ?? path.join(DATA, 'office.db');

// Load .env once (no dependency): KEY=value lines, existing env wins.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

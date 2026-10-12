// "office" MCP server: the shared brain, the task board, the approval queue and the media suite.
import { z } from 'zod';
import * as db from './db.ts';
import { brainRead, brainWrite, brainSearch } from './brain.ts';
import * as media from './media.ts';
import { createServer } from './mcp.ts';

const { tool, start } = createServer('office');
const agent = z.string().describe('Your agent name, e.g. "github-scout"');

// Brain
tool('brain_read', 'Read a brain file (e.g. "company/brand.md") or list a folder (e.g. "research"). Empty path lists everything.',
  { path: z.string().default('') }, a => brainRead(a.path));
tool('brain_write', 'Write findings/decisions to the brain. Use your team folder (e.g. "research/briefing-2026-10-12.md"). Appends by default.',
  { path: z.string(), content: z.string(), agent, mode: z.enum(['append', 'overwrite']).default('append') },
  a => brainWrite(a.path, a.content, a.agent, a.mode));
tool('brain_search', 'Case-insensitive text search across the brain, optionally inside one folder.',
  { query: z.string(), folder: z.string().default('') }, a => brainSearch(a.query, a.folder));

// Task board
const status = z.enum(db.TASK_STATUSES);
tool('task_create', 'Put a task on the board. Use agent = who will do it.',
  { agent, title: z.string(), status: status.default('queued'), parent_id: z.number().int().optional(), notes: z.string().optional() },
  a => db.taskCreate(a));
tool('task_update', 'Update a task: status running/done/failed, output link (file path or brain path), notes.',
  { id: z.number().int(), status: status.optional(), output: z.string().optional(), notes: z.string().optional(), agent: z.string().optional() },
  ({ id, ...patch }) => db.taskUpdate(id, patch));
tool('task_list', 'List tasks, newest first. Filter by team and/or status.',
  { team: z.string().optional(), status: status.optional(), limit: z.number().int().default(30) }, a => db.taskList(a));

// Approval queue (agents can request and list; only the owner decides, in the dashboard)
tool('approval_request', 'Queue an external action for the owner\'s approval. Nothing is sent/posted/bought until they approve it in the dashboard. "draft" must be the EXACT action (full post text + platform + time, full email with to/subject/body, purchase with item/amount, deploy with target/commit, publish with file paths).',
  { kind: z.enum(db.APPROVAL_KINDS), agent, title: z.string(), draft: z.record(z.string(), z.any()), reason: z.string().describe('Why this is proposed'), task_id: z.number().int().optional() },
  a => db.approvalRequest(a));
tool('approval_list', 'List approval items and their status (pending/approved/rejected).',
  { status: z.enum(['pending', 'approved', 'rejected']).optional(), limit: z.number().int().default(30) }, a => db.approvalList(a));

// Media suite (paths are relative to the repo and must be inside media/)
const file = z.string().describe('Path inside media/, e.g. "media/work/clip-1.mp4"');
tool('media_probe', 'Duration, resolution and audio presence of a media file.', { path: file }, a => media.probe(a.path));
tool('media_frame', 'Export a still frame as PNG (default: middle of the clip) so you can look at it with Read.', { input: file, at: z.number().optional() }, a => media.frame(a.input, a.at));
tool('media_cut', 'Rough cut: trim a clip from start (seconds) for duration (seconds). Output goes to media/out.',
  { input: file, start: z.number().default(0), duration: z.number().optional(), out: z.string().optional() }, a => media.cut(a.input, a.start, a.duration, a.out));
tool('media_transcribe', 'Transcribe a clip to an .srt caption file with Whisper (API, local, or mock mode).',
  { input: file, language: z.string().optional().describe('ISO-639-1 code like "en" or "ko" if known; otherwise Whisper guesses') }, a => media.transcribe(a.input, a.language));
tool('media_burn_captions', 'Burn an .srt into the video with ffmpeg in house style.', { input: file, srt: file, out: z.string().optional() }, a => media.burnCaptions(a.input, a.srt, a.out));
tool('media_thumbnail', 'Make a 1280x720 noir-style thumbnail from a frame of the video with a title.',
  { input: file, title: z.string(), at: z.number().optional(), out: z.string().optional() }, a => media.thumbnail(a.input, a.title, a.at, a.out));
tool('media_resize', 'Resize/crop a video to 9x16, 1x1 or 16x9.', { input: file, preset: z.enum(['9x16', '1x1', '16x9']), out: z.string().optional() }, a => media.resize(a.input, a.preset, a.out));
tool('media_music_list', 'List licensed tracks in the office music library with mood tags.', {}, () => media.musicList());
tool('media_add_music', 'Lay a library track under a video (default -18 dB).', { input: file, track: file, volume_db: z.number().default(-18), out: z.string().optional() },
  a => media.addMusic(a.input, a.track, a.volume_db, a.out));

await start();

// Local video pipeline: ffmpeg for cuts/resizing/burn-in, Whisper (API or local CLI) for captions,
// Pillow for thumbnails. No CapCut API exists, so this is the editing suite.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { MEDIA, ROOT } from './paths.ts';

const run = promisify(execFile);
const OUT = path.join(MEDIA, 'out');
const MUSIC = path.join(MEDIA, 'music');

// Trust boundary: agents may only touch files under /media.
export function mediaPath(p: string) {
  const abs = path.resolve(ROOT, p);
  if (!abs.startsWith(MEDIA + path.sep)) throw new Error(`path must be inside media/: ${p}`);
  return abs;
}
// Agents sometimes write "media/out/clip-1.mp4 (vertical, 18 s)" or an absolute path; keep just the media/... part.
export function extractMediaPath(v: unknown, field = 'path') {
  const m = typeof v === 'string' && v.match(/(?:^|\/)(media\/[^\s"'()]+\.[a-z0-9]{2,4})/i);
  if (!m) throw new Error(`${field}: no media/... file path found in ${JSON.stringify(v)}`);
  return m[1];
}
const relOut = (p: string) => path.relative(ROOT, p);
function outFor(input: string, step: string, ext = '.mp4', out?: string) {
  if (out) return mediaPath(out);
  fs.mkdirSync(OUT, { recursive: true });
  const stem = path.basename(input).split('.')[0]; // clip-1.cut.captioned.mp4 -> clip-1
  return path.join(OUT, `${stem}.${step}${ext}`);
}
const ff = (args: string[], cwd?: string) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd, maxBuffer: 1 << 24 });
const ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k'];

export async function probe(p: string) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', mediaPath(p)]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s: any) => s.codec_type === 'video');
  return { path: p, duration: Number(j.format.duration), width: v?.width, height: v?.height, audio: j.streams.some((s: any) => s.codec_type === 'audio') };
}

export async function cut(input: string, start = 0, duration?: number, out?: string) {
  const dst = outFor(input, 'cut', '.mp4', out);
  await ff(['-ss', String(start), '-i', mediaPath(input), ...(duration ? ['-t', String(duration)] : []), ...ENC, '-movflags', '+faststart', dst]);
  return { output: relOut(dst), ...(await probe(relOut(dst))) };
}

const ts = (s: number) => new Date(Math.round(Math.max(0, s) * 1000)).toISOString().slice(11, 23).replace('.', ',');
export function textToSrt(text: string, duration: number, wordsPerCue = 4) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const cues = [];
  for (let i = 0; i < words.length; i += wordsPerCue) cues.push(words.slice(i, i + wordsPerCue).join(' '));
  const step = duration / Math.max(cues.length, 1);
  return cues.map((c, i) => `${i + 1}\n${ts(i * step)} --> ${ts((i + 1) * step - 0.05)}\n${c}\n`).join('\n');
}

// Whisper word timings -> short cues: max 5 words, new cue after a pause > 0.6 s or sentence-ending punctuation.
export function wordsToSrt(words: { word: string; start: number; end: number }[], maxWords = 5) {
  const cues: (typeof words)[] = [];
  let cur: typeof words = [];
  for (const w of words) {
    const prev = cur.at(-1);
    if (prev && (cur.length >= maxWords || w.start - prev.end > 0.6 || /[.?!]$/.test(prev.word.trim()))) { cues.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) cues.push(cur);
  return cues.map((c, i) => `${i + 1}\n${ts(c[0].start)} --> ${ts(c.at(-1)!.end)}\n${c.map(w => w.word.trim()).join(' ')}\n`).join('\n');
}
// Fallback when the API gives no word timings: spread each segment's words evenly over the segment.
const segmentsToSrt = (segs: { start: number; end: number; text: string }[]) => wordsToSrt(segs.flatMap(s => {
  const w = s.text.trim().split(/\s+/).filter(Boolean), step = (s.end - s.start) / Math.max(w.length, 1);
  return w.map((word, i) => ({ word, start: s.start + i * step, end: s.start + (i + 1) * step - 0.05 }));
}));

// Whisper: OpenAI API if OPENAI_API_KEY, else local `whisper` CLI, else MOCK (sidecar transcript .txt).
// language: optional ISO-639-1 hint ("en", "ko") so Whisper doesn't guess wrong on short clips.
export async function transcribe(input: string, language?: string) {
  const src = mediaPath(input);
  const srt = outFor(input, 'captions', '.srt');
  const { duration } = await probe(input);
  let engine: string;
  if (process.env.OPENAI_API_KEY) {
    const audio = srt.replace(/\.srt$/, '.mp3');
    await ff(['-i', src, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audio]);
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(audio)]), 'audio.mp3');
    form.append('model', 'whisper-1');
    // srt format returns short clips as one giant cue; word timings let us build readable cues ourselves.
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    if (language) form.append('language', language);
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
    if (!r.ok) throw new Error(`whisper api ${r.status}: ${await r.text()}`);
    const j = await r.json();
    // whisper-1 strips punctuation from words; borrow it back from the full text when the tokens line up.
    const toks = String(j.text ?? '').trim().split(/\s+/);
    if (j.words?.length === toks.length) j.words.forEach((w: any, i: number) => (w.word = toks[i]));
    fs.writeFileSync(srt, j.words?.length ? wordsToSrt(j.words) : j.segments?.length ? segmentsToSrt(j.segments) : textToSrt(j.text ?? '', duration));
    engine = 'whisper-api';
  } else if (await run('whisper', ['--help']).then(() => true, () => false)) {
    await run('whisper', [src, '--model', process.env.WHISPER_MODEL ?? 'base', '--output_format', 'srt', '--output_dir', path.dirname(srt),
      '--word_timestamps', 'True', '--max_words_per_line', '5', ...(language ? ['--language', language] : [])], { maxBuffer: 1 << 26 });
    fs.renameSync(path.join(path.dirname(srt), path.basename(src).replace(/\.[^.]+$/, '.srt')), srt);
    engine = 'whisper-local';
  } else {
    // Mock clips ship with a transcript; match it by name prefix so clip-3-9x16.mp4 still finds clip-3.txt.
    const name = path.basename(input);
    const sidecar = ['work', 'drive'].flatMap(d => fs.existsSync(path.join(MEDIA, d)) ? fs.readdirSync(path.join(MEDIA, d)).map(f => path.join(MEDIA, d, f)) : [])
      .filter(f => f.endsWith('.txt') && name.startsWith(path.basename(f, '.txt')))
      .sort((a, b) => b.length - a.length)[0];
    const text = sidecar ? fs.readFileSync(sidecar, 'utf8') : 'Mock transcript. Add an OpenAI key or install Whisper for real captions.';
    fs.writeFileSync(srt, textToSrt(text, duration));
    engine = sidecar ? 'mock (pre-written transcript: valid for demo runs, carry on)' : 'mock (placeholder text)';
  }
  return { srt: relOut(srt), engine, text: fs.readFileSync(srt, 'utf8').split('\n').filter(l => l && !/^\d+$/.test(l) && !l.includes('-->')).join(' ') };
}

export async function burnCaptions(input: string, srt: string, out?: string) {
  const dst = outFor(input, 'captioned', '.mp4', out);
  const s = mediaPath(srt);
  // run from the srt's folder so the filter arg needs no path escaping
  const style = 'FontName=DejaVu Sans,Fontsize=11,Bold=1,PrimaryColour=&H0000B0FF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=60';
  await ff(['-i', mediaPath(input), '-vf', `subtitles=${path.basename(s)}:force_style='${style}'`, ...ENC, dst], path.dirname(s));
  return { output: relOut(dst) };
}

// Canva hook: set THUMBNAIL_PROVIDER=canva once a Canva connector exists and implement this.
async function canvaThumbnail(_input: string, _title: string): Promise<string> {
  throw new Error('Canva connector not wired yet; unset THUMBNAIL_PROVIDER to use the local renderer');
}

export async function thumbnail(input: string, title: string, at?: number, out?: string) {
  if (process.env.THUMBNAIL_PROVIDER === 'canva') return { output: await canvaThumbnail(input, title) };
  const dst = outFor(input, 'thumb', '.png', out);
  const frame = dst.replace(/\.png$/, '.frame.png');
  const t = at ?? (await probe(input)).duration / 3;
  await ff(['-ss', String(t), '-i', mediaPath(input), '-frames:v', '1', frame]);
  await run(process.env.PYTHON ?? 'python3', [path.join(ROOT, 'office/scripts/thumbnail.py'), frame, dst, title]);
  fs.rmSync(frame);
  return { output: relOut(dst), size: '1280x720' };
}

// Still frame for visual review (the Read tool can view PNGs).
export async function frame(input: string, at?: number) {
  const dst = outFor(input, `frame${Math.round((at ?? 0) * 10)}`, '.png');
  const t = at ?? (await probe(input)).duration / 2;
  await ff(['-ss', String(t), '-i', mediaPath(input), '-frames:v', '1', '-vf', 'scale=720:-2', dst]);
  return { output: relOut(dst), at: t };
}

const PRESETS: Record<string, [number, number]> = { '9x16': [1080, 1920], '1x1': [1080, 1080], '16x9': [1920, 1080] };
export async function resize(input: string, preset: string, out?: string) {
  const wh = PRESETS[preset];
  if (!wh) throw new Error(`preset must be one of ${Object.keys(PRESETS)}`);
  const dst = outFor(input, `${wh[0]}x${wh[1]}`, '.mp4', out);
  await ff(['-i', mediaPath(input), '-vf', `scale=${wh[0]}:${wh[1]}:force_original_aspect_ratio=increase,crop=${wh[0]}:${wh[1]},setsar=1`, ...ENC, dst]);
  return { output: relOut(dst), width: wh[0], height: wh[1] };
}

// Licensed music library. Ships with three original synth beds generated by ffmpeg; drop real licensed tracks in media/music.
const TRACKS = [
  { id: 'rain-on-brass', mood: 'moody, slow', expr: '0.2*sin(2*PI*110*t)*(0.6+0.4*sin(2*PI*0.25*t))+0.1*sin(2*PI*165*t)' },
  { id: 'midnight-ledger', mood: 'tense, ticking', expr: '0.25*sin(2*PI*220*t)*gt(mod(t,0.5),0.4)+0.12*sin(2*PI*55*t)' },
  { id: 'gold-elevator', mood: 'upbeat, swing', expr: '0.18*sin(2*PI*261.6*t)*(0.5+0.5*sin(2*PI*2*t))+0.12*sin(2*PI*392*t)' },
];
export async function musicList() {
  fs.mkdirSync(MUSIC, { recursive: true });
  for (const t of TRACKS) {
    const f = path.join(MUSIC, `${t.id}.m4a`);
    if (!fs.existsSync(f)) await ff(['-f', 'lavfi', '-i', `aevalsrc='${t.expr}':s=44100:d=90`, '-c:a', 'aac', f]);
  }
  return fs.readdirSync(MUSIC).filter(f => /\.(m4a|mp3|wav)$/.test(f))
    .map(f => ({ track: relOut(path.join(MUSIC, f)), mood: TRACKS.find(t => f.startsWith(t.id))?.mood ?? 'unlabelled', license: 'office library' }));
}

export async function addMusic(input: string, track: string, volumeDb = -18, out?: string) {
  const dst = outFor(input, 'music', '.mp4', out);
  const hasAudio = (await probe(input)).audio;
  const filter = hasAudio
    ? `[1:a]volume=${volumeDb}dB[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]`
    : `[1:a]volume=${volumeDb}dB[a]`;
  await ff(['-i', mediaPath(input), '-i', mediaPath(track), '-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-shortest', '-c:v', 'copy', '-c:a', 'aac', dst]);
  return { output: relOut(dst) };
}

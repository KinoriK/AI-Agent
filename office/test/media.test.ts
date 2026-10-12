// Pipeline check on a mock clip: cut -> transcribe -> burn captions -> thumbnail -> resize -> music.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as m from '../src/media.ts';
import { TOOLS } from '../src/integrations.ts';

test('srt timing', () => {
  const srt = m.textToSrt('one two three four five six seven', 7, 6);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:03,450\none two three four five six\n/);
  assert.match(srt, /2\n00:00:03,500 --> 00:00:06,950\nseven/);
});

test('full clip pipeline', { timeout: 240000 }, async () => {
  delete process.env.OPENAI_API_KEY;
  await TOOLS.drive.drive_download.mock({ file_id: 'mock-clip-2.mp4' });
  const cut = await m.cut('media/work/clip-2.mp4', 1, 8);
  assert.ok(Math.abs(cut.duration - 8) < 0.5);
  const cap = await m.transcribe(cut.output);
  assert.match(cap.text, /Agent Ledger/);
  const vert = await m.resize(cut.output, '9x16');
  const burned = await m.burnCaptions(vert.output, cap.srt);
  const thumb = await m.thumbnail(cut.output, 'Stop burning tokens');
  const p = await m.probe(burned.output);
  assert.deepEqual([p.width, p.height], [1080, 1920]);
  assert.ok(fs.statSync(thumb.output).size > 10000);
  const [track] = await m.musicList();
  assert.ok((await m.probe((await m.addMusic(burned.output, track.track)).output)).audio);
});

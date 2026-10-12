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

test('word timings -> short cues', () => {
  const w = (word: string, start: number) => ({ word, start, end: start + 0.3 });
  const srt = m.wordsToSrt([w('one', 0), w('two', 0.4), w('three', 0.8), w('four', 1.2), w('five', 1.6), w('six', 2), // 5-word cap
    w('seven.', 2.4), w('eight', 2.8), // sentence end
    w('nine', 4)]); // pause > 0.6 s
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:01,900\none two three four five\n\n2\n00:00:02,000 --> 00:00:02,700\nsix seven.\n\n'
    + '3\n00:00:02,800 --> 00:00:03,100\neight\n\n4\n00:00:04,000 --> 00:00:04,300\nnine\n');
});

test('media path from a chatty draft field', () => {
  assert.equal(m.extractMediaPath('media/out/clip-1.mp4 (vertical, 18 s)'), 'media/out/clip-1.mp4');
  assert.equal(m.extractMediaPath('/Users/me/AI-Agent/media/out/clip-1.thumb.png'), 'media/out/clip-1.thumb.png');
  assert.throws(() => m.extractMediaPath('see above', 'draft.video'), /draft\.video/);
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

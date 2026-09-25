// Encodes every hero clip listed in src/config/hero.ts at every quality tier, into
// src/assets/hero/<slug>-<height>.mp4. Rerun it whenever a clip or tier changes:
//
//   npm run hero:encode
//
// Files in that folder that the config no longer asks for are deleted, so the folder
// always matches the config exactly. Needs ffmpeg on PATH, and Node 23.6 or newer to
// read the .ts config directly.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { heroClips, heroSourceFolder, heroTiers } from '../src/config/hero.ts';

const outFolder = resolve('src/assets/hero');
const sourceFolder = resolve(heroSourceFolder);
mkdirSync(outFolder, { recursive: true });

const wanted = new Set();
const mb = (bytes) => (bytes / 1048576).toFixed(2).padStart(6) + ' MB';

for (const [slug, { file, start, end, crop }] of Object.entries(heroClips)) {
  const input = resolve(sourceFolder, file);
  if (!existsSync(input)) {
    console.error(`${slug}: no such file ${input}`);
    process.exit(1);
  }

  // A cut is taken before decoding starts, which is fast, and still frame accurate
  // because the clip is re-encoded rather than copied.
  const cut = [];
  if (start !== undefined) cut.push('-ss', String(start));
  if (end !== undefined) cut.push('-t', String(end - (start ?? 0)));

  // Cropped first, so each tier's scale sizes what's left rather than the whole frame.
  const cropFilter = crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` : '';

  const sizes = [];
  for (const { height, kbps } of heroTiers) {
    const output = resolve(outFolder, `${slug}-${height}.mp4`);
    wanted.add(output);

    execFileSync(
      'ffmpeg',
      [
        '-y', '-loglevel', 'error',
        ...cut,
        '-i', input,
        // CRF picks the quality, and maxrate caps the bitrate so no clip in a tier is
        // greedier than the ceiling the hero's speed check assumes. bufsize is two
        // seconds' worth, the window that cap is measured over.
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
        '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`,
        '-vf', `${cropFilter}scale=-2:${height}`,
        '-pix_fmt', 'yuv420p',
        // Muted in the hero, so the audio would only be weight.
        '-an',
        // The index at the front, so playback can begin before the download ends.
        '-movflags', '+faststart',
        output,
      ],
      { stdio: 'inherit' }
    );
    sizes.push(`${height}p ${mb(statSync(output).size)}`);
  }
  console.log(`${slug.padEnd(24)} ${sizes.join('   ')}`);
}

for (const name of readdirSync(outFolder)) {
  const path = resolve(outFolder, name);
  if (name.endsWith('.mp4') && !wanted.has(path)) {
    rmSync(path);
    console.log(`removed ${name}, no longer in the config`);
  }
}

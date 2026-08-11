// Turns a GIF (or any video) into the small MP4 the portfolio grid uses for hover
// previews, and drops it next to the game's markdown.
//
//   npm run preview:make -- "C:/path/to/clip.gif" cursed-blight
//
// GIF is a terrible format for this: no interframe compression and 256 colours, so a
// 5 second clip runs about 30 MB. The same clip as h264 is under 1 MB and decodes on
// the GPU. Needs ffmpeg on PATH.

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const [input, slug] = process.argv.slice(2);

if (!input || !slug) {
  console.error('usage: npm run preview:make -- <input file> <game-slug>');
  process.exit(1);
}
if (!existsSync(input)) {
  console.error(`no such file: ${input}`);
  process.exit(1);
}

const markdown = resolve('src/content/games', `${slug}.md`);
if (!existsSync(markdown)) {
  console.error(`no game called "${slug}" (expected ${markdown})`);
  process.exit(1);
}

const output = resolve('src/content/games', `${slug}.mp4`);

// 854 wide is roughly 2x the size a card is displayed at, so it stays sharp on a
// retina screen without paying for full HD. CRF 26 is a good quality/size balance;
// lower is better looking and bigger.
execFileSync(
  'ffmpeg',
  [
    '-y', '-loglevel', 'error',
    '-i', input,
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=854:-2',
    '-c:v', 'libx264',
    '-crf', '26',
    '-an',
    output,
  ],
  { stdio: 'inherit' }
);

const before = statSync(input).size;
const after = statSync(output).size;
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
console.log(`${slug}.mp4  ${mb(before)} -> ${mb(after)}`);
console.log('Done. The card will use it automatically; nothing to add to the markdown.');

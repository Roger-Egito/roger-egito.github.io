/**
 * Captures the hero as the image a shared link shows (WhatsApp, LinkedIn, Discord…).
 *
 *   npm run dev            # in one terminal
 *   npm run og:capture     # in another
 *
 *   npm run og:capture -- --game "Prison Break" --at 2.5
 *
 * It's a real screenshot of the real hero rather than a drawing of it, so the preview
 * always matches the page: same name, same title, same type, over a real frame of one
 * of the games. Run it again whenever the hero changes and commit the new file.
 *
 * How: opens the running site in headless Chrome at 1200x630, the size every major
 * preview crops to, drawn at 2x and scaled down so the type comes out sharp. Hides the
 * parts that only exist in development or only make sense live (Astro's dev toolbar,
 * the scrollbar, the scroll arrow), steps the reel to the chosen game with the hero's
 * own "next" button, freezes the clip at the chosen second, and saves the frame to
 * src/assets/og-preview.jpg, which index.astro hands to Head.
 *
 * Needs Chrome or Edge installed. Set CHROME_PATH if yours isn't in a standard place.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : fallback;
};

/** Matched against the hero's credit line, so any part of the game's name works. */
const game = arg('game', 'Cursed Blight');
/** Seconds into that game's clip. */
const at = Number(arg('at', '3'));
const url = arg('url', 'http://localhost:4321/');
const port = Number(arg('port', '9399'));

const out = fileURLToPath(new URL('../src/assets/og-preview.jpg', import.meta.url));

const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((path) => path && existsSync(path));

if (!chrome) {
  console.error('No Chrome or Edge found. Set CHROME_PATH to its executable.');
  process.exit(1);
}

try {
  await fetch(url);
} catch {
  console.error(`Nothing is answering at ${url}. Start the site with "npm run dev" first.`);
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'og-capture-'));
const browser = spawn(chrome, [
  '--headless=new',
  // The reel is muted video, but headless Chrome still wants permission to start it.
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  'about:blank',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  let target;
  for (let tries = 0; tries < 50 && !target; tries++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = pages.find((page) => page.type === 'page');
    } catch {
      // Chrome hasn't opened its debugging port yet.
    }
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('Chrome started but never opened its debugging port.');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));

  let nextId = 0;
  const waiting = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      waiting.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  const run = async (expression) => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.result.exceptionDetails) throw new Error(reply.result.exceptionDetails.text);
    return reply.result.result.value;
  };

  // 2x, so the reel picks its sharpest clip and the type is drawn at double detail
  // before the screenshot scales it back down to 1200x630.
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1200,
    height: 630,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await send('Page.navigate', { url });
  await sleep(4000);

  await run(`(() => {
    const style = document.createElement('style');
    style.textContent = 'astro-dev-toolbar, .scroll-cue { display: none !important } html { scrollbar-width: none }';
    document.head.append(style);
  })()`);

  // Step the reel with its own button until the credit line names the game.
  const want = game.toLowerCase();
  let credit = '';
  for (let step = 0; step < 12; step++) {
    credit = await run(`document.querySelector('[data-hero-credit]')?.textContent.trim() ?? ''`);
    if (credit.toLowerCase().includes(want)) break;
    await run(`document.querySelector('[data-pad="next"]').click()`);
    await sleep(1500);
  }
  if (!credit.toLowerCase().includes(want)) {
    throw new Error(`No game in the hero matches "${game}". Last credit line: "${credit}".`);
  }

  // Let the crossfade finish, then freeze the visible clip on the chosen second.
  await sleep(1500);
  await run(`(async () => {
    const video = [...document.querySelectorAll('.reel video')]
      .find((v) => getComputedStyle(v).opacity === '1');
    if (!video) throw new Error('No clip is showing.');
    video.pause();
    video.currentTime = ${at};
    await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
  })()`);
  await sleep(300);

  // A seek near the end of a clip makes the reel start its handover to the next game,
  // and the frame would then be the wrong game under a credit line read a moment ago.
  // So look again, after the seek, and refuse to save if it moved on.
  const after = await run(`document.querySelector('[data-hero-credit]')?.textContent.trim() ?? ''`);
  if (!after.toLowerCase().includes(want)) {
    throw new Error(
      `At ${at}s the reel had already moved on to "${after}". Pick an earlier second.`
    );
  }

  const shot = await send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 88,
    // 0.5 against the 2x page: back to 1200x630, downsampled from the sharp render.
    clip: { x: 0, y: 0, width: 1200, height: 630, scale: 0.5 },
  });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log(`Saved ${out}`);
  console.log(`  ${credit}, at ${at}s`);

  socket.close();
} finally {
  browser.kill();
  // Chrome keeps the profile locked for a moment after it's told to quit.
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}

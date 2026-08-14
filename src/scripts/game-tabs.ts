/**
 * The Game / Video / Cover switch inside a portfolio entry.
 *
 * An entry gets a tab per thing there is to look at, and the served HTML already shows
 * one of them — this only moves between them. Which is showing lives in data-shown on
 * the group, so the CSS decides what's visible and this file only says what the state
 * is.
 *
 * Switching away from a panel stops whatever was running in it:
 *
 *   away from Video -> the trailer is told to pause over postMessage
 *   away from Game  -> the game panel stops being rendered, and the browser stops
 *                      firing requestAnimationFrame inside a frame it isn't rendering,
 *                      which is what actually halts a WebGL build's loop
 *
 * Neither frame is same-origin, so that's as much control as we get: we can't call
 * into an itch.io build directly. Dropping the frame is the only real stop, which is
 * why closing asks first.
 */

import { setFrameSrc } from './frames';

type Tab = 'game' | 'video' | 'cover';

const YOUTUBE_PAUSE = JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' });

/** Matches the media query in GameDetails.astro. Below it, no build is ever fetched. */
const desktop = matchMedia('(min-width: 48rem)');

const groupsIn = (scope: ParentNode) =>
  scope.querySelectorAll<HTMLElement>('[data-media-group]');

const gamePanel = (scope: ParentNode) => scope.querySelector<HTMLElement>('.game-panel');

const gameFrame = (scope: ParentNode) =>
  scope.querySelector<HTMLIFrameElement>('iframe[data-game-src]');

const videoFrame = (scope: ParentNode) =>
  scope.querySelector<HTMLIFrameElement>('iframe[data-video]');

/** True once someone has actually started a build in this scope. */
export function isGameLoaded(scope: ParentNode) {
  return !!gameFrame(scope)?.getAttribute('src');
}

export function select(group: HTMLElement, name: Tab) {
  group.dataset.shown = name;
  delete group.dataset.paused;

  for (const tab of group.querySelectorAll<HTMLElement>('[data-tab]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  }

  const video = videoFrame(group);
  if (!video) return;

  // The trailer waits for its own tab, so nine YouTube players don't load on a page
  // showing nine games. Once it exists it only ever gets paused, never dropped, so
  // coming back to it doesn't start over.
  if (name === 'video') {
    if (!video.getAttribute('src') && video.dataset.video) {
      setFrameSrc(video, video.dataset.video);
    }
  } else if (video.getAttribute('src')) {
    video.contentWindow?.postMessage(YOUTUBE_PAUSE, '*');
  }
}

/**
 * The tab an entry opens on: the build on a desktop, otherwise whatever the page was
 * served showing. Games are what the portfolio is for, so they lead — but a phone has
 * neither the input devices nor the connection for one, and never sees the tab at all.
 */
export function showDefault(scope: ParentNode) {
  for (const group of groupsIn(scope)) openGroup(group);
}

function openGroup(group: HTMLElement) {
  if (gamePanel(group) && desktop.matches) return select(group, 'game');
  select(group, fallbackFor(group));
}

/** Where an entry goes when the build isn't on offer. */
const fallbackFor = (group: HTMLElement): Tab => (videoFrame(group) ? 'video' : 'cover');

// Narrow the window far enough and the Game tab goes away, taking the only visible
// panel with it and leaving a gap where the media was. Anything sitting on that tab
// gets moved along. Widening again doesn't drag you back into a game you'd left.
desktop.addEventListener('change', () => {
  if (desktop.matches) return;
  for (const group of groupsIn(document)) {
    if (group.dataset.shown === 'game') select(group, fallbackFor(group));
  }
});

/**
 * Freezes a running build without losing it — the same trick switching tabs uses, but
 * hiding only the frame so the panel keeps its size and nothing jumps around. Used
 * while "Close the game?" is up, so the game isn't playing on behind the question.
 */
export function pauseGame(scope: ParentNode) {
  for (const group of groupsIn(scope)) {
    if (group.dataset.shown === 'game' && isGameLoaded(group)) group.dataset.paused = '';
  }
}

export function resumeGame(scope: ParentNode) {
  for (const group of groupsIn(scope)) delete group.dataset.paused;
}

/** Drops both frames. The only way to genuinely stop a cross-origin iframe. */
export function unloadMedia(scope: ParentNode) {
  for (const frame of scope.querySelectorAll<HTMLIFrameElement>(
    'iframe[data-game-src], iframe[data-video]'
  )) {
    if (frame.getAttribute('src')) setFrameSrc(frame, null);
  }
}

/**
 * itch hands a build a fixed pixel size and leaves it there, so a frame narrower than
 * that crops the game rather than shrinking it. The frame is laid out at the build's
 * real size and scaled to whatever room the panel has.
 */
function fit(panel: HTMLElement) {
  const width = parseFloat(panel.style.getPropertyValue('--game-w'));
  if (!width || !panel.clientWidth) return; // hidden panels measure zero
  panel.style.setProperty('--game-scale', String(panel.clientWidth / width));
}

const watchSize = new ResizeObserver((entries) => {
  for (const entry of entries) fit(entry.target as HTMLElement);
});

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;

  const panel = target?.closest<HTMLElement>('[data-play]')?.closest('.game-panel');
  if (panel) {
    const frame = gameFrame(panel);
    if (frame?.dataset.gameSrc) setFrameSrc(frame, frame.dataset.gameSrc);
    return;
  }

  const tab = target?.closest<HTMLElement>('[data-tab]');
  const group = tab?.closest<HTMLElement>('[data-media-group]');
  if (tab && group) select(group, (tab.dataset.tab ?? 'cover') as Tab);
});

for (const panel of document.querySelectorAll<HTMLElement>('.game-panel')) {
  watchSize.observe(panel);
}

// A game's own page shows its entry straight away. Copies living inside a dialog are
// left alone until modal.ts opens one, so the homepage stays cheap.
for (const group of groupsIn(document)) {
  if (!group.closest('dialog')) openGroup(group);
}

/**
 * The clips that play behind the hero, and the quality tiers each one comes in.
 *
 * Swapping a clip: point its entry at the new file, then run
 *
 *     npm run hero:encode
 *
 * which writes every tier to src/assets/hero/. The build fails if a clip listed here is
 * missing a tier, so a forgotten encode can't ship as a blank hero.
 *
 * This file is also imported by scripts/encode-hero.mjs, which runs it straight
 * through Node, so it has to stay plain data with no imports of its own.
 */

/**
 * Every clip is encoded at each of these. The hero picks one per clip from the screen
 * size and how fast the visitor's downloads are going (see src/scripts/hero-quality.ts).
 *
 * `kbps` is the bitrate ceiling the encoder holds each tier to, and it's what makes the
 * speed check dependable. It isn't a hard per-second limit: short bursts can run over
 * it, and the encoder only promises that a player downloading at the ceiling won't run
 * dry if it starts a little ahead. Measured on every clip at exactly its ceiling, the
 * longest head start any of them needs is under a second, and the hero starts
 * downloading each clip six seconds before it plays.
 */
export const heroTiers = [
  { height: 480, kbps: 1000 },
  { height: 720, kbps: 2500 },
  { height: 1080, kbps: 5000 },
] as const;

/**
 * Where the source videos live, relative to the project folder. Outside the repo on
 * purpose: the originals run to hundreds of MB and would sit in git history forever.
 */
export const heroSourceFolder = '../videos-to-convert';

/**
 * One entry per game in the hero, keyed by its slug. `file` is inside heroSourceFolder.
 * `start` and `end` are in seconds and cut a stretch out of a longer video, so a full
 * trailer can be the source without trimming it by hand first. Leave them off to use
 * the whole file.
 *
 * `crop` cuts a rectangle out of each frame, in the source's own pixels, before it's
 * scaled. It's for footage with black bars baked into the picture, like a 4:3 game
 * recorded into a 16:9 video. Cropping those to 16:9 lets the game fill the hero
 * instead of showing the bars.
 *
 * `hold` repeats the clip's last frame for that many seconds. The reel starts fading to
 * the next clip 1.2 seconds before the end (HANDOVER_AT in hero-reel.ts), so a clip
 * whose good part ends right before a cut can hold its last frame through the fade
 * instead of fading out over whatever comes after the cut.
 *
 * A game left out of this list simply doesn't appear in the hero. Its card is
 * unaffected.
 */
export const heroClips: Record<
  string,
  {
    file: string;
    start?: number;
    end?: number;
    crop?: { width: number; height: number; x: number; y: number };
    hold?: number;
  }
> = {
  'all-stars-merge': { file: 'all-stars-merge.mp4', end: 3.8 },
  'blinc-requiem': { file: 'blinc-requiem-miniature.mp4', end: 4.4, hold: 1.2 },
  'cursed-blight': { file: 'cursed-blight-trailer.mp4', start: 30, end: 37 },
  'hotel-77': { file: 'hotel-77.mp4', end: 7.8 },
  'memories-of-war': { file: 'memories-of-war.mp4', end: 5.8 },
  'prison-break': { file: 'prison-break.mp4' },
};

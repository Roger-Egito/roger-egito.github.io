/**
 * Picks the quality each hero clip is downloaded at.
 *
 * Three inputs, in the order they arrive:
 *
 *   - the screen. Never more pixels than the footage is actually shown at, so a small
 *     window doesn't download 1080p it can't display.
 *   - the browser's own speed estimate, where there is one. Only Chromium browsers have
 *     it (not Firefox, not Safari, not any iPhone browser), so it's a head start for
 *     the first clip, before anything has been measured, and nothing more.
 *   - our own measurements. Every clip the reel downloads is timed, and that decides
 *     the next one. This works in every browser, and it costs nothing extra because
 *     the clips were being downloaded anyway.
 *
 * Plus a safety net: a clip that stalls drops the next one a tier.
 *
 * With nothing to go on, the answer is the best the screen can show. Most connections
 * carry it easily, and a slow one is found out on the first clip.
 */

export interface Tier {
  height: number;
  /** The bitrate ceiling the tier was encoded to. See src/config/hero.ts. */
  kbps: number;
}

export interface Source extends Tier {
  src: string;
  bytes: number;
}

/**
 * How much faster than a tier's ceiling a connection has to measure before it gets that
 * tier. The margin covers a speed that was measured on a single clip and could have been
 * a good moment on an unsteady connection.
 */
const HEADROOM = 1.5;

type Connection = { effectiveType?: string; downlink?: number };
const connection = (navigator as { connection?: Connection }).connection;

/** `tiers` sorted from smallest to largest, the same order every clip's sources use. */
export function createQuality(reel: HTMLElement, tiers: Tier[]) {
  /** The best tier a connection this fast can hold. Never below the smallest. */
  const fitting = (kbps: number) =>
    tiers.reduce((best, tier, index) => (tier.kbps * HEADROOM <= kbps ? index : best), 0);

  /**
   * The smallest tier that still covers the footage's size on screen. The reel uses
   * object-fit: cover, so 16:9 footage is drawn at whichever is taller: the box, or the
   * box's width at 16:9. Times the pixel ratio, since a phone draws three pixels for
   * every CSS pixel.
   */
  const screenCap = () => {
    const { width, height } = reel.getBoundingClientRect();
    const shown = Math.max(height, (width * 9) / 16) * devicePixelRatio;
    const index = tiers.findIndex((tier) => tier.height >= shown);
    return index === -1 ? tiers.length - 1 : index;
  };

  // Infinity means "as high as the screen allows", the default with nothing to go on.
  let level = Infinity;
  if (connection?.effectiveType && ['slow-2g', '2g', '3g'].includes(connection.effectiveType)) {
    level = 0;
  } else if (connection?.downlink) {
    level = fitting(connection.downlink * 1000);
  }

  const current = () => Math.min(level, screenCap());

  return {
    /** The source to download for the next clip. */
    pick: (sources: Source[]) => sources[current()],

    /** A clip finished downloading at this speed. It decides the next clip, up or down. */
    measured(kbps: number) {
      level = fitting(kbps);
    },

    /** Playback had to wait for data. One tier down from what was playing. */
    stalled() {
      level = Math.max(0, current() - 1);
    },
  };
}

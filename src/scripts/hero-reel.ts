/**
 * Plays the game clips behind the hero, one after another, forever.
 *
 * Two <video> elements take turns. One is on screen; the other quietly loads the clip
 * that's coming up and is faded in over the top just before the current one runs out,
 * so there's never a black frame or a stall between games. Then they swap roles.
 *
 * Which clip is next comes from a shuffled queue rather than a fresh random pick, so
 * every game gets shown once before any of them comes round again — and the shuffle
 * won't hand you the same clip twice across the seam between two passes.
 *
 * What it deliberately doesn't do:
 *
 *   - download anything up front. The still banner is the poster, and the first clip
 *     is only fetched once we know the hero is actually on screen
 *   - hold more than two clips at a time. The next one is fetched a few seconds before
 *     it's needed, not at the start
 *   - keep running once you've scrolled past, or once the tab is in the background
 *   - run at all for someone who asked for less motion, or who's on a metered
 *     connection — they keep the still, and nothing is downloaded
 */

/** Seconds left on the current clip when the next one starts downloading. */
const PRELOAD_AT = 6;

/** Seconds left when the next clip starts playing and the fade begins. */
const HANDOVER_AT = 1.2;

/**
 * Longest a game stays on screen. The clips run from five seconds to twenty-one, so
 * without a cap the reel would sit on one game three times as long as another. Short
 * clips still just play out; nothing is padded.
 */
const MAX_SHOWTIME = 10;

/** Must match the opacity transition on .clip in Header.astro. */
const FADE_MS = 1000;

const reel = document.querySelector<HTMLElement>('[data-reel]');
const wantsLessMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Chrome and friends expose this when the visitor has data saver on. It's the closest
// thing to being told "don't spend my bandwidth on decoration".
const savingData =
  (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true;

if (reel && !wantsLessMotion && !savingData) run(reel);

function run(reel: HTMLElement) {
  const clips: string[] = JSON.parse(reel.dataset.clips ?? '[]');
  const [a, b] = reel.querySelectorAll('video');
  if (!clips.length || !a || !b) return;

  // Nothing to rotate through, so just loop the one clip.
  if (clips.length === 1) {
    a.loop = true;
    startWhenVisible(reel, () => begin(a, clips[0]));
    return;
  }

  let front = a;
  let back = b;

  /** Indices still to be shown this time round. */
  let queue: number[] = [];
  let showing = -1;
  let queued = -1; // index currently loaded into `back`
  let handedOver = false;
  let onScreen = false;

  const take = () => {
    if (!queue.length) queue = shuffle(clips.length, showing);
    return queue.shift() as number;
  };

  /** Fetch the next clip, a little ahead of needing it. */
  const prime = () => {
    if (queued !== -1) return;
    queued = take();
    back.src = clips[queued];
    back.load();
  };

  /** Bring the loaded clip up over the one that's ending. */
  const handover = () => {
    if (handedOver) return;
    prime(); // a clip shorter than PRELOAD_AT never got the chance
    handedOver = true;

    const outgoing = front;
    back
      .play()
      .then(() => {
        back.dataset.active = '';
        delete outgoing.dataset.active;
      })
      .catch(() => {
        // Couldn't start, so stay on the clip we have and try again next time round.
        handedOver = false;
        queued = -1;
      });

    // Hand the roles over once the fade has finished, so the old clip keeps rendering
    // until it's genuinely invisible.
    window.setTimeout(() => {
      if (!handedOver) return;
      outgoing.pause();
      outgoing.currentTime = 0;
      [front, back] = [back, outgoing];
      showing = queued;
      queued = -1;
      handedOver = false;
    }, FADE_MS);
  };

  for (const clip of [a, b]) {
    clip.addEventListener('timeupdate', () => {
      if (clip !== front || !onScreen) return;
      if (!Number.isFinite(clip.duration)) return;

      // A game's turn ends when its clip runs out or when it's had its ten seconds,
      // whichever comes first.
      const left = Math.min(clip.duration, MAX_SHOWTIME) - clip.currentTime;

      if (left <= PRELOAD_AT) prime();
      if (left <= HANDOVER_AT) handover();
    });

    // Safety net: timeupdate stops firing if a clip is cut short or stalls at the end.
    clip.addEventListener('ended', () => clip === front && handover());
  }

  startWhenVisible(reel, (visible) => {
    onScreen = visible;
    if (!visible) {
      a.pause();
      b.pause();
      return;
    }
    if (!front.getAttribute('src')) {
      showing = take();
      begin(front, clips[showing]);
    } else {
      front.play().catch(() => {});
    }
  });
}

/** Load a clip and only fade it in once it's really playing, so no black frame shows. */
function begin(video: HTMLVideoElement, src: string) {
  video.src = src;
  video
    .play()
    .then(() => {
      video.dataset.active = '';
    })
    .catch(() => {
      // Autoplay refused. The still banner is already behind us, so leave it be.
    });
}

/**
 * Runs the callback when the hero comes into view and again when it leaves, and treats
 * a backgrounded tab as "gone" so nothing decodes while nobody's looking.
 */
function startWhenVisible(el: Element, onChange: (visible: boolean) => void) {
  let inView = false;

  const settle = () => onChange(inView && !document.hidden);

  new IntersectionObserver((entries) => {
    inView = entries[entries.length - 1].isIntersecting;
    settle();
  }).observe(el);

  document.addEventListener('visibilitychange', settle);
}

/**
 * A fresh running order. `avoid` is the clip that just played, kept out of first place
 * so the seam between two passes doesn't show the same game twice in a row.
 */
function shuffle(length: number, avoid: number) {
  const order = [...Array(length).keys()];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order.length > 1 && order[0] === avoid) [order[0], order[1]] = [order[1], order[0]];
  return order;
}

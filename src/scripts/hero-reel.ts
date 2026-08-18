/**
 * Plays the game clips behind the hero, and everything that hangs off which one is up:
 * the line of credit under the name, clicking through to that game, and the d-pad.
 *
 * Two <video> elements take turns. One is on screen; the other quietly loads the clip
 * that's coming up and is faded in over the top just before the current one runs out,
 * so there's never a black frame or a stall between games. Then they swap roles.
 *
 * The running order is shuffled once, on load, and then repeats unchanged — so the
 * sequence is a surprise the first time and predictable afterwards, and the d-pad has
 * something stable to step through. Position counts forwards and backwards without
 * limit and wraps into the order, so Back always has somewhere to go: past the start
 * it simply carries on into the previous pass.
 *
 * What it deliberately doesn't do:
 *
 *   - download anything up front. The still banner is the poster, and the first clip
 *     is only fetched once we know the hero is actually on screen
 *   - hold more than two clips at a time. The next one is fetched a few seconds before
 *     it's needed, not at the start
 *   - keep running once you've scrolled past, or once the tab is in the background
 *   - run at all for someone who asked for less motion, or who's on a metered
 *     connection — they keep the still, the slogan and no download
 */

interface Clip {
  src: string;
  slug: string;
  credit: string;
}

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

/** Must match the opacity transition on .reel video in Header.astro. */
const FADE_MS = 1000;

const reel = document.querySelector<HTMLElement>('[data-reel]');
const wantsLessMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Chrome and friends expose this when the visitor has data saver on. It's the closest
// thing to being told "don't spend my bandwidth on decoration".
const savingData =
  (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true;

wireNav();

if (reel && !wantsLessMotion && !savingData) run(reel);

function run(reel: HTMLElement) {
  const clips: Clip[] = JSON.parse(reel.dataset.clips ?? '[]');
  const [a, b] = reel.querySelectorAll('video');
  if (!clips.length || !a || !b) return;

  // Shuffled once and then left alone, so every pass runs in the same order.
  const order = shuffle(clips.length);
  const at = (position: number) => order[((position % order.length) + order.length) % order.length];

  let front = a;
  let back = b;

  let position = 0; // counts freely in both directions; at() wraps it into the order
  let queued = -1; // index currently loaded into `back`
  let handedOver = false;
  let onScreen = false;

  const credit = document.querySelector<HTMLElement>('[data-hero-credit]');

  /** Everything that has to follow the clip on screen. */
  const announce = (clip: Clip) => {
    reel.dataset.slug = clip.slug;
    if (credit) credit.textContent = clip.credit;
  };

  /** Fetch a clip into the back element, a little ahead of needing it. */
  const prime = (index: number) => {
    if (queued === index) return;
    queued = index;
    back.src = clips[index].src;
    back.load();
  };

  /**
   * Bring the loaded clip up over the one on screen. `step` is which way we're moving
   * through the order — the auto-advance and the d-pad both come through here, so a
   * skip behaves exactly like a clip ending early.
   */
  const handover = (step: number) => {
    if (handedOver) return;
    const target = at(position + step);
    prime(target); // a clip shorter than PRELOAD_AT never got the chance
    handedOver = true;

    const outgoing = front;
    announce(clips[target]);

    back
      .play()
      .then(() => {
        back.dataset.active = '';
        delete outgoing.dataset.active;

        // Roles change over only once the fade has finished, so the old clip keeps
        // rendering until it's genuinely invisible. Hung off playback actually
        // starting rather than a bare timer: pressing Right early asks for a clip
        // that hasn't downloaded yet, and on a fixed delay the swap would happen
        // while the incoming video was still black.
        window.setTimeout(() => {
          outgoing.pause();
          outgoing.currentTime = 0;
          [front, back] = [back, outgoing];
          position += step;
          queued = -1;
          handedOver = false;
        }, FADE_MS);
      })
      .catch(() => {
        // Couldn't start, so stay on the clip we have and let the next press retry.
        handedOver = false;
        queued = -1;
        announce(clips[at(position)]);
      });
  };

  for (const clip of [a, b]) {
    clip.addEventListener('timeupdate', () => {
      if (clip !== front || !onScreen || handedOver) return;
      if (!Number.isFinite(clip.duration)) return;

      // A game's turn ends when its clip runs out or when it's had its ten seconds,
      // whichever comes first.
      const left = Math.min(clip.duration, MAX_SHOWTIME) - clip.currentTime;

      if (left <= PRELOAD_AT) prime(at(position + 1));
      if (left <= HANDOVER_AT) handover(1);
    });

    // Safety net: timeupdate stops firing if a clip is cut short or stalls at the end.
    clip.addEventListener('ended', () => clip === front && handover(1));
  }

  // --- the d-pad -----------------------------------------------------------------
  // Left and Right are the reel's, so they live here where the running order does.
  document.addEventListener('click', (event) => {
    const key = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-pad]');
    if (!key) return;
    if (key.dataset.pad === 'next') handover(1);
    if (key.dataset.pad === 'prev') handover(-1);
  });

  // Clicking the footage opens that game, by way of the card that already knows how.
  // Anything with its own job — a link, a button — is left to get on with it.
  const hero = reel.closest<HTMLElement>('.hero');
  hero?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('a, button')) return;
    if (!window.getSelection()?.isCollapsed) return; // they were selecting text
    const slug = reel.dataset.slug;
    if (slug) document.querySelector<HTMLElement>(`a[data-game="${CSS.escape(slug)}"]`)?.click();
  });

  // Say who we're about to show before the first frame arrives, so the slogan the page
  // was served with is never the thing anyone reads.
  announce(clips[at(0)]);

  startWhenVisible(reel, (visible) => {
    onScreen = visible;
    if (!visible) {
      a.pause();
      b.pause();
      return;
    }
    if (!front.getAttribute('src')) begin(front, clips[at(position)].src);
    else front.play().catch(() => {});
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

/** Down jumps to the portfolio; Up brings the nav bar in and out. */
function wireNav() {
  const nav = document.getElementById('site-nav');

  const setOpen = (open: boolean) => {
    if (!nav) return;
    if (open) {
      nav.hidden = false;
      // Next frame, so the browser has a closed state to animate away from.
      requestAnimationFrame(() => (nav.dataset.open = ''));
    } else {
      delete nav.dataset.open;
    }
  };

  document.addEventListener('click', (event) => {
    const key = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-pad]');
    if (!key) return;
    if (key.dataset.pad === 'down') {
      document.getElementById('portfolio')?.scrollIntoView({ behavior: 'smooth' });
    }
    if (key.dataset.pad === 'up') setOpen(!(nav && 'open' in nav.dataset));
  });

  // Following a link in it is a good moment to put it away again.
  nav?.addEventListener('click', (event) => {
    if ((event.target as HTMLElement | null)?.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav && 'open' in nav.dataset) setOpen(false);
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

/** One running order, drawn once and then kept. */
function shuffle(length: number) {
  const order = [...Array(length).keys()];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * Drives the inspection screen in Lightbox.astro.
 *
 * Clicking a picture or a clip in a game's write-up (anything marked [data-inspect],
 * which Media.astro puts on both) opens it, and the set to step through is every picture
 * and clip in that same article. On the homepage each game's dialog holds its own
 * article, so stepping never wanders into another game.
 *
 * The middle of the view zooms it in and back out. While zoomed, where the pointer is
 * in the frame is where you are in the picture: at the frame's bottom edge you see the
 * bottom edge, at its top the top. Stepping waits until you zoom back out, and every
 * opening starts unzoomed. A clip zooms and pans exactly like a picture, and keeps
 * looping while it does.
 *
 * A picture reuses the article image's own srcset, with `sizes` set to the width it
 * reaches zoomed in, so the browser fetches a larger file only when the screen calls
 * for one. A clip is the same file the article is already playing, picked up from the
 * frame it was on.
 */

const dialog = document.querySelector<HTMLDialogElement>('dialog.inspect');

if (dialog) {
  const frame = dialog.querySelector<HTMLElement>('.frame')!;
  const view = dialog.querySelector<HTMLElement>('[data-inspect-view]')!;
  const picture = dialog.querySelector<HTMLImageElement>('[data-inspect-image]')!;
  const clip = dialog.querySelector<HTMLVideoElement>('[data-inspect-clip]')!;
  const count = dialog.querySelector<HTMLElement>('[data-inspect-count]')!;
  const zoomButton = dialog.querySelector<HTMLElement>('[data-inspect-zoom]')!;
  const sides = [...dialog.querySelectorAll<HTMLElement>('[data-inspect-step]')];

  // How far a click on the middle zooms in. Handed to the CSS as --zoom, so this is
  // the only place it's set.
  const ZOOM = 2.5;
  dialog.style.setProperty('--zoom', String(ZOOM));

  /** What an article holds: the <img> or <video> inside each [data-inspect] button. */
  type Item = HTMLImageElement | HTMLVideoElement;

  let items: Item[] = [];
  let at = 0;
  let zoomed = false;

  /** The view's width over its height, which the CSS sizes it from. */
  const setRatio = (ratio: number) => view.style.setProperty('--ratio', String(ratio));

  /** Stops the clip and lets go of its file, so nothing plays or loads unseen. */
  const stopClip = () => {
    clip.pause();
    clip.removeAttribute('src');
    clip.load();
  };

  const showPicture = (source: HTMLImageElement) => {
    stopClip();
    clip.hidden = true;
    picture.hidden = false;

    // The width and height attributes are the file's own, and they're there even when
    // the article image is lazy and hasn't loaded yet.
    const width = Number(source.getAttribute('width')) || source.naturalWidth;
    const height = Number(source.getAttribute('height')) || source.naturalHeight;
    const ratio = width / height;
    setRatio(ratio);

    // Same sum as the CSS width: 96% of the screen's width or 92% of its height times
    // the ratio, whichever is smaller. Asked for at its zoomed size from the start, so
    // zooming in never has to swap the file mid-look.
    const drawn = Math.min(window.innerWidth * 0.96, window.innerHeight * 0.92 * ratio);
    picture.sizes = `${Math.round(drawn * ZOOM)}px`;
    picture.srcset = source.srcset;
    picture.src = source.currentSrc || source.src;
    picture.alt = source.alt;
  };

  const showClip = (source: HTMLVideoElement, label: string) => {
    picture.hidden = true;
    picture.removeAttribute('srcset');
    picture.removeAttribute('src');
    clip.hidden = false;
    clip.setAttribute('aria-label', label);

    // The article's clip has usually read its size by now. If not, the view takes the
    // common 16:9 until this one has.
    setRatio(source.videoWidth ? source.videoWidth / source.videoHeight : 16 / 9);
    clip.addEventListener('loadedmetadata', () => setRatio(clip.videoWidth / clip.videoHeight), {
      once: true,
    });

    clip.src = source.currentSrc || source.src;
    clip.currentTime = source.currentTime;
    // Muted, so the browser lets it play without a gesture. If it refuses anyway, the
    // first frame still shows.
    clip.play().catch(() => {});
  };

  const show = (index: number) => {
    // Wraps both ways, so the last item steps on to the first and back again.
    at = (index + items.length) % items.length;
    const source = items[at];
    const opener = source.closest<HTMLElement>('[data-inspect]');

    if (source instanceof HTMLVideoElement) showClip(source, opener?.getAttribute('aria-label') ?? '');
    else showPicture(source);

    const caption = source.closest('figure')?.querySelector('figcaption')?.textContent?.trim();
    count.textContent = [`${at + 1} / ${items.length}`, caption].filter(Boolean).join('  ·  ');
  };

  /**
   * Points the zoom at the part of the view that matches where the pointer is in the
   * frame. The view scales around its transform-origin, and the origin's own point
   * stays put, so an origin at 80% down keeps the view's 80% mark under the pointer's
   * 80% of the frame. Outside the frame it holds at the nearest edge.
   */
  const aim = (x: number, y: number) => {
    const box = frame.getBoundingClientRect();
    const percent = (value: number, start: number, size: number) =>
      `${Math.min(100, Math.max(0, ((value - start) / size) * 100))}%`;
    view.style.setProperty('--zoom-x', percent(x, box.left, box.width));
    view.style.setProperty('--zoom-y', percent(y, box.top, box.height));
  };

  const setZoom = (on: boolean) => {
    zoomed = on;
    dialog.toggleAttribute('data-zoomed', on);
    zoomButton.setAttribute('aria-pressed', String(on));
  };

  document.addEventListener('click', (event) => {
    const opener = (event.target as Element | null)?.closest<HTMLElement>('[data-inspect]');
    const item = opener?.querySelector<Item>('img, video');
    if (!opener || !item) return;

    const article = opener.closest('.long-form');
    items = article ? [...article.querySelectorAll<Item>('[data-inspect] :is(img, video)')] : [item];

    // Nothing to step through with a single item, so no arrow zones. The zoom zone
    // underneath then covers the whole view.
    for (const side of sides) side.hidden = items.length < 2;

    // Set while the dialog is still display: none, so it starts unzoomed without
    // playing the zoom-out on the way in.
    setZoom(false);
    show(items.indexOf(item));
    dialog.showModal();
    frame.focus();
  });

  dialog.addEventListener('close', stopClip);

  dialog.addEventListener('click', (event) => {
    const target = event.target as Element;

    if (target.closest('[data-inspect-zoom]')) {
      if (zoomed) setZoom(false);
      else {
        // A click from the keyboard has no position (detail is 0), so it zooms on the
        // middle of the view.
        if (event.detail === 0) {
          const box = frame.getBoundingClientRect();
          aim(box.left + box.width / 2, box.top + box.height / 2);
        } else aim(event.clientX, event.clientY);
        setZoom(true);
      }
      frame.focus();
      return;
    }

    const step = target.closest<HTMLElement>('[data-inspect-step]');
    if (step) {
      show(at + Number(step.dataset.inspectStep));
      // Focus goes back to the frame, which is what holds it while the screen is open.
      // Left on the zone that was clicked, the next arrow key press would make the
      // browser draw a focus ring around a quarter of the view.
      frame.focus();
      return;
    }

    // Anywhere that isn't the view is outside it, zoomed or not.
    if (!target.closest('.frame')) dialog.close();
  });

  // Listened for on the whole screen, so a pointer that slips past the frame's edge
  // keeps the view pinned to that edge rather than leaving it where it last was.
  dialog.addEventListener('pointermove', (event) => {
    if (zoomed) aim(event.clientX, event.clientY);
  });

  dialog.addEventListener('keydown', (event) => {
    if (zoomed || items.length < 2) return;
    if (event.key === 'ArrowLeft') show(at - 1);
    else if (event.key === 'ArrowRight') show(at + 1);
    else return;
    event.preventDefault();
  });
}

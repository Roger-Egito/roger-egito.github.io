/**
 * Opens the portfolio dialogs and keeps the URL in step with them.
 *
 * A normal click opens the dialog over the homepage and puts /games/<slug>/ in the
 * address bar. Ctrl/cmd/middle click falls through to the browser so the link opens
 * the standalone page as usual. Back, Esc, Close and clicking outside all shut the
 * dialog and restore the URL.
 *
 * <dialog> handles the focus trap and Esc itself, so what's left here is the history
 * juggling and loading the trailer lazily.
 */

// Whether we're responsible for the current history entry. This has to be tracked
// explicitly rather than worked out from location.pathname: history.back() applies
// asynchronously, so right after a close the URL still reads as the game's for a
// moment. Reopening in that window used to skip the push and leave the URL stuck.
let ownsEntry = false;

// Set while we're closing a dialog in response to the URL changing, so the close
// handler doesn't try to rewind history a second time.
let syncingFromHistory = false;

// Refreshed on every page load, since the view transition router swaps the title.
let baseTitle = document.title;

const videoFrame = (dialog: HTMLDialogElement) =>
  dialog.querySelector<HTMLIFrameElement>('iframe[data-video]');

function open(dialog: HTMLDialogElement) {
  // The src is left empty in the HTML so the homepage doesn't boot up a YouTube
  // player for every game. Fill it in the first time the dialog is opened.
  const frame = videoFrame(dialog);
  if (frame && !frame.getAttribute('src')) {
    frame.src = frame.dataset.video ?? '';
  }

  dialog.showModal();

  const url = dialog.dataset.url;
  if (url) {
    // Replace rather than push when we already own the entry, so repeatedly opening
    // dialogs can't stack up entries that all need backing out of.
    if (ownsEntry) history.replaceState({ gameDialog: true }, '', url);
    else {
      history.pushState({ gameDialog: true }, '', url);
      ownsEntry = true;
    }
  }
  document.title = `${dialog.dataset.title} | ${baseTitle}`;
}

function closeOpenDialog() {
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
  if (!dialog) return;
  syncingFromHistory = true;
  dialog.close();
  syncingFromHistory = false;
}

// Capture phase on purpose. The view transition router also listens for clicks on
// document, and it bails out if the event was already default-prevented — capture
// runs first, so this wins and a card click opens the dialog instead of navigating.
document.addEventListener(
  'click',
  (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const card = target.closest<HTMLAnchorElement>('a[data-game]');
    if (card) {
      // Let the browser handle new-tab/new-window clicks.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.button !== 0) return;

      const dialog = document.getElementById(`game-${card.dataset.game}`);
      if (!(dialog instanceof HTMLDialogElement)) return;

      event.preventDefault();
      open(dialog);
      return;
    }

    if (target.closest('[data-close]')) {
      target.closest('dialog')?.close();
    }
  },
  true
);

window.addEventListener('popstate', () => {
  ownsEntry = false;
  closeOpenDialog();
});

// Runs on the first load and again after every client-side navigation. The dialogs
// are fresh elements each time, so their listeners have to be reattached; the
// document-level ones above are registered once and survive.
document.addEventListener('astro:page-load', () => {
  baseTitle = document.title;
  ownsEntry = false;

  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[data-url]')) {
    // The dialog element is the full-screen overlay, so a click reported against it
    // is a click outside the card.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });

    // Every way of closing (button, Esc, click-outside) ends up here.
    dialog.addEventListener('close', () => {
      // Dropping the src stops playback, which is what the old jQuery snippet was
      // doing by reassigning it.
      videoFrame(dialog)?.removeAttribute('src');
      document.title = baseTitle;

      if (syncingFromHistory || !ownsEntry) return;
      ownsEntry = false;
      // Rewind our own entry so Back doesn't have to be pressed twice.
      history.back();
    });
  }
});

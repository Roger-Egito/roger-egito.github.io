/**
 * Opens the portfolio dialogs and keeps the URL in step with them.
 *
 * A normal click opens the dialog over the homepage and puts /games/<slug>/ in the
 * address bar. Ctrl/cmd/middle click falls through to the browser so the link opens
 * the standalone page as usual. Back, Esc, Close and clicking outside all shut the
 * dialog and restore the URL.
 *
 * <dialog> handles the focus trap and Esc itself, so what's left here is the history
 * juggling, loading the trailer lazily, and asking before dropping a running build.
 */

import { isGameLoaded, pauseGame, resumeGame, showDefault, unloadMedia } from './game-tabs';

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

const openDialog = () =>
  document.querySelector<HTMLDialogElement>('dialog[open]:not(#confirm-close)');

/**
 * Closing unloads the build, so check first. Resolves true if it's fine to go ahead.
 * Esc and clicking outside the confirmation both count as "No", which is the
 * non-destructive answer.
 *
 * The build is frozen while the question is up, so nothing carries on happening in a
 * game nobody is looking at, and picks up again if the answer is "No".
 */
function confirmLosingGame(dialog: HTMLDialogElement): Promise<boolean> {
  const box = document.getElementById('confirm-close');
  if (!(box instanceof HTMLDialogElement)) return Promise.resolve(true);

  pauseGame(dialog);

  return new Promise((resolve) => {
    const finish = (answer: boolean) => {
      box.removeEventListener('click', onClick);
      box.removeEventListener('cancel', onCancel);
      box.close();
      if (!answer) resumeGame(dialog);
      resolve(answer);
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target === box) return finish(false); // clicked the backdrop
      const button = target?.closest<HTMLElement>('[data-confirm]');
      if (button) finish(button.dataset.confirm === 'yes');
    };

    const onCancel = () => finish(false);

    box.addEventListener('click', onClick);
    box.addEventListener('cancel', onCancel);
    box.showModal();
    box.querySelector<HTMLElement>('[data-confirm="no"]')?.focus();
  });
}

function open(dialog: HTMLDialogElement) {
  // Frames are left with no src in the HTML so the homepage doesn't boot up a YouTube
  // player for every game. This picks the opening tab and fills in whichever one of
  // them the visitor is about to look at.
  showDefault(dialog);

  dialog.showModal();

  // Focus the card rather than whatever happens to be focusable first, which is the
  // YouTube iframe — and focus inside a cross-origin frame sends Esc to that frame,
  // so the dialog never gets its cancel event. The autofocus attribute only works the
  // first time an element is focused, so reopening needs this done explicitly.
  dialog.querySelector<HTMLElement>('.sheet')?.focus();

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
  document.title = dialog.dataset.title ?? baseTitle;
}

function closeOpenDialog() {
  const dialog = openDialog();
  if (!dialog) return;
  syncingFromHistory = true;
  dialog.close();
  syncingFromHistory = false;
}

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

    // Close button. Guarded here rather than in the close handler because by then
    // the dialog has already gone.
    const closer = target.closest('[data-close]');
    if (closer) {
      const dialog = closer.closest('dialog');
      if (!(dialog instanceof HTMLDialogElement)) return;
      if (!isGameLoaded(dialog)) return dialog.close();
      confirmLosingGame(dialog).then((ok) => ok && dialog.close());
    }
  },
  true
);

window.addEventListener('popstate', () => {
  const dialog = openDialog();

  if (dialog && isGameLoaded(dialog)) {
    const url = dialog.dataset.url;
    confirmLosingGame(dialog).then((ok) => {
      if (ok) {
        ownsEntry = false;
        closeOpenDialog();
        return;
      }
      // Staying put, so put the URL back where it was.
      if (url) {
        history.pushState({ gameDialog: true }, '', url);
        ownsEntry = true;
      }
    });
    return;
  }

  ownsEntry = false;
  closeOpenDialog();
});

// Astro serves this as a deferred module, so the document is already parsed by the
// time it runs and the dialogs are all present.
{
  baseTitle = document.title;

  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[data-url]')) {
    // The dialog element is the full-screen overlay, so a click reported against it
    // is a click outside the card.
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      if (!isGameLoaded(dialog)) return dialog.close();
      confirmLosingGame(dialog).then((ok) => ok && dialog.close());
    });

    // Esc. Cancelled while a build is running so the confirmation can be shown first.
    dialog.addEventListener('cancel', (event) => {
      if (!isGameLoaded(dialog)) return;
      event.preventDefault();
      confirmLosingGame(dialog).then((ok) => ok && dialog.close());
    });

    // Every way of closing ends up here.
    dialog.addEventListener('close', () => {
      // Dropping both frames stops whatever was playing; opening again starts fresh.
      unloadMedia(dialog);
      document.title = baseTitle;

      if (syncingFromHistory || !ownsEntry) return;
      ownsEntry = false;
      // Rewind our own entry so Back doesn't have to be pressed twice.
      history.back();
    });
  }
}

/**
 * Loads and unloads the iframes inside a portfolio entry.
 *
 * Assigning `iframe.src` navigates the frame, and a frame navigation pushes an entry
 * onto the browser's session history. Opening a dialog, closing it and opening it
 * again therefore buried our own history entry, and Back stopped returning to the
 * homepage — it walked back through the trailer's navigations instead.
 *
 * Replacing the element sidesteps that: a freshly created iframe's first load
 * *replaces* rather than pushes. Destroying the old frame also guarantees whatever was
 * playing in it stops, which is what we want on close anyway.
 */
export function setFrameSrc(frame: HTMLIFrameElement, src: string | null) {
  const fresh = frame.cloneNode(false) as HTMLIFrameElement;

  if (src) fresh.src = src;
  else fresh.removeAttribute('src');

  frame.replaceWith(fresh);
  return fresh;
}

/**
 * Small helpers the report's views share: element and SVG builders, the one tooltip,
 * and how numbers and times are written.
 *
 * Everything from the export goes in as text (textContent, never innerHTML), so a page
 * title or a referrer in the CSV can't put markup on the page.
 */
import type { Kind } from '../../lib/umami-report/sessions.ts';

export type Child = Node | string | number | null | undefined | false;

type Attributes = Record<string, string | number | boolean | undefined | null>;

/** el('td', { class: 'n' }, '12'). false/null/undefined attributes are left off. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Attributes = {}, ...children: Child[]) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'number' ? String(child) : child);
  }
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';
export function svg(tag: string, attributes: Attributes = {}, text?: string) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue;
    node.setAttribute(name, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

/* --- formats --------------------------------------------------------------------- */

export const number = (value: number) => value.toLocaleString('en-US');
export const percent = (value: number) => `${Math.round(value * 100)}%`;

export function duration(ms: number | null) {
  if (ms === null) return '-';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

const formats = new Map<string, Intl.DateTimeFormat>();
const formatter = (timeZone: string, options: Intl.DateTimeFormatOptions) => {
  const key = timeZone + JSON.stringify(options);
  let format = formats.get(key);
  if (!format) formats.set(key, (format = new Intl.DateTimeFormat('en-GB', { timeZone, ...options })));
  return format;
};

export const moment = (value: Date, timeZone: string) =>
  formatter(timeZone, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value);

export const clockTime = (value: Date, timeZone: string) =>
  formatter(timeZone, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value);

/** "07 Oct 2026" from YYYY-MM-DD, read as a calendar day (no zone shift). */
export const day = (date: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(
    new Date(`${date}T00:00:00Z`)
  );

/** "07 Oct" from YYYY-MM-DD. */
export const shortDay = (date: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short' }).format(new Date(`${date}T00:00:00Z`));

export const kindNames: Record<Kind, string> = { real: 'Real visitor', me: 'Me', bot: 'Bot' };

/** A small colored key beside a label: identity is never color alone, the label is there. */
export const key = (kind: Kind, shape: 'box' | 'line' = 'box') => el('span', { class: `key key-${shape} kind-${kind}`, 'aria-hidden': 'true' });

/* --- the tooltip ----------------------------------------------------------------- */

let tip: HTMLElement | null = null;

/** One tooltip for the whole page. Rows lead with the value, then the label. */
export function showTip(event: { clientX: number; clientY: number } | DOMRect, title: string, rows: [Kind | null, string, string][]) {
  if (!tip) {
    tip = el('div', { class: 'report-tip', role: 'tooltip' });
    document.body.append(tip);
  }
  tip.replaceChildren(
    el('strong', { class: 'tip-title' }, title),
    ...rows.map(([kind, value, label]) =>
      el('div', { class: 'tip-row' }, kind ? key(kind, 'line') : el('span', { class: 'key key-none' }), el('b', {}, value), el('span', {}, label))
    )
  );
  tip.hidden = false;
  const x = 'clientX' in event ? event.clientX : event.left + event.width / 2;
  const y = 'clientY' in event ? event.clientY : event.top;
  const box = tip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - box.width - 8, Math.max(8, x + 14));
  const top = y - box.height - 14 < 8 ? y + 18 : y - box.height - 14;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

export function hideTip() {
  if (tip) tip.hidden = true;
}

/** Wires hover and keyboard focus on a mark to the tooltip. */
export function tipOn(node: Element, title: () => string, rows: () => [Kind | null, string, string][]) {
  node.addEventListener('pointermove', (event) => showTip(event as PointerEvent, title(), rows()));
  node.addEventListener('pointerleave', hideTip);
  node.addEventListener('focus', () => showTip(node.getBoundingClientRect(), title(), rows()));
  node.addEventListener('blur', hideTip);
}

/** A row of toggle buttons, one pressed: Views | Visits. */
export function segmented<T extends string>(label: string, options: [T, string][], current: T, pick: (value: T) => void) {
  return el(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': label },
    ...options.map(([value, text]) => {
      const button = el('button', { type: 'button', 'aria-pressed': String(value === current) }, text);
      button.addEventListener('click', () => pick(value));
      return button;
    })
  );
}

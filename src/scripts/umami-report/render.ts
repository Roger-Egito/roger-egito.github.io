/**
 * Draws the analytics report. Takes the plain data report.ts and sessions.ts produce
 * and turns it into elements; knows nothing about files, rules or storage.
 *
 * Everything from the export goes in as text (textContent, never innerHTML), so a page
 * title or a referrer in the CSV can't put markup on the page.
 */
import type { Report, WeekBar } from '../../lib/umami-report/report.ts';
import { kindLabel, type ClassifiedSession, type Kind } from '../../lib/umami-report/sessions.ts';

type Child = Node | string | null | undefined | false;

/** A tiny element builder: el('td', { class: 'n' }, '12'). */
function el(tag: string, attributes: Record<string, string> = {}, ...children: Child[]) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  for (const child of children) if (child) node.append(child);
  return node;
}

const number = (value: number) => value.toLocaleString('en-US');
const percent = (value: number) => `${Math.round(value * 100)}%`;

export function moment(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

export function duration(from: Date, to: Date) {
  const seconds = Math.round((to.getTime() - from.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const device = (session: ClassifiedSession) =>
  [session.device, session.browser, session.os, session.screen].filter(Boolean).join(' · ');

/** Where a session went, page by page. Repeats of the same page in a row fold into one. */
const route = (session: ClassifiedSession) =>
  session.pageviews
    .map((view) => view.urlPath + (view.urlQuery ? `?${view.urlQuery}` : ''))
    .filter((path, i, all) => path !== all[i - 1])
    .join(' → ');

function table(head: string[], rows: Child[][], className = '') {
  return el(
    'div',
    { class: 'table-wrap' },
    el(
      'table',
      { class: className },
      el('thead', {}, el('tr', {}, ...head.map((label) => el('th', {}, label)))),
      el('tbody', {}, ...rows.map((cells) => el('tr', {}, ...cells.map((cell) => el('td', {}, cell)))))
    )
  );
}

function section(title: string, ...children: Child[]) {
  return el('section', { class: 'block' }, el('h2', {}, title), ...children);
}

const empty = (text: string) => el('p', { class: 'empty' }, text);

function headline(report: Report) {
  const { totals } = report;
  const card = (value: string, label: string, note?: string) =>
    el('div', { class: 'card' }, el('strong', {}, value), el('span', {}, label), note && el('small', {}, note));
  return el(
    'div',
    { class: 'cards' },
    card(number(totals.pageviews), 'Total pageviews'),
    card(number(totals.myPageviews), 'My pageviews', `${percent(totals.myShare)} of all`),
    card(number(totals.botSessions), 'Bot sessions'),
    card(number(totals.realSessions), 'Real sessions'),
    card(number(totals.realPageviews), 'Real pageviews')
  );
}

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag: string, attributes: Record<string, string | number>, text?: string) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Pageviews per week, stacked Real at the bottom, then Me, then Bot. */
function weeklyChart(weeks: WeekBar[]) {
  if (weeks.length === 0) return empty('No pageviews.');
  const kinds: Kind[] = ['real', 'me', 'bot'];
  const max = Math.max(...weeks.map((week) => week.me + week.bot + week.real), 1);
  const bar = 34;
  const gap = 18;
  const top = 22;
  const height = 200;
  const width = weeks.length * (bar + gap) + gap;
  // Its own width and height, so it draws at that size rather than being stretched to
  // the page and squeezed back down. CSS only lets it shrink on a narrow screen.
  const chart = svg('svg', {
    viewBox: `0 0 ${width} ${top + height + 34}`,
    width,
    height: top + height + 34,
    class: 'chart',
    role: 'img',
    'aria-label': 'Pageviews per week by type',
  });

  weeks.forEach((week, i) => {
    const x = gap + i * (bar + gap);
    let y = top + height;
    for (const kind of kinds) {
      const size = (week[kind] / max) * height;
      if (!size) continue;
      y -= size;
      const rect = svg('rect', { x, y, width: bar, height: size, class: `fill-${kind}` });
      rect.append(svg('title', {}, `${kindLabel(kind)}: ${week[kind]}`));
      chart.append(rect);
    }
    const total = week.me + week.bot + week.real;
    chart.append(svg('text', { x: x + bar / 2, y: y - 6, class: 'total' }, total ? String(total) : ''));
    const [, month, day] = week.week.split('-');
    chart.append(svg('text', { x: x + bar / 2, y: top + height + 18, class: 'axis' }, `${day}/${month}`));
  });

  const legend = el(
    'p',
    { class: 'legend' },
    ...kinds.map((kind) => el('span', { class: `key key-${kind}` }, kindLabel(kind)))
  );
  return el('div', {}, chart, legend, el('p', { class: 'note' }, 'Weeks start on Monday, São Paulo time.'));
}

function counts(rows: { label: string; count: number }[], label: string, none: string) {
  if (rows.length === 0) return empty(none);
  return table([label, 'Count'], rows.map((row) => [row.label, number(row.count)]), 'counts');
}

export interface RenderInput {
  report: Report;
  sessions: ClassifiedSession[];
  timeZone: string;
  hasEventData: boolean;
  /** Called when a session's type is changed in the table. */
  onOverride: (sessionId: string, kind: Kind) => void;
}

export function renderReport(target: HTMLElement, input: RenderInput) {
  const { report, sessions, timeZone } = input;
  const real = sessions.filter((session) => session.kind === 'real');

  const filters =
    report.filters.length === 0
      ? empty('No ?f= filters in this export.')
      : table(
          ['Filter', 'Real visitors', 'Me'],
          report.filters.map((row) => [row.filter, number(row.real), number(row.me)]),
          'counts'
        );

  const events = !input.hasEventData
    ? empty('No event_data.csv in the drop.')
    : report.realEvents.length === 0
      ? empty('No click events from real visitors in this export.')
      : table(
          ['Event', 'Count', 'Details'],
          report.realEvents.map((event) => [
            event.name,
            number(event.count),
            event.details.map((detail) => `${detail.label} (${detail.count})`).join(', '),
          ]),
          'counts'
        );

  const realTable =
    real.length === 0
      ? empty('No real visitors.')
      : table(
          ['Start', 'City', 'Device', 'Language', 'Source', 'Pages', 'Duration', 'Path'],
          real.map((session) => [
            moment(session.start, timeZone),
            [session.city, session.country].filter(Boolean).join(', '),
            device(session),
            session.language ?? '',
            session.source,
            String(session.pageviews.length),
            duration(session.start, session.end),
            el('span', { class: 'route' }, route(session)),
          ])
        );

  const typePicker = (session: ClassifiedSession) => {
    const select = el('select', { 'aria-label': 'Type' }) as HTMLSelectElement;
    for (const kind of ['me', 'bot', 'real'] as Kind[]) {
      const option = el('option', { value: kind }, kindLabel(kind)) as HTMLOptionElement;
      option.selected = kind === session.kind;
      select.append(option);
    }
    select.addEventListener('change', () => input.onOverride(session.id, select.value as Kind));
    return el('span', { class: `type type-${session.kind}` }, select);
  };

  const allTable = table(
    ['Start', 'Type', 'Pages', 'City', 'Device', 'Source', 'Reason'],
    sessions.map((session) => [
      moment(session.start, timeZone),
      typePicker(session),
      String(session.pageviews.length),
      [session.city, session.country].filter(Boolean).join(', '),
      device(session),
      session.source,
      el('span', { class: session.kind === session.ruled.kind ? 'reason' : 'reason changed' }, session.reason),
    ]),
    'all'
  );

  target.replaceChildren(
    headline(report),
    section('Pageviews per week', weeklyChart(report.weeks)),
    el(
      'div',
      { class: 'pair' },
      section('Real visitors by source', counts(report.realSources, 'Source', 'No real visitors.')),
      section(
        'Pages real visitors viewed',
        counts(report.realPages, 'Page', 'No real visitors.'),
        el(
          'p',
          { class: 'note' },
          `${number(report.homeOnly.sessions)} of ${number(report.totals.realSessions)} real sessions (${percent(report.homeOnly.share)}) only saw the home page.`
        )
      )
    ),
    el(
      'div',
      { class: 'pair' },
      section('Portfolio filters (?f=), in pageviews', filters),
      section('Click events by real visitors', events)
    ),
    section('Real sessions', realTable),
    section('Every session', allTable)
  );
}

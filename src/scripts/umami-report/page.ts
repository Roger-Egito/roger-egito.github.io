/**
 * The report page: reads the dropped export, keeps the view's state (filters, sorting,
 * hand overrides), and draws every section from the pure modules in
 * src/lib/umami-report. Everything below the filter bar is redrawn from scratch on each
 * change; the data is small enough that this is instant, and it means no section can
 * ever disagree with another about what's filtered.
 *
 * The files are read with the File API and never leave the browser: there's no fetch,
 * no upload, nothing sent anywhere. The last export is kept in this browser's local
 * storage so a reload doesn't need the files again, and "Forget" removes it.
 */
import { readExport, type DroppedFile } from '../../lib/umami-report/archive.ts';
import { parseRecords, type CsvRecord } from '../../lib/umami-report/csv.ts';
import { reportConfig } from '../../lib/umami-report/config.ts';
import {
  buildSessions, classifyAll, kindLabel, readEvents,
  type ClassifiedSession, type Kind, type Session,
} from '../../lib/umami-report/sessions.ts';
import {
  applyFilters, autoGranularity, breakdown, classificationSummary, dimensionLabels, durations, eventProperties,
  events, filterUsage, heatmap, kinds, metricLabels, noFilters, pages, personPages, searchUsage, timeline,
  totals, visitRows, visitors, weekdays,
  type Dimension, type Filters, type Granularity, type Metric, type VisitRow,
} from '../../lib/umami-report/explore.ts';
import { barList, heatmapChart, legend, stackedColumns } from './charts.ts';
import { clockTime, day, duration, el, key, kindNames, moment, number, percent, segmented, shortDay, type Child } from './dom.ts';
import { table, type SortState } from './table.ts';

const TZ = reportConfig.timeZone;
const STORE = { overrides: 'umami-report:overrides', view: 'umami-report:view', data: 'umami-report:export' };

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const loadZone = $<HTMLElement>('[data-report-load]');
const input = $<HTMLInputElement>('[data-report-files]');
const status = $<HTMLElement>('[data-report-status]');
const summary = $<HTMLElement>('[data-report-summary]');
const bar = $<HTMLElement>('[data-report-bar]');
const barMain = $<HTMLElement>('[data-report-bar-main]');
const chips = $<HTMLElement>('[data-report-chips]');
const search = $<HTMLInputElement>('[data-report-search]');
const output = $<HTMLElement>('[data-report-output]');
const profile = $<HTMLDialogElement>('[data-report-profile]');

/* --- storage --------------------------------------------------------------------- */

const read = <T>(name: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(name);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (name: string, value: unknown) => {
  try {
    if (value === null) localStorage.removeItem(name);
    else localStorage.setItem(name, JSON.stringify(value));
    return true;
  } catch {
    return false; // storage blocked or full: everything still works, it just won't be remembered
  }
};

/* --- state ----------------------------------------------------------------------- */

interface View {
  filters: Filters;
  metric: Metric;
  granularity: Granularity | 'auto';
  measure: 'views' | 'visits';
  sorts: Record<string, SortState>;
}

/** Real visitors only, to start with: the people are what the page is for. */
const startFilters = (): Filters => ({ ...noFilters(), kinds: ['real'] });

const defaultView = (): View => ({
  filters: startFilters(),
  metric: 'visits',
  granularity: 'auto',
  measure: 'views',
  sorts: {},
});

let view: View = { ...defaultView(), ...read<Partial<View>>(STORE.view, {}) };
let overrides = read<Record<string, Kind>>(STORE.overrides, {});
/** Lists showing all their rows, and visits opened to their pages. Not saved. */
const expanded = new Set<string>();
const open = new Set<string>();
/** The dimension picked in "Add filter", waiting for its value. */
let pendingDimension: Dimension | null = null;

interface Loaded {
  sessions: Session[];
  eventData: CsvRecord[];
  /** event_data's properties by event id: "game: hotel-77". */
  properties: Map<string, string[]>;
  hasEventData: boolean;
  note: string;
}
let loaded: Loaded | null = null;
let classified: ClassifiedSession[] = [];
let allRows: VisitRow[] = [];
let byId = new Map<string, ClassifiedSession>();
/** Each visitor's number, in the order they first came: #1 is the earliest. */
let numbers = new Map<string, number>();
/** The visitor whose profile is open, if any. */
let profileId: string | null = null;

function classify() {
  if (!loaded) return;
  classified = classifyAll(loaded.sessions, reportConfig, overrides);
  byId = new Map(classified.map((s) => [s.id, s]));
  numbers = new Map(classified.map((s, i) => [s.id, i + 1]));
  allRows = visitRows(classified, TZ);
}

function update() {
  write(STORE.view, view);
  drawSummary();
  drawBar();
  drawOutput();
}

const setFilters = (change: Partial<Filters>) => {
  view.filters = { ...view.filters, ...change };
  update();
};

/** Turns one value of a dimension on or off. */
function toggle(dimension: Dimension, value: string) {
  const current = view.filters.values[dimension] ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  setFilters({ values: { ...view.filters.values, [dimension]: next } });
}

/** Shows or hides one type, read from the filters as they are now, not as they were drawn. */
function toggleKind(kind: Kind) {
  const current = view.filters.kinds;
  setFilters({ kinds: current.includes(kind) ? current.filter((k) => k !== kind) : kinds.filter((k) => k === kind || current.includes(k)) });
}

/** Sets a dimension to exactly one value, or clears it if that's what it already was. */
function only(dimension: Dimension, value: string) {
  const current = view.filters.values[dimension] ?? [];
  const next = current.length === 1 && current[0] === value ? [] : [value];
  setFilters({ values: { ...view.filters.values, [dimension]: next } });
}

const sortOf = (name: string, fallback: SortState) => view.sorts[name] ?? fallback;
const setSort = (name: string) => (sort: SortState) => {
  view.sorts = { ...view.sorts, [name]: sort };
  update();
};
const expander = (name: string) => () => {
  expanded.add(name);
  update();
};

function setOverride(id: string, kind: Kind) {
  const ruled = byId.get(id)?.ruled.kind;
  if (kind === ruled) delete overrides[id];
  else overrides[id] = kind;
  write(STORE.overrides, Object.keys(overrides).length ? overrides : null);
  classify();
  update();
  if (profileId) drawProfile();
}

/* --- labels ---------------------------------------------------------------------- */

/** How a dimension's value reads on screen. */
function labelOf(dimension: Dimension, value: string) {
  if (dimension === 'visitor') {
    const session = byId.get(value);
    return session ? personLabel(session) : value.slice(0, 8);
  }
  if (dimension === 'hour') return `${value}:00`;
  return value;
}

const placeOf = (s: ClassifiedSession) => [s.city, s.region, s.country].filter(Boolean).join(', ') || '?';

/** "#12 · Rio de Janeiro · chrome on Windows 10": a name for a person, not an id. */
const personLabel = (s: ClassifiedSession) =>
  `#${numbers.get(s.id) ?? '?'} · ${s.city || s.country || 'Unknown place'} · ${s.browser ?? '?'} on ${s.os ?? '?'}`;

/** A person's name as a button that opens their profile. */
function personLink(session: ClassifiedSession) {
  const button = el('button', { type: 'button', class: 'link person', title: 'Open everything this visitor did' }, personLabel(session));
  button.addEventListener('click', () => openProfile(session.id));
  return button;
}
const deviceOf = (s: ClassifiedSession) => [s.device, s.browser, s.os].filter(Boolean).join(' · ');
const pathWithQuery = (path: string, query: string | null) => path + (query ? `?${query}` : '');

/** A small pill for a session's type, with its key. */
const kindTag = (kind: Kind) => el('span', { class: 'kind-tag' }, key(kind), kindNames[kind]);

/** A link-looking button that filters by a value. */
function filterLink(dimension: Dimension, value: string, text = labelOf(dimension, value)) {
  const button = el('button', { type: 'button', class: 'link', title: `Filter by ${dimensionLabels[dimension].toLowerCase()}: ${text}` }, text);
  button.addEventListener('click', () => toggle(dimension, value));
  return button;
}

function typePicker(session: ClassifiedSession) {
  const select = el('select', { 'aria-label': `Type of ${personLabel(session)}`, class: `kind-select kind-${session.kind}` });
  for (const kind of kinds) {
    const option = el('option', { value: kind }, kindLabel(kind));
    option.selected = kind === session.kind;
    select.append(option);
  }
  select.addEventListener('change', () => setOverride(session.id, select.value as Kind));
  return select;
}

/* --- the whole-export strip ------------------------------------------------------ */

function drawSummary() {
  if (!loaded) return summary.replaceChildren();
  const s = classificationSummary(classified);
  const changed = classified.filter((c) => c.kind !== c.ruled.kind).length;

  const again = el('button', { type: 'button', class: 'quiet' }, 'Load another export');
  again.addEventListener('click', () => {
    loadZone.hidden = false;
    input.click();
  });
  const forget = el('button', { type: 'button', class: 'quiet' }, 'Forget saved export');
  forget.addEventListener('click', () => {
    write(STORE.data, null);
    loaded = null;
    summary.replaceChildren();
    bar.hidden = true;
    output.replaceChildren();
    loadZone.hidden = false;
    status.textContent = 'Forgotten. Nothing from the export is kept in this browser now.';
  });
  const clear = el('button', { type: 'button', class: 'quiet', hidden: Object.keys(overrides).length === 0 }, `Clear hand changes (${changed} here)`);
  clear.addEventListener('click', () => {
    overrides = {};
    write(STORE.overrides, null);
    classify();
    update();
  });

  const figure = (value: string, label: string) => el('div', { class: 'figure' }, el('strong', {}, value), el('span', {}, label));
  summary.replaceChildren(
    el(
      'div',
      { class: 'whole' },
      el('div', { class: 'whole-head' }, el('h2', {}, 'Whole export'), el('p', { class: 'note' }, loaded.note)),
      el(
        'div',
        { class: 'figures' },
        figure(number(s.pageviews), 'Pageviews'),
        figure(`${number(s.myPageviews)} (${percent(s.myShare)})`, 'Mine'),
        figure(number(s.botSessions), 'Bot sessions'),
        figure(number(s.realSessions), 'Real sessions'),
        figure(number(s.realPageviews), 'Real pageviews')
      ),
      el('div', { class: 'actions' }, again, forget, clear)
    )
  );
}

/* --- the filter bar -------------------------------------------------------------- */

const dateRange = () => {
  const dates = allRows.map((r) => r.date);
  return { first: dates[0] ?? null, last: dates.at(-1) ?? null };
};

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function drawBar() {
  if (!loaded) return;
  bar.hidden = false;
  const { filters } = view;
  const { first, last } = dateRange();

  // Date: presets count back from the export's last day, not from today, so an old
  // export still has something in its "last 7 days".
  const presets: [string, string, string | null, string | null][] = [
    ['all', 'All dates', null, null],
    ['7', 'Last 7 days', last && addDays(last, -6), last],
    ['30', 'Last 30 days', last && addDays(last, -29), last],
    ['90', 'Last 90 days', last && addDays(last, -89), last],
  ];
  const current = presets.find(([, , from, to]) => from === filters.from && to === filters.to)?.[0] ?? 'custom';
  const preset = el('select', { 'aria-label': 'Date range' });
  for (const [value, label] of presets) preset.append(el('option', { value, selected: value === current }, label));
  if (current === 'custom') preset.append(el('option', { value: 'custom', selected: true }, 'Custom'));
  preset.addEventListener('change', () => {
    const picked = presets.find(([value]) => value === preset.value);
    if (picked) setFilters({ from: picked[2], to: picked[3] });
  });
  const fromInput = el('input', { type: 'date', value: filters.from ?? '', min: first ?? undefined, max: last ?? undefined, 'aria-label': 'From' });
  const toInput = el('input', { type: 'date', value: filters.to ?? '', min: first ?? undefined, max: last ?? undefined, 'aria-label': 'To' });
  fromInput.addEventListener('change', () => setFilters({ from: fromInput.value || null }));
  toInput.addEventListener('change', () => setFilters({ to: toInput.value || null }));

  // Types, with how many visits each has under the other filters.
  const withoutKinds = applyFilters(allRows, { ...filters, kinds: [...kinds] });
  const typeButtons = kinds.map((kind) => {
    const on = filters.kinds.includes(kind);
    const count = withoutKinds.filter((r) => r.kind === kind).length;
    const button = el(
      'button',
      { type: 'button', class: `type-toggle${on ? '' : ' off'}`, 'aria-pressed': String(on) },
      key(kind),
      kindNames[kind],
      el('span', { class: 'count' }, number(count))
    );
    button.addEventListener('click', () =>
      toggleKind(kind)
    );
    return button;
  });

  // Add filter: pick a dimension, then one of its values (with counts under the rest).
  const dimensions = Object.keys(dimensionLabels) as Dimension[];
  const dimensionSelect = el('select', { 'aria-label': 'Add a filter' });
  dimensionSelect.append(el('option', { value: '' }, '+ Add filter'));
  for (const d of dimensions) dimensionSelect.append(el('option', { value: d, selected: d === pendingDimension }, dimensionLabels[d]));
  dimensionSelect.addEventListener('change', () => {
    pendingDimension = (dimensionSelect.value || null) as Dimension | null;
    drawBar();
    barMain.querySelector<HTMLSelectElement>('[data-value-select]')?.focus();
  });
  let valueSelect: HTMLSelectElement | null = null;
  if (pendingDimension) {
    const dimension = pendingDimension;
    const options = breakdown(applyFilters(allRows, filters, dimension), dimension, 'visits');
    valueSelect = el('select', { 'aria-label': `${dimensionLabels[dimension]} value`, 'data-value-select': true });
    valueSelect.append(el('option', { value: '' }, `Pick ${dimensionLabels[dimension].toLowerCase()}…`));
    for (const option of options) {
      const on = filters.values[dimension]?.includes(option.value);
      valueSelect.append(el('option', { value: option.value }, `${on ? '✓ ' : ''}${labelOf(dimension, option.value)} (${option.visits})`));
    }
    valueSelect.addEventListener('change', () => {
      const value = valueSelect!.value;
      if (!value) return;
      pendingDimension = null;
      toggle(dimension, value);
    });
  }

  barMain.replaceChildren(
    el('div', { class: 'bar-group' }, preset, fromInput, el('span', { class: 'dash' }, '–'), toInput),
    el('div', { class: 'bar-group', role: 'group', 'aria-label': 'Types' }, ...typeButtons),
    el('div', { class: 'bar-group' }, dimensionSelect, valueSelect)
  );

  // Active filters as chips.
  const list: HTMLElement[] = [];
  if (filters.from || filters.to) {
    const chip = el('button', { type: 'button', class: 'chip' }, `Dates: ${filters.from ? day(filters.from) : 'start'} – ${filters.to ? day(filters.to) : 'end'}`, el('span', { 'aria-hidden': 'true' }, ' ✕'));
    chip.setAttribute('aria-label', `Remove the date filter`);
    chip.addEventListener('click', () => setFilters({ from: null, to: null }));
    list.push(chip);
  }
  for (const [dimension, values] of Object.entries(filters.values) as [Dimension, string[]][]) {
    for (const value of values) {
      const text = `${dimensionLabels[dimension]}: ${labelOf(dimension, value)}`;
      const chip = el('button', { type: 'button', class: 'chip', 'aria-label': `Remove ${text}` }, text, el('span', { 'aria-hidden': 'true' }, ' ✕'));
      chip.addEventListener('click', () => toggle(dimension, value));
      list.push(chip);
    }
  }
  const narrowed = list.length > 0 || filters.search || filters.kinds.join() !== startFilters().kinds.join();
  if (narrowed) {
    const reset = el('button', { type: 'button', class: 'link' }, 'Reset filters');
    reset.addEventListener('click', () => {
      search.value = '';
      pendingDimension = null;
      setFilters(startFilters());
    });
    list.push(reset);
  }
  chips.replaceChildren(...list);
  if (search.value !== filters.search) search.value = filters.search;
}

let typing = 0;
search.addEventListener('input', () => {
  clearTimeout(typing);
  typing = window.setTimeout(() => {
    view.filters = { ...view.filters, search: search.value };
    write(STORE.view, view);
    drawBar();
    drawOutput();
  }, 150);
});

/* --- the sections ---------------------------------------------------------------- */

const card = (title: string, controls: Child, ...children: Child[]) =>
  el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, title), controls || null), ...children);

const note = (text: string) => el('p', { class: 'note' }, text);

function kpis(rows: VisitRow[]) {
  const t = totals(rows);
  const split = (pick: (k: Kind) => number) =>
    el('span', { class: 'split' }, ...kinds.filter((k) => view.filters.kinds.includes(k)).map((k) => el('span', {}, key(k), number(pick(k)))));
  const tile = (value: string, label: string, extra?: Child, hint?: string) =>
    el('div', { class: 'tile', title: hint }, el('span', { class: 'tile-label' }, label), el('strong', {}, value), extra || null);
  return el(
    'div',
    { class: 'tiles' },
    tile(number(t.views), 'Views', split((k) => t.byKind[k].views)),
    tile(number(t.visits), 'Visits', split((k) => t.byKind[k].visits)),
    tile(number(t.visitors), 'Visitors', split((k) => t.byKind[k].visitors), 'Umami sessions: one device on one network'),
    tile(percent(t.bounceRate), 'Bounce rate', el('span', { class: 'split' }, `${number(t.bounces)} one-page visits`)),
    tile(t.viewsPerVisit.toFixed(1), 'Views per visit'),
    tile(duration(t.medianDuration), 'Median visit'),
    tile(duration(t.measuredTime), 'Time measured', null, 'Time between pageviews, summed. The last page of each visit has nothing after it to measure against.')
  );
}

function timelineCard(rows: VisitRow[]) {
  const { filters } = view;
  const granularity = view.granularity === 'auto' ? autoGranularity(rows.length ? rows : allRows) : view.granularity;
  const buckets = timeline(rows, granularity, TZ);
  const hourFilter = filters.values.hour ?? [];
  const label = (key: string) =>
    granularity === 'hour' ? `${shortDay(key.slice(0, 10))} ${key.slice(11)}h` : granularity === 'month' ? key.slice(0, 7) : shortDay(key);
  const title = (b: (typeof buckets)[number]) =>
    granularity === 'hour'
      ? `${day(b.from)}, ${b.key.slice(11)}:00`
      : granularity === 'day'
        ? day(b.from)
        : `${day(b.from)} – ${day(b.to)}`;
  const selected = (b: (typeof buckets)[number]) =>
    filters.from === b.from && filters.to === b.to && (granularity !== 'hour' || (hourFilter.length === 1 && hourFilter[0] === b.key.slice(11)));

  const chart = stackedColumns({
    columns: buckets.map((b) => ({ label: label(b.key), title: title(b), values: b[view.measure], selected: selected(b) })),
    show: kinds.filter((k) => filters.kinds.includes(k)),
    unit: view.measure,
    ariaLabel: `${view.measure} per ${granularity}, by type`,
    onClick: (i) => {
      const b = buckets[i];
      if (selected(b)) {
        setFilters({ from: null, to: null, values: granularity === 'hour' ? { ...filters.values, hour: [] } : filters.values });
      } else {
        setFilters({ from: b.from, to: b.to, values: granularity === 'hour' ? { ...filters.values, hour: [b.key.slice(11)] } : filters.values });
      }
    },
  });

  const controls = el(
    'div',
    { class: 'controls' },
    segmented('Measure', [['views', 'Views'], ['visits', 'Visits']], view.measure, (m) => { view.measure = m; update(); }),
    segmented('Bucket size', [['auto', 'Auto'], ['hour', 'Hour'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month']], view.granularity, (g) => { view.granularity = g; update(); })
  );

  const tableView = el(
    'details',
    { class: 'table-view' },
    el('summary', {}, 'Table view'),
    table({
      label: 'Timeline',
      columns: [
        { key: 'when', label: 'When', sort: (b) => b.key, cell: (b) => title(b) },
        ...kinds.map((k) => ({ key: k, label: kindNames[k], numeric: true, sort: (b: (typeof buckets)[number]) => b[view.measure][k], cell: (b: (typeof buckets)[number]) => number(b[view.measure][k]) })),
      ],
      rows: buckets.filter((b) => kinds.some((k) => b[view.measure][k] > 0)),
      sort: sortOf('timeline', { key: 'when', descending: false }),
      onSort: setSort('timeline'),
      expanded: expanded.has('timeline'),
      onExpand: expander('timeline'),
    })
  );

  return card(
    `${view.measure === 'views' ? 'Views' : 'Visits'} over time`,
    controls,
    rows.length ? chart : el('p', { class: 'empty' }, 'Nothing with these filters.'),
    legend(kinds.filter((k) => filters.kinds.includes(k)), (kind) =>
      toggleKind(kind)
    ),
    note(`Click a column to keep only that ${granularity}; click it again to let go. Times are ${TZ}.`),
    tableView
  );
}

function heatmapCard() {
  const { filters } = view;
  const rows = applyFilters(allRows, { ...filters, values: { ...filters.values, weekday: [], hour: [] } });
  const weekday = filters.values.weekday?.length === 1 ? filters.values.weekday[0] : null;
  const hour = filters.values.hour?.length === 1 ? Number(filters.values.hour[0]) : null;
  const hh = (h: number) => String(h).padStart(2, '0');
  return card(
    'When people look',
    null,
    heatmapChart({
      grid: heatmap(rows, TZ),
      rows: weekdays,
      selected: { row: weekday, column: hour },
      onCell: (r, h) => {
        const same = weekday === weekdays[r] && hour === h;
        setFilters({ values: { ...filters.values, weekday: same ? [] : [weekdays[r]], hour: same ? [] : [hh(h)] } });
      },
      onRow: (r) => only('weekday', weekdays[r]),
      onColumn: (h) => only('hour', hh(h)),
    }),
    note(`Views by weekday and hour, ${TZ}. Click a cell, a day or an hour to filter by it.`)
  );
}

const breakdownDimensions: Dimension[] = [
  'source', 'referrer', 'country', 'region', 'city', 'device', 'browser', 'os', 'screen', 'language', 'entry', 'exit', 'page', 'event',
];

function breakdownSection() {
  const { filters, metric } = view;
  const format = (amount: number) => (metric === 'time' ? duration(amount) : number(amount));
  const cards = breakdownDimensions.map((dimension) => {
    const data = breakdown(applyFilters(allRows, filters, dimension), dimension, metric).filter((r) => r[metric] > 0 || metric !== 'time');
    const name = `breakdown:${dimension}`;
    const shown = expanded.has(name) ? data : data.slice(0, 8);
    const more =
      data.length > shown.length
        ? (() => {
            const button = el('button', { type: 'button', class: 'more' }, `Show all ${data.length}`);
            button.addEventListener('click', expander(name));
            return button;
          })()
        : null;
    return card(
      dimensionLabels[dimension],
      null,
      data.length === 0
        ? el('p', { class: 'empty' }, dimension === 'event' ? 'No click events with these filters.' : 'Nothing with these filters.')
        : barList(
            shown.map((r) => ({
              value: r.value,
              label: labelOf(dimension, r.value),
              amount: r[metric],
              note: `${number(r.visits)} visits · ${number(r.visitors)} visitors · ${number(r.views)} views · ${duration(r.time)}`,
              byKind: r.byKind,
              selected: filters.values[dimension]?.includes(r.value) ?? false,
            })),
            format,
            (value) => toggle(dimension, value)
          ),
      more
    );
  });
  return el(
    'section',
    { class: 'breakdowns' },
    el(
      'div',
      { class: 'section-head' },
      el('h2', {}, 'Breakdowns'),
      segmented('Measure', (Object.keys(metricLabels) as Metric[]).map((m) => [m, metricLabels[m]]), metric, (m) => { view.metric = m; update(); })
    ),
    note('Click any row to filter by it, and again to remove it. Each list ignores its own filter, so the other values stay visible to add.'),
    el('div', { class: 'grid' }, ...cards)
  );
}

function durationCard(rows: VisitRow[]) {
  const data = durations(rows);
  return card(
    'How long visits last',
    null,
    stackedColumns({
      columns: data.map((d) => ({ label: d.label, title: d.label, values: d.byKind })),
      show: kinds.filter((k) => view.filters.kinds.includes(k)),
      unit: 'visits',
      width: 560,
      height: 260,
      ariaLabel: 'Visits by duration',
    }),
    note('From the first event to the last in each visit. A one-page visit has no length to measure.')
  );
}

function pagesCard(rows: VisitRow[]) {
  const data = pages(rows);
  return card(
    'Pages',
    null,
    table({
      label: 'Pages',
      rows: data,
      sort: sortOf('pages', { key: 'views', descending: true }),
      onSort: setSort('pages'),
      expanded: expanded.has('pages'),
      onExpand: expander('pages'),
      columns: [
        { key: 'path', label: 'Page', sort: (p) => p.path, cell: (p) => filterLink('page', p.path) },
        { key: 'views', label: 'Views', numeric: true, sort: (p) => p.views, cell: (p) => number(p.views) },
        { key: 'visits', label: 'Visits', numeric: true, sort: (p) => p.visits, cell: (p) => number(p.visits) },
        { key: 'visitors', label: 'Visitors', numeric: true, sort: (p) => p.visitors, cell: (p) => number(p.visitors) },
        { key: 'entries', label: 'Entries', numeric: true, sort: (p) => p.entries, cell: (p) => number(p.entries), hint: 'Visits that started here' },
        { key: 'exits', label: 'Exits', numeric: true, sort: (p) => p.exits, cell: (p) => number(p.exits), hint: 'Visits that ended here' },
        { key: 'bounces', label: 'Bounces', numeric: true, sort: (p) => p.bounces, cell: (p) => number(p.bounces), hint: 'Visits that saw only this page' },
        { key: 'time', label: 'Total time', numeric: true, sort: (p) => p.time, cell: (p) => duration(p.time), hint: 'Measured time on this page, summed' },
        { key: 'average', label: 'Avg. time', numeric: true, sort: (p) => p.averageTime, cell: (p) => duration(p.averageTime), hint: 'Over the views that could be timed' },
      ],
    }),
    note('Time on a page runs until the next page in the same visit. The last page of a visit has no next page, so it adds no time: a visit that ends on a page it read for ten minutes shows nothing for those ten minutes.')
  );
}

function visitorsCard(rows: VisitRow[]) {
  return card(
    'People',
    null,
    table({
      label: 'People',
      onRowClick: (v) => openProfile(v.session.id),
      rows: visitors(rows),
      sort: sortOf('visitors', { key: 'last', descending: true }),
      onSort: setSort('visitors'),
      expanded: expanded.has('visitors'),
      onExpand: expander('visitors'),
      rowClass: (v) => (v.session.kind !== v.session.ruled.kind ? 'changed' : ''),
      columns: [
        { key: 'kind', label: 'Type', sort: (v) => v.session.kind, cell: (v) => typePicker(v.session) },
        { key: 'visitor', label: 'Person', sort: (v) => numbers.get(v.session.id) ?? 0, cell: (v) => personLink(v.session) },
        { key: 'place', label: 'Place', sort: (v) => placeOf(v.session), cell: (v) => placeOf(v.session) },
        { key: 'device', label: 'Device', sort: (v) => deviceOf(v.session), cell: (v) => deviceOf(v.session) },
        { key: 'screen', label: 'Screen', sort: (v) => v.session.screen, cell: (v) => v.session.screen ?? '' },
        { key: 'language', label: 'Language', sort: (v) => v.session.language, cell: (v) => v.session.language ?? '' },
        { key: 'source', label: 'First source', sort: (v) => v.session.source, cell: (v) => v.session.source },
        { key: 'visits', label: 'Visits', numeric: true, sort: (v) => v.visits, cell: (v) => number(v.visits) },
        { key: 'views', label: 'Views', numeric: true, sort: (v) => v.views, cell: (v) => number(v.views) },
        { key: 'time', label: 'Time', numeric: true, sort: (v) => v.time, cell: (v) => duration(v.time) },
        { key: 'first', label: 'First seen', sort: (v) => v.first.getTime(), cell: (v) => moment(v.first, TZ) },
        { key: 'last', label: 'Last seen', sort: (v) => v.last.getTime(), cell: (v) => moment(v.last, TZ) },
        { key: 'reason', label: 'Why this type', sort: (v) => v.session.reason, cell: (v) => el('span', { class: 'reason' }, v.session.reason) },
      ],
    }),
    note('Click a person to see everything they did, visit by visit. A person here is an Umami session: one device on one network, so the same human on a phone and on a laptop shows up twice. Change a type and the whole report follows; the change is kept in this browser.')
  );
}

function stepsOf(row: VisitRow) {
  return el(
    'ol',
    { class: 'steps' },
    ...row.steps.map((step) =>
      el(
        'li',
        {},
        el('span', { class: 'step-time' }, clockTime(step.view.createdAt, TZ)),
        filterLink('page', step.view.urlPath, pathWithQuery(step.view.urlPath, step.view.urlQuery)),
        el('span', { class: 'step-stay' }, step.timeOnPage === null ? 'last page' : duration(step.timeOnPage)),
        ...step.events.map((event) =>
          el('span', { class: 'step-event' }, `● ${[event.eventName, ...(loaded?.properties.get(event.eventId) ?? [])].join(' · ')}`)
        )
      )
    )
  );
}

function visitsCard(rows: VisitRow[]) {
  return card(
    'Visits',
    null,
    table({
      label: 'Visits',
      rows,
      sort: sortOf('visits', { key: 'start', descending: true }),
      onSort: setSort('visits'),
      expanded: expanded.has('visits'),
      onExpand: expander('visits'),
      isOpen: (r) => open.has(r.visit.id),
      detail: stepsOf,
      onRowClick: (r) => {
        if (open.has(r.visit.id)) open.delete(r.visit.id);
        else open.add(r.visit.id);
        drawOutput();
      },
      rowClass: (r) => (open.has(r.visit.id) ? 'open' : ''),
      columns: [
        { key: 'start', label: 'Start', sort: (r) => r.visit.start.getTime(), cell: (r) => el('span', {}, el('span', { class: 'disclosure', 'aria-hidden': 'true' }, open.has(r.visit.id) ? '▾ ' : '▸ '), moment(r.visit.start, TZ)) },
        { key: 'kind', label: 'Type', sort: (r) => r.kind, cell: (r) => kindTag(r.kind) },
        { key: 'visitor', label: 'Person', sort: (r) => numbers.get(r.session.id) ?? 0, cell: (r) => personLink(r.session) },
        { key: 'place', label: 'Place', sort: (r) => placeOf(r.session), cell: (r) => placeOf(r.session) },
        { key: 'source', label: 'Source', sort: (r) => r.visit.source, cell: (r) => filterLink('source', r.visit.source) },
        { key: 'entry', label: 'Entry', sort: (r) => r.visit.pageviews[0]?.urlPath ?? '', cell: (r) => r.visit.pageviews[0]?.urlPath ?? '' },
        { key: 'views', label: 'Views', numeric: true, sort: (r) => r.visit.pageviews.length, cell: (r) => number(r.visit.pageviews.length) },
        { key: 'duration', label: 'Duration', numeric: true, sort: (r) => r.duration, cell: (r) => duration(r.duration) },
        { key: 'events', label: 'Clicks', numeric: true, sort: (r) => r.visit.events.filter((e) => e.eventType === 2).length, cell: (r) => number(r.visit.events.filter((e) => e.eventType === 2).length) },
      ],
    }),
    note('Click a visit to see every page in order, how long each one held them, and what they clicked.')
  );
}

function usageCard(title: string, name: string, data: ReturnType<typeof filterUsage>, label: string, empty: string) {
  return card(
    title,
    null,
    table({
      label: title,
      rows: data,
      empty,
      sort: sortOf(name, { key: 'total', descending: true }),
      onSort: setSort(name),
      expanded: expanded.has(name),
      onExpand: expander(name),
      columns: [
        { key: 'value', label, sort: (r) => r.value, cell: (r) => r.value },
        ...kinds
          .filter((k) => view.filters.kinds.includes(k))
          .map((k) => ({ key: k, label: kindNames[k], numeric: true, sort: (r: (typeof data)[number]) => r.byKind[k], cell: (r: (typeof data)[number]) => number(r.byKind[k]) })),
        { key: 'total', label: 'Total', numeric: true, sort: (r) => r.total, cell: (r) => number(r.total) },
      ],
    })
  );
}

function eventsCard(rows: VisitRow[]) {
  if (!loaded) return null;
  const data = events(rows, loaded.eventData);
  return card(
    'Click events',
    null,
    table({
      label: 'Click events',
      rows: data,
      empty: loaded.hasEventData ? 'No click events with these filters.' : 'No event_data.csv in this export.',
      sort: sortOf('events', { key: 'total', descending: true }),
      onSort: setSort('events'),
      columns: [
        { key: 'name', label: 'Event', sort: (r) => r.name, cell: (r) => filterLink('event', r.name, r.name) },
        ...kinds
          .filter((k) => view.filters.kinds.includes(k))
          .map((k) => ({ key: k, label: kindNames[k], numeric: true, sort: (r: (typeof data)[number]) => r.byKind[k], cell: (r: (typeof data)[number]) => number(r.byKind[k]) })),
        { key: 'total', label: 'Total', numeric: true, sort: (r) => r.total, cell: (r) => number(r.total) },
        { key: 'details', label: 'Details', cell: (r) => r.details.map((d) => `${d.label} (${d.count})`).join(', ') },
      ],
    })
  );
}

function drawOutput() {
  if (!loaded) return;
  const rows = applyFilters(allRows, view.filters);
  output.replaceChildren(
    kpis(rows),
    visitorsCard(rows),
    timelineCard(rows),
    el('div', { class: 'pair' }, heatmapCard(), durationCard(rows)),
    breakdownSection(),
    pagesCard(rows),
    visitsCard(rows),
    el(
      'div',
      { class: 'pair' },
      usageCard('Portfolio filters (?f=)', 'filters', filterUsage(rows), 'Filter', 'No portfolio filters used with these filters.'),
      usageCard('Portfolio searches (?q=)', 'searches', searchUsage(rows), 'Search', 'No searches with these filters.')
    ),
    eventsCard(rows) ?? ""
  );
}

/* --- one person ------------------------------------------------------------------ */

/** The people in the order the People table shows them, for previous and next. */
function peopleInView() {
  const rows = applyFilters(allRows, view.filters);
  const sort = sortOf('visitors', { key: 'last', descending: true });
  const list = visitors(rows);
  const read: Record<string, (v: (typeof list)[number]) => number | string> = {
    kind: (v) => v.session.kind,
    visitor: (v) => numbers.get(v.session.id) ?? 0,
    place: (v) => placeOf(v.session),
    visits: (v) => v.visits,
    views: (v) => v.views,
    time: (v) => v.time,
    first: (v) => v.first.getTime(),
    last: (v) => v.last.getTime(),
  };
  const by = read[sort.key] ?? read.last;
  return list
    .sort((a, b) => {
      const x = by(a);
      const y = by(b);
      const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.descending ? -order : order;
    })
    .map((v) => v.session.id);
}

function openProfile(id: string) {
  profileId = id;
  drawProfile();
  if (!profile.open) profile.showModal();
  profile.querySelector<HTMLElement>('.profile-body')?.scrollTo(0, 0);
}

profile.addEventListener('close', () => (profileId = null));
// A click on the backdrop (the dialog itself, outside its sheet) closes it.
profile.addEventListener('click', (event) => {
  if (event.target === profile) profile.close();
});

function drawProfile() {
  const session = profileId ? byId.get(profileId) : undefined;
  if (!session || !loaded) return;
  const properties = loaded.properties;
  // Every visit this person made, whatever the filters: the whole story.
  const rows = allRows.filter((r) => r.session.id === session.id);
  const t = totals(rows);
  const people = peopleInView();
  const at = people.indexOf(session.id);

  const step = (offset: number, text: string) => {
    const target = at === -1 ? undefined : people[at + offset];
    const button = el('button', { type: 'button', class: 'quiet', disabled: !target }, text);
    if (target) button.addEventListener('click', () => openProfile(target));
    return button;
  };
  const close = el('button', { type: 'button', class: 'quiet close', 'aria-label': 'Close' }, '✕');
  close.addEventListener('click', () => profile.close());
  const filterTo = el('button', { type: 'button', class: 'quiet' }, 'Show only this person in the report');
  filterTo.addEventListener('click', () => {
    profile.close();
    setFilters({ kinds: [...kinds], values: { ...view.filters.values, visitor: [session.id] } });
  });

  const fact = (label: string, value: Child) => el('div', { class: 'fact' }, el('dt', {}, label), el('dd', {}, value));
  const sources = [...new Set(rows.map((r) => r.visit.source))].join(', ');
  const clicks = rows.flatMap((r) => r.visit.events.filter((e) => e.eventType === 2));
  const describe = (event: (typeof clicks)[number]) => [event.eventName, ...(properties.get(event.eventId) ?? [])].join(' · ');

  const visitBlocks = [...rows].reverse().map((row, i) =>
    el(
      'section',
      { class: 'profile-visit' },
      el(
        'h3',
        {},
        `Visit ${rows.length - i} · ${moment(row.visit.start, TZ)}`,
        el(
          'span',
          { class: 'visit-meta' },
          `${duration(row.duration)} · ${number(row.visit.pageviews.length)} ${row.visit.pageviews.length === 1 ? 'page' : 'pages'} · from ${row.visit.source}` +
            (row.visit.referrer && row.visit.source !== row.visit.referrer ? ` (${row.visit.referrer})` : '')
        )
      ),
      stepsOf(row)
    )
  );

  profile.replaceChildren(
    el(
      'div',
      { class: 'profile-sheet' },
      el(
        'header',
        { class: 'profile-head' },
        el('div', {}, el('h2', {}, personLabel(session)), el('p', { class: 'reason' }, session.reason)),
        el(
          'div',
          { class: 'profile-nav' },
          step(-1, '← Previous'),
          el('span', { class: 'note' }, at === -1 ? '' : `${at + 1} of ${people.length}`),
          step(1, 'Next →'),
          close
        )
      ),
      el(
        'div',
        { class: 'profile-body' },
        el(
          'dl',
          { class: 'facts' },
          fact('Type', typePicker(session)),
          fact('Place', placeOf(session)),
          fact('Device', deviceOf(session)),
          fact('Screen', session.screen ?? '?'),
          fact('Language', session.language ?? '?'),
          fact('Came from', sources),
          fact('First seen', moment(session.start, TZ)),
          fact('Last seen', moment(session.end, TZ)),
          fact('Visits', number(t.visits)),
          fact('Pages viewed', number(t.views)),
          fact('Time measured', duration(t.measuredTime)),
          fact('Clicks', clicks.length ? clicks.map(describe).join('; ') : 'None recorded')
        ),
        el('h3', { class: 'profile-sub' }, 'Pages, over all visits'),
        table({
          label: 'Pages this person viewed',
          rows: personPages(rows),
          sort: sortOf('person-pages', { key: 'time', descending: true }),
          onSort: (sort) => {
            view.sorts = { ...view.sorts, 'person-pages': sort };
            write(STORE.view, view);
            drawProfile();
          },
          limit: 100,
          columns: [
            { key: 'path', label: 'Page', sort: (p) => p.path, cell: (p) => p.path },
            { key: 'views', label: 'Views', numeric: true, sort: (p) => p.views, cell: (p) => number(p.views) },
            { key: 'time', label: 'Time', numeric: true, sort: (p) => p.time, cell: (p) => duration(p.time) },
            { key: 'clicks', label: 'Clicks', numeric: true, sort: (p) => p.clicks, cell: (p) => number(p.clicks) },
          ],
        }),
        el('h3', { class: 'profile-sub' }, 'Every visit, newest first'),
        note('Each page shows how long it held them before the next one. The last page of a visit has no next page, so how long they stayed on it is unknown.'),
        ...visitBlocks,
        el('div', { class: 'actions' }, filterTo)
      )
    )
  );
}

/* --- loading --------------------------------------------------------------------- */

interface Saved {
  websiteEvent: string;
  eventData?: string;
  sessionData?: boolean;
  names: string;
}

function use(saved: Saved) {
  const records = parseRecords(saved.websiteEvent);
  const sessions = buildSessions(readEvents(records), reportConfig);
  const eventData = saved.eventData ? parseRecords(saved.eventData) : [];
  const first = sessions[0]?.start;
  const last = sessions.reduce((latest, s) => (s.end > latest ? s.end : latest), first ?? new Date(0));
  const note = [
    `${saved.names}.`,
    `${number(records.length)} events, ${first ? `${moment(first, TZ)} to ${moment(last, TZ)}` : 'none'}.`,
    saved.eventData ? `event_data.csv: ${number(eventData.length)} rows.` : 'No event_data.csv.',
    saved.sessionData ? 'session_data.csv only holds identify() data, which the site doesn\'t send, so it isn\'t used.' : '',
  ].filter(Boolean).join(' ');
  loaded = { sessions, eventData, properties: eventProperties(eventData), hasEventData: Boolean(saved.eventData), note };
  classify();
  loadZone.hidden = true;
  status.textContent = '';
  update();
}

async function load(files: File[]) {
  if (files.length === 0) return;
  status.textContent = 'Reading…';
  try {
    const dropped: DroppedFile[] = await Promise.all(
      files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))
    );
    const found = await readExport(dropped);
    if (!found.websiteEvent) {
      status.textContent = `No website_event.csv in ${files.map((f) => f.name).join(', ')}.`;
      return;
    }
    const saved: Saved = {
      websiteEvent: found.websiteEvent,
      eventData: found.eventData,
      sessionData: Boolean(found.sessionData),
      names: `Read ${files.map((f) => f.name).join(', ')}` + (found.ignored.length ? ` (skipped ${found.ignored.join(', ')})` : ''),
    };
    // A new export starts from a clean view: old dates and visitors wouldn't match it.
    view = { ...defaultView(), sorts: view.sorts, metric: view.metric, measure: view.measure };
    expanded.clear();
    open.clear();
    use(saved);
    if (!write(STORE.data, saved)) status.textContent = 'Too big to keep in this browser: it will need loading again after a reload.';
  } catch (error) {
    status.textContent = `Couldn't read that: ${(error as Error).message}`;
  }
}

input.addEventListener('change', () => load([...(input.files ?? [])]));
loadZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  loadZone.dataset.over = '';
});
loadZone.addEventListener('dragleave', () => delete loadZone.dataset.over);
loadZone.addEventListener('drop', (event) => {
  event.preventDefault();
  delete loadZone.dataset.over;
  load([...(event.dataTransfer?.files ?? [])]);
});

// The export from last time, if this browser kept it.
const saved = read<Saved | null>(STORE.data, null);
if (saved?.websiteEvent) {
  try {
    use(saved);
  } catch {
    write(STORE.data, null);
  }
}

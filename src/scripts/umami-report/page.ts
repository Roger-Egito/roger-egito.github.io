/**
 * The analytics page: reads the collector, keeps the view's state, and draws every tab
 * from the pure modules in src/lib/umami-report.
 *
 * Laid out after tools built for reading a lot of traffic data:
 *
 *   - Overview, after Plausible: one strip of headline numbers that doubles as the
 *     chart's tabs, one big chart, then cards with small tabs, their rows drawn on faint
 *     bars you click to filter by.
 *   - People, after the person views in PostHog and Intercom: the list on the left, the
 *     chosen person on the right, their visits as one activity timeline.
 *   - Pages and Visits: plain sortable tables, for when the detail is the point.
 *
 * Everything below the top bar is redrawn from scratch on each change. The data is small
 * enough that it's instant, and no section can disagree with another about what's
 * filtered. The search box is the exception, so typing never loses focus.
 *
 * All the data comes from the site's own collector (collector/), read with the key from
 * a browser approved by email. The visits from before it, recorded by Umami, were
 * imported into it once. The only request the page makes is to the collector.
 */
import type { CsvRecord } from '../../lib/umami-report/csv.ts';
import { reportConfig } from '../../lib/umami-report/config.ts';
import { site } from '../../config/site';
import {
  buildSessions, classifyAll, kindLabel, readEvents,
  type ClassifiedSession, type Kind, type Session, type UmamiEvent,
} from '../../lib/umami-report/sessions.ts';
import {
  ENGAGED_MS, addDays, applyFilters, autoGranularity, breakdown, classificationSummary, clock, dimensionLabels, durations,
  eventProperties, events, filterUsage, heatmap, kinds, noFilters, pages, personPages, searchUsage, timeline, totals,
  visitRows, visitors, weekdays,
  type Dimension, type Filters, type Metric, type VisitRow, type VisitorRow,
} from '../../lib/umami-report/explore.ts';
import { heatmapChart, legend, rankList, stackedColumns, visitStrip } from './charts.ts';
import { faArrowUpRightFromSquare, faCheck, faCopy, faXmark } from '@fortawesome/free-solid-svg-icons';
import { clockTime, day, duration, el, hideTip, icon, key, kindNames, moment, number, percent, segmented, shortDay, type Child } from './dom.ts';
import { table, type SortState } from './table.ts';

const TZ = reportConfig.timeZone;
const ENGAGED_S = ENGAGED_MS / 1000;
const STORE = {
  overrides: 'umami-report:overrides',
  view: 'umami-report:view',
  /** The collector's read key, and its address when it isn't the one in site.ts. */
  key: 'umami-report:key',
  collector: 'umami-report:collector',
  /** This browser's id for the collector, which emails Roger to approve each new one. */
  device: 'umami-report:device',
};

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const connect = $<HTMLFormElement>('[data-report-connect]');
const status = $<HTMLElement>('[data-report-status]');
const app = $<HTMLElement>('[data-report-app]');
const controls = $<HTMLElement>('[data-report-controls]');
const chipRow = $<HTMLElement>('[data-report-chips]');
const tabRow = $<HTMLElement>('[data-report-tabs]');
const search = $<HTMLInputElement>('[data-report-search]');
const main = $<HTMLElement>('[data-report-main]');

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
    return false; // storage blocked or full: everything still works, it just isn't remembered
  }
};

/* --- state ----------------------------------------------------------------------- */

type Tab = 'overview' | 'people' | 'pages' | 'visits';
type Count = 'visitors' | 'visits' | 'views';
type PeopleOrder = 'last' | 'first' | 'views' | 'time' | 'visits';

interface View {
  filters: Filters;
  tab: Tab;
  /** What the chart and the breakdown cards count. */
  count: Count;
  /** The tab picked inside each card: { pages: 'entry' }. */
  cardTabs: Record<string, string>;
  sorts: Record<string, SortState>;
  peopleOrder: PeopleOrder;
  person: string | null;
}

/** Real visitors only, to start with: the people are what the page is for. */
const startFilters = (): Filters => ({ ...noFilters(), kinds: ['real'] });

const defaultView = (): View => ({
  filters: startFilters(),
  tab: 'overview',
  count: 'visitors',
  cardTabs: {},
  sorts: {},
  peopleOrder: 'last',
  person: null,
});

let view: View = { ...defaultView(), ...read<Partial<View>>(STORE.view, {}) };
let overrides = read<Record<string, Kind>>(STORE.overrides, {});
/** Cards showing every row, and visits opened to their pages. Not saved. */
const expanded = new Set<string>();
const open = new Set<string>();
/** Which top-bar menu is open, so a redraw keeps it open. */
let openMenu: string | null = null;
/** The Filter menu's dimension, and the text typed to narrow its values. */
let pendingDimension: Dimension | null = null;
let valueQuery = '';

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

function classify() {
  if (!loaded) return;
  classified = classifyAll(loaded.sessions, reportConfig, overrides);
  byId = new Map(classified.map((s) => [s.id, s]));
  numbers = new Map(classified.map((s, i) => [s.id, i + 1]));
  allRows = visitRows(classified, TZ);
}

function update() {
  write(STORE.view, view);
  hideTip();
  drawControls();
  drawChips();
  drawTabs();
  drawMain();
}

const setView = (change: Partial<View>) => {
  view = { ...view, ...change };
  update();
};

const setFilters = (change: Partial<Filters>) => setView({ filters: { ...view.filters, ...change } });

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
const setSort = (name: string) => (sort: SortState) => setView({ sorts: { ...view.sorts, [name]: sort } });
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
}

/** Opens a person in the People tab. */
const showPerson = (id: string) => setView({ tab: 'people', person: id });

/* --- labels ---------------------------------------------------------------------- */

const placeOf = (s: ClassifiedSession) => [s.city, s.region, s.country].filter(Boolean).join(', ') || 'Unknown place';
const deviceOf = (s: ClassifiedSession) => [s.device, s.browser, s.os].filter(Boolean).join(' · ');
/**
 * A stored page as the address it was: "/?f=unity#portfolio". The collector keeps the
 * #hash on the path, the way Umami did, so the query goes back in before it.
 */
function pathWithQuery(path: string, query: string | null) {
  const hashAt = path.indexOf('#');
  const [bare, hash] = hashAt === -1 ? [path, ''] : [path.slice(0, hashAt), path.slice(hashAt)];
  return bare + (query ? `?${query}` : '') + hash;
}

/** "#12 · Rio de Janeiro · chrome on Windows 10": a name for a person, not an id. */
const personLabel = (s: ClassifiedSession) =>
  `#${numbers.get(s.id) ?? '?'} · ${s.city || s.country || 'Unknown place'} · ${s.browser ?? '?'} on ${s.os ?? '?'}`;

function labelOf(dimension: Dimension, value: string) {
  if (dimension === 'visitor') {
    const session = byId.get(value);
    return session ? personLabel(session) : value.slice(0, 8);
  }
  if (dimension === 'hour') return `${value}:00`;
  return value;
}

const describeEvent = (event: UmamiEvent) => [event.eventName, ...(loaded?.properties.get(event.eventId) ?? [])].join(' · ');

/** A person's name as a button that opens them in the People tab. */
function personLink(session: ClassifiedSession) {
  const button = el('button', { type: 'button', class: 'link', title: 'See everything this person did' }, personLabel(session));
  button.addEventListener('click', () => showPerson(session.id));
  return button;
}

/** A link-looking button that filters by a value. */
function filterLink(dimension: Dimension, value: string, text = labelOf(dimension, value)) {
  const button = el('button', { type: 'button', class: 'link', title: `Filter by ${dimensionLabels[dimension].toLowerCase()}` }, text);
  button.addEventListener('click', () => toggle(dimension, value));
  return button;
}

/**
 * A page someone viewed, in a person's activity or a visit's steps: its address
 * filters the report to that page and opens the Overview, and two buttons beside it
 * open the page on the site in a new tab or copy its full address.
 */
function viewedPage(path: string, query: string | null) {
  const address = pathWithQuery(path, query);
  const full = new URL(address, site.url).href;

  const filter = el('button', { type: 'button', class: 'link', title: 'Filter the report to this page and see it in the Overview' }, address);
  filter.addEventListener('click', () => {
    const current = view.filters.values.page ?? [];
    // Added, never toggled off: the click means "show me this page".
    const page = current.includes(path) ? current : [...current, path];
    setView({ tab: 'overview', filters: { ...view.filters, values: { ...view.filters.values, page } } });
  });

  const open = el('a', { class: 'icon-button', href: full, target: '_blank', rel: 'noopener', title: 'Open this page on the site', 'aria-label': `Open ${address} on the site` }, icon(faArrowUpRightFromSquare));

  const copy = el('button', { type: 'button', class: 'icon-button', title: 'Copy the address', 'aria-label': `Copy the address of ${address}` }, icon(faCopy));
  let reset: number | undefined;
  copy.addEventListener('click', async () => {
    let copied = true;
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      copied = false; // no permission, or not a secure page
    }
    copy.replaceChildren(icon(copied ? faCheck : faXmark));
    copy.title = copied ? 'Copied' : 'The browser didn’t allow copying';
    window.clearTimeout(reset);
    reset = window.setTimeout(() => {
      copy.replaceChildren(icon(faCopy));
      copy.title = 'Copy the address';
    }, 1500);
  });

  return el('span', { class: 'event-page' }, filter, open, copy);
}

const kindTag = (kind: Kind) => el('span', { class: 'kind-tag' }, key(kind), kindNames[kind]);

function typePicker(session: ClassifiedSession) {
  const select = el('select', { 'aria-label': `Type of ${personLabel(session)}`, class: `kind-select kind-${session.kind}` });
  for (const kind of kinds) select.append(el('option', { value: kind, selected: kind === session.kind }, kindLabel(kind)));
  select.addEventListener('change', () => setOverride(session.id, select.value as Kind));
  return select;
}

const countLabels: Record<Count, string> = { visitors: 'Visitors', visits: 'Visits', views: 'Views' };

/* --- top bar: menus -------------------------------------------------------------- */

/** A menu that opens under its button and stays open across redraws. */
function menu(name: string, summary: Child, panel: () => Child[], className = '') {
  const details = el('details', { class: `menu ${className}`, open: openMenu === name });
  details.append(el('summary', {}, summary), el('div', { class: 'menu-panel' }, ...(openMenu === name ? panel() : [])));
  details.addEventListener('toggle', () => {
    if (details.open) {
      openMenu = name;
      details.querySelector('.menu-panel')!.replaceChildren(...(panel().filter(Boolean) as Node[]));
      details.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (openMenu === name) {
      openMenu = null;
    }
  });
  return details;
}

// A click outside a menu, or Esc, closes it. A click on something its own handler just
// redrew away (picking a filter value redraws the menu it was in) is no longer on the
// page, so it can't say where it was: those are left alone.
document.addEventListener('click', (event) => {
  const target = event.target as Element;
  if (!target.isConnected) return;
  const inside = target.closest('details.menu');
  for (const details of document.querySelectorAll<HTMLDetailsElement>('.report details.menu[open]')) {
    if (details !== inside) details.open = false;
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  for (const details of document.querySelectorAll<HTMLDetailsElement>('.report details.menu[open]')) details.open = false;
});

interface Period {
  id: 'all' | 'today' | '7' | '30' | '90';
  label: string;
  /** The chart's button for it. */
  short: string;
  from: string | null;
  to: string | null;
}

/**
 * The periods the date menu and the chart both offer. Each one is just the date filter,
 * so picking one filters every number on the page. They count back from today, in the
 * report's zone, since the collector's data runs up to now.
 */
function periods(): Period[] {
  const today = clock(new Date(), TZ).date;
  return [
    { id: 'all', label: 'All dates', short: 'All', from: null, to: null },
    { id: 'today', label: 'Today', short: 'Today', from: today, to: today },
    { id: '7', label: 'Last 7 days', short: '7 days', from: addDays(today, -6), to: today },
    { id: '30', label: 'Last 30 days', short: '30 days', from: addDays(today, -29), to: today },
    { id: '90', label: 'Last 90 days', short: '90 days', from: addDays(today, -89), to: today },
  ];
}

const currentPeriod = () => periods().find((p) => p.from === view.filters.from && p.to === view.filters.to);

function dateMenu() {
  const { filters } = view;
  const dates = allRows.map((r) => r.date);
  const first = dates[0] ?? null;
  const last = dates.at(-1) ?? null;
  const current = currentPeriod();
  const label = current
    ? current.label
    : `${filters.from ? shortDay(filters.from) : 'Start'} – ${filters.to ? shortDay(filters.to) : 'end'}`;

  return menu('date', el('span', {}, label, el('span', { class: 'caret', 'aria-hidden': 'true' }, '▾')), () => {
    const rows = periods().map(({ id, label: text, from, to }) => {
      const on = current?.id === id;
      const button = el('button', { type: 'button', class: 'menu-row', 'aria-pressed': String(on) }, el('span', { class: 'menu-check' }, on ? '✓' : ''), text);
      button.addEventListener('click', () => {
        openMenu = null;
        setFilters({ from, to });
      });
      return button;
    });
    const fromInput = el('input', { type: 'date', value: filters.from ?? '', min: first ?? undefined, max: last ?? undefined, 'aria-label': 'From' });
    const toInput = el('input', { type: 'date', value: filters.to ?? '', min: first ?? undefined, max: last ?? undefined, 'aria-label': 'To' });
    const apply = el('button', { type: 'button', class: 'button primary' }, 'Apply');
    apply.addEventListener('click', () => {
      openMenu = null;
      setFilters({ from: fromInput.value || null, to: toInput.value || null });
    });
    return [
      ...rows,
      el('div', { class: 'menu-rule' }),
      el('div', { class: 'menu-custom' }, el('span', { class: 'muted' }, 'Custom range'), el('div', { class: 'menu-dates' }, fromInput, toInput), apply),
      el('p', { class: 'muted small' }, `The data runs from ${first ? day(first) : '?'} to ${last ? day(last) : '?'}.`),
    ];
  }, 'date-menu');
}

function filterMenu() {
  const { filters } = view;
  const dimensions = Object.keys(dimensionLabels) as Dimension[];
  const active = Object.values(filters.values).reduce((sum, list) => sum + (list?.length ?? 0), 0);

  return menu('filter', el('span', {}, 'Filter', active ? el('span', { class: 'badge' }, active) : null, el('span', { class: 'caret', 'aria-hidden': 'true' }, '▾')), () => {
    if (!pendingDimension) {
      return [
        el('p', { class: 'menu-title' }, 'Filter by'),
        el(
          'div',
          { class: 'menu-grid' },
          ...dimensions.map((dimension) => {
            const count = filters.values[dimension]?.length ?? 0;
            const button = el('button', { type: 'button', class: 'menu-row' }, dimensionLabels[dimension], count ? el('span', { class: 'badge' }, count) : null);
            button.addEventListener('click', () => {
              pendingDimension = dimension;
              valueQuery = '';
              openMenu = 'filter';
              drawControls();
            });
            return button;
          })
        ),
      ];
    }

    const dimension = pendingDimension;
    const options = breakdown(applyFilters(allRows, filters, dimension), dimension, 'visits');
    const back = el('button', { type: 'button', class: 'menu-back' }, '← ', dimensionLabels[dimension]);
    back.addEventListener('click', () => {
      pendingDimension = null;
      drawControls();
    });
    const query = el('input', { type: 'search', placeholder: `Search ${dimensionLabels[dimension].toLowerCase()}…`, value: valueQuery, 'data-autofocus': true, 'aria-label': 'Search values' });
    const list = el('div', { class: 'menu-values' });
    const fill = () => {
      const wanted = valueQuery.trim().toLowerCase();
      list.replaceChildren(
        ...options
          .filter((o) => !wanted || labelOf(dimension, o.value).toLowerCase().includes(wanted))
          .slice(0, 200)
          .map((option) => {
            const on = filters.values[dimension]?.includes(option.value) ?? false;
            const button = el(
              'button',
              { type: 'button', class: 'menu-row', 'aria-pressed': String(on) },
              el('span', { class: 'menu-check' }, on ? '✓' : ''),
              el('span', { class: 'menu-value' }, labelOf(dimension, option.value)),
              el('span', { class: 'muted' }, number(option.visits))
            );
            button.addEventListener('click', () => {
              openMenu = 'filter';
              toggle(dimension, option.value);
            });
            return button;
          })
      );
      if (!list.childElementCount) list.append(el('p', { class: 'muted small' }, 'Nothing matches.'));
    };
    query.addEventListener('input', () => {
      valueQuery = query.value;
      fill();
    });
    fill();
    return [back, query, list];
  }, 'filter-menu');
}

function dataMenu() {
  if (!loaded) return null;
  const s = classificationSummary(classified);
  const changed = classified.filter((c) => c.kind !== c.ruled.kind).length;
  return menu('data', el('span', {}, '⋯'), () => {
    const reload = el('button', { type: 'button', class: 'button primary', disabled: !readKey() }, 'Refresh live data');
    reload.addEventListener('click', () => {
      openMenu = null;
      void refresh();
    });
    const disconnect = el('button', { type: 'button', class: 'button', disabled: !readKey() }, 'Disconnect');
    disconnect.addEventListener('click', () => {
      write(STORE.key, null);
      live = null;
      openMenu = null;
      status.textContent = 'Disconnected. The read key is no longer kept in this browser.';
      rebuild();
    });
    const clear = el('button', { type: 'button', class: 'button', disabled: Object.keys(overrides).length === 0 }, `Clear hand changes (${changed})`);
    clear.addEventListener('click', () => {
      overrides = {};
      write(STORE.overrides, null);
      classify();
      update();
    });
    const figure = (value: string, label: string) => el('div', { class: 'figure' }, el('strong', {}, value), el('span', {}, label));
    return [
      el('p', { class: 'menu-title' }, 'Data'),
      el('p', { class: 'muted small' }, loaded!.note),
      el('div', { class: 'menu-actions' }, reload, disconnect),
      el('div', { class: 'menu-rule' }),
      el('p', { class: 'menu-title' }, 'Everything loaded'),
      el(
        'div',
        { class: 'figures' },
        figure(number(s.pageviews), 'Pageviews'),
        figure(`${number(s.myPageviews)} (${percent(s.myShare)})`, 'Mine'),
        figure(number(s.botSessions), 'Bot sessions'),
        figure(number(s.realSessions), 'Real sessions'),
        figure(number(s.realPageviews), 'Real pageviews')
      ),
      el('div', { class: 'menu-actions' }, clear),
    ];
  }, 'data-menu');
}

function drawControls() {
  if (!loaded) return;
  const { filters } = view;
  const withoutKinds = applyFilters(allRows, { ...filters, kinds: [...kinds] });
  const types = el(
    'div',
    { class: 'types', role: 'group', 'aria-label': 'Types shown' },
    ...kinds.map((kind) => {
      const on = filters.kinds.includes(kind);
      const button = el(
        'button',
        { type: 'button', class: `type${on ? '' : ' off'}`, 'aria-pressed': String(on), title: on ? `Hide ${kindNames[kind].toLowerCase()}` : `Show ${kindNames[kind].toLowerCase()}` },
        key(kind),
        kindNames[kind],
        el('span', { class: 'count' }, number(new Set(withoutKinds.filter((r) => r.kind === kind).map((r) => r.session.id)).size))
      );
      button.addEventListener('click', () => toggleKind(kind));
      return button;
    })
  );
  controls.replaceChildren(types, filterMenu(), dateMenu(), dataMenu() ?? "");
}

function drawChips() {
  if (!loaded) return;
  const { filters } = view;
  const list: HTMLElement[] = [];
  const chip = (text: string, remove: () => void) => {
    const button = el('button', { type: 'button', class: 'chip', 'aria-label': `Remove ${text}` }, text, el('span', { class: 'chip-x', 'aria-hidden': 'true' }, '✕'));
    button.addEventListener('click', remove);
    list.push(button);
  };
  if (filters.from || filters.to) {
    chip(`Dates ${filters.from ? day(filters.from) : 'start'} – ${filters.to ? day(filters.to) : 'end'}`, () => setFilters({ from: null, to: null }));
  }
  for (const [dimension, values] of Object.entries(filters.values) as [Dimension, string[]][]) {
    for (const value of values) chip(`${dimensionLabels[dimension]} is ${labelOf(dimension, value)}`, () => toggle(dimension, value));
  }
  if (filters.search) chip(`Search “${filters.search}”`, () => { search.value = ''; setFilters({ search: '' }); });
  if (list.length || filters.kinds.join() !== startFilters().kinds.join()) {
    const reset = el('button', { type: 'button', class: 'link small' }, 'Reset');
    reset.addEventListener('click', () => {
      search.value = '';
      pendingDimension = null;
      setFilters(startFilters());
    });
    list.push(reset);
  }
  chipRow.replaceChildren(...list);
  chipRow.hidden = list.length === 0;
}

function drawTabs() {
  const tabs: [Tab, string][] = [['overview', 'Overview'], ['people', 'People'], ['pages', 'Pages'], ['visits', 'Visits']];
  const rows = applyFilters(allRows, view.filters);
  const counts: Record<Tab, string> = {
    overview: '',
    people: number(new Set(rows.map((r) => r.session.id)).size),
    pages: number(new Set(rows.flatMap((r) => r.visit.pageviews.map((v) => v.urlPath))).size),
    visits: number(rows.length),
  };
  tabRow.replaceChildren(
    ...tabs.map(([tab, label]) => {
      const button = el('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(view.tab === tab) }, label, counts[tab] ? el('span', { class: 'tab-count' }, counts[tab]) : null);
      button.addEventListener('click', () => setView({ tab }));
      return button;
    })
  );
}

let typing = 0;
search.addEventListener('input', () => {
  clearTimeout(typing);
  typing = window.setTimeout(() => {
    view.filters = { ...view.filters, search: search.value };
    write(STORE.view, view);
    drawControls();
    drawChips();
    drawTabs();
    drawMain();
  }, 150);
});

// "/" jumps to search, the way most data tools do it.
document.addEventListener('keydown', (event) => {
  const typingInField = (event.target as Element).closest('input, select, textarea');
  if (event.key === '/' && !typingInField && loaded) {
    event.preventDefault();
    search.focus();
  }
});

/* --- shared pieces --------------------------------------------------------------- */

const card = (title: Child, aside: Child, ...children: Child[]) =>
  el('section', { class: 'card' }, el('header', { class: 'card-head' }, el('h2', {}, title), aside || null), ...children);

const note = (text: string) => el('p', { class: 'note' }, text);

/** Small tabs inside a card: "Top pages | Entry pages | Exit pages". */
function cardTabs<T extends string>(name: string, options: [T, string][]): [T, HTMLElement] {
  const current = (view.cardTabs[name] as T) ?? options[0][0];
  const nav = el(
    'div',
    { class: 'card-tabs', role: 'tablist' },
    ...options.map(([value, label]) => {
      const button = el('button', { type: 'button', role: 'tab', 'aria-selected': String(value === current) }, label);
      button.addEventListener('click', () => setView({ cardTabs: { ...view.cardTabs, [name]: value } }));
      return button;
    })
  );
  return [current, nav];
}

/* --- overview -------------------------------------------------------------------- */

function overview(rows: VisitRow[]) {
  const t = totals(rows);
  const shown = kinds.filter((k) => view.filters.kinds.includes(k));
  // The chart spans the period picked, and its bucket size follows from it.
  const span = { from: view.filters.from, to: view.filters.to };
  const granularity = autoGranularity(rows.length ? rows : allRows, span);
  const buckets = timeline(rows, granularity, TZ, span);
  const hourFilter = view.filters.values.hour ?? [];

  // The strip of numbers: the first three choose what the chart counts.
  const stat = (label: string, value: string, sub: Child, count?: Count, hint?: string) => {
    const body = [el('span', { class: 'stat-label' }, label), el('strong', { class: 'stat-value' }, value), sub ? el('span', { class: 'stat-sub' }, sub) : null];
    if (!count) return el('div', { class: 'stat', title: hint }, ...body);
    const button = el('button', { type: 'button', class: 'stat', 'aria-pressed': String(view.count === count), title: hint ?? `Chart ${label.toLowerCase()}` }, ...body);
    button.addEventListener('click', () => setView({ count }));
    return button;
  };
  const split = (pick: (k: Kind) => number) =>
    shown.length > 1 ? el('span', { class: 'split' }, ...shown.map((k) => el('span', {}, key(k), number(pick(k))))) : null;
  const stats = el(
    'div',
    { class: 'stats' },
    stat('Visitors', number(t.visitors), split((k) => t.byKind[k].visitors), 'visitors'),
    stat('Visits', number(t.visits), split((k) => t.byKind[k].visits), 'visits'),
    stat('Views', number(t.views), split((k) => t.byKind[k].views), 'views'),
    stat('Bounce rate', percent(t.bounceRate), `${number(t.bounces)} one-page visits`),
    stat('Visit length', duration(t.medianDuration), `median · avg ${duration(t.averageDuration)}`, undefined, 'Visits that went past one page. The median is the middle visit, so one very long one barely moves it.'),
    stat('Time on a page', duration(t.medianTimeOnPage), `median · avg ${duration(t.averageTimeOnPage)}`, undefined, 'Over every view whose time is known: until the next page, or until the visitor left. The last page of a visit imported from Umami has none.')
  );

  const label = (k: string) => (granularity === 'hour' ? `${shortDay(k.slice(0, 10))} ${k.slice(11)}h` : granularity === 'month' ? k.slice(0, 7) : shortDay(k));
  const title = (b: (typeof buckets)[number]) =>
    granularity === 'hour' ? `${day(b.from)}, ${b.key.slice(11)}:00` : granularity === 'day' ? day(b.from) : `${day(b.from)} – ${day(b.to)}`;
  const selected = (b: (typeof buckets)[number]) =>
    view.filters.from === b.from && view.filters.to === b.to && (granularity !== 'hour' || (hourFilter.length === 1 && hourFilter[0] === b.key.slice(11)));

  const chart = rows.length
    ? stackedColumns({
        columns: buckets.map((b) => ({ label: label(b.key), title: title(b), values: b[view.count], selected: selected(b) })),
        show: shown,
        unit: view.count,
        height: 280,
        ariaLabel: `${view.count} per ${granularity}, by type`,
        onClick: (i) => {
          const b = buckets[i];
          const values = granularity === 'hour' ? { ...view.filters.values, hour: selected(b) ? [] : [b.key.slice(11)] } : view.filters.values;
          setFilters(selected(b) ? { from: null, to: null, values } : { from: b.from, to: b.to, values });
        },
      })
    : el('p', { class: 'empty' }, 'Nothing with these filters.');

  const top = el(
    'section',
    { class: 'card hero' },
    stats,
    el(
      'div',
      { class: 'chart-bar' },
      shown.length > 1 ? legend(shown) : el('span', { class: 'muted small' }, `${countLabels[view.count]} per ${granularity}`),
      segmented(
        'Period',
        (['all', '30', '7', 'today'] as const).map((id) => [id, periods().find((p) => p.id === id)!.short]),
        currentPeriod()?.id ?? '',
        (id) => {
          const period = periods().find((p) => p.id === id)!;
          setFilters({ from: period.from, to: period.to });
        }
      )
    ),
    chart,
    note(`A period filters everything on the page, like the date menu. Click a column to keep only that ${granularity}, and again to let go. Times are ${TZ}.`)
  );

  return [
    top,
    el(
      'div',
      { class: 'cards' },
      rankCard('sources', [['source', 'Sources'], ['referrer', 'Referrers']]),
      rankCard('pages', [['page', 'Top pages'], ['entry', 'Entry pages'], ['exit', 'Exit pages']]),
      engagedGamesCard(rows),
      rankCard('locations', [['country', 'Countries'], ['region', 'Regions'], ['city', 'Cities']]),
      rankCard('devices', [['device', 'Devices'], ['browser', 'Browsers'], ['os', 'OS'], ['screen', 'Screens'], ['language', 'Languages']]),
      heatmapCard(),
      durationCard(rows),
      clicksCard(rows),
      usageCard(rows)
    ),
  ];
}

/**
 * The games people actually read: engaged visitors per game page (explore.ts, pages).
 * Views reward one person reloading and averages reward a forgotten tab, so neither
 * answers which game is most popular. Ties go to the one with more time spent on it.
 */
function engagedGamesCard(rows: VisitRow[]) {
  const games = pages(rows)
    .filter((p) => p.path.startsWith('/games/') && p.engaged > 0)
    .sort((a, b) => b.engaged - a.engaged || b.time - a.time);
  const all = expanded.has('engaged-games');
  const shown = all ? games : games.slice(0, 9);
  const more = games.length > shown.length ? el('button', { type: 'button', class: 'more' }, `Show all ${games.length}`) : null;
  more?.addEventListener('click', expander('engaged-games'));
  return card(
    'Most engaged games',
    null,
    games.length === 0
      ? el('p', { class: 'empty' }, `Nobody spent ${ENGAGED_S} seconds on a game with these filters.`)
      : rankList({
          head: ['Game', 'Engaged'],
          rows: shown.map((p) => ({
            value: p.path,
            label: labelOf('page', p.path),
            amount: p.engaged,
            byKind: p.engagedByKind,
            selected: view.filters.values.page?.includes(p.path) ?? false,
            note: `${number(p.engaged)} engaged of ${number(p.visitors)} ${p.visitors === 1 ? 'visitor' : 'visitors'} · ${number(p.views)} views · ${duration(p.time)} in total`,
          })),
          format: number,
          onPick: (value) => toggle('page', value),
        }),
    more,
    note(`Engaged: people who spent at least ${ENGAGED_S} seconds on the game’s page, all their views added up. Each person counts once.`)
  );
}

/** A breakdown card with small tabs, counting whatever the strip of numbers has picked. */
function rankCard(name: string, options: [Dimension, string][]) {
  const [dimension, nav] = cardTabs(name, options);
  const metric: Metric = view.count;
  const data = breakdown(applyFilters(allRows, view.filters, dimension), dimension, metric).filter((r) => r[metric] > 0);
  const all = expanded.has(`${name}:${dimension}`);
  const shown = all ? data : data.slice(0, 9);
  const more = data.length > shown.length ? el('button', { type: 'button', class: 'more' }, `Show all ${data.length}`) : null;
  more?.addEventListener('click', expander(`${name}:${dimension}`));
  return card(
    nav,
    null,
    data.length === 0
      ? el('p', { class: 'empty' }, 'Nothing with these filters.')
      : rankList({
          head: [dimensionLabels[dimension], countLabels[view.count]],
          rows: shown.map((r) => ({
            value: r.value,
            label: labelOf(dimension, r.value),
            amount: r[metric],
            byKind: r.byKind,
            selected: view.filters.values[dimension]?.includes(r.value) ?? false,
            note: `${number(r.visitors)} visitors · ${number(r.visits)} visits · ${number(r.views)} views · ${duration(r.time)}`,
          })),
          format: number,
          onPick: (value) => toggle(dimension, value),
        }),
    more
  );
}

function heatmapCard() {
  const { filters } = view;
  const rows = applyFilters(allRows, { ...filters, values: { ...filters.values, weekday: [], hour: [] } });
  const weekday = filters.values.weekday?.length === 1 ? filters.values.weekday[0] : null;
  const hour = filters.values.hour?.length === 1 ? Number(filters.values.hour[0]) : null;
  const hh = (h: number) => String(h).padStart(2, '0');
  return card(
    'When they look',
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
    note('Views by weekday and hour. Click a cell, a day or an hour to filter.')
  );
}

function durationCard(rows: VisitRow[]) {
  return card(
    'How long visits last',
    null,
    stackedColumns({
      columns: durations(rows).map((d) => ({ label: d.label, title: d.label, values: d.byKind })),
      show: kinds.filter((k) => view.filters.kinds.includes(k)),
      unit: 'visits',
      width: 560,
      height: 250,
      ariaLabel: 'Visits by duration',
    }),
    note('From the first event to the last in each visit.')
  );
}

function clicksCard(rows: VisitRow[]) {
  if (!loaded) return null;
  const data = events(rows, loaded.eventData);
  return card(
    'Clicks',
    null,
    data.length === 0
      ? el('p', { class: 'empty' }, loaded.hasEventData ? 'No clicks with these filters.' : 'This export has no click events yet. They start with exports after the click tracking went live.')
      : rankList({
          head: ['Event', 'Clicks'],
          rows: data.map((e) => ({
            value: e.name,
            label: e.name,
            amount: e.total,
            byKind: e.byKind,
            selected: view.filters.values.event?.includes(e.name) ?? false,
            note: e.details.slice(0, 6).map((d) => `${d.label} (${d.count})`).join(', ') || 'No details',
          })),
          format: number,
          onPick: (value) => toggle('event', value),
        })
  );
}

function usageCard(rows: VisitRow[]) {
  const [which, nav] = cardTabs('usage', [['filters', 'Portfolio filters'], ['searches', 'Portfolio searches']]);
  const data = which === 'filters' ? filterUsage(rows) : searchUsage(rows);
  return card(
    nav,
    null,
    data.length === 0
      ? el('p', { class: 'empty' }, which === 'filters' ? 'Nobody used the ?f= filters with these filters.' : 'Nobody searched with these filters.')
      : rankList({
          head: [which === 'filters' ? 'Filter' : 'Search', 'Views'],
          rows: data.map((r) => ({ value: r.value, label: r.value, amount: r.total, byKind: r.byKind, selected: false, note: `${number(r.total)} pageviews with it` })),
          format: number,
          onPick: (value) => { search.value = value; setFilters({ search: value }); },
        })
  );
}

/* --- people ---------------------------------------------------------------------- */

const orders: [PeopleOrder, string][] = [
  ['last', 'Most recent'],
  ['first', 'First seen'],
  ['views', 'Most pages'],
  ['time', 'Most time'],
  ['visits', 'Most visits'],
];

function orderPeople(list: VisitorRow[]) {
  const by: Record<PeopleOrder, (v: VisitorRow) => number> = {
    last: (v) => -v.last.getTime(),
    first: (v) => v.first.getTime(),
    views: (v) => -v.views,
    time: (v) => -v.time,
    visits: (v) => -v.visits,
  };
  return [...list].sort((a, b) => by[view.peopleOrder](a) - by[view.peopleOrder](b));
}

function people(rows: VisitRow[]) {
  const list = orderPeople(visitors(rows));
  if (list.length === 0) return [el('p', { class: 'empty' }, 'Nobody with these filters.')];
  const current = list.find((v) => v.session.id === view.person) ?? list[0];
  const span = { from: allRows[0]?.visit.start.getTime() ?? 0, to: allRows.at(-1)?.visit.start.getTime() ?? 1 };

  const order = el('select', { 'aria-label': 'Order people by' });
  for (const [value, label] of orders) order.append(el('option', { value, selected: value === view.peopleOrder }, label));
  order.addEventListener('change', () => setView({ peopleOrder: order.value as PeopleOrder }));

  const items = list.map((v) => {
    const s = v.session;
    const own = rows.filter((r) => r.session.id === s.id);
    const button = el(
      'button',
      { type: 'button', class: `person${v === current ? ' current' : ''}`, 'aria-current': v === current ? 'true' : undefined, 'data-person': s.id },
      el('span', { class: 'avatar' }, `#${numbers.get(s.id)}`),
      el(
        'span',
        { class: 'person-main' },
        el('span', { class: 'person-name' }, s.city || s.country || 'Unknown place', el('span', { class: 'muted' }, ` · ${s.browser ?? '?'} on ${s.os ?? '?'}`)),
        el('span', { class: 'person-meta' }, key(s.kind), `${s.source} · ${number(v.visits)} ${v.visits === 1 ? 'visit' : 'visits'} · ${number(v.views)} ${v.views === 1 ? 'page' : 'pages'} · ${duration(v.time)}`),
        visitStrip(own.map((r) => ({ at: r.visit.start.getTime(), pages: r.visit.pageviews.length })), span.from, span.to, s.kind)
      ),
      el('span', { class: 'person-when' }, shortDay(own.at(-1)!.date))
    );
    button.addEventListener('click', () => setView({ person: s.id }));
    return el('li', {}, button);
  });

  return [
    el(
      'div',
      { class: 'people' },
      el(
        'aside',
        { class: 'people-list' },
        el('div', { class: 'people-tools' }, el('span', { class: 'muted' }, `${number(list.length)} ${list.length === 1 ? 'person' : 'people'}`), order),
        el('ol', {}, ...items),
        note('↑ ↓ move through people. A person is one device on one network, so the same human on a phone and a laptop counts twice.')
      ),
      profile(current.session)
    ),
  ];
}

// Up and down move through the list while the People tab is open.
document.addEventListener('keydown', (event) => {
  if (view.tab !== 'people' || !loaded) return;
  if ((event.target as Element).closest('input, select, textarea')) return;
  const step = event.key === 'ArrowDown' || event.key === 'j' ? 1 : event.key === 'ArrowUp' || event.key === 'k' ? -1 : 0;
  if (!step) return;
  const ids = [...main.querySelectorAll<HTMLElement>('[data-person]')].map((node) => node.dataset.person!);
  const at = ids.indexOf(view.person ?? ids[0]);
  const next = ids[Math.min(ids.length - 1, Math.max(0, (at === -1 ? 0 : at) + step))];
  if (!next) return;
  event.preventDefault();
  setView({ person: next });
  main.querySelector<HTMLElement>(`[data-person="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' });
});

function profile(session: ClassifiedSession) {
  // Every visit this person made, whatever the filters: the whole story.
  const rows = allRows.filter((r) => r.session.id === session.id);
  const t = totals(rows);
  const clicks = rows.flatMap((r) => r.visit.events.filter((e) => e.eventType === 2));
  const longest = Math.max(1, ...rows.flatMap((r) => r.steps.map((s) => s.timeOnPage ?? 0)));

  const fact = (label: string, value: Child) => el('div', { class: 'fact' }, el('dt', {}, label), el('dd', {}, value));
  const filterTo = el('button', { type: 'button', class: 'button' }, 'Filter the report to this person');
  filterTo.addEventListener('click', () => setView({ tab: 'overview', filters: { ...view.filters, kinds: [...kinds], values: { ...view.filters.values, visitor: [session.id] } } }));

  const activity = [...rows].reverse().map((row, i) =>
    el(
      'li',
      { class: 'visit' },
      el(
        'div',
        { class: 'visit-head' },
        el('strong', {}, `Visit ${rows.length - i}`),
        el('span', {}, moment(row.visit.start, TZ)),
        el('span', { class: 'muted' }, `from ${row.visit.source}${row.visit.referrer && row.visit.referrer !== row.visit.source ? ` (${row.visit.referrer})` : ''} · ${number(row.visit.pageviews.length)} ${row.visit.pageviews.length === 1 ? 'page' : 'pages'} · ${duration(row.duration)}`)
      ),
      el(
        'ol',
        { class: 'events' },
        ...row.steps.flatMap((step, i) => [
          el(
            'li',
            { class: 'event' },
            el('time', {}, clockTime(step.view.createdAt, TZ)),
            el('span', { class: 'event-dot', 'aria-hidden': 'true' }),
            viewedPage(step.view.urlPath, step.view.urlQuery),
            el(
              'span',
              {
                class: 'stay',
                title:
                  step.timeOnPage === null
                    ? 'A visit imported from Umami, which didn’t record leaving, so how long they stayed is unknown'
                    : i === row.steps.length - 1 ? 'Until they left the site' : 'Until the next page',
              },
              step.timeOnPage === null ? null : el('span', { class: 'stay-bar', style: `width:${Math.max(2, (step.timeOnPage / longest) * 100)}%` }),
              el('span', { class: 'stay-text' }, step.timeOnPage === null ? 'left here' : duration(step.timeOnPage))
            )
          ),
          ...step.events.map((event) =>
            el('li', { class: 'event click' }, el('time', {}, clockTime(event.createdAt, TZ)), el('span', { class: 'event-dot click', 'aria-hidden': 'true' }), el('span', { class: 'click-text' }, describeEvent(event)))
          ),
        ])
      )
    )
  );

  return el(
    'article',
    { class: 'profile card' },
    el(
      'header',
      { class: 'profile-head' },
      el('span', { class: 'avatar big' }, `#${numbers.get(session.id)}`),
      el('div', {}, el('h2', {}, personLabel(session)), el('p', { class: 'muted small' }, session.reason)),
      typePicker(session)
    ),
    el(
      'dl',
      { class: 'facts' },
      fact('Place', placeOf(session)),
      fact('Device', deviceOf(session)),
      fact('Screen · language', `${session.screen ?? '?'} · ${session.language ?? '?'}`),
      fact('Came from', [...new Set(rows.map((r) => r.visit.source))].join(', ')),
      fact('First seen', moment(session.start, TZ)),
      fact('Last seen', moment(session.end, TZ)),
      fact('Visits · pages', `${number(t.visits)} · ${number(t.views)}`),
      fact('Time measured', duration(t.measuredTime)),
      fact('Clicks', clicks.length ? number(clicks.length) : 'None recorded')
    ),
    el('h3', {}, 'Activity'),
    el('ol', { class: 'activity' }, ...activity),
    el('p', { class: 'note' }, 'Time on a page runs until the next page, or until the visitor left the site. Visits imported from Umami didn’t record leaving, so their last page says “left here” with no time.'),
    el('h3', {}, 'Pages, over all visits'),
    table({
      label: 'Pages this person viewed',
      rows: personPages(rows),
      sort: sortOf('person-pages', { key: 'time', descending: true }),
      onSort: setSort('person-pages'),
      limit: 100,
      columns: [
        { key: 'path', label: 'Page', sort: (p) => p.path, cell: (p) => p.path },
        { key: 'views', label: 'Views', numeric: true, sort: (p) => p.views, cell: (p) => number(p.views) },
        { key: 'time', label: 'Time', numeric: true, sort: (p) => p.time, cell: (p) => duration(p.time) },
        { key: 'clicks', label: 'Clicks', numeric: true, sort: (p) => p.clicks, cell: (p) => number(p.clicks) },
      ],
    }),
    el('div', { class: 'profile-actions' }, filterTo)
  );
}

/* --- pages and visits ------------------------------------------------------------ */

function pagesTab(rows: VisitRow[]) {
  return [
    card(
      'Pages',
      null,
      table({
        label: 'Pages',
        rows: pages(rows),
        limit: 100,
        sort: sortOf('pages', { key: 'views', descending: true }),
        onSort: setSort('pages'),
        expanded: expanded.has('pages'),
        onExpand: expander('pages'),
        columns: [
          { key: 'path', label: 'Page', sort: (p) => p.path, cell: (p) => filterLink('page', p.path) },
          { key: 'views', label: 'Views', numeric: true, sort: (p) => p.views, cell: (p) => number(p.views) },
          { key: 'visitors', label: 'Visitors', numeric: true, sort: (p) => p.visitors, cell: (p) => number(p.visitors) },
          { key: 'engaged', label: 'Engaged', numeric: true, sort: (p) => p.engaged, cell: (p) => number(p.engaged), hint: `People who spent at least ${ENGAGED_S} seconds here, all their views added up` },
          { key: 'entries', label: 'Entries', numeric: true, sort: (p) => p.entries, cell: (p) => number(p.entries), hint: 'Visits that started here' },
          { key: 'exits', label: 'Exits', numeric: true, sort: (p) => p.exits, cell: (p) => number(p.exits), hint: 'Visits that ended here' },
          { key: 'bounces', label: 'Bounces', numeric: true, sort: (p) => p.bounces, cell: (p) => number(p.bounces), hint: 'Visits that saw only this page' },
          { key: 'median', label: 'Median time', numeric: true, sort: (p) => p.medianTime, cell: (p) => duration(p.medianTime), hint: 'The middle timed view: one very long view barely moves it' },
          { key: 'average', label: 'Avg. time', numeric: true, sort: (p) => p.averageTime, cell: (p) => duration(p.averageTime), hint: 'One very long view drags this up' },
          { key: 'time', label: 'Total time', numeric: true, sort: (p) => p.time, cell: (p) => duration(p.time) },
        ],
      }),
      note('Time on a page runs until the next page in the same visit, or until the visitor left the site. The last page of a visit imported from Umami adds no time, since Umami didn’t record leaving.')
    ),
  ];
}

function stepsOf(row: VisitRow) {
  return el(
    'ol',
    { class: 'steps' },
    ...row.steps.map((step) =>
      el(
        'li',
        {},
        el('time', {}, clockTime(step.view.createdAt, TZ)),
        viewedPage(step.view.urlPath, step.view.urlQuery),
        el('span', { class: 'muted' }, step.timeOnPage === null ? 'left here' : duration(step.timeOnPage)),
        ...step.events.map((event) => el('span', { class: 'click-pill' }, describeEvent(event)))
      )
    )
  );
}

function visitsTab(rows: VisitRow[]) {
  return [
    card(
      'Visits',
      null,
      table({
        label: 'Visits',
        rows,
        limit: 50,
        sort: sortOf('visits', { key: 'start', descending: true }),
        onSort: setSort('visits'),
        expanded: expanded.has('visits'),
        onExpand: expander('visits'),
        isOpen: (r) => open.has(r.visit.id),
        detail: stepsOf,
        onRowClick: (r) => {
          if (open.has(r.visit.id)) open.delete(r.visit.id);
          else open.add(r.visit.id);
          drawMain();
        },
        rowClass: (r) => (open.has(r.visit.id) ? 'open' : ''),
        columns: [
          { key: 'start', label: 'Start', sort: (r) => r.visit.start.getTime(), cell: (r) => el('span', {}, el('span', { class: 'disclosure', 'aria-hidden': 'true' }, open.has(r.visit.id) ? '▾ ' : '▸ '), moment(r.visit.start, TZ)) },
          { key: 'kind', label: 'Type', sort: (r) => r.kind, cell: (r) => kindTag(r.kind) },
          { key: 'person', label: 'Person', sort: (r) => numbers.get(r.session.id) ?? 0, cell: (r) => personLink(r.session) },
          { key: 'source', label: 'Source', sort: (r) => r.visit.source, cell: (r) => filterLink('source', r.visit.source) },
          { key: 'entry', label: 'Entry', sort: (r) => r.visit.pageviews[0]?.urlPath ?? '', cell: (r) => r.visit.pageviews[0]?.urlPath ?? '' },
          { key: 'views', label: 'Pages', numeric: true, sort: (r) => r.visit.pageviews.length, cell: (r) => number(r.visit.pageviews.length) },
          { key: 'duration', label: 'Length', numeric: true, sort: (r) => r.duration, cell: (r) => duration(r.duration) },
          { key: 'clicks', label: 'Clicks', numeric: true, sort: (r) => r.visit.events.filter((e) => e.eventType === 2).length, cell: (r) => number(r.visit.events.filter((e) => e.eventType === 2).length) },
        ],
      }),
      note('Click a visit to see its pages in order.')
    ),
  ];
}

function drawMain() {
  if (!loaded) return;
  const rows = applyFilters(allRows, view.filters);
  const content =
    view.tab === 'people' ? people(rows) : view.tab === 'pages' ? pagesTab(rows) : view.tab === 'visits' ? visitsTab(rows) : overview(rows);
  main.replaceChildren(...content);
}

/* --- loading --------------------------------------------------------------------- */

/**
 * Everything the collector has, read with the key on every load and on Refresh. Only
 * the key, the collector's address and this browser's device id are kept here, never
 * the data. The rows use Umami's column names, so readEvents reads them as it read
 * Umami's exports.
 */
interface Live {
  records: CsvRecord[];
  eventData: CsvRecord[];
  fetchedAt: Date;
}

let live: Live | null = null;

// Umami exports were kept in this key before the collector held all the data.
write('umami-report:export', null);

/** Where the collector is: the address in site.ts, unless this browser was given another. */
const collectorUrl = () => read<string>(STORE.collector, '') || site.analytics.collector;
const readKey = () => read<string>(STORE.key, '');

/** JSON values as the CSV parser would have given them: text, or null for nothing. */
const asRecord = (row: Record<string, unknown>): CsvRecord =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null || v === undefined ? null : String(v)]));

/** This browser's device id: 64 random hex characters, made on its first read and kept. */
function deviceId() {
  const kept = read<string>(STORE.device, '');
  if (/^[0-9a-f]{64}$/.test(kept)) return kept;
  const made = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  write(STORE.device, made);
  return made;
}

/** The collector said no. pending: the key was right, and an approval email went out. */
class Refused extends Error {
  constructor(message: string, readonly pending = false) {
    super(message);
  }
}

/** What each of the collector's device answers means here (collector/src/index.ts, approved). */
const DEVICE_ANSWERS: Record<string, string> = {
  pending: 'This browser needs your approval. Open the email the collector sent, approve it, then reload this page.',
  denied: 'This browser was denied access to the collector.',
  capped: 'The collector already sent today’s approval emails. Try again tomorrow.',
  'email-failed': 'The collector couldn’t send the approval email. Try again in a while.',
};

/** Every event the collector has, a page at a time. */
async function fetchLive(url: string, key: string): Promise<Live> {
  const records: CsvRecord[] = [];
  const eventData: CsvRecord[] = [];
  let since = '';
  for (let page = 0; page < 200; page++) {
    const response = await fetch(`${url.replace(/\/$/, '')}/v1/export?since=${encodeURIComponent(since)}`, {
      headers: { Authorization: `Bearer ${key}`, 'X-Device': deviceId() },
    });
    if (response.status === 401) throw new Error('The collector didn’t accept that key.');
    if (response.status === 429) {
      // Three wrong keys from this network in an hour (collector/src/index.ts, admit).
      const minutes = Math.ceil(Number(response.headers.get('Retry-After') ?? 3600) / 60);
      throw new Error(`Too many wrong keys from this network. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    }
    if (response.status === 403 || response.status === 502) {
      const answer = ((await response.json().catch(() => ({}))) as { status?: string }).status ?? '';
      throw new Refused(DEVICE_ANSWERS[answer] ?? `The collector answered ${response.status}.`, answer === 'pending');
    }
    if (!response.ok) throw new Error(`The collector answered ${response.status}.`);
    const body = (await response.json()) as { website_event: Record<string, unknown>[]; event_data: Record<string, unknown>[]; next: string | null };
    records.push(...body.website_event.map(asRecord));
    eventData.push(...body.event_data.map(asRecord));
    if (!body.next) break;
    since = body.next;
  }
  return { records, eventData, fetchedAt: new Date() };
}

/** Draws what the collector gave, or the connect form when there's nothing read yet. */
function rebuild() {
  if (!live) {
    loaded = null;
    app.hidden = true;
    connect.hidden = false;
    return;
  }
  const sessions = buildSessions(readEvents(live.records), reportConfig);
  const first = sessions[0]?.start;
  const last = sessions.reduce((latest, s) => (s.end > latest ? s.end : latest), first ?? new Date(0));
  const note = [
    `${number(live.records.length)} events, read ${moment(live.fetchedAt, TZ)}.`,
    first ? `From ${moment(first, TZ)} to ${moment(last, TZ)}.` : '',
  ].join(' ');
  loaded = { sessions, eventData: live.eventData, properties: eventProperties(live.eventData), hasEventData: true, note };
  classify();
  connect.hidden = true;
  app.hidden = false;
  update();
}

/** Reads the collector and redraws. Reports what went wrong in the status line. */
async function refresh() {
  const url = collectorUrl();
  const key = readKey();
  if (!url || !key) return;
  status.textContent = 'Reading the collector…';
  try {
    live = await fetchLive(url, key);
    status.textContent = '';
  } catch (error) {
    // A refresh that fails keeps what's on screen. On the first read there's nothing
    // on screen, and the connect form comes back with the reason above it.
    status.textContent = live ? `${(error as Error).message} Showing what was read before.` : (error as Error).message;
  }
  rebuild();
}

// The first screen's form: the collector's address (from site.ts, editable)
// and the read key. Both are kept in this browser once they work.
const connectUrl = connect.querySelector<HTMLInputElement>('[name="collector"]')!;
const connectKey = connect.querySelector<HTMLInputElement>('[name="key"]')!;
connectUrl.value = collectorUrl();
connect.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = connectUrl.value.trim().replace(/\/$/, '');
  const key = connectKey.value.trim();
  if (!url || !key) return;
  status.textContent = 'Reading the collector…';
  try {
    live = await fetchLive(url, key);
  } catch (error) {
    status.textContent = (error as Error).message;
    // The key was right and the browser only waits for approval: keep both, so a
    // reload after approving reads the data without typing the key again.
    if (error instanceof Refused && error.pending) {
      write(STORE.key, key);
      write(STORE.collector, url === site.analytics.collector ? null : url);
      connectKey.value = '';
    }
    return;
  }
  write(STORE.key, key);
  write(STORE.collector, url === site.analytics.collector ? null : url);
  connectKey.value = '';
  status.textContent = '';
  rebuild();
});

// A kept key reads the collector straight away. Without one, the form asks for it.
if (readKey()) void refresh();
else rebuild();

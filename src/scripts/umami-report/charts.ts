/**
 * The report's charts, drawn as SVG. Each takes plain data and callbacks; none of them
 * knows about filters or files.
 *
 * Built to the dataviz rules this site follows: bars at most 24px wide with a 4px
 * rounded end and a square base, a 2px gap of surface between stacked segments,
 * hairline gridlines, labels in text colours (never the series colour), and a tooltip
 * on every mark whose hit area is bigger than the mark itself.
 */
import type { Kind } from '../../lib/umami-report/sessions.ts';
import { kinds } from '../../lib/umami-report/explore.ts';
import { el, hideTip, kindNames, number, svg, tipOn } from './dom.ts';

/** Clean axis steps: 1, 2 or 5 times a power of ten, about four of them. */
function ticks(max: number) {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? power * 10;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** A bar with its top corners rounded and its base square. */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + w - radius}Q${x + w},${y} ${x + w},${y + radius}V${y + h}Z`;
}

export interface Column {
  /** Shown under the column (thinned out when there are many). */
  label: string;
  /** Shown as the tooltip's title. */
  title: string;
  values: Record<Kind, number>;
  selected?: boolean;
}

export interface ColumnsOptions {
  columns: Column[];
  /** Kinds to draw, bottom to top. */
  show: Kind[];
  /** What the numbers are, for the tooltip: "views". */
  unit: string;
  onClick?: (index: number) => void;
  /** The drawing's own size. Match it roughly to the space it gets, or its text scales with it. */
  width?: number;
  height?: number;
  ariaLabel: string;
}

/** Stacked columns, one per bucket, segments by kind. */
export function stackedColumns(options: ColumnsOptions) {
  const { columns, show, unit } = options;
  const width = options.width ?? 1000;
  const height = options.height ?? 260;
  const pad = { top: 16, right: 8, bottom: 30, left: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const totalOf = (c: Column) => show.reduce((sum, kind) => sum + c.values[kind], 0);
  const scale = ticks(Math.max(1, ...columns.map(totalOf)));
  const max = scale[scale.length - 1];
  const y = (value: number) => pad.top + plotH - (value / max) * plotH;

  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': options.ariaLabel });

  for (const tick of scale) {
    chart.append(svg('line', { x1: pad.left, x2: width - pad.right, y1: y(tick), y2: y(tick), class: tick === 0 ? 'baseline' : 'grid' }));
    chart.append(svg('text', { x: pad.left - 8, y: y(tick) + 4, class: 'tick', 'text-anchor': 'end' }, number(tick)));
  }

  const slot = plotW / Math.max(1, columns.length);
  const barW = Math.max(2, Math.min(24, slot * 0.72));
  // Enough room between labels that they never touch.
  const every = Math.max(1, Math.ceil(64 / slot));

  columns.forEach((column, i) => {
    const x = pad.left + slot * i + (slot - barW) / 2;
    const group = svg('g', { class: `column${column.selected ? ' selected' : ''}` });

    // The hit area: the whole slot, top to bottom, so a thin or empty column is still easy to point at.
    const hit = svg('rect', {
      x: pad.left + slot * i,
      y: pad.top,
      width: slot,
      height: plotH,
      class: 'hit',
      tabindex: options.onClick ? 0 : -1,
      role: options.onClick ? 'button' : undefined,
      'aria-label': `${column.title}: ${totalOf(column)} ${unit}`,
    });
    group.append(hit);

    let top = y(0);
    const drawn = show.filter((kind) => column.values[kind] > 0);
    drawn.forEach((kind, j) => {
      const h = (column.values[kind] / max) * plotH;
      const last = j === drawn.length - 1;
      // The 2px surface gap sits on top of every segment but the highest.
      const gap = last ? 0 : Math.min(2, h / 2);
      const segment = last
        ? svg('path', { d: topRounded(x, top - h, barW, h, 4), class: `fill kind-${kind}` })
        : svg('rect', { x, y: top - h + gap, width: barW, height: h - gap, class: `fill kind-${kind}` });
      group.append(segment);
      top -= h;
    });

    if (i % every === 0) {
      chart.append(svg('text', { x: pad.left + slot * i + slot / 2, y: height - 10, class: 'tick', 'text-anchor': 'middle' }, column.label));
    }

    tipOn(hit, () => column.title, () => [
      ...show.map((kind) => [kind, number(column.values[kind]), kindNames[kind]] as [Kind, string, string]),
      [null, number(totalOf(column)), `${unit} in total`],
    ]);
    if (options.onClick) {
      const go = () => {
        hideTip();
        options.onClick!(i);
      };
      hit.addEventListener('click', go);
      hit.addEventListener('keydown', (event) => {
        const key = (event as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') {
          event.preventDefault();
          go();
        }
      });
    }
    chart.append(group);
  });

  return chart;
}

/** The legend, which doubles as the type toggle: click a type to hide or show it. */
export function legend(show: Kind[], onToggle?: (kind: Kind) => void) {
  return el(
    'div',
    { class: 'legend', role: onToggle ? 'group' : undefined, 'aria-label': onToggle ? 'Types shown' : undefined },
    ...kinds.map((kind) => {
      const on = show.includes(kind);
      if (!onToggle) return el('span', { class: 'legend-item' }, el('span', { class: `key key-box kind-${kind}` }), kindNames[kind]);
      const button = el(
        'button',
        { type: 'button', class: `legend-item${on ? '' : ' off'}`, 'aria-pressed': String(on) },
        el('span', { class: `key key-box kind-${kind}` }),
        kindNames[kind]
      );
      button.addEventListener('click', () => onToggle(kind));
      return button;
    })
  );
}

/** Sequential blues for the heatmap, dark to light, for a dark surface. */
const ramp = ['#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#86b6ef', '#b7d3f6'];

export interface HeatmapOptions {
  grid: number[][];
  rows: string[];
  selected: { row: string | null; column: number | null };
  onCell: (row: number, column: number) => void;
  onRow: (row: number) => void;
  onColumn: (column: number) => void;
}

/** Views by weekday (rows) and hour (columns). */
export function heatmapChart(options: HeatmapOptions) {
  const { grid, rows } = options;
  const max = Math.max(1, ...grid.flat());
  // Sized for a half-width card, so its labels stay at their real size.
  const cell = 22;
  const gap = 2;
  const left = 44;
  const top = 20;
  const width = left + 24 * cell;
  const height = top + rows.length * cell + 4;
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart heatmap', role: 'img', 'aria-label': 'Views by weekday and hour' });

  for (let h = 0; h < 24; h++) {
    const label = svg('text', { x: left + h * cell + cell / 2, y: 13, class: `tick axis-button${options.selected.column === h ? ' on' : ''}`, 'text-anchor': 'middle', tabindex: 0, role: 'button', 'aria-label': `Filter by ${h}:00` }, String(h).padStart(2, '0'));
    label.addEventListener('click', () => options.onColumn(h));
    chart.append(label);
  }

  rows.forEach((row, r) => {
    const label = svg('text', { x: left - 8, y: top + r * cell + cell / 2 + 4, class: `tick axis-button${options.selected.row === row ? ' on' : ''}`, 'text-anchor': 'end', tabindex: 0, role: 'button', 'aria-label': `Filter by ${row}` }, row);
    label.addEventListener('click', () => options.onRow(r));
    chart.append(label);

    for (let h = 0; h < 24; h++) {
      const value = grid[r][h];
      // A square root, because one busy hour would otherwise push every quiet one to
      // the darkest step, which barely shows on the dark card. And never below the
      // second step: any view at all has to be visible.
      const step = value === 0 ? -1 : Math.max(1, Math.min(ramp.length - 1, Math.round(Math.sqrt(value / max) * (ramp.length - 1))));
      const selected = options.selected.row === row && options.selected.column === h;
      const rect = svg('rect', {
        x: left + h * cell + gap / 2,
        y: top + r * cell + gap / 2,
        width: cell - gap,
        height: cell - gap,
        rx: 3,
        class: `cell${value === 0 ? ' zero' : ''}${selected ? ' selected' : ''}`,
        fill: value === 0 ? undefined : ramp[step],
        tabindex: 0,
        role: 'button',
        'aria-label': `${row} ${String(h).padStart(2, '0')}:00, ${value} views`,
      });
      tipOn(rect, () => `${row}, ${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`, () => [[null, number(value), value === 1 ? 'view' : 'views']]);
      rect.addEventListener('click', () => { hideTip(); options.onCell(r, h); });
      rect.addEventListener('keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Enter') options.onCell(r, h);
      });
      chart.append(rect);
    }
  });

  const scale = el(
    'div',
    { class: 'heat-scale' },
    el('span', {}, 'Fewer'),
    ...[-1, ...ramp.map((_, i) => i)].map((i) => el('span', { class: 'heat-step', style: i < 0 ? '' : `background:${ramp[i]}` })),
    el('span', {}, `More (max ${number(max)})`)
  );
  return el('div', {}, chart, scale);
}

export interface BarRow {
  value: string;
  label: string;
  /** What the bar's length and the number show. */
  amount: number;
  /** Shown beside the number: "12 visits · 3 visitors". */
  note: string;
  byKind: Record<Kind, number>;
  selected: boolean;
}

/**
 * A ranked list with a bar under each label, split by type. Each row is a button that
 * toggles a filter on its value.
 */
export function barList(rows: BarRow[], format: (amount: number) => string, onPick: (value: string) => void) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return el(
    'ol',
    { class: 'bar-list' },
    ...rows.map((row) => {
      const total = kinds.reduce((sum, kind) => sum + row.byKind[kind], 0) || 1;
      const button = el(
        'button',
        { type: 'button', class: `bar-row${row.selected ? ' selected' : ''}`, 'aria-pressed': String(row.selected), title: row.label },
        el('span', { class: 'bar-label' }, row.selected ? el('span', { class: 'check', 'aria-hidden': 'true' }, '✓') : null, row.label),
        el('span', { class: 'bar-amount' }, format(row.amount)),
        el(
          'span',
          { class: 'bar-track', 'aria-hidden': 'true' },
          el(
            'span',
            { class: 'bar-fill', style: `width:${(row.amount / max) * 100}%` },
            ...kinds
              .filter((kind) => row.byKind[kind] > 0)
              .map((kind) => el('span', { class: `bar-part kind-${kind}`, style: `flex-grow:${row.byKind[kind] / total}` }))
          )
        )
      );
      tipOn(button, () => row.label, () => [
        ...kinds.filter((kind) => row.byKind[kind] > 0).map((kind) => [kind, format(row.byKind[kind]), kindNames[kind]] as [Kind, string, string]),
        [null, '', row.note],
      ]);
      button.addEventListener('click', () => { hideTip(); onPick(row.value); });
      return el('li', {}, button);
    })
  );
}

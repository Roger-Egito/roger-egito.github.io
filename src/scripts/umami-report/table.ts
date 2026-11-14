/**
 * One sortable, pageable table for every list in the report. Click a header to sort by
 * it, click again to flip the order. Long lists show their first rows and a button for
 * the rest, so a big export doesn't bury everything below it.
 */
import { el, type Child } from './dom.ts';

export interface Column<T> {
  key: string;
  label: string;
  /** What the column sorts by. Leave out to make the column unsortable. */
  sort?: (row: T) => string | number | null;
  cell: (row: T) => Child;
  /** Numbers line up on the right. */
  numeric?: boolean;
  /** Shown on hover over the header, for columns that need explaining. */
  hint?: string;
}

export interface SortState {
  key: string;
  descending: boolean;
}

export interface TableOptions<T> {
  columns: Column<T>[];
  rows: T[];
  sort: SortState;
  onSort: (sort: SortState) => void;
  /** Rows shown before the "Show all" button. */
  limit?: number;
  expanded?: boolean;
  onExpand?: () => void;
  /** A detail row under a row, for the ones open (visits open to their pages). */
  detail?: (row: T) => Child;
  isOpen?: (row: T) => boolean;
  onRowClick?: (row: T) => void;
  rowClass?: (row: T) => string;
  empty?: string;
  label: string;
}

export function sortRows<T>(rows: T[], columns: Column<T>[], sort: SortState): T[] {
  const column = columns.find((c) => c.key === sort.key && c.sort);
  if (!column?.sort) return rows;
  const read = column.sort;
  const direction = sort.descending ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = read(a);
    const y = read(b);
    // Empty values sink to the bottom whichever way the column is sorted.
    if (x === null || x === '') return y === null || y === '' ? 0 : 1;
    if (y === null || y === '') return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * direction;
  });
}

export function table<T>(options: TableOptions<T>) {
  const { columns, sort, limit = 25 } = options;
  if (options.rows.length === 0) return el('p', { class: 'empty' }, options.empty ?? 'Nothing here with these filters.');

  const sorted = sortRows(options.rows, columns, sort);
  const shown = options.expanded ? sorted : sorted.slice(0, limit);

  const head = el(
    'tr',
    {},
    ...columns.map((column) => {
      if (!column.sort) return el('th', { class: column.numeric ? 'num' : '', scope: 'col', title: column.hint }, column.label);
      const active = sort.key === column.key;
      const button = el(
        'button',
        { type: 'button', class: 'sort' },
        column.label,
        el('span', { class: 'arrow', 'aria-hidden': 'true' }, active ? (sort.descending ? '▼' : '▲') : '↕')
      );
      // Numbers start biggest-first, words start A to Z.
      button.addEventListener('click', () =>
        options.onSort({ key: column.key, descending: active ? !sort.descending : Boolean(column.numeric) })
      );
      return el(
        'th',
        {
          class: column.numeric ? 'num' : '',
          scope: 'col',
          title: column.hint,
          'aria-sort': active ? (sort.descending ? 'descending' : 'ascending') : 'none',
        },
        button
      );
    })
  );

  const body = el('tbody');
  for (const row of shown) {
    const tr = el(
      'tr',
      { class: [options.rowClass?.(row), options.onRowClick ? 'clickable' : ''].filter(Boolean).join(' ') || false },
      ...columns.map((column) => el('td', { class: column.numeric ? 'num' : '' }, column.cell(row)))
    );
    if (options.onRowClick) {
      tr.addEventListener('click', (event) => {
        // Controls inside the row keep their own clicks.
        if ((event.target as Element).closest('button, select, a, input')) return;
        options.onRowClick!(row);
      });
    }
    body.append(tr);
    if (options.detail && options.isOpen?.(row)) {
      body.append(el('tr', { class: 'detail' }, el('td', { colspan: columns.length }, options.detail(row))));
    }
  }

  const more =
    !options.expanded && sorted.length > limit && options.onExpand
      ? (() => {
          const button = el('button', { type: 'button', class: 'more' }, `Show all ${sorted.length}`);
          button.addEventListener('click', options.onExpand);
          return button;
        })()
      : null;

  return el(
    'div',
    { class: 'table-block' },
    el('div', { class: 'table-wrap' }, el('table', { 'aria-label': options.label }, el('thead', {}, head), body)),
    more
  );
}

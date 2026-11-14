/**
 * CSV text to records, for Umami's exports. No DOM, no I/O: text in, objects out.
 *
 * Follows RFC 4180: fields may be wrapped in double quotes, a quote inside one is
 * written twice, and a quoted field may hold commas and line breaks. Umami writes a
 * missing value as \N, which comes out here as null, so "no referrer" and "an empty
 * referrer" stay different things.
 */

export type CsvRecord = Record<string, string | null>;

/** Splits CSV text into rows of raw fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  // A byte-order mark at the start would otherwise become part of the first header.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  for (; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      // \r\n is one line break, not two.
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }

  // The last line, when the file doesn't end with a line break.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Blank lines carry nothing.
  return rows.filter((cells) => cells.length > 1 || cells[0] !== '');
}

/** CSV text to one object per row, keyed by the header row. \N becomes null. */
export function parseRecords(text: string): CsvRecord[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  return rows.map((cells) =>
    Object.fromEntries(
      header.map((name, column) => {
        const value = cells[column] ?? null;
        return [name.trim(), value === '\\N' ? null : value];
      })
    )
  );
}

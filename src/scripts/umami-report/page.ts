/**
 * Wires the report page together: reads the dropped files, runs them through the pure
 * modules in src/lib/umami-report, keeps the hand overrides in local storage, and hands
 * the result to render.ts.
 *
 * The files are read with the File API and never leave the browser: there is no fetch,
 * no upload, nothing sent anywhere. Closing the tab forgets them.
 */
import { readExport, type DroppedFile } from '../../lib/umami-report/archive.ts';
import { parseRecords, type CsvRecord } from '../../lib/umami-report/csv.ts';
import { reportConfig } from '../../lib/umami-report/config.ts';
import { buildSessions, classifyAll, readEvents, type Kind, type Session } from '../../lib/umami-report/sessions.ts';
import { buildReport } from '../../lib/umami-report/report.ts';
import { moment, renderReport } from './render.ts';

const STORAGE_KEY = 'umami-report:overrides';

const input = document.querySelector<HTMLInputElement>('[data-report-files]')!;
const zone = document.querySelector<HTMLElement>('[data-report-drop]')!;
const status = document.querySelector<HTMLElement>('[data-report-status]')!;
const output = document.querySelector<HTMLElement>('[data-report-output]')!;
const clear = document.querySelector<HTMLButtonElement>('[data-report-clear]')!;

/** Hand overrides, by session id. Kept per browser, so they survive a reload. */
function loadOverrides(): Record<string, Kind> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveOverrides(overrides: Record<string, Kind>) {
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Storage blocked: the change still shows, it just won't be remembered.
  }
}

let sessions: Session[] = [];
let eventData: CsvRecord[] = [];
let hasEventData = false;
let overrides = loadOverrides();

function draw() {
  const classified = classifyAll(sessions, reportConfig, overrides);
  const report = buildReport(classified, reportConfig.timeZone, eventData);
  // Only the overrides for sessions in this export count toward the button's number.
  const here = classified.filter((session) => session.kind !== session.ruled.kind).length;
  clear.hidden = Object.keys(overrides).length === 0;
  clear.textContent = `Clear hand changes (${here} in this export)`;

  renderReport(output, {
    report,
    sessions: classified,
    timeZone: reportConfig.timeZone,
    hasEventData,
    onOverride: (id, kind) => {
      const ruled = classified.find((session) => session.id === id)?.ruled.kind;
      // Back to what the rules say is no override at all.
      if (kind === ruled) delete overrides[id];
      else overrides[id] = kind;
      saveOverrides(overrides);
      draw();
    },
  });
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
      status.textContent = `No website_event.csv in ${files.map((file) => file.name).join(', ')}.`;
      return;
    }

    const records = parseRecords(found.websiteEvent);
    sessions = buildSessions(readEvents(records), reportConfig);
    eventData = found.eventData ? parseRecords(found.eventData) : [];
    hasEventData = Boolean(found.eventData);

    const first = sessions[0]?.start;
    const last = sessions.reduce((latest, s) => (s.end > latest ? s.end : latest), first ?? new Date(0));
    const range = first ? `${moment(first, reportConfig.timeZone)} to ${moment(last, reportConfig.timeZone)}` : 'no events';
    const read = [
      `website_event.csv (${records.length.toLocaleString('en-US')} rows)`,
      found.eventData && `event_data.csv (${eventData.length.toLocaleString('en-US')} rows)`,
      found.sessionData && 'session_data.csv (not used: it only holds identify() data)',
    ].filter(Boolean);
    status.textContent =
      `Read ${read.join(', ')}. ${sessions.length} sessions, ${range}.` +
      (found.ignored.length ? ` Skipped: ${found.ignored.join(', ')}.` : '');
    draw();
  } catch (error) {
    status.textContent = `Couldn't read that: ${(error as Error).message}`;
  }
}

input.addEventListener('change', () => load([...(input.files ?? [])]));

zone.addEventListener('dragover', (event) => {
  event.preventDefault();
  zone.dataset.over = '';
});
zone.addEventListener('dragleave', () => delete zone.dataset.over);
zone.addEventListener('drop', (event) => {
  event.preventDefault();
  delete zone.dataset.over;
  load([...(event.dataTransfer?.files ?? [])]);
});

clear.addEventListener('click', () => {
  overrides = {};
  saveOverrides(overrides);
  draw();
});

/**
 * The files dropped on the report page to the three CSVs inside them. Accepts the CSVs
 * themselves, a .gz (a gzipped tar of them, or one gzipped CSV), or a .zip.
 *
 * Unpacking uses DecompressionStream, which browsers and Node both have, so this runs
 * in either and never needs a server: the files are read where they're dropped.
 */

export interface DroppedFile {
  name: string;
  bytes: Uint8Array;
}

export interface ExportFiles {
  websiteEvent?: string;
  sessionData?: string;
  eventData?: string;
  /** Names of anything that wasn't one of the three, so the page can say so. */
  ignored: string[];
}

async function inflate(bytes: Uint8Array, format: 'gzip' | 'deflate-raw') {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const text = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes);
const base = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** A tar archive's files. Tar is 512-byte headers, each followed by its file's data. */
function untar(bytes: Uint8Array): DroppedFile[] {
  const files: DroppedFile[] = [];
  let at = 0;
  while (at + 512 <= bytes.length) {
    const header = bytes.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break; // the end-of-archive blocks
    const field = (start: number, length: number) =>
      text(header.subarray(start, start + length)).replace(/\0.*$/s, '').trim();
    const name = field(0, 100);
    const size = parseInt(field(124, 12), 8) || 0;
    const type = field(156, 1);
    // A ustar prefix holds the front of a long path.
    const prefix = field(257, 6) === 'ustar' ? field(345, 155) : '';
    if (type === '0' || type === '') {
      files.push({
        name: prefix ? `${prefix}/${name}` : name,
        bytes: bytes.slice(at + 512, at + 512 + size),
      });
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

const isTar = (bytes: Uint8Array) => bytes.length > 262 && text(bytes.subarray(257, 262)) === 'ustar';

/** A zip archive's files, read from its central directory, which has the real sizes. */
async function unzip(bytes: Uint8Array): Promise<DroppedFile[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= 0; at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error('This .zip has no directory at its end, so it may be damaged.');

  const files: DroppedFile[] = [];
  let at = view.getUint32(end + 16, true);
  const entries = view.getUint16(end + 10, true);
  for (let i = 0; i < entries; i++) {
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = text(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue; // a folder
    const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(dataAt, dataAt + compressed);
    if (method === 0) files.push({ name, bytes: data.slice() });
    else if (method === 8) files.push({ name, bytes: await inflate(data, 'deflate-raw') });
  }
  return files;
}

/** Every file inside what was dropped, archives opened up. */
async function expand(file: DroppedFile): Promise<DroppedFile[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.zip')) return unzip(file.bytes);
  if (name.endsWith('.gz') || name.endsWith('.tgz')) {
    const inner = await inflate(file.bytes, 'gzip');
    if (isTar(inner)) return untar(inner);
    return [{ name: file.name.replace(/\.t?gz$/i, (match) => (match.toLowerCase() === '.tgz' ? '.tar' : '')), bytes: inner }];
  }
  if (name.endsWith('.tar')) return untar(file.bytes);
  return [file];
}

export async function readExport(dropped: DroppedFile[]): Promise<ExportFiles> {
  const result: ExportFiles = { ignored: [] };
  for (const file of (await Promise.all(dropped.map(expand))).flat()) {
    const name = base(file.name).toLowerCase();
    if (name.startsWith('website_event')) result.websiteEvent = text(file.bytes);
    else if (name.startsWith('session_data')) result.sessionData = text(file.bytes);
    else if (name.startsWith('event_data')) result.eventData = text(file.bytes);
    else result.ignored.push(file.name);
  }
  return result;
}

/** File reading for the jobs worker: bytes + lowercase extension, never the name. */
import { XchangeError } from '../core/errors';
import { LIMITS } from '../core/limits';
import { UiError, type InFile } from '../state/jobs-handler';
import { extensionOf } from './dom';

/** The largest mesh or position file any step accepts (the jaw scan). */
const MAX_INPUT = LIMITS.jaw.maxBytes;

/**
 * Reads files after a File.size check (a 3 GB drop is refused before it is read into the tab's memory);
 * the parsers in the worker check their own, tighter limits again.
 */
export async function readFiles(files: readonly File[], maxBytes: number = MAX_INPUT): Promise<InFile[]> {
  files.forEach((f, i) => {
    if (f.size > maxBytes) throw new XchangeError('FILE_TOO_LARGE', { limitBytes: maxBytes, bytes: f.size, file: i + 1, files: files.length });
  });
  try {
    return await Promise.all(files.map(async (f) => ({ bytes: new Uint8Array(await f.arrayBuffer()), extension: extensionOf(f) })));
  } catch {
    throw new UiError('readFailed');
  }
}

export const buffersOf = (files: readonly InFile[]): ArrayBuffer[] => files.map((f) => f.bytes.buffer as ArrayBuffer);

export const ACCEPT = {
  capture: '.stl,.ply,.obj,.csv,.txt,.tsv,.xml,.json,.xlsx,.xls,.pic,.tupel,.beb',
  geometry: '.stl,.ply,.obj',
  jaw: '.stl,.ply',
  library: '.json,application/json',
} as const;

/** Every blob: URL handed out and not yet revoked (one page, any number of mounts). */
const liveUrls = new Set<string>();

/** Starts a download of in-memory bytes through a blob: URL (a navigation, not governed by CSP). Revoke it with revokeUrl. */
export function download(bytes: Uint8Array, name: string, type: string): string {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  liveUrls.add(url);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  return url;
}

export function revokeUrl(url: string): void {
  if (liveUrls.delete(url)) URL.revokeObjectURL(url);
}

/** On dispose (astro:before-swap): the document lives on with the ClientRouter, so every blob would stay in memory. */
export function revokeAllUrls(): void {
  for (const u of liveUrls) URL.revokeObjectURL(u);
  liveUrls.clear();
}

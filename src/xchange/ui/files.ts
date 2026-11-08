/** File reading for the jobs worker: bytes + lowercase extension, never the name. */
import { UiError, type InFile } from '../state/jobs-handler';
import { extensionOf } from './dom';

export async function readFiles(files: readonly File[]): Promise<InFile[]> {
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

/** Starts a download of in-memory bytes through a blob: URL (a navigation, not governed by CSP). The caller revokes the URL. */
export function download(bytes: Uint8Array, name: string, type: string): string {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  return url;
}

/**
 * ddt-xchange-geometries.json (UI-DESIGN §7.3): { schema, schemaVersion: 1, exportedAt, entries: [{ name, favorite, stl }] }
 * with `stl` = base64 of a binary STL. Runs in the jobs worker. JSON, not ZIP, so import needs no ZIP reader;
 * every entry goes through the hardened parseMesh(…, 'geometry'). Holds nothing about cases.
 */
import { writeBinarySTL } from '../core/stl-writer';
import type { TriMesh } from '../core/types';
import { parseMesh } from '../io/mesh/index';

export const LIBRARY_FILE_SCHEMA = 'ddt-xchange-geometries';
/** Covers a full library (50) of ordinary parts (~50 k triangles, ~3.3 MB each as base64 STL). */
export const LIBRARY_FILE_MAX_BYTES = 256 * 1024 * 1024;

export interface LibraryFileEntry {
  name: string;
  favorite: boolean;
  mesh: TriMesh;
}

export class LibraryFileError extends Error {
  constructor(readonly code: 'libraryFileInvalid' | 'libraryFileTooLarge') {
    super(code);
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeLibraryFile(entries: readonly LibraryFileEntry[], exportedAt = new Date().toISOString()): Uint8Array {
  const json = JSON.stringify({
    schema: LIBRARY_FILE_SCHEMA,
    schemaVersion: 1,
    exportedAt,
    entries: entries.map((e) => ({ name: e.name, favorite: e.favorite, stl: toBase64(writeBinarySTL(e.mesh)) })),
  });
  return new TextEncoder().encode(json);
}

/** Bad entries are skipped and counted, never fatal; a wrong schema or a broken file is. */
export function decodeLibraryFile(bytes: Uint8Array): { entries: LibraryFileEntry[]; skipped: number } {
  if (bytes.byteLength > LIBRARY_FILE_MAX_BYTES) throw new LibraryFileError('libraryFileTooLarge');
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new LibraryFileError('libraryFileInvalid');
  }
  const root = data as { schema?: unknown; schemaVersion?: unknown; entries?: unknown };
  if (!root || root.schema !== LIBRARY_FILE_SCHEMA || root.schemaVersion !== 1 || !Array.isArray(root.entries)) throw new LibraryFileError('libraryFileInvalid');
  const entries: LibraryFileEntry[] = [];
  let skipped = 0;
  for (const raw of root.entries as unknown[]) {
    const e = raw as { name?: unknown; favorite?: unknown; stl?: unknown };
    try {
      if (!e || typeof e.name !== 'string' || typeof e.stl !== 'string') throw new Error('entry');
      const { mesh } = parseMesh(fromBase64(e.stl), 'geometry', 'stl');
      entries.push({ name: e.name, favorite: e.favorite === true, mesh });
    } catch {
      skipped++;
    }
  }
  return { entries, skipped };
}

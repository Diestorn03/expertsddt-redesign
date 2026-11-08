/**
 * "Your geometries" (UI-DESIGN §7): IndexedDB 'ddt-xchange' v1 with a `meta` and a `mesh` store, always
 * written in one transaction. Falls back to memory when IndexedDB is missing or blocked (persistent = false).
 * Names come from the user only, never from a file. Nothing is deleted except by remove().
 */
import { computeBounds, countTriangles } from '../core/mesh';
import type { TriMesh } from '../core/types';

export const LIBRARY_LIMIT = 50;
export const NAME_MAX = 60;
const DB_NAME = 'ddt-xchange';
const DB_VERSION = 1;

export interface GeometryMeta {
  schema: 1;
  id: string;
  name: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  triangles: number;
  extentMm: [number, number, number];
  /** 96×96 data:image/png, or '' until rendered. */
  thumbnail: string;
}

export class LibraryError extends Error {
  constructor(readonly code: 'libraryFull' | 'storageFull' | 'nameEmpty') {
    super(code);
  }
}

/** Trimmed, control characters removed, NFKC, at most 60 characters; '' when nothing is left. */
export function cleanName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

/** Appends " (2)", " (3)"… until the name is unique ignoring case. */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const t of taken) used.add(t.normalize('NFKC').toLowerCase());
  if (!used.has(name.toLowerCase())) return name;
  for (let k = 2; ; k++) {
    const suffix = ` (${k})`;
    const candidate = name.slice(0, NAME_MAX - suffix.length) + suffix;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Favorites first, then by name (locale-aware, accent-insensitive). */
export const sortMetas = (list: readonly GeometryMeta[]): GeometryMeta[] =>
  [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

/** Filter rule: name contains the query, case- and accent-insensitive. */
export const matchesQuery = (name: string, query: string): boolean => {
  const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return fold(name).includes(fold(query.trim()));
};

export function extentOf(mesh: TriMesh): [number, number, number] {
  const b = computeBounds(mesh);
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
const isQuota = (e: unknown): boolean => e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let r: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      r = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('mesh')) db.createObjectStore('mesh', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
  });
}

export class Library {
  private readonly metas = new Map<string, GeometryMeta>();
  /** Memory copy of meshes when not persistent, plus a cache of meshes read this visit. */
  private readonly meshes = new Map<string, TriMesh>();

  private constructor(private db: IDBDatabase | null) {}

  static async open(useIndexedDb = true): Promise<Library> {
    const db = useIndexedDb ? await openDb() : null;
    const lib = new Library(db);
    if (db) {
      db.onversionchange = () => { db.close(); lib.db = null; };
      try {
        const all = await req(db.transaction('meta').objectStore('meta').getAll() as IDBRequest<GeometryMeta[]>);
        for (const m of all) if (m && m.schema === 1 && typeof m.id === 'string') lib.metas.set(m.id, m);
      } catch {
        db.close();
        lib.db = null;
      }
    }
    return lib;
  }

  get persistent(): boolean {
    return this.db !== null;
  }
  get size(): number {
    return this.metas.size;
  }
  list(): GeometryMeta[] {
    return sortMetas([...this.metas.values()]);
  }
  meta(id: string): GeometryMeta | undefined {
    return this.metas.get(id);
  }
  has(id: string): boolean {
    return this.metas.has(id);
  }

  async get(id: string): Promise<TriMesh | null> {
    const cached = this.meshes.get(id);
    if (cached || !this.db) return cached ?? null;
    const row = await req(this.db.transaction('mesh').objectStore('mesh').get(id) as IDBRequest<{ positions: Float32Array; indices: Uint32Array } | undefined>);
    if (!row) return null;
    const mesh: TriMesh = { positions: row.positions, indices: row.indices };
    this.meshes.set(id, mesh);
    return mesh;
  }

  private names(exceptId?: string): string[] {
    return [...this.metas.values()].filter((m) => m.id !== exceptId).map((m) => m.name);
  }

  /** Saves a new geometry; the name is cleaned and made unique. */
  async add(rawName: string, mesh: TriMesh, thumbnail = '', favorite = false): Promise<GeometryMeta> {
    if (this.metas.size >= LIBRARY_LIMIT) throw new LibraryError('libraryFull');
    const name = cleanName(rawName);
    if (!name) throw new LibraryError('nameEmpty');
    const now = new Date().toISOString();
    const meta: GeometryMeta = {
      schema: 1, id: crypto.randomUUID(), name: uniqueName(name, this.names()), favorite, createdAt: now, updatedAt: now,
      triangles: countTriangles(mesh), extentMm: extentOf(mesh), thumbnail,
    };
    const stored: TriMesh = { positions: mesh.positions, indices: mesh.indices }; // colors are not kept
    if (this.db) {
      try {
        const tx = this.db.transaction(['meta', 'mesh'], 'readwrite');
        tx.objectStore('meta').put(meta);
        tx.objectStore('mesh').put({ id: meta.id, ...stored });
        await done(tx);
      } catch (e) {
        if (isQuota(e)) throw new LibraryError('storageFull');
        throw e;
      }
    }
    this.metas.set(meta.id, meta);
    this.meshes.set(meta.id, stored);
    return meta;
  }

  private async putMeta(meta: GeometryMeta): Promise<void> {
    if (this.db) {
      const tx = this.db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(meta);
      await done(tx);
    }
    this.metas.set(meta.id, meta);
  }

  async rename(id: string, rawName: string): Promise<GeometryMeta> {
    const m = this.metas.get(id);
    if (!m) throw new LibraryError('nameEmpty');
    const name = cleanName(rawName);
    if (!name) throw new LibraryError('nameEmpty');
    const next = { ...m, name: uniqueName(name, this.names(id)), updatedAt: new Date().toISOString() };
    await this.putMeta(next);
    return next;
  }

  async setFavorite(id: string, favorite: boolean): Promise<GeometryMeta | null> {
    const m = this.metas.get(id);
    if (!m) return null;
    const next = { ...m, favorite, updatedAt: new Date().toISOString() };
    await this.putMeta(next);
    return next;
  }

  async setThumbnail(id: string, thumbnail: string): Promise<void> {
    const m = this.metas.get(id);
    if (m) await this.putMeta({ ...m, thumbnail });
  }

  async remove(id: string): Promise<void> {
    if (this.db) {
      const tx = this.db.transaction(['meta', 'mesh'], 'readwrite');
      tx.objectStore('meta').delete(id);
      tx.objectStore('mesh').delete(id);
      await done(tx);
    }
    this.metas.delete(id);
    this.meshes.delete(id);
  }

  /** Merges imported entries, never overwriting: names made unique, extra entries beyond the limit skipped. */
  async importEntries(entries: readonly { name: string; favorite: boolean; mesh: TriMesh }[]): Promise<{ added: GeometryMeta[]; renamed: number; skipped: number }> {
    const added: GeometryMeta[] = [];
    let renamed = 0, skipped = 0;
    for (const e of entries) {
      if (this.metas.size >= LIBRARY_LIMIT) { skipped++; continue; }
      const name = cleanName(e.name);
      if (!name) { skipped++; continue; }
      const meta = await this.add(name, e.mesh, '', e.favorite);
      if (meta.name !== name) renamed++;
      added.push(meta);
    }
    return { added, renamed, skipped };
  }

  async entriesForExport(): Promise<{ name: string; favorite: boolean; mesh: TriMesh }[]> {
    const out: { name: string; favorite: boolean; mesh: TriMesh }[] = [];
    for (const m of this.list()) {
      const mesh = await this.get(m.id);
      if (mesh) out.push({ name: m.name, favorite: m.favorite, mesh });
    }
    return out;
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.meshes.clear();
  }
}

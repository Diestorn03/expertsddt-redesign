import { describe, expect, it } from 'vitest';
import { isXchangeError } from '../core/errors';
import { identity } from '../core/mat4';
import { writeBinarySTL } from '../core/stl-writer';
import type { AlignmentResult, ImplantSite } from '../core/types';
import { makeFrames, makeScanBody, makeSyntheticCase } from '../test/fixtures';
import { encodeMicronMapperCSV, encodeScanAdaptorXML, utf8 } from '../test/fixtures/positions';
import type { WorkerLike } from '../align/client';
import {
  alignmentParts, canMatchCapture, exportBlocker, freshCase, guidedTargets, mergeMeasured, mergePositionFiles, missingGeometry,
  pushUndo, reachable, siteStatus, step1Blocker, UNDO_LIMIT,
} from './case';
import { createJobsHandler, readCapture, UiError, type JobRequest } from './jobs-handler';
import { JobsClient } from './jobs';
import { LEAD_KEY, needsEmail, readLead, retryPending, submitLead, type StorageLike } from './lead';
import { cleanName, Library, LIBRARY_LIMIT, matchesQuery, uniqueName } from './library';
import { decodeLibraryFile, encodeLibraryFile, LibraryFileError } from './library-file';

const site = (id: string, label: string, m = identity()): ImplantSite => ({ id, label, matrix: m, source: 'matrix-table', flags: {} });
const frames = makeFrames(6, 'lower');

describe('mergePositionFiles (cross-file rule)', () => {
  it('keeps a label present in two files once when the matrices match within 1e-7, ids renumbered', () => {
    const m2 = Float64Array.from(frames[1]!);
    m2[3] = m2[3]! + 5e-8;
    const out = mergePositionFiles([[site('site-1', 'A', frames[0]), site('site-2', 'B', frames[1])], [site('site-1', 'B', m2), site('site-2', 'C', frames[2])]]);
    expect(out.map((s) => `${s.id}:${s.label}`)).toEqual(['site-1:A', 'site-2:B', 'site-3:C']);
  });
  it('different matrices for the same label -> LABEL_DUPLICATE crossFile', () => {
    const m2 = Float64Array.from(frames[0]!);
    m2[3] = m2[3]! + 1e-6;
    try {
      mergePositionFiles([[site('site-1', 'A', frames[0])], [site('site-1', 'A', m2)]]);
      expect.unreachable();
    } catch (e) {
      expect(isXchangeError(e) && e.code === 'LABEL_DUPLICATE' && e.details.reason === 'crossFile' && e.details.file === 2).toBe(true);
    }
  });
  it('merged count above the limit -> TOO_MANY_POSITIONS', () => {
    expect(() => mergePositionFiles([[site('s', 'A'), site('s', 'B')], [site('s', 'C')]], 2)).toThrow(/TOO_MANY_POSITIONS/);
  });
});

describe('gating and invalidation', () => {
  it('step 1 needs arch, positions and confirmed provisional sites', () => {
    const s = freshCase();
    expect(step1Blocker(s)).toBe('needArch');
    s.arch = 'lower';
    expect(step1Blocker(s)).toBe('needCapture');
    s.sites = [site('site-1', 'A'), { ...site('site-2', 'B'), flags: { provisional: true } }];
    expect(step1Blocker(s)).toBe('needConfirm');
    expect(reachable(s, 2)).toBe(false);
    s.excluded = new Set(['site-2']);
    expect(step1Blocker(s)).toBe(null);
    expect(missingGeometry(s)).toBe(1);
    s.geometryBySite = { 'site-1': 'g' };
    expect(reachable(s, 3)).toBe(true);
  });
  it('export: blocked without geometry, with an unaligned jaw and while measuring', () => {
    const s = { ...freshCase('lower'), sites: [site('site-1', 'A')] };
    expect(exportBlocker(s)).toBe('geometry');
    s.geometryBySite = { 'site-1': 'g' };
    expect(exportBlocker(s)).toBe(null);
    s.jaw = { mesh: makeScanBody(), originalBytes: new Uint8Array(1), format: 'stl' };
    expect(exportBlocker(s)).toBe('notAligned');
    s.alignment = {} as AlignmentResult;
    s.measuring = true;
    expect(exportBlocker(s)).toBe('measuring');
  });
  it('undo keeps at most 20 poses', () => {
    let u: Float64Array[] = [];
    for (let i = 0; i < 25; i++) u = pushUndo(u, identity());
    expect(u.length).toBe(UNDO_LIMIT);
  });
});

describe('alignment parts', () => {
  const c = makeSyntheticCase({ implants: 3 });
  it('replacement geometry placed at each site, or the captured shell', () => {
    const parts = alignmentParts(c.sites, () => c.body, c.parts.map((p) => p.mesh), 'replacement');
    expect(parts.length).toBe(3);
    expect(parts[1]!.mesh.positions).toEqual(c.parts[1]!.mesh.positions);
    const shells = alignmentParts(c.sites, () => undefined, c.parts.map((p) => p.mesh), 'capture');
    expect(shells[2]!.mesh).toBe(c.parts[2]!.mesh);
    expect(canMatchCapture(c.sites, [])).toBe(false);
    expect(canMatchCapture(c.sites, c.parts.map((p) => p.mesh))).toBe(true);
  });
  it('guided targets: all up to 4, four spread above', () => {
    for (let n = 1; n <= 8; n++) {
      const sites = makeFrames(n, 'lower').map((m, i) => site(`site-${i + 1}`, `S${i + 1}`, m));
      const t = guidedTargets(sites);
      expect(t.length).toBe(Math.min(n, 4));
      expect(new Set(t.map((x) => x.id)).size).toBe(t.length);
    }
  });
});

describe('results', () => {
  it('per-site status from DEFAULT_QUALITY', () => {
    expect(siteStatus({ rmsMm: 0.02, coverage: 0.99 })).toBe('good');
    expect(siteStatus({ rmsMm: 0.08, coverage: 0.9 })).toBe('acceptable');
    expect(siteStatus({ rmsMm: 0.3, coverage: 0.6 })).toBe('weak');
    expect(siteStatus({ rmsMm: 0.3, coverage: 0.1 })).toBe('poor');
  });
  it('a re-measure of an unmoved pose keeps the method and method flags', () => {
    const prev = { method: 'landmarks', status: 'good', flags: ['visualCheckRequired', 'landmarkAxisFree'] } as unknown as AlignmentResult;
    const measured = { method: 'manual', status: 'acceptable', rmsMm: 0.07, flags: ['visualCheckRequired', 'manualPose'] } as unknown as AlignmentResult;
    const kept = mergeMeasured(prev, measured, false);
    expect(kept.method).toBe('landmarks');
    expect(kept.flags).toEqual(['visualCheckRequired', 'landmarkAxisFree']);
    expect(kept.status).toBe('acceptable');
    expect(mergeMeasured(prev, measured, true)).toBe(measured);
  });
});

describe('library', () => {
  it('cleans names and makes them unique ignoring case', () => {
    expect(cleanName('  H6.6\u0007 cap  ')).toBe('H6.6 cap');
    expect(uniqueName('Cap', ['cap', 'Cap (2)'])).toBe('Cap (3)');
    expect(matchesQuery('Pilar cicatrización', 'CICATRIZACION')).toBe(true);
  });
  it('memory fallback: add, favorite first, rename, limit, remove, import never overwrites', async () => {
    const lib = await Library.open(false);
    expect(lib.persistent).toBe(false);
    const body = makeScanBody();
    const a = await lib.add('Cap', body);
    await lib.add('cap', body);
    expect(lib.list().map((m) => m.name)).toEqual(['Cap', 'cap (2)']);
    await lib.setFavorite(lib.list()[1]!.id, true);
    expect(lib.list()[0]!.name).toBe('cap (2)');
    expect((await lib.rename(a.id, 'Cap (2)')).name).toBe('Cap (2) (2)');
    const r = await lib.importEntries([{ name: 'Cap', favorite: false, mesh: body }]);
    expect(r).toMatchObject({ renamed: 0, skipped: 0 });
    while (lib.size < LIBRARY_LIMIT) await lib.add('x', body);
    await expect(lib.add('y', body)).rejects.toMatchObject({ code: 'libraryFull' });
    expect((await lib.importEntries([{ name: 'z', favorite: false, mesh: body }])).skipped).toBe(1);
    await lib.remove(a.id);
    expect(lib.has(a.id)).toBe(false);
    expect(await lib.get(lib.list()[0]!.id)).not.toBeNull();
  });
  it('library file round trip, bad entries skipped, wrong schema refused', () => {
    const body = makeScanBody();
    const bytes = encodeLibraryFile([{ name: 'A', favorite: true, mesh: body }]);
    const json = JSON.parse(new TextDecoder().decode(bytes));
    json.entries.push({ name: 'broken', stl: 'AAAA' });
    const back = decodeLibraryFile(utf8(JSON.stringify(json)));
    expect(back.skipped).toBe(1);
    expect(back.entries[0]!.name).toBe('A');
    expect(back.entries[0]!.favorite).toBe(true);
    expect(back.entries[0]!.mesh.indices.length).toBe(body.indices.length);
    expect(() => decodeLibraryFile(utf8('{"schema":"other"}'))).toThrow(LibraryFileError);
    expect(() => decodeLibraryFile(utf8('not json'))).toThrow(LibraryFileError);
  });
});

describe('lead (email gate)', () => {
  const store = (): StorageLike & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };
  const env = (s: StorageLike, fetchFn: typeof fetch, hook = 'https://hook.test/x') => ({ storage: s, hook, lang: 'en', page: 'https://expertsddt.com/ddt-xchange/', fetchFn, warn: () => {} });
  it('none -> pending -> sent, payload has exactly four keys', async () => {
    const s = store();
    let body = '';
    expect(needsEmail(s)).toBe(true);
    const state = await submitLead('a@b.co', env(s, (async (_u: unknown, init?: RequestInit) => { body = String(init?.body); return new Response('', { status: 200 }); }) as typeof fetch));
    expect(state).toBe('sent');
    expect(JSON.parse(body)).toEqual({ source: 'ddt-xchange', email: 'a@b.co', lang: 'en', page: 'https://expertsddt.com/ddt-xchange/' });
    expect(s.data.get(LEAD_KEY)).toBe('{"v":1,"state":"sent"}');
  });
  it('failure keeps pending (email kept) and a retry sends it', async () => {
    const s = store();
    expect(await submitLead('a@b.co', env(s, (async () => { throw new Error('offline'); }) as typeof fetch))).toBe('pending');
    expect(readLead(s)).toEqual({ v: 1, state: 'pending', email: 'a@b.co' });
    expect(needsEmail(s)).toBe(false);
    await retryPending(env(s, (async () => new Response('', { status: 200 })) as typeof fetch));
    expect(readLead(s)?.state).toBe('sent');
  });
  it('unset webhook -> sent without a request', async () => {
    const s = store();
    let called = false;
    expect(await submitLead('a@b.co', env(s, (async () => { called = true; return new Response(''); }) as typeof fetch, ''))).toBe('sent');
    expect(called).toBe(false);
  });
});

describe('jobs', () => {
  const c = makeSyntheticCase({ implants: 4, seed: 5 });
  const csv = utf8(encodeMicronMapperCSV(c.frames));
  const stl = writeBinarySTL(c.captureMesh);
  it('position file + capture mesh: linked sites, one source per file, no name anywhere', () => {
    const r = readCapture([{ bytes: csv, extension: 'csv' }, { bytes: stl, extension: 'stl' }]);
    expect(r.format).toBe('micronmapper-csv');
    expect(r.sources.map((s) => `${s.kind}:${s.count}`)).toEqual(['positions:4', 'mesh:4']);
    expect(r.sites.map((s) => s.componentIndex)).toEqual([0, 1, 2, 3]);
    expect(r.components!.length).toBe(4);
  });
  it('two meshes are refused; a bad second file reports its position', () => {
    expect(() => readCapture([{ bytes: stl, extension: 'stl' }, { bytes: stl, extension: 'stl' }])).toThrow(UiError);
    try {
      readCapture([{ bytes: csv, extension: 'csv' }, { bytes: new Uint8Array(0), extension: 'csv' }]);
      expect.unreachable();
    } catch (e) {
      expect(isXchangeError(e) && e.code === 'FILE_EMPTY' && e.details.file === 2 && e.details.files === 2).toBe(true);
    }
  });
  it('client <-> handler through an in-process worker, cancel then reuse', async () => {
    const fake = (): WorkerLike => {
      const listeners: ((e: MessageEvent) => void)[] = [];
      const handle = createJobsHandler((m) => setTimeout(() => listeners.forEach((l) => l({ data: m } as MessageEvent)), 0));
      return { postMessage: (m) => setTimeout(() => handle(m as { id: number; job: JobRequest }), 0), addEventListener: (t, l) => { if (t === 'message') listeners.push(l as never); }, terminate: () => {} };
    };
    const client = new JobsClient(fake);
    const xml = utf8(encodeScanAdaptorXML(c.frames, ['11', '12', '13', '14']));
    const ac = new AbortController();
    const first = client.run({ type: 'readCapture', files: [{ bytes: xml, extension: 'xml' }] }, [], ac.signal);
    ac.abort();
    await expect(first).rejects.toMatchObject({ code: 'CANCELLED' });
    const r = await client.run<{ sites: ImplantSite[] }>({ type: 'readCapture', files: [{ bytes: xml, extension: 'xml' }] });
    expect(r.sites.map((s) => s.label)).toEqual(['11', '12', '13', '14']);
    await expect(client.run({ type: 'readCapture', files: [{ bytes: new Uint8Array(0), extension: 'csv' }] })).rejects.toMatchObject({ code: 'FILE_EMPTY' });
    client.dispose();
  });
});

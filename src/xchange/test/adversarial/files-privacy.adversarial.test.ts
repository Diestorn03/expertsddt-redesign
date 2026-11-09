/**
 * Integration review, files and privacy: input size limits as the UI meets them, the library backup round trip,
 * and the privacy promises ("your files never leave this computer"; no names in anything the tool writes or
 * sends). Tests named "BUG:" fail on purpose until the production code is fixed; the others guard what holds.
 * Synthetic data only; the "patient" below is made up.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { identity } from '../../core/mat4';
import { countTriangles } from '../../core/mesh';
import { LIMITS } from '../../core/limits';
import { writeBinarySTL } from '../../core/stl-writer';
import type { AlignmentResult, TriMesh } from '../../core/types';
import { createAlignHandler } from '../../align/handler';
import type { AlignResponse } from '../../align/protocol';
import { alignmentParts } from '../../state/case';
import { runJob, type CaptureResult, type ExportResult, type JawResult } from '../../state/jobs-handler';
import { needsEmail, submitLead, type LeadEnv, type StorageLike } from '../../state/lead';
import { LIBRARY_LIMIT } from '../../state/library';
import { decodeLibraryFile, encodeLibraryFile, LIBRARY_FILE_MAX_BYTES } from '../../state/library-file';
import { makeSample } from '../../ui/demo';
import { readFiles } from '../../ui/files';
import { AlignStep, XCHANGE_VERSION } from '../../ui/step-align';
import { makeSyntheticCase } from '../fixtures';
import { encodeAsciiSTL, encodePLY } from '../fixtures/encoders';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** n × n quads on a gentle bump: an ordinary library part (2 n² triangles). */
function grid(n: number): TriMesh {
  const positions = new Float32Array(3 * (n + 1) * (n + 1));
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const k = 3 * (i * (n + 1) + j), x = (8 * i) / n - 4, y = (8 * j) / n - 4;
    positions[k] = x; positions[k + 1] = y; positions[k + 2] = 3 - 0.1 * (x * x + y * y);
  }
  const indices = new Uint32Array(6 * n * n);
  let t = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const a = i * (n + 1) + j, b = a + 1, c = a + n + 2, d = a + n + 1;
    indices.set([a, b, c, a, c, d], t);
    t += 6;
  }
  return { positions, indices };
}

const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);
function contains(hay: Uint8Array, needle: string): boolean {
  const n = ascii(needle);
  outer: for (let i = 0; i + n.length <= hay.length; i++) {
    for (let k = 0; k < n.length; k++) if (hay[i + k] !== n[k]) continue outer;
    return true;
  }
  return false;
}

describe('input size limits, as the UI meets them', () => {
  it('BUG: a file larger than every input limit is refused from File.size, before it is read into memory', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(16));
    // 3 GB, e.g. a raw full-arch scan dropped by mistake (the largest input limit is 150 MB, LIMITS.jaw)
    const huge = { name: 'scan.stl', size: 3 * 1024 ** 3, type: 'model/stl', arrayBuffer } as unknown as File;
    const outcome = await readFiles([huge]).then(() => 'read', (e: unknown) => e);
    // Today readFiles calls File.arrayBuffer() first (step 1 capture, step 2 geometry, step 3 jaw, library import):
    // a 3 GB read on the main thread either fails as "could not read the file" (ui.readFailed) or takes the tab
    // down, and anything between the limit and ~2 GB is read in full and copied to the worker before
    // FILE_TOO_LARGE. The library import (step-geometry.ts importLibrary) checks its 100 MB only after the read too.
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('BUG: a library the app accepts can be exported and imported back (the backup the storage-full message suggests)', () => {
    const part = grid(158); // 49,928 triangles: an ordinary Ti-base or scan-body part
    expect(countTriangles(part)).toBeLessThan(LIMITS.geometry.maxTriangles / 10);
    const entry = (i: number): { name: string; favorite: boolean; mesh: TriMesh } => ({ name: `Part ${String(i).padStart(2, '0')}`, favorite: false, mesh: part });
    const one = encodeLibraryFile([entry(1)], '2026-11-07T12:00:00.000Z');
    expect(decodeLibraryFile(one).entries).toHaveLength(1); // the format itself round-trips
    const two = encodeLibraryFile([entry(1), entry(2)], '2026-11-07T12:00:00.000Z').byteLength;
    // every further entry adds exactly the same bytes (same mesh, same-length name): the full library's file size
    const full = one.byteLength + (LIBRARY_LIMIT - 1) * (two - one.byteLength);
    // Today ~170 MB (base64 STL inside JSON) for 50 such parts, while decodeLibraryFile and the import button refuse
    // anything over 100 MB: the exported backup cannot be restored (about 30 parts is already the ceiling).
    expect(full).toBeLessThanOrEqual(LIBRARY_FILE_MAX_BYTES);
  });
});

describe('privacy: files never leave this computer', () => {
  // The whole pipeline on a 280 k-triangle jaw takes 3-4 s alone: the 5 s default timed out when the full suite loads the machine.
  it('the whole sample case (read, align, measure, deviation map, export, library file) touches no network API', { timeout: 30_000 }, () => {
    const used: string[] = [];
    const trap = (name: string) => (): never => { used.push(name); throw new Error(`${name} must not be used`); };
    vi.stubGlobal('fetch', trap('fetch'));
    vi.stubGlobal('XMLHttpRequest', trap('XMLHttpRequest'));
    vi.stubGlobal('WebSocket', trap('WebSocket'));
    vi.stubGlobal('EventSource', trap('EventSource'));
    vi.stubGlobal('importScripts', trap('importScripts'));
    vi.stubGlobal('navigator', { sendBeacon: trap('sendBeacon') });

    const sample = makeSample();
    const capture = runJob({ type: 'readCapture', files: [{ bytes: sample.csv, extension: 'csv' }] }, []) as CaptureResult;
    const jaw = runJob({ type: 'readJaw', file: { bytes: sample.jaw, extension: 'ply' } }, []) as JawResult;
    const parts = alignmentParts(capture.sites, () => sample.body, [], 'replacement');
    const answers: AlignResponse[] = [];
    const align = createAlignHandler((m) => void answers.push(m));
    align({ type: 'setJaw', id: 1, jaw: jaw.mesh });
    align({ type: 'auto', id: 2, parts });
    const auto = answers.find((a): a is Extract<AlignResponse, { type: 'result' }> => a.type === 'result')!.result;
    align({ type: 'measure', id: 3, parts, transform: auto.transform });
    align({ type: 'deviation', id: 4, parts, transform: auto.transform });
    expect(answers.filter((a) => a.type === 'error')).toEqual([]);
    const geometry = { id: 'sample-body', name: 'Sample scan body', mesh: sample.body };
    const exported = runJob({ type: 'export', request: {
      arch: sample.arch, captureFormat: 'demo', sites: capture.sites, geometryBySite: Object.fromEntries(capture.sites.map((s) => [s.id, geometry])),
      assemblyTransform: auto.transform, jaw: { mesh: jaw.mesh, originalBytes: jaw.originalBytes, format: jaw.format }, alignment: auto,
      createdAt: '2026-11-07T12:00:00Z', appVersion: XCHANGE_VERSION,
    } }, []) as ExportResult;
    const libraryFile = runJob({ type: 'libraryOut', entries: [{ name: 'Sample scan body', favorite: true, mesh: sample.body }] }, []) as Uint8Array;
    runJob({ type: 'libraryIn', bytes: libraryFile }, []);
    expect(exported.zipName).toBe('DDT-Xchange_upper_export.zip');
    expect(used).toEqual([]);
  });

  it('a name inside the jaw file (binary STL header, ASCII solid name, PLY comment) stays only in the byte-for-byte jaw.*, never in a file the tool writes', () => {
    const who = 'Maria Lopez';
    const c = makeSyntheticCase({ implants: 2, seed: 9 });
    const ply = encodePLY(c.jaw, 'binary_little_endian');
    const head = new TextDecoder('latin1').decode(ply.subarray(0, 512));
    const at = head.indexOf('\n', head.indexOf('format')) + 1;
    const comment = ascii(`comment Patient ${who} 1984-02-03\n`);
    const plyWithName = new Uint8Array(ply.length + comment.length);
    plyWithName.set(ply.subarray(0, at));
    plyWithName.set(comment, at);
    plyWithName.set(ply.subarray(at), at + comment.length);
    const jaws = [writeBinarySTL(c.jaw, `PATIENT ${who} 1984-02-03`), encodeAsciiSTL(c.jaw, 'Maria_Lopez_1984-02-03'), plyWithName];
    const geometry = { id: 'g', name: 'Lab Ti-base', mesh: c.body };
    for (const bytes of jaws) {
      expect(contains(bytes, 'Maria')).toBe(true);
      const jaw = runJob({ type: 'readJaw', file: { bytes, extension: '' } }, []) as JawResult;
      const out = runJob({ type: 'export', request: {
        arch: 'lower', captureFormat: 'demo', sites: c.sites, geometryBySite: Object.fromEntries(c.sites.map((s) => [s.id, geometry])),
        assemblyTransform: identity(), jaw: { mesh: jaw.mesh, originalBytes: jaw.originalBytes, format: jaw.format },
        alignment: undefined as AlignmentResult | undefined, createdAt: '2026-11-07T12:00:00Z', appVersion: XCHANGE_VERSION,
      } }, []) as ExportResult;
      // jaw.* is the user's own file, copied unchanged on purpose (report: "exact-original-bytes"); everything
      // else in the ZIP is written by the tool. Read the local entries back from the stored ZIP.
      const view = new DataView(out.zip.buffer, out.zip.byteOffset, out.zip.byteLength);
      let o = 0;
      const entries: string[] = [];
      while (view.getUint32(o, true) === 0x04034b50) {
        const size = view.getUint32(o + 18, true), nameLen = view.getUint16(o + 26, true), extra = view.getUint16(o + 28, true);
        const name = new TextDecoder().decode(out.zip.subarray(o + 30, o + 30 + nameLen));
        const data = out.zip.subarray(o + 30 + nameLen + extra, o + 30 + nameLen + extra + size);
        entries.push(name);
        if (!name.startsWith('jaw.')) expect(contains(data, 'Maria'), name).toBe(false);
        o += 30 + nameLen + extra + size;
      }
      expect(entries).toContain('combined.stl');
    }
  });

  it('the email POST carries exactly source, email, lang and page, and page drops the query and hash', async () => {
    vi.stubGlobal('location', new URL('https://expertsddt.com/es/ddt-xchange/?utm_source=mail&case=Maria#xch-export'));
    // AlignStep.leadEnv is what onExport / the email form pass to submitLead
    const env = (AlignStep.prototype as unknown as { leadEnv(this: unknown): LeadEnv }).leadEnv.call({ app: { hook: 'https://n8n.example/webhook/leads', lang: 'es' } });
    const data = new Map<string, string>();
    const storage: StorageLike = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
    const sent: { url: string; init: RequestInit }[] = [];
    const state = await submitLead('dr@clinic.com', {
      ...env, storage, warn: () => {},
      fetchFn: (async (url: string, init: RequestInit) => { sent.push({ url, init }); return new Response('', { status: 200 }); }) as unknown as typeof fetch,
    });
    expect(state).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://n8n.example/webhook/leads');
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({ source: 'ddt-xchange', email: 'dr@clinic.com', lang: 'es', page: 'https://expertsddt.com/es/ddt-xchange/' });
    expect([...data.values()]).toEqual(['{"v":1,"state":"sent"}']); // nothing but the state is kept once sent
  });

  it('BUG: with storage blocked (private window, site data off) the email is asked once per visit, not before every export', async () => {
    // step-align.ts storage(): window.localStorage throws when blocked -> null is what onExport and submitLead get
    const fetchFn = vi.fn(async () => new Response('', { status: 200 }));
    const env: LeadEnv = { storage: null, hook: 'https://n8n.example/webhook/leads', lang: 'en', page: 'https://expertsddt.com/ddt-xchange/', fetchFn: fetchFn as unknown as typeof fetch };
    expect(needsEmail(null)).toBe(true); // first export: the gate opens
    expect(await submitLead('dr@clinic.com', env)).toBe('sent');
    // UI-DESIGN §9: "Storage blocked -> asked again next visit". Today nothing is remembered at all: the dialog opens
    // before every export of the same visit and each submit posts the same address again (duplicate leads).
    expect(needsEmail(null)).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

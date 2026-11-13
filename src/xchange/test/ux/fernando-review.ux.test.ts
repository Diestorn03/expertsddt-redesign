/**
 * Fernando's review of 2026-11-11: a clean capture goes straight to step 2; once aligned, the hand controls are locked
 * until the box is ticked; the jaw step names its arch.
 */
import { describe, expect, it, vi } from 'vitest';
import { freshCase } from '../../state/case';
import type { ImplantSite } from '../../core/types';
import { AlignStep } from '../../ui/step-align';
import { CaptureStep } from '../../ui/step-capture';

const site = (id: string, flags: Record<string, boolean> = {}): ImplantSite => ({ id, flags } as unknown as ImplantSite);

function captureStep(patch: Record<string, unknown>, warnings: unknown[] = [], mixed: unknown = null) {
  const s = { ...freshCase('upper'), sites: [site('a'), site('b')], ...patch };
  const go = vi.fn();
  const later = (fn: () => void): void => fn();
  const app = { s, shown: 1, go, later };
  const step = Object.create(CaptureStep.prototype) as CaptureStep;
  Object.assign(step, { app, warnings, mixed });
  (step as unknown as { maybeAdvance(): void }).maybeAdvance();
  return go;
}

describe('step 1 goes on by itself when the capture is clean', () => {
  it('a clean capture with its arch known goes to step 2', () => {
    expect(captureStep({})).toHaveBeenCalledWith(2);
  });
  it('without an arch it waits for the answer', () => {
    expect(captureStep({ arch: null })).not.toHaveBeenCalled();
  });
  it('warnings, mixed coordinates, unresolved bodies or unconfirmed positions keep the user on step 1', () => {
    expect(captureStep({}, [{ code: 'MESH_UNITS_SUSPECT' }])).not.toHaveBeenCalled();
    expect(captureStep({}, [], { framesDiffer: true })).not.toHaveBeenCalled();
    expect(captureStep({ unresolved: [2] })).not.toHaveBeenCalled();
    expect(captureStep({ sites: [site('a', { provisional: true })] })).not.toHaveBeenCalled();
  });
  it('a user who is not on step 1 any more is not pulled back', () => {
    const go = vi.fn();
    const s = { ...freshCase('upper'), sites: [site('a')] };
    const step = Object.create(CaptureStep.prototype) as CaptureStep;
    Object.assign(step, { app: { s, shown: 3, go, later: (fn: () => void) => fn() }, warnings: [], mixed: null });
    (step as unknown as { maybeAdvance(): void }).maybeAdvance();
    expect(go).not.toHaveBeenCalled();
  });
});

describe('once aligned, the hand controls are locked until the box is ticked', () => {
  const align = (alignment: unknown, unlocked: boolean) => {
    const finishPose = vi.fn();
    const app = { shown: 4, s: { jaw: {}, alignment }, viewer: { finishPose } };
    const step = Object.create(AlignStep.prototype) as AlignStep;
    Object.assign(step, { app, guided: null, unlocked });
    return { step, finishPose };
  };
  it('not aligned yet: free to adjust by hand (the way to align by hand)', () => {
    const { step } = align(null, false);
    expect(step.locked()).toBe(false);
    expect(step.mode()).toBe('set');
  });
  it('aligned: dragging the set is off and the pad does nothing', () => {
    const { step, finishPose } = align({ status: 'good' }, false);
    expect(step.locked()).toBe(true);
    expect(step.mode()).toBe('camera');
    step.pad('rx', 1, false);
    expect(finishPose).not.toHaveBeenCalled();
  });
  it('ticking the box gives the controls back', () => {
    const { step } = align({ status: 'good' }, true);
    expect(step.locked()).toBe(false);
    expect(step.mode()).toBe('set');
  });
});

describe('a mesh-only capture identifies its scan body by itself (2026-11-12)', () => {
  const run = async (results: Record<string, { found: number; provisional?: number; unresolved?: number }>, favorite = '') => {
    const mesh = {};
    const tried: string[] = [];
    const detect = vi.fn(async () => {});
    const app = {
      s: { captureMesh: mesh }, lang: 'en', c: { s1: { identifying: '{n}/{total}' }, say: { identified: '{name}' } },
      library: { list: () => Object.keys(results).map((id) => ({ id, favorite: id === favorite })) },
      loadGeometry: async (id: string) => ({ mesh: id }),
      jobs: { run: async (job: { reference: string }) => {
        tried.push(job.reference);
        const r = results[job.reference]!;
        const sites = [...Array(r.found).fill({ flags: {} }), ...Array(r.provisional ?? 0).fill({ flags: { provisional: true } })];
        return { sites, unresolved: Array(r.unresolved ?? 0).fill(0), warnings: [] };
      } },
      busy: () => ({ set() {}, done() {} }), toasts: { show: vi.fn() }, geometryName: (id: string) => id,
    };
    const step = Object.create(CaptureStep.prototype) as CaptureStep;
    Object.assign(step, { app, detect });
    await (step as unknown as { identify(m: unknown): Promise<void> }).identify(mesh);
    return { detect, tried, toast: app.toasts.show };
  };
  it('keeps the geometry that finds the most bodies', async () => {
    const { detect, toast } = await run({ a: { found: 1, unresolved: 3 }, b: { found: 4 }, c: { found: 2, unresolved: 2 } });
    expect(detect).toHaveBeenCalledWith('b');
    expect(toast).toHaveBeenCalledWith('b');
  });
  it('tries the favorites first and stops at a full match', async () => {
    const { tried, detect } = await run({ a: { found: 4 }, b: { found: 4 } }, 'b');
    expect(tried).toEqual(['b']);
    expect(detect).toHaveBeenCalledWith('b');
  });
  it('nothing found: the list stays for a manual pick', async () => {
    const { detect } = await run({ a: { found: 0, unresolved: 4 } });
    expect(detect).not.toHaveBeenCalled();
  });
});

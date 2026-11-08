/**
 * Integration review, viewer <-> export: what the 3D view shows must be what the ZIP holds. The real Viewer runs
 * on three.js with only WebGLRenderer replaced (no GPU in Node) and the small fake DOM of ./fake-dom; the real
 * controls get synthetic pointer and key events. Tests named "BUG:" fail on purpose until the production code is
 * fixed; the others guard what holds. All data is the in-browser sample case (synthetic).
 */
import type gsap from 'gsap';
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { identity, maxAbsDiff } from '../../core/mat4';
import { computeVertexNormals, countTriangles } from '../../core/mesh';
import type { AlignmentResult, ImplantSite, Mat4, ReplacementGeometry } from '../../core/types';
import { buildIcpTarget, type IcpTarget } from '../../align/icp';
import { measureManualPose } from '../../align/metrics';
import { multiStartAlign } from '../../align/multistart';
import { buildBundle } from '../../export/bundle';
import { alignmentParts } from '../../state/case';
import { readCapture, readJaw, type JawResult } from '../../state/jobs-handler';
import { makeSample } from '../../ui/demo';
import { AlignStep, XCHANGE_VERSION } from '../../ui/step-align';
import { attachControls, type ControlCallbacks } from '../../viewer/controls';
import { toEngine, Viewer } from '../../viewer/viewer';
import { fakeElement, installFakeDom, keyEvent, pointer, type FakeElement } from './fake-dom';

// No WebGL in Node: everything else in three is the real library.
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class WebGLRenderer {
    readonly domElement = Object.assign(new EventTarget(), {
      className: '',
      setAttribute(): void {},
      remove(): void {},
      setPointerCapture(): void {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }),
    });
    setClearColor(): void {}
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
    forceContextLoss(): void {}
  }
  return { ...three, WebGLRenderer };
});

installFakeDom();

interface Demo {
  sites: ImplantSite[];
  geometry: ReplacementGeometry;
  normals: Float32Array;
  jaw: JawResult;
  target: IcpTarget;
  auto: AlignmentResult;
}
let demo: Demo;

beforeAll(() => {
  // The sample case through the real pipeline, exactly as ui/main.ts loadSample + step 3 "Use the sample jaw scan".
  const sample = makeSample();
  const capture = readCapture([{ bytes: sample.csv, extension: 'csv' }]);
  const jaw = readJaw({ bytes: sample.jaw, extension: 'ply' });
  const geometry: ReplacementGeometry = { id: 'sample-body', name: 'Sample scan body', mesh: sample.body };
  const target = buildIcpTarget(jaw.mesh);
  const auto = multiStartAlign(alignmentParts(capture.sites, () => sample.body, [], 'replacement'), target);
  demo = { sites: capture.sites, geometry, normals: computeVertexNormals(sample.body), jaw, target, auto };
}, 60_000);

/** A Viewer showing the demo set at `pose`, built the way App.rebuildViewer / syncSites do it. */
function demoViewer(reducedMotion: boolean, pose: Mat4, stage: FakeElement = fakeElement()): Viewer {
  const v = new Viewer(stage as unknown as HTMLElement, fakeElement() as unknown as HTMLElement, { reducedMotion, onContextLost() {} });
  v.setJaw(demo.jaw.mesh, demo.jaw.normals);
  v.setSites(demo.sites.map((s) => ({ id: s.id, label: s.label, matrix: s.matrix })));
  for (const s of demo.sites) v.setGeometry(s.id, demo.geometry.id, demo.geometry.mesh, demo.normals);
  v.setAssembly(pose);
  return v;
}

/** Largest distance (mm) between the viewer's world triangles of a site and the triangles of an exported STL. */
function viewerVsStl(v: Viewer, siteId: string, stl: Uint8Array, firstTriangle = 0): number {
  v.scene.updateMatrixWorld(true);
  const mesh = v.assembly.children.find((o) => o.userData.siteId === siteId) as THREE.Mesh;
  const pos = mesh.geometry.getAttribute('position'), idx = mesh.geometry.getIndex()!;
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const p = new THREE.Vector3();
  let worst = 0;
  for (let i = 0; i < idx.count; i++) {
    p.fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(mesh.matrixWorld);
    const o = 84 + 50 * (firstTriangle + Math.floor(i / 3)) + 12 + 12 * (i % 3);
    worst = Math.max(worst, Math.abs(view.getFloat32(o, true) - p.x), Math.abs(view.getFloat32(o + 4, true) - p.y), Math.abs(view.getFloat32(o + 8, true) - p.z));
  }
  return worst;
}

/** The pose the store holds after the pad (AlignStep.pad -> commitPose), with the real pad code. */
function padStep(v: Viewer, start: Mat4): { step: AlignStep; committed: Mat4[] } {
  const committed: Mat4[] = [];
  const s = { jaw: demo.jaw, assembly: start };
  const fake = { app: { viewer: v, s }, commitPose: (m: Mat4): void => { committed.push(m); s.assembly = m; v.setAssembly(m, 'step'); } };
  return { step: fake as unknown as AlignStep, committed };
}

const tweenOf = (v: Viewer): gsap.core.Tween | null => (v as unknown as { poseTween: gsap.core.Tween | null }).poseTween;

function noopCallbacks(overrides: Partial<ControlCallbacks>): ControlCallbacks {
  return {
    mode: () => 'camera', onSelect() {}, onGuidedPoint() {}, onSetChange() {}, onHover() {}, onPreset() {}, onToggleJawOpacity() {},
    onToggleMap() {}, onShortcuts() {}, onGuidedKey() {}, onCtrl() {}, ...overrides,
  };
}

describe('what you see is what you export (sample case)', () => {
  it('after auto align and two pad steps, every exported replacement triangle sits where the viewer draws it', { timeout: 60_000 }, () => {
    expect(demo.auto.status).toBe('good');
    const v = demoViewer(true, demo.auto.transform);
    const { step, committed } = padStep(v, demo.auto.transform);
    AlignStep.prototype.pad.call(step, 'ry', 1, false); // turn right 30°
    AlignStep.prototype.pad.call(step, 'tx', 1, true); // move right 0.1 mm (Shift)
    const pose = committed.at(-1)!;
    expect(maxAbsDiff(toEngine(v.assembly.matrix), pose)).toBeLessThan(1e-12); // the store and the view agree

    const sites = demo.sites;
    const bundle = buildBundle({
      arch: 'upper', captureFormat: 'demo', sites, geometryBySite: Object.fromEntries(sites.map((s) => [s.id, demo.geometry])),
      assemblyTransform: pose, jaw: { mesh: demo.jaw.mesh, originalBytes: demo.jaw.originalBytes, format: demo.jaw.format },
      alignment: measureManualPose(alignmentParts(sites, () => demo.geometry.mesh, [], 'replacement'), demo.target, pose),
      createdAt: '2026-11-07T12:00:00Z', appVersion: XCHANGE_VERSION,
    });
    expect(bundle.report.coordinateFrame).toBe('jaw');
    expect(bundle.report.alignment?.matchesExport).toBe(true);
    const file = (name: string): Uint8Array => bundle.files.find((f) => f.name === name)!.bytes;
    const perSite = countTriangles(demo.geometry.mesh);
    sites.forEach((s, i) => {
      expect(viewerVsStl(v, s.id, file(bundle.report.sites[i]!.file))).toBeLessThan(1e-4);
      expect(viewerVsStl(v, s.id, file('replacements.stl'), i * perSite)).toBeLessThan(1e-4);
      expect(viewerVsStl(v, s.id, file('combined.stl'), countTriangles(demo.jaw.mesh) + i * perSite)).toBeLessThan(1e-4);
    });
    v.dispose();
  });

  it('BUG: a set drag that starts during the .9 s alignment animation ends where the store (and the ZIP) put it', { timeout: 30_000 }, () => {
    // Motion on (the visitors' default; the developer PC forces reduced motion, where setAssembly is instant).
    const v = demoViewer(false, identity());
    v.setAssembly(demo.auto.transform, 'align'); // AlignStep.applyResult: 0.9 s expo.out toward the result
    let stored: Mat4 | null = null;
    const stage = fakeElement();
    const ac = new AbortController();
    // AlignStep.controlCallbacks: phase 'end' -> store.set({ assembly: toEngine(pose) }) -> re-measure and export use it
    attachControls(v, stage as unknown as HTMLElement, noopCallbacks({ mode: () => 'set', onSetChange: (pose, phase) => { if (phase === 'end') stored = toEngine(pose); } }), ac.signal);
    v.pickPart = () => ({ siteId: demo.sites[0]!.id, um: null }); // the press lands on an implant (ray picking needs a sized canvas)
    const canvas = v.canvas as unknown as EventTarget;
    canvas.dispatchEvent(pointer('pointerdown', { clientX: 400, clientY: 300 }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: 460, clientY: 300 }));
    canvas.dispatchEvent(pointer('pointerup', { clientX: 460, clientY: 300 }));
    expect(stored).not.toBeNull();
    tweenOf(v)?.progress(1); // ...and the alignment animation, never killed by the drag, plays to its end
    // Today the view snaps back to the alignment pose while the store keeps the dragged one: the metrics, the
    // export and the leave guard describe a pose the user no longer sees.
    expect(maxAbsDiff(toEngine(v.assembly.matrix), stored!)).toBeLessThan(1e-9);
    ac.abort();
    v.dispose();
  });

  it('BUG: two "Flip over" clicks return the set to its pose even when the second lands mid-animation', { timeout: 30_000 }, () => {
    const start = demo.auto.transform;
    const v = demoViewer(false, start);
    const { step, committed } = padStep(v, start);
    AlignStep.prototype.pad.call(step, 'fx', 1, false); // 180° about the screen X axis: .35 s power3.out
    tweenOf(v)!.progress(0.5); // the second click comes halfway through that animation
    AlignStep.prototype.pad.call(step, 'fx', 1, false);
    tweenOf(v)?.progress(1);
    // pad() starts from viewer.assembly.matrix (the in-between pose), not from the committed pose: the second
    // flip lands about 90° off, and every quick 30° / 5° click loses part of its step the same way.
    expect(maxAbsDiff(committed[1]!, start)).toBeLessThan(1e-6);
    v.dispose();
  });
});

describe('viewer restart after a lost WebGL context', () => {
  it('BUG: after "Restart 3D view" each stage shortcut acts once (the old controls are detached)', () => {
    const stage = fakeElement();
    const appSignal = new AbortController().signal; // App.signal: aborted only when the whole workspace is disposed
    const calls = { jawOpacity: 0, map: 0, back: 0 };
    const cb = (): ControlCallbacks => noopCallbacks({
      mode: () => 'guided',
      onToggleJawOpacity: () => void calls.jawOpacity++,
      onToggleMap: () => void calls.map++,
      onGuidedKey: (k) => void (k === 'Backspace' && calls.back++),
    });
    // App.createViewer(): new Viewer + attachControls(v, stageEl, alignStep.controlCallbacks(), this.signal)
    const first = new Viewer(stage as unknown as HTMLElement, fakeElement() as unknown as HTMLElement, { reducedMotion: true, onContextLost() {} });
    attachControls(first, stage as unknown as HTMLElement, cb(), appSignal);
    // webglcontextlost -> [Restart 3D view] -> App.restartViewer(): viewer.dispose(); createViewer() with the same signal
    first.dispose();
    const second = new Viewer(stage as unknown as HTMLElement, fakeElement() as unknown as HTMLElement, { reducedMotion: true, onContextLost() {} });
    attachControls(second, stage as unknown as HTMLElement, cb(), appSignal);
    stage.dispatchEvent(keyEvent('keydown', 't'));
    stage.dispatchEvent(keyEvent('keydown', 'c'));
    stage.dispatchEvent(keyEvent('keydown', 'Backspace'));
    // Today both sets of stage listeners answer: T and C toggle twice (no visible effect) and Backspace removes
    // two guided points.
    expect(calls).toEqual({ jawOpacity: 1, map: 1, back: 1 });
    second.dispose();
  });
});

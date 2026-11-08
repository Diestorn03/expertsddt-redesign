/**
 * Exocad-style input (UI-DESIGN §6.7): right-drag or left-drag on empty space rotates (free trackball),
 * middle-drag / Shift-drag / left+right pans, wheel zooms toward the pointer, middle-click sets the
 * rotation center, Ctrl/Shift + middle-click toggles jaw transparency, double-click fits. In 'set' mode a
 * left-drag on an implant moves the whole set; Ctrl/⌘ + drag rotates it about its center (Shift: one axis).
 * Every listener lives until the caller's AbortSignal or the viewer's dispose (a restart after a lost context).
 */
import * as THREE from 'three';
import type { Vec3 } from '../core/types';
import { PRESET_KEYS, type Preset } from './presets';
import type { PartHit, Viewer } from './viewer';

export type ControlMode = 'camera' | 'set' | 'guided';

export interface ControlCallbacks {
  mode(): ControlMode;
  onSelect(siteId: string | null): void;
  onGuidedPoint(point: Vec3): void;
  /** Enter in guided mode with nothing under the crosshair. */
  onGuidedMiss?(): void;
  /** World pose of the implant set during a drag; 'start' before the first move, 'end' after the last. */
  onSetChange(pose: THREE.Matrix4, phase: 'start' | 'move' | 'end'): void;
  onHover(hit: PartHit | null): void;
  onPreset(preset: Preset | 'fit'): void;
  onToggleJawOpacity(): void;
  onToggleMap(): void;
  onShortcuts(): void;
  onGuidedKey(key: 'Backspace' | 'Escape'): void;
  onCtrl(down: boolean): void;
}

const DEG = Math.PI / 180;

export function translatePose(pose: THREE.Matrix4, v: THREE.Vector3): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(v.x, v.y, v.z).multiply(pose);
}

export function rotatePose(pose: THREE.Matrix4, axis: THREE.Vector3, angle: number, pivot: THREE.Vector3): THREE.Matrix4 {
  const r = new THREE.Matrix4().makeRotationAxis(axis.clone().normalize(), angle);
  const to = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
  const back = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  return to.multiply(r).multiply(back).multiply(pose);
}

type Drag = { kind: 'rotate' | 'pan' | 'moveSet' | 'rotateSet'; x: number; y: number; x0: number; y0: number; t0: number; button: number; pose?: THREE.Matrix4; pivot?: THREE.Vector3; moved: boolean; shift: boolean; ctrl: boolean };

export function attachControls(viewer: Viewer, stage: HTMLElement, cb: ControlCallbacks, outer: AbortSignal): void {
  const signal = viewer.signal ? AbortSignal.any([outer, viewer.signal]) : outer;
  const canvas = viewer.canvas;
  const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts: AddEventListenerOptions = {}): void =>
    el.addEventListener(type, fn as EventListener, { ...opts, signal });
  const gain = (): number => (viewer.display.speed / 3) * 0.25 * DEG;
  let drag: Drag | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; cx: number; cy: number } | null = null;
  let lastTap = 0;
  let hoverRaf = 0;
  let hoverAt: { x: number; y: number } | null = null;
  let over = false;

  const rotateCamera = (dx: number, dy: number): void => {
    const g = gain();
    viewer.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * g)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -dy * g)).normalize();
  };
  const pan = (dx: number, dy: number): void => {
    const { right, up } = viewer.axes(), k = viewer.mmPerPixel();
    viewer.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
  };
  const zoomAt = (clientX: number, clientY: number, factor: number): void => {
    const r = canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = -(((clientY - r.top) / r.height) * 2 - 1);
    const halfH = viewer.dist * Math.tan((viewer.display.fovDeg * DEG) / 2), halfW = halfH * (r.width / Math.max(1, r.height));
    const { right, up } = viewer.axes();
    const p = viewer.target.clone().addScaledVector(right, nx * halfW).addScaledVector(up, ny * halfH);
    viewer.dist = Math.min(1e5, Math.max(0.5, viewer.dist * factor));
    viewer.target.sub(p).multiplyScalar(factor).add(p);
  };
  const touchInput = (): void => { viewer.stopCameraTween(); viewer.interacting(); viewer.invalidate(); };

  on(canvas, 'contextmenu', (e) => e.preventDefault());
  on(canvas, 'pointerdown', (e) => {
    stage.focus({ preventScroll: true });
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      if (touches.size === 2) { drag = null; const [a, b] = [...touches.values()]; pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2 }; }
      else drag = { kind: 'rotate', x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), button: 0, moved: false, shift: false, ctrl: false };
      return;
    }
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const base = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), button: e.button, moved: false, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    if (e.buttons === 3 || e.button === 1 || (e.button === 0 && e.shiftKey)) drag = { kind: 'pan', ...base };
    else if (e.button === 2) drag = { kind: 'rotate', ...base };
    else if (e.button === 0) {
      const hit = cb.mode() === 'set' ? viewer.pickPart(e.clientX, e.clientY) : null;
      if (hit) {
        viewer.finishPose(); // a drag grabbed mid-animation starts from the stored pose, not an in-between one
        const pose = viewer.assembly.matrix.clone();
        drag = { kind: base.ctrl ? 'rotateSet' : 'moveSet', ...base, pose, pivot: viewer.setCenter() };
        stage.classList.add('is-grabbing');
      } else drag = { kind: 'rotate', ...base };
    }
  });

  on(canvas, 'pointermove', (e) => {
    if (e.pointerType === 'touch') {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y), cx = (a!.x + b!.x) / 2, cy = (a!.y + b!.y) / 2;
        if (d > 0) zoomAt(cx, cy, pinch.d / d);
        pan(cx - pinch.cx, cy - pinch.cy);
        pinch = { d, cx, cy };
        touchInput();
        return;
      }
    }
    if (!drag) {
      if (e.pointerType !== 'touch') {
        hoverAt = { x: e.clientX, y: e.clientY };
        if (!hoverRaf) hoverRaf = requestAnimationFrame(() => {
          hoverRaf = 0;
          if (!hoverAt) return;
          const hit = viewer.pickPart(hoverAt.x, hoverAt.y);
          stage.classList.toggle('is-grab', !!hit && cb.mode() === 'set');
          cb.onHover(hit);
        });
      }
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) {
      drag.moved = true;
      if (drag.pose) cb.onSetChange(drag.pose, 'start');
    }
    if (!drag.moved) return;
    if (drag.kind === 'rotate') rotateCamera(dx, dy);
    else if (drag.kind === 'pan') pan(dx, dy);
    else {
      const { right, up } = viewer.axes();
      const tx = e.clientX - drag.x0, ty = e.clientY - drag.y0;
      let pose: THREE.Matrix4;
      if (drag.kind === 'moveSet') {
        const k = viewer.mmPerPixel();
        pose = translatePose(drag.pose!, right.clone().multiplyScalar(tx * k).addScaledVector(up, -ty * k));
      } else {
        let ax = tx, ay = ty;
        if (e.shiftKey) { if (Math.abs(ax) > Math.abs(ay)) ay = 0; else ax = 0; }
        const axis = up.clone().multiplyScalar(ax).addScaledVector(right, ay);
        const angle = Math.hypot(ax, ay) * (viewer.display.speed / 3) * 0.3 * DEG;
        pose = axis.lengthSq() > 0 ? rotatePose(drag.pose!, axis, angle, drag.pivot!) : drag.pose!.clone();
      }
      viewer.assembly.matrix.copy(pose);
      viewer.assembly.matrixWorldNeedsUpdate = true;
      cb.onSetChange(pose, 'move');
    }
    touchInput();
  });

  /** A click (or tap) with the primary button: a guided point, else selection. */
  const primaryClick = (x: number, y: number): void => {
    if (cb.mode() === 'guided') {
      const p = viewer.pickSurface(x, y, true);
      if (p) cb.onGuidedPoint(p);
    } else cb.onSelect(viewer.pickPart(x, y)?.siteId ?? null);
  };

  const end = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
      // a one-finger tap (never part of a pinch: drag is null then) acts like a click; a double tap fits
      if (drag && !drag.moved && touches.size === 0 && e.type === 'pointerup') {
        const now = performance.now();
        if (now - lastTap < 300) { cb.onPreset('fit'); lastTap = 0; }
        else { lastTap = now; if (now - drag.t0 < 500) primaryClick(e.clientX, e.clientY); }
      }
      if (touches.size === 0) drag = null;
      return;
    }
    const d = drag;
    drag = null;
    stage.classList.remove('is-grabbing');
    if (!d) return;
    if (d.moved && d.pose) cb.onSetChange(viewer.assembly.matrix.clone(), 'end');
    const click = !d.moved && performance.now() - d.t0 < 300;
    if (!click) return;
    if (d.button === 1) {
      if (d.ctrl || d.shift) cb.onToggleJawOpacity();
      else {
        const p = viewer.pickSurface(e.clientX, e.clientY);
        if (p) viewer.setOrbitCenter(new THREE.Vector3(...p));
      }
    } else if (d.button === 0) primaryClick(e.clientX, e.clientY);
  };
  on(canvas, 'pointerup', end);
  on(canvas, 'pointercancel', end);
  on(canvas, 'pointerleave', () => { hoverAt = null; stage.classList.remove('is-grab'); cb.onHover(null); });
  on(canvas, 'dblclick', () => cb.onPreset('fit'));
  on(canvas, 'wheel', (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(e.clientX, e.clientY, Math.pow(1.12, Math.max(-3, Math.min(3, dy / 100))));
    touchInput();
  }, { passive: false });

  // keys act only while focus is inside the stage (WCAG 2.1.4)
  on(stage, 'keydown', (e) => {
    if (e.target !== stage) return;
    const k = e.key;
    if ((k === 'Control' || k === 'Meta') && cb.mode() === 'set') { cb.onCtrl(true); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // only keys that move the camera themselves take it over from a running tween: a preset key would otherwise stop
    // the tween it has just started, and a toggle would freeze one mid-way
    let handled = true, moves = false;
    if (k.startsWith('Arrow')) {
      const sx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, sy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
      if (e.shiftKey) { const step = 0.05 * stage.clientHeight; pan(-sx * step, -sy * step); }
      else rotateCamera((sx * 10 * DEG) / gain(), (sy * 10 * DEG) / gain());
      moves = true;
    } else if (k === '+' || k === '=') { zoomAt(...center(), 1 / 1.15); moves = true; }
    else if (k === '-' || k === '_') { zoomAt(...center(), 1.15); moves = true; }
    else if (k === '0' || k === 'Home') cb.onPreset('fit');
    else if (PRESET_KEYS[k]) cb.onPreset(PRESET_KEYS[k]!);
    else if (k === 't' || k === 'T') cb.onToggleJawOpacity();
    else if (k === 'c' || k === 'C') cb.onToggleMap();
    else if (k === '?') cb.onShortcuts();
    else if (k === 'Enter' && cb.mode() === 'guided') {
      const [x, y] = center();
      const p = viewer.pickSurface(x, y, true);
      if (p) cb.onGuidedPoint(p);
      else cb.onGuidedMiss?.();
    } else if ((k === 'Backspace' || k === 'Escape') && cb.mode() === 'guided') cb.onGuidedKey(k);
    else handled = false;
    if (handled) { e.preventDefault(); if (moves) touchInput(); }
  });
  const center = (): [number, number] => { const r = canvas.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  on(stage, 'keyup', (e) => { if (e.key === 'Control' || e.key === 'Meta') cb.onCtrl(false); });
  on(stage, 'pointerenter', () => { over = true; });
  on(stage, 'pointerleave', () => { over = false; cb.onCtrl(false); });
  on(window, 'keydown', (e) => { if (over && (e.key === 'Control' || e.key === 'Meta') && cb.mode() === 'set') cb.onCtrl(true); });
  on(window, 'keyup', (e) => { if (e.key === 'Control' || e.key === 'Meta') cb.onCtrl(false); });
  on(window, 'blur', () => cb.onCtrl(false));
  signal.addEventListener('abort', () => { cancelAnimationFrame(hoverRaf); }, { once: true });
}

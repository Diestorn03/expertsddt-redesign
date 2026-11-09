/**
 * UX review, step changes (UI-DESIGN §3.5 "a step change completes in ≤ .9 s"; §11.1 focus goes to the new panel's
 * h3 when the step changes). App.go() moves focus to the heading only when Motion.panel() resolves, so this duration
 * is also how long keyboard focus sits on <body> after Continue / Back / a stepper click, and a control the user
 * focuses in the meantime is taken back to the heading (seen in Chrome: focus parked on <body> ~1.2 s, then stolen).
 * The real Motion and GSAP run on plain objects; the child counts are the server-rendered panes of
 * src/pages/ddt-xchange.astro (hidden blocks included, as `from.children` / `to.children` are). "BUG:" fails until fixed.
 */
import { describe, expect, it } from 'vitest';
import { Motion } from '../../ui/motion';

const pane = (children: number): HTMLElement => ({ children: Array.from({ length: children }, () => ({ y: 0, opacity: 1, skewY: 0 })) }) as unknown as HTMLElement;
const PANE_CHILDREN = { 1: 12, 2: 9, 3: 10, 4: 10 } as const;

function stepChangeSeconds(from: keyof typeof PANE_CHILDREN, to: keyof typeof PANE_CHILDREN): number {
  const motion = new Motion(false, undefined as unknown as Element);
  void motion.panel(pane(PANE_CHILDREN[from]), pane(PANE_CHILDREN[to]), () => {});
  const seconds = (motion as unknown as { step: { duration(): number } | null }).step?.duration() ?? 0;
  motion.dispose();
  return seconds;
}

describe('step change timing (no-preference motion)', () => {
  for (const [a, b] of [[1, 2], [2, 3], [3, 4], [4, 3]] as const) {
    const s = stepChangeSeconds(a, b);
    it(`${s > 0.9 ? 'BUG: ' : ''}step ${a} → ${b} completes within the 0.9 s budget (computed ${s.toFixed(2)} s)`, () => expect(s).toBeLessThanOrEqual(0.9));
  }

  it('reduced motion swaps the panels at once', async () => {
    let swapped = false;
    const motion = new Motion(true, undefined as unknown as Element);
    await motion.panel(pane(12), pane(9), () => { swapped = true; });
    expect(swapped).toBe(true);
    motion.dispose();
  });
});

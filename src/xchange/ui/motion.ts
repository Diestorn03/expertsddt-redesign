/**
 * The tool's motion vocabulary (UI-DESIGN §3.2), on the same GSAP instance motion.js uses. Eases map to the
 * site tokens: expo.out ≈ --ease-out, power3.inOut ≈ the loader curve; power3.out and back.out are the
 * reveal eases. Every tween lives in one gsap.context per mount (reverted on dispose) and leaves it when it
 * completes (transient()). Reduced motion: the end state at once. No ScrollTrigger (motion.js kills them all
 * on every page load).
 */
import gsap from 'gsap';

type Data = { data: unknown[] };

/** GSAP's twin of the site's --ease-out cubic-bezier(.16,1,.3,1): camera moves and arrivals. */
export const EASE_OUT = 'expo.out';

/** Drops an animation (and a timeline's children) from the context's record. */
export function forget(ctx: gsap.Context, anim: gsap.core.Animation | null): void {
  if (!anim) return;
  const gone = new Set<unknown>([anim, ...(anim instanceof gsap.core.Timeline ? anim.getChildren(true, true, true) : [])]);
  const d = (ctx as unknown as Data).data;
  for (let i = d.length; i--;) if (gone.has(d[i])) d.splice(i, 1);
}

/**
 * ctx.add for a fire-and-forget animation: gsap.context keeps every animation it records (and the closures and
 * detached nodes they hold) until revert, so a finished one is forgotten in its onComplete.
 */
export function transient<T extends gsap.core.Animation>(ctx: gsap.Context, make: () => T): T {
  let anim!: T;
  ctx.add(() => { anim = make(); });
  const done = anim.eventCallback('onComplete') as (() => void) | null;
  anim.eventCallback('onComplete', () => { done?.(); forget(ctx, anim); });
  return anim;
}

export class Motion {
  readonly ctx: gsap.Context;
  private step: gsap.core.Timeline | null = null;

  constructor(readonly reduced: boolean, scope: Element) {
    this.ctx = gsap.context(() => {}, scope);
  }

  private add<T extends gsap.core.Animation>(fn: () => T): T {
    return transient(this.ctx, fn);
  }

  /**
   * Step change: outgoing children up and out, incoming children rise in (the data-stagger move, smaller).
   * Only shown blocks move, and the whole change stays within .9 s (UI-DESIGN §3.5): stagger by total amount.
   */
  panel(from: HTMLElement | null, to: HTMLElement, swap: () => void): Promise<void> {
    this.step?.progress(1); // interrupt, never queue
    if (this.reduced || !from || from === to) {
      swap();
      return Promise.resolve();
    }
    const shown = (pane: HTMLElement): Element[] => Array.from(pane.children).filter((c) => !(c as HTMLElement).hidden);
    const out = shown(from), into = shown(to);
    return new Promise((resolve) => {
      this.step = this.add(() => gsap.timeline({ onComplete: () => { this.step = null; resolve(); }, onInterrupt: () => resolve() })
        .to(out, { y: -16, opacity: 0, duration: 0.18, ease: 'power2.in', stagger: { amount: 0.08 } })
        .add(() => { gsap.set(out, { clearProps: 'transform,opacity' }); swap(); })
        .fromTo(into, { y: 40, opacity: 0, skewY: 2 }, { y: 0, opacity: 1, skewY: 0, duration: 0.5, ease: 'power3.out', stagger: { amount: 0.12 }, clearProps: 'transform,opacity' }));
    });
  }

  /** New result chip: = data-reveal="scale". */
  chip(el: Element): void {
    if (this.reduced) return;
    this.add(() => gsap.fromTo(el, { scale: 0.86, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: 'back.out(1.6)', clearProps: 'transform,opacity' }));
  }

  rows(els: ArrayLike<Element>): void {
    if (this.reduced || !els.length) return;
    this.add(() => gsap.fromTo(els, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out', stagger: 0.04, clearProps: 'transform,opacity' }));
  }

  /** Count-up like [data-count]; `format` renders the value. */
  count(el: HTMLElement, to: number, format: (v: number) => string): void {
    if (this.reduced) { el.textContent = format(to); return; }
    const o = { v: 0 };
    this.add(() => gsap.to(o, { v: to, duration: 0.9, ease: 'power3.out', onUpdate: () => { el.textContent = format(o.v); } }));
  }

  /** Fade + rise for anything that appears (alerts, cards). */
  appear(el: Element): void {
    if (this.reduced) return;
    this.add(() => gsap.fromTo(el, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out', clearProps: 'transform,opacity' }));
  }

  toastIn(el: Element): void {
    if (this.reduced) return;
    this.add(() => gsap.fromTo(el, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: EASE_OUT, clearProps: 'transform,opacity' }));
  }

  toastOut(el: Element, done: () => void): void {
    if (this.reduced) { done(); return; }
    this.add(() => gsap.to(el, { y: 24, opacity: 0, duration: 0.3, ease: 'power2.in', onComplete: done }));
  }

  dispose(): void {
    this.ctx.revert();
  }
}

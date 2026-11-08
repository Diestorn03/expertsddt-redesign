/**
 * The tool's motion vocabulary (UI-DESIGN §3.2), on the same GSAP instance motion.js uses. Eases map to the
 * site tokens: expo.out ≈ --ease-out, power3.inOut ≈ the loader curve; power3.out and back.out are the
 * reveal eases. Every tween lives in one gsap.context per mount (reverted on dispose). Reduced motion:
 * gsap.set to the end state. No ScrollTrigger (motion.js kills them all on every page load).
 */
import gsap from 'gsap';

export class Motion {
  readonly ctx: gsap.Context;
  private step: gsap.core.Timeline | null = null;

  constructor(readonly reduced: boolean, scope: Element) {
    this.ctx = gsap.context(() => {}, scope);
  }

  private add<T>(fn: () => T): T {
    let out!: T;
    this.ctx.add(() => { out = fn(); });
    return out;
  }

  /** Step change: outgoing children up and out, incoming children rise in (the data-stagger move, smaller). */
  panel(from: HTMLElement | null, to: HTMLElement, swap: () => void): Promise<void> {
    this.step?.progress(1); // interrupt, never queue
    if (this.reduced || !from || from === to) {
      swap();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.step = this.add(() => gsap.timeline({ onComplete: () => { this.step = null; resolve(); }, onInterrupt: () => resolve() })
        .to(from.children, { y: -16, opacity: 0, duration: 0.25, ease: 'power2.in', stagger: 0.03 })
        .add(() => { gsap.set(from.children, { clearProps: 'transform,opacity' }); swap(); })
        .fromTo(to.children, { y: 40, opacity: 0, skewY: 2 }, { y: 0, opacity: 1, skewY: 0, duration: 0.7, ease: 'power3.out', stagger: 0.06, clearProps: 'transform,opacity' }));
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
    this.add(() => gsap.fromTo(el, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'expo.out', clearProps: 'transform,opacity' }));
  }

  toastOut(el: Element, done: () => void): void {
    if (this.reduced) { done(); return; }
    this.add(() => gsap.to(el, { y: 24, opacity: 0, duration: 0.3, ease: 'power2.in', onComplete: done }));
  }

  dispose(): void {
    this.ctx.revert();
  }
}

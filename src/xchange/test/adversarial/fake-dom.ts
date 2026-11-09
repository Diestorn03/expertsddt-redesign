/**
 * The smallest browser surface the workspace code touches, for Node tests of the integration review: EventTarget
 * elements, observers that never fire, rAF on timers (so GSAP ticks), getComputedStyle without tokens.
 * No DOM library (no new dependency); WebGL is replaced in the test files with vi.mock('three').
 */

export type FakeElement = EventTarget & {
  [key: string]: unknown;
  classList: { add(c: string): void; remove(c: string): void; toggle(c: string, on?: boolean): boolean; contains(c: string): boolean };
  style: { [key: string]: unknown; setProperty(k: string, v: string): void };
  children: FakeElement[];
  querySelector(sel: string): FakeElement;
};

export function fakeElement(props: Record<string, unknown> = {}): FakeElement {
  const classes = new Set<string>();
  const found = new Map<string, FakeElement>();
  const el: FakeElement = Object.assign(new EventTarget(), {
    className: '',
    textContent: '',
    hidden: false,
    clientWidth: 800,
    clientHeight: 600,
    children: [] as FakeElement[],
    classList: {
      add: (c: string): void => void classes.add(c),
      remove: (c: string): void => void classes.delete(c),
      toggle: (c: string, on?: boolean): boolean => ((on ?? !classes.has(c)) ? (classes.add(c), true) : (classes.delete(c), false)),
      contains: (c: string): boolean => classes.has(c),
    },
    style: { setProperty(): void {} },
    setAttribute(): void {},
    removeAttribute(): void {},
    focus(): void {},
    remove(): void {},
    append(...nodes: FakeElement[]): void { el.children.push(...nodes); },
    prepend(...nodes: FakeElement[]): void { el.children.unshift(...nodes); },
    replaceChildren(...nodes: FakeElement[]): void { el.children = [...nodes]; },
    setPointerCapture(): void {},
    click(): void {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }),
    /** One stable child per selector, created on first use (enough for q(root, sel) in the UI code). */
    querySelector(sel: string): FakeElement {
      let child = found.get(sel);
      if (!child) found.set(sel, (child = fakeElement()));
      return child;
    },
    querySelectorAll: (): FakeElement[] => [],
    ...props,
  }) as unknown as FakeElement;
  return el;
}

/** The nodes a fill() / replaceChildren() put into `el`, document fragments flattened. */
export function renderedChildren(el: FakeElement): FakeElement[] {
  return el.children.flatMap((c) => (c.fragment ? renderedChildren(c) : [c]));
}

class InertObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Installs window/document/observers/rAF on globalThis (each Vitest file runs in its own worker). */
export function installFakeDom(): { document: FakeElement } {
  const g = globalThis as Record<string, unknown>;
  const doc = fakeElement({ hidden: false, documentElement: fakeElement(), body: fakeElement(), createElement: () => fakeElement(), createDocumentFragment: () => fakeElement({ fragment: true }) });
  // window === globalThis (so window.setTimeout follows vi.useFakeTimers), plus the EventTarget methods Node lacks
  const win = new EventTarget();
  g.addEventListener = win.addEventListener.bind(win);
  g.removeEventListener = win.removeEventListener.bind(win);
  g.dispatchEvent = win.dispatchEvent.bind(win);
  g.window = globalThis;
  g.document = doc;
  g.ResizeObserver = InertObserver;
  g.IntersectionObserver = InertObserver;
  g.MutationObserver = InertObserver;
  g.getComputedStyle = () => ({ getPropertyValue: () => '' });
  g.requestAnimationFrame = (cb: (t: number) => void): unknown => setTimeout(() => cb(performance.now()), 16);
  g.cancelAnimationFrame = (id: Parameters<typeof clearTimeout>[0]): void => clearTimeout(id);
  return { document: doc };
}

/** A pointer event as the controls read it (mouse unless said otherwise). */
export function pointer(type: string, props: Record<string, unknown>): Event {
  return Object.assign(new Event(type, { cancelable: true }), { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 1, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...props });
}

export function keyEvent(type: 'keydown' | 'keyup', k: string, props: Record<string, unknown> = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), { key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...props });
}

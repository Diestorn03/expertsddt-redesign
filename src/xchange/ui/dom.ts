/** DOM helpers. Text only through textContent (CSP + privacy rule: no innerHTML with data anywhere). */

type Attrs = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** Element with a class string, attributes and children (strings become text nodes). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const PATHS: Readonly<Record<string, string>> = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  warn: 'M12 3l9.5 17h-19L12 3zM12 10v4.5M12 17.6v.1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.6v.1',
  bad: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9l6 6M15 9l-6 6',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  close: 'M6 6l12 12M18 6L6 18',
  pin: 'M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10zM12 11.5v.1',
};

/** 1.8-stroke line icon (the site's .svc__icon voice), aria-hidden. */
export function icon(name: keyof typeof PATHS | string, size = 18): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'xch-ico');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', PATHS[name] ?? PATHS.info!);
  svg.append(p);
  return svg;
}

export function q<T extends Element = HTMLElement>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
}
export const qa = <T extends Element = HTMLElement>(root: ParentNode, sel: string): T[] => [...root.querySelectorAll<T>(sel)];

/** Swaps a container's children in one write. */
export function fill(el: Element, nodes: readonly Node[]): void {
  const frag = document.createDocumentFragment();
  frag.append(...nodes);
  el.replaceChildren(frag);
}

/** role=radiogroup of role=radio buttons: click + arrow keys; calls `pick` with the button. */
export function radiogroup(group: HTMLElement, pick: (btn: HTMLElement) => void, signal: AbortSignal): void {
  const radios = (): HTMLElement[] => qa(group, '[role="radio"]').filter((r) => r.getAttribute('aria-disabled') !== 'true');
  group.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[role="radio"]');
    if (b && b.getAttribute('aria-disabled') !== 'true') pick(b);
  }, { signal });
  group.addEventListener('keydown', (e) => {
    const list = radios();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = list[(i + d + list.length) % list.length]!;
    next.focus();
    pick(next);
  }, { signal });
}

/** Marks the checked radio and the roving tab stop. */
export function setChecked(group: HTMLElement, value: string | null, attr: string): void {
  const radios = qa(group, '[role="radio"]');
  let any = false;
  for (const r of radios) {
    const on = r.getAttribute(attr) === value;
    r.setAttribute('aria-checked', String(on));
    r.tabIndex = on ? 0 : -1;
    any ||= on;
  }
  if (!any && radios[0]) radios[0].tabIndex = 0;
}

/** role=toolbar roving tabindex: one Tab stop; both arrow pairs move (the pad is a 2-column grid). */
export function roving(bar: HTMLElement, signal: AbortSignal): void {
  const items = (): HTMLElement[] => qa<HTMLElement>(bar, 'button').filter((b) => !b.hidden && b.offsetParent !== null);
  const set = (el: HTMLElement): void => { for (const b of qa<HTMLElement>(bar, 'button')) b.tabIndex = b === el ? 0 : -1; };
  const first = items()[0];
  if (first) set(first);
  bar.addEventListener('focusin', (e) => { if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON') set(e.target); }, { signal });
  bar.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = list.length - 1;
    if (j < 0) return;
    e.preventDefault();
    list[j]!.focus();
  }, { signal });
}

/** Lowercase extension of a picked file. The only thing ever read from a file name. */
export const extensionOf = (file: File): string => {
  const m = /\.([a-z0-9]{1,8})$/i.exec(file.name);
  return m ? m[1]!.toLowerCase() : '';
};

/** fill() that keeps keyboard focus: `prefer` (a data-key) gets it if it is in `el`, else the element with the focused one's key. */
export function fillKeep(el: Element, nodes: readonly Node[], prefer?: string | null): void {
  const active = document.activeElement;
  const had = active instanceof HTMLElement && el.contains(active) ? active.dataset.key : undefined;
  fill(el, nodes);
  for (const key of [prefer, had]) {
    const next = key ? el.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) : null;
    if (next) { next.focus({ preventScroll: true }); return; }
  }
}

/** aria-disabled buttons stay focusable (they explain why); their click handlers check this first. */
export const isOff = (el: Element): boolean => el.getAttribute('aria-disabled') === 'true';

/** Opens the file picker; resolves [] on cancel. The input is removed (and its value cleared) right after. */
export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.hidden = true;
    const finish = (files: File[]): void => { input.value = ''; input.remove(); resolve(files); };
    input.addEventListener('change', () => finish([...(input.files ?? [])]), { once: true });
    input.addEventListener('cancel', () => finish([]), { once: true });
    document.body.append(input);
    input.click();
  });
}

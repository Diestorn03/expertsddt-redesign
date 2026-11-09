/** Live region, toasts, alert cards and modal dialogs (UI-DESIGN §11.3, §3.3). */
import type { Message } from './i18n/format';
import { h, icon, q } from './dom';
import type { Motion } from './motion';

/** Polite announcements; messages within 300 ms are merged. */
export class Announcer {
  private queue: string[] = [];
  private timer = 0;
  constructor(private readonly el: HTMLElement) {}
  say(text: string): void {
    this.queue.push(text);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.el.textContent = this.queue.join(' ');
      this.queue = [];
    }, 300);
  }
  dispose(): void {
    clearTimeout(this.timer);
  }
}

export interface ToastAction {
  label: string;
  run: () => void;
}

export class Toasts {
  private readonly timers = new Set<number>();
  /** How to take each toast showing now away. */
  private readonly live = new Set<() => void>();
  constructor(private readonly box: HTMLElement, private readonly motion: Motion, private readonly closeLabel: string) {}

  /** Every toast goes (as its close button does). */
  clear(): void {
    for (const remove of [...this.live]) remove();
  }

  /** A toast with an action stays 10 s and pauses while hovered or focused (WCAG 2.2.1). */
  show(text: string, action?: ToastAction): void {
    const close = h('button', 'xch-toast__x', { type: 'button', 'aria-label': this.closeLabel }, icon('close', 16));
    const el = h('div', 'xch-toast', {}, h('span', 'xch-toast__text', { text }));
    if (action) {
      const b = h('button', 'btn btn--outline xch-btn-sm', { type: 'button', text: action.label });
      b.addEventListener('click', () => { action.run(); remove(); });
      el.append(b);
    }
    el.append(close);
    let left = action ? 10000 : 5000, started = Date.now(), timer = 0, gone = false;
    const remove = (): void => {
      if (gone) return;
      gone = true;
      this.live.delete(remove);
      clearTimeout(timer);
      this.timers.delete(timer);
      this.motion.toastOut(el, () => el.remove());
    };
    this.live.add(remove);
    const run = (): void => { started = Date.now(); timer = window.setTimeout(remove, left); this.timers.add(timer); };
    const pause = (): void => { clearTimeout(timer); left -= Date.now() - started; };
    el.addEventListener('pointerenter', pause);
    el.addEventListener('pointerleave', run);
    el.addEventListener('focusin', pause);
    el.addEventListener('focusout', run);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') remove(); });
    close.addEventListener('click', remove);
    this.box.append(el);
    while (this.box.children.length > 3) this.box.firstElementChild?.remove();
    this.motion.toastIn(el);
    run();
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.live.clear();
    this.box.replaceChildren();
  }
}

/** Red alert card: title, body, muted code line, [Dismiss]. role=alert, announced on insert. */
export function alertCard(m: Message, dismissLabel: string, onDismiss: () => void): HTMLElement {
  const dismiss = h('button', 'btn btn--outline xch-btn-sm', { type: 'button', text: dismissLabel });
  dismiss.addEventListener('click', onDismiss);
  return h('div', 'xch-alert', { role: 'alert' }, icon('bad', 20), h('div', 'xch-alert__body', {},
    h('p', 'xch-alert__title', { text: m.title }), m.body ? h('p', '', { text: m.body }) : null, h('p', 'xch-alert__code', { text: m.code }), dismiss));
}

/** Amber note (warnings) or neutral info note; never blocking. */
export function noteCard(text: string, tone: 'warn' | 'info' = 'warn', ...extra: Node[]): HTMLElement {
  return h('div', `xch-alert xch-alert--${tone}`, {}, icon(tone === 'warn' ? 'warn' : 'info', 20), h('div', 'xch-alert__body', {}, h('p', '', { text }), ...extra));
}

/** Modal dialogs pause the site's smooth scroll through the motion.js bridge. */
export function openModal(dlg: HTMLDialogElement, opener: Element | null): void {
  if (dlg.open) return;
  dlg.showModal();
  document.dispatchEvent(new CustomEvent('scroll-lock', { detail: true }));
  dlg.addEventListener('close', () => {
    document.dispatchEvent(new CustomEvent('scroll-lock', { detail: false }));
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }, { once: true });
}

/** Themed confirm (never window.confirm). Resolves true on the primary button. */
export function confirmDialog(dlg: HTMLDialogElement, copy: { title: string; text: string; yes: string; keep: string }, opener: Element | null): Promise<boolean> {
  q(dlg, '[data-confirm-title]').textContent = copy.title;
  q(dlg, '[data-confirm-text]').textContent = copy.text;
  const yes = q<HTMLButtonElement>(dlg, '[data-confirm-yes]');
  const no = q<HTMLButtonElement>(dlg, '[data-confirm-no]');
  yes.firstChild!.textContent = copy.yes + ' ';
  no.textContent = copy.keep;
  return new Promise((resolve) => {
    let answer = false;
    const ac = new AbortController();
    yes.addEventListener('click', () => { answer = true; dlg.close(); }, { signal: ac.signal });
    no.addEventListener('click', () => dlg.close(), { signal: ac.signal });
    dlg.addEventListener('close', () => { ac.abort(); resolve(answer); }, { once: true });
    openModal(dlg, opener);
    no.focus();
  });
}

/** Scrolls an element into view through Lenis (motion.js bridge), only when it is off-screen. */
export function bringIntoView(el: Element): void {
  const r = el.getBoundingClientRect();
  if (r.top >= 70 && r.bottom <= window.innerHeight) return;
  document.dispatchEvent(new CustomEvent('scroll-to', { detail: el }));
}

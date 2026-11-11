/**
 * Email gate state (UI-DESIGN §9). localStorage['ddt-xchange:lead'] holds {v:1,state:'sent'} (no email kept)
 * or {v:1,state:'pending',email} until a POST succeeds. The POST never blocks the download; failures stay
 * pending and are retried later. Payload is exactly { source, email, lang, page }.
 */
export const LEAD_KEY = 'ddt-xchange:lead';
export const LEAD_SOURCE = 'ddt-xchange';

export type LeadState = { v: 1; state: 'sent' } | { v: 1; state: 'pending'; email: string };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LeadEnv {
  storage: StorageLike | null;
  /** PUBLIC_N8N_FORM_WEBHOOK; '' when unset. */
  hook: string;
  lang: string;
  /** origin + pathname (no query, no hash). */
  page: string;
  fetchFn?: typeof fetch;
  warn?: (message: string) => void;
}

/** Storage blocked (private window, site data off): the state is kept for this visit only (asked again next visit). */
let visit: LeadState | null = null;

export function readLead(storage: StorageLike | null): LeadState | null {
  if (!storage) return visit;
  try {
    const raw = storage.getItem(LEAD_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as LeadState;
    if (v?.v === 1 && v.state === 'sent') return { v: 1, state: 'sent' };
    if (v?.v === 1 && v.state === 'pending' && typeof v.email === 'string') return { v: 1, state: 'pending', email: v.email };
  } catch {
    return visit; // blocked storage
  }
  return null; // corrupt: ask again
}

function write(storage: StorageLike | null, state: LeadState): void {
  if (!storage) { visit = state; return; }
  try { storage.setItem(LEAD_KEY, JSON.stringify(state)); } catch { visit = state; /* storage blocked: kept for this visit */ }
}

/** True until an email was given on this browser (pending counts: it was given). */
export const needsEmail = (storage: StorageLike | null): boolean => readLead(storage) === null;

/** Honeypot filled: treated as sent locally, nothing posted. */
export const markSent = (storage: StorageLike | null): void => write(storage, { v: 1, state: 'sent' });

/** Saves pending, then posts. Resolves to the final state; never rejects. */
export async function submitLead(email: string, env: LeadEnv): Promise<LeadState['state']> {
  write(env.storage, { v: 1, state: 'pending', email });
  if (!env.hook) {
    (env.warn ?? console.warn)('PUBLIC_N8N_FORM_WEBHOOK is not set: the DDT Xchange lead was not recorded.');
    markSent(env.storage);
    return 'sent';
  }
  try {
    const r = await (env.fetchFn ?? fetch)(env.hook, {
      method: 'POST',
      // text/plain: a simple request, so the Google Apps Script endpoint needs no CORS preflight; the body is still JSON
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ source: LEAD_SOURCE, email, lang: env.lang, page: env.page }),
      keepalive: true,
    });
    if (!r.ok) return 'pending';
    markSent(env.storage);
    return 'sent';
  } catch {
    return 'pending';
  }
}

/** Retries a pending email once (on mount and before an export). */
export async function retryPending(env: LeadEnv): Promise<void> {
  const s = readLead(env.storage);
  if (s?.state === 'pending') await submitLead(s.email, env);
}

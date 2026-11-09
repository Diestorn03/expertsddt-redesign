/**
 * Interpolation, plurals, numbers and error/warning text (UI-DESIGN §12 conventions). Pure: no DOM.
 * Engine details carry only numbers and reason ids, so nothing here can leak a file name.
 */
import type { ErrorDetails, XchangeErrorPayload, XchangeWarning } from '../../core/errors';
import type { Copy } from './en';
import type { ErrCopy, Text } from './types';

export type Lang = 'en' | 'es';
export type Purpose = 'jaw' | 'capture' | 'positions' | 'geometry' | 'library';
type Vars = Readonly<Record<string, string | number>>;

const nf = new Map<string, Intl.NumberFormat>();
/** Locale number; `digits` fixes the fraction digits. */
export function num(lang: Lang, value: number, digits = 0): string {
  const key = `${lang}:${digits}`;
  let f = nf.get(key);
  if (!f) nf.set(key, (f = new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits })));
  return f.format(value);
}

export const mb = (lang: Lang, bytes: number): string => num(lang, bytes / (1024 * 1024), 1);

/** Replaces {key} tokens; numbers go through Intl. Unknown tokens stay as they are. */
export function fmt(lang: Lang, text: string, vars: Vars = {}): string {
  return text.replace(/\{(\w+)\}/g, (all, key: string) => {
    const v = vars[key];
    return v === undefined ? all : typeof v === 'number' ? num(lang, v) : v;
  });
}

const rules = new Map<Lang, Intl.PluralRules>();
/** A plural pair picked by Intl.PluralRules; {count} is filled with n. */
export function plural(lang: Lang, text: Text, n: number, vars: Vars = {}): string {
  if (typeof text === 'string') return fmt(lang, text, { count: n, ...vars });
  let r = rules.get(lang);
  if (!r) rules.set(lang, (r = new Intl.PluralRules(lang)));
  return fmt(lang, r.select(n) === 'one' ? text.one : text.other, { count: n, ...vars });
}

/** " (line 12)" from the first location detail present; 0-based engine indices are shown + 1. */
export function loc(c: Copy, lang: Lang, d: ErrorDetails): string {
  const order: [keyof Copy['loc'], number][] = [['row', 0], ['line', 0], ['triangle', 1], ['vertex', 1], ['face', 1], ['offset', 1]];
  for (const [key, plus] of order) {
    const v = d[key];
    if (typeof v === 'number') return ' ' + fmt(lang, c.loc[key], { n: v + plus });
  }
  return '';
}

export interface Message {
  title: string;
  body: string;
  /** "Code: FORMAT_UNSUPPORTED · spreadsheet" */
  code: string;
}

export interface MessageContext {
  purpose?: Purpose;
  /** 1-based position of the failing file and the number of files, for "File 2 of 3:". */
  file?: { n: number; total: number };
  /** Implant labels by site index, for EXPORT_GEOMETRY_MISSING. */
  labels?: readonly string[];
}

const purposeOf = (d: ErrorDetails, ctx: MessageContext): Purpose => {
  const p = d.purpose;
  return p === 'jaw' || p === 'capture' || p === 'geometry' ? p : (ctx.purpose ?? 'capture');
};

export function errorMessage(c: Copy, lang: Lang, error: XchangeErrorPayload, ctx: MessageContext = {}): Message {
  const d = error.details;
  const reason = typeof d.reason === 'string' ? d.reason : undefined;
  const row: ErrCopy = c.errors[error.code] ?? c.errors.INTERNAL;
  // reason rows override the code row; a few variants are keyed by context instead of a reason id
  let key = reason;
  if (error.code === 'FORMAT_NOT_ALLOWED' && d.purpose === 'jaw') key = 'jaw';
  if (error.code === 'TOO_MANY_TRIANGLES' && typeof d.count !== 'number') key = 'noCount';
  const pick = (key && row.reasons?.[key]) || row;
  const purpose = purposeOf(d, ctx);
  const n = (k: string): number | undefined => (typeof d[k] === 'number' ? (d[k] as number) : undefined);
  const site = n('site');
  const fmtName = typeof d.format === 'string' ? d.format : '';
  const vars: Record<string, string | number> = {
    loc: loc(c, lang, d),
    purposeA: c.purpose[purpose],
    accepted: c.accepted[purpose],
    FORMAT: fmtName.toUpperCase(),
    formatName: (c.format as Record<string, string>)[fmtName] ?? fmtName,
    reasonText: (c.rigidReason as Record<string, string>)[reason ?? ''] ?? c.rigidReason.other,
    dropped: n('dropped') ? fmt(lang, c.dropped, { n: n('dropped')! }) : '',
    label: site !== undefined ? (ctx.labels?.[site] ?? String(site + 1)) : '',
    n: (n('index') ?? 0) + 1,
  };
  if (n('bytes') !== undefined) vars.size = mb(lang, n('bytes')!);
  if (n('limitBytes') !== undefined) vars.limit = mb(lang, n('limitBytes')!);
  else if (n('limit') !== undefined) vars.limit = n('limit')!;
  if (n('count') !== undefined) vars.count = n('count')!;
  const file = ctx.file ?? (n('file') && n('files') ? { n: n('file')!, total: n('files')! } : undefined);
  const prefix = file && file.total > 1 ? fmt(lang, c.s1.fileOf, file) + ' ' : '';
  return {
    title: prefix + fmt(lang, pick.t, vars),
    body: fmt(lang, pick.b, vars),
    code: fmt(lang, c.err.code, { code: error.code, reason: reason ? ` · ${reason}` : '' }),
  };
}

export function warningMessage(c: Copy, lang: Lang, w: XchangeWarning, purpose: Purpose = 'capture'): string {
  const d = w.details ?? {};
  const text = c.warnings[w.code];
  const count = typeof d.count === 'number' ? d.count : 0;
  return plural(lang, text, count, {
    triangles: typeof d.triangles === 'number' ? num(lang, d.triangles) : '',
    extent: typeof d.extentMm === 'number' ? num(lang, d.extentMm, 1) : '',
    purposeA: c.purpose[purpose],
  });
}

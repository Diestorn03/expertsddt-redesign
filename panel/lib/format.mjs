// Spanish display formats (es-US, Florida time). A library dataDate (YYYY-MM-DD) is a calendar day, so it is formatted in UTC:
// in New York, midnight UTC of 2026-11-06 is still November 5.
const TZ = 'America/New_York';
const MB = 1048576;
const fl = (o) => new Intl.DateTimeFormat('es-US', { timeZone: TZ, ...o });
const DATE_TIME = fl({ day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const DATE = fl({ day: 'numeric', month: 'short', year: 'numeric' });
const TIME = fl({ hour: 'numeric', minute: '2-digit' });
const WEEKDAY = fl({ weekday: 'long', day: 'numeric', month: 'long' });
const WEEKDAY_YEAR = fl({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const ISO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }); // en-CA prints YYYY-MM-DD
const DATA = {
  long: new Intl.DateTimeFormat('es-US', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }),
  short: new Intl.DateTimeFormat('es-US', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }),
};
const REL = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

/** «105 KB», «23.7 MB». */
export const size = (n) => (n >= MB ? `${(n / MB).toFixed(1)} MB` : `${n > 0 ? Math.max(1, Math.round(n / 1024)) : 0} KB`);
/** «7 nov 2026, 2:40 p.m.» */
export const dateTime = (ts) => DATE_TIME.format(ts);
/** «7 nov 2026» */
export const date = (ts) => DATE.format(ts);
/** «2:40 p.m.» */
export const time = (ts) => TIME.format(ts);
/** Florida calendar day of a timestamp, 'YYYY-MM-DD' (also the max/value of the data-date input). */
export const isoDay = (ts) => ISO_DAY.format(ts);
/** «6 de noviembre de 2026» or, with 'short', «6 nov 2026». Always UTC. */
export function dataDate(d, style = 'long') {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isNaN(t) ? '' : DATA[style === 'short' ? 'short' : 'long'].format(t);
}
/** «1 archivo», «35 archivos». */
export const files = (n) => `${n} ${n === 1 ? 'archivo' : 'archivos'}`;

const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
/** «hace un momento», «hace 5 minutos», «hace 2 horas», «ayer», «anteayer», «hace 3 días» (days counted on Florida's calendar). */
export function relative(ts, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return 'hace un momento';
  if (s < 3600) return REL.format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return REL.format(-Math.floor(s / 3600), 'hour');
  return REL.format(-Math.max(1, Math.round((dayMs(isoDay(now)) - dayMs(isoDay(ts))) / 86400000)), 'day');
}

/** History day heading: «Hoy · sábado 7 de noviembre», «Ayer · viernes 6 de noviembre», «Jueves 5 de noviembre de 2026». */
export function day(ts, now = Date.now()) {
  const d = isoDay(ts), today = isoDay(now);
  const yesterday = new Date(dayMs(today) - 86400000).toISOString().slice(0, 10);
  if (d === today || d === yesterday) return `${d === today ? 'Hoy' : 'Ayer'} · ${WEEKDAY.format(ts).replace(',', '')}`;
  const s = WEEKDAY_YEAR.format(ts).replace(',', '');
  return s[0].toLocaleUpperCase('es') + s.slice(1);
}

/** «lugares» for the consequence sentence: «Inicio (pilar «Soporte y contacto») y en Servicios («Visitas de consultoría y soporte»)». */
export function places(where = []) {
  const p = where.map((w, i) => `${i ? 'en ' : ''}${w.page}${w.section ? ` (${w.section})` : ''}`);
  return p.length < 2 ? p.join('') : `${p.slice(0, -1).join(', ')} y ${p.at(-1)}`;
}

/** The exact line the public libraries page shows (its template, date in UTC, size rounded like the site): «Versión v10 · actualizada el 6 de noviembre de 2026 · 24 MB». */
export const publicLine = ({ version, dataDate: d, bytes }) => `Versión ${version} · actualizada el ${dataDate(d)} · ${(bytes / MB).toFixed(0)} MB`;

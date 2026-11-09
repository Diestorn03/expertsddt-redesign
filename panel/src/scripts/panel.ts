// The panel's only client bundle (DESIGN §9.8). Progressive enhancement: every action is a plain <form> that works without this file.
// CSP-safe: no inline code, no innerHTML with user data (textContent only), no eval; dynamic values through attributes, classes or CSSOM.
const doc = document, root = doc.documentElement;
root.classList.add('js'); // set here, not in theme-init.js: if this bundle fails, file inputs stay visible

const MB = 1048576;
const $ = <T extends Element = HTMLElement>(s: string, el: ParentNode = doc) => el.querySelector(s) as T | null;
const $$ = <T extends Element = HTMLElement>(s: string, el: ParentNode = doc) => [...el.querySelectorAll(s)] as T[];
const make = (tag: string, cls = '', text = '') => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const mb = (n: number) => (n / MB).toFixed(1);
const size = (n: number) => (n >= MB ? `${mb(n)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fill = (s = '', v: Record<string, string> = {}) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const DATA_DATE = new Intl.DateTimeFormat('es-US', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }); // a calendar day: UTC (§9.5.16)
const dataDate = (d: string) => { const t = Date.parse(`${d}T00:00:00Z`); return Number.isNaN(t) ? '' : DATA_DATE.format(t); };

/** An icon cloned from the <template id="icons"> the frame renders (no SVG path is duplicated here). */
function icon(name: string, px = 16) {
  const svg = ($<HTMLTemplateElement>('#icons')?.content.querySelector(`[data-icon="${name}"] svg`)?.cloneNode(true) as SVGElement) ?? doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(px)); svg.setAttribute('height', String(px));
  return svg;
}
/** Polite announcement in #sr-status (§5.27). */
function say(text: string) {
  const s = $('#sr-status'); if (!s) return;
  s.textContent = ''; setTimeout(() => { s.textContent = text; }, 60);
}

// ---------- toasts: browser events only, never a server result (§6.13) ----------
function toast(tone: 'info' | 'err', text: string, title = tone === 'err' ? 'No se pudo completar' : 'Aviso') {
  const box = $('.toasts'); if (!box) return;
  while (box.children.length >= 3) box.firstElementChild!.remove();
  const t = make('div', 'toast'); t.dataset.tone = tone;
  if (tone === 'err') t.setAttribute('role', 'alert');
  const i = make('span', 'toast__i'); i.append(icon(tone === 'err' ? 'alert-circle' : 'info', 16));
  const body = make('div'); body.append(make('p', 'toast__t', title), make('p', '', text));
  const x = make('button', 'toast__x') as HTMLButtonElement; x.type = 'button'; x.setAttribute('aria-label', 'Cerrar aviso'); x.append(icon('x', 18));
  t.append(i, body, x); box.append(t);
  const pad = () => root.style.setProperty('scroll-padding-bottom', box.children.length ? `${box.offsetHeight + 16}px` : ''); // 2.4.11: never over the focus
  const close = () => { t.remove(); pad(); };
  x.addEventListener('click', close);
  if (tone === 'info') { // 6 s, paused while hovered or focused (2.2.1)
    let timer = setTimeout(close, 6000);
    const pause = () => clearTimeout(timer), resume = () => { clearTimeout(timer); timer = setTimeout(close, 6000); };
    t.addEventListener('mouseenter', pause); t.addEventListener('mouseleave', resume);
    t.addEventListener('focusin', pause); t.addEventListener('focusout', resume);
  }
  pad();
}

// ---------- theme (§6.2) ----------
const toggles = $$<HTMLButtonElement>('[data-theme-toggle]');
const syncTheme = () => { const dark = root.dataset.theme === 'dark'; for (const b of toggles) { b.setAttribute('aria-label', dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'); } };
for (const b of toggles) {
  b.hidden = false;
  b.addEventListener('click', () => {
    const t = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = t; try { localStorage.setItem('theme', t); } catch { /* private mode */ }
    syncTheme();
  });
}
syncTheme();

// ---------- result notice: fallback focus after the redirect (§6.7) ----------
const result = $('#resultado');
const focusResult = () => { if (result && (!doc.activeElement || doc.activeElement === doc.body)) result.focus(); }; // never steal focus the user moved
focusResult(); window.addEventListener('load', focusResult, { once: true }); // browsers skip autofocus when the URL has a #fragment

// ---------- previews: broken image, real dimensions (§6.15) ----------
let toldBroken = false;
function broken(img: HTMLImageElement) {
  const card = img.closest<HTMLElement>('[data-slot]');
  const box = make('span', 'frame__empty'); box.append(icon('image-off', 22), make('span', '', 'No se pudo cargar la vista previa desde expertsddt.com.'));
  img.replaceWith(box);
  const old = card?.querySelector('[data-compare-old]'); // «Actual» in the comparison is the same picture
  if (old) { const e = make('span', 'frame__empty'); e.append(icon('image-off', 22)); old.replaceWith(e); }
  if (!toldBroken && card) { toldBroken = true; toast('info', `No se pudo cargar la vista previa de «${card.dataset.label}» desde expertsddt.com.`); }
}
for (const img of $$<HTMLImageElement>('img[data-preview]')) {
  const ready = () => {
    if (!img.naturalWidth) return broken(img);
    const dims = img.closest('[data-slot]')?.querySelector('[data-dims]');
    if (dims) dims.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
  };
  if (img.complete && img.src) ready(); else { img.addEventListener('load', ready); img.addEventListener('error', () => broken(img)); }
}

// ---------- choosing a file: the server's rules, checked before a single byte is sent (§6.5) ----------
type Check = { tone: 'ok' | 'info' | 'warn'; lead: string; text: string };
const urls = new WeakMap<Element, string>();
const RATIOS: [number, number][] = [[1, 1], [4, 3], [3, 4], [3, 2], [2, 3], [16, 9], [9, 16], [16, 10], [10, 16], [5, 4], [4, 5], [21, 9]];
const ratioName = (w: number, h: number) => { const r = w / h; const hit = RATIOS.find(([a, b]) => Math.abs(a / b - r) / r < 0.02); return hit ? `${hit[0]}:${hit[1]}` : `${r.toFixed(2)}:1`; };
const ratioOff = (a: number, b: number) => Math.abs(a - b) / b > 0.1;
const isZip = (f: File) => /\.zip$/i.test(f.name) || ['application/zip', 'application/x-zip-compressed'].includes(f.type);
const imgType = (f: File) => (/png/.test(f.type) || /\.png$/i.test(f.name) ? 'png' : /jpe?g/.test(f.type) || /\.jpe?g$/i.test(f.name) ? 'jpg' : /webp/.test(f.type) || /\.webp$/i.test(f.name) ? 'webp' : null);

async function inspect(drop: HTMLElement, file: File): Promise<{ error?: string; checks: Check[]; w?: number; h?: number }> {
  const d = drop.dataset, kind = d.kind!, max = Number(d.maxBytes), checks: Check[] = [];
  if (!file.size) return { error: 'El archivo está vacío.', checks };
  if (kind === 'library') {
    if (d.folder) return { error: 'Arrastraste una carpeta. Comprímela primero: clic derecho › Enviar a › Carpeta comprimida (en zip).', checks };
    if (!isZip(file)) return { error: 'Este archivo no es un .zip. Las librerías se publican comprimidas en .zip.', checks };
    if (file.size > max) return { error: `Este .zip pesa ${mb(file.size)} MB y el máximo es ${Math.round(max / MB)} MB.`, checks };
    return { checks };
  }
  if (kind === 'document') {
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return { error: 'No se puede usar: no es un PDF.', checks };
    if (file.size > max) return { error: `No se puede usar: pesa ${mb(file.size)} MB y el máximo es ${Math.round(max / MB)} MB.`, checks };
    return { checks: [{ tone: 'ok', lead: 'Listo:', text: `es un PDF de ${size(file.size)} (máximo ${Math.round(max / MB)} MB).` }] };
  }
  if (kind === 'video') {
    if (file.type === 'video/quicktime' || /\.mov$/i.test(file.name)) return { error: 'No se puede usar: es un MOV del iPhone. Expórtalo como MP4 o pídele ayuda al equipo técnico.', checks };
    if (file.type !== 'video/mp4' && !/\.mp4$/i.test(file.name)) return { error: 'No se puede usar: no es un video MP4.', checks };
    if (file.size > max) return { error: `No se puede usar: pesa ${mb(file.size)} MB y el máximo es ${Math.round(max / MB)} MB. Pide una versión más liviana (por ejemplo, exportada en 1080p o más corta).`, checks };
    return { checks: [{ tone: 'ok', lead: 'Listo:', text: 'es un MP4.' }, { tone: 'ok', lead: 'Listo:', text: `pesa ${mb(file.size)} MB (máximo ${Math.round(max / MB)} MB).` }] };
  }
  // image or poster
  if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return { error: 'No se puede usar: es HEIC, el formato del iPhone. Ábrela y guárdala como JPG, o en el iPhone activa Ajustes › Cámara › Formatos › Más compatible.', checks };
  const type = imgType(file);
  if (!type || (d.format && d.format !== type)) return { error: d.format ? `No se puede usar: aquí solo sirven imágenes ${d.format === 'jpg' ? 'JPG' : 'WebP'}.` : 'No se puede usar: no es una foto PNG, JPG o WebP.', checks };
  if (file.size > max) return { error: `No se puede usar: pesa ${Math.round(file.size / MB)} MB y el máximo es ${Math.round(max / MB)} MB.`, checks };
  let w = 0, h = 0;
  try { const bmp = await createImageBitmap(file); w = bmp.width; h = bmp.height; bmp.close(); } catch { return { error: 'No pudimos abrir esta foto. Puede estar dañada.', checks }; }
  const min = Number(d.minWidth) || 0;
  if (w < min) return { error: `No se puede usar: mide ${w} px de ancho y aquí se necesitan al menos ${min}. Busca la foto original o una más grande.`, checks, w, h };
  checks.push({ tone: 'ok', lead: 'Listo:', text: 'formato aceptado.' }, { tone: 'ok', lead: 'Listo:', text: `tamaño suficiente (${w} px de ancho).` });
  if (kind === 'poster') return { checks: [], w, h };
  if (!d.format) checks.push({ tone: 'info', lead: '', text: 'Quitaremos los datos ocultos de la foto, como la ubicación GPS.' });
  const card = drop.closest<HTMLElement>('[data-slot]');
  const cur = card?.querySelector<HTMLImageElement>('img[data-preview]');
  if (d.crop === 'og') { if (w !== 1200 || h !== 630) checks.push({ tone: 'info', lead: 'Así quedará:', text: 'la recortamos a 1200 × 630 px.' }); }
  else if (cur?.naturalWidth && ratioOff(w / h, cur.naturalWidth / cur.naturalHeight)) {
    checks.push({ tone: 'warn', lead: 'Ojo:', text: `tiene otra proporción que la foto actual (${ratioName(w, h)} frente a ${ratioName(cur.naturalWidth, cur.naturalHeight)}). En la web podría verse recortada.` });
  }
  const pair = d.pair ? $<HTMLImageElement>(`#slot-${d.pair} img[data-preview]`) : null;
  if (pair?.naturalWidth && ratioOff(w / h, pair.naturalWidth / pair.naturalHeight)) checks.push({ tone: 'warn', lead: 'Ojo:', text: `tiene otra proporción que su pareja «${d.pairLabel}». El comparador de la web no coincidiría.` });
  if (d.alpha !== undefined && type === 'jpg') checks.push({ tone: 'warn', lead: 'Ojo:', text: 'esta imagen necesita fondo transparente (PNG o WebP). Una foto JPG se verá como un rectángulo sobre el fondo.' });
  return { checks, w, h };
}

const errorOf = (input: HTMLInputElement) => $(`#${CSS.escape(input.id)}-err`) ?? $(`#${CSS.escape(input.id)}-e`);
function setError(input: HTMLInputElement, text: string | null) {
  const box = errorOf(input);
  if (text) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  input.closest('.drop')?.classList.toggle('is-invalid', !!text);
  if (box) { box.hidden = !text; const t = $('[data-error-text]', box); if (t) t.textContent = text ?? ''; }
}

function clearDrop(drop: HTMLElement) {
  const old = urls.get(drop); if (old) URL.revokeObjectURL(old);
  urls.delete(drop);
  drop.classList.remove('has-file', 'is-invalid');
  const row = $('.drop__file', drop)!; row.hidden = true; row.replaceChildren();
  delete drop.dataset.invalid;
  const input = $<HTMLInputElement>('input[type="file"]', drop)!;
  setError(input, null);
  if (input.name === 'file') {
    const form = drop.closest('form')!;
    const cmp = $('[data-compare]', form), checks = $('[data-checks]', form);
    if (cmp) cmp.hidden = true;
    if (checks) { checks.hidden = true; checks.replaceChildren(); }
  }
}

async function chosen(drop: HTMLElement) {
  const input = $<HTMLInputElement>('input[type="file"]', drop)!, file = input.files?.[0];
  clearDrop(drop);
  if (!file) return;
  const form = drop.closest('form')!, kind = drop.dataset.kind!;
  const r = await inspect(drop, file);
  // FileRow (§5.13): the whole row stays inside the <label>, so any click opens the picker again
  const row = $('.drop__file', drop)!;
  let thumb: Element;
  if ((kind === 'image' || kind === 'poster') && !r.error) { const u = URL.createObjectURL(file); urls.set(drop, u); thumb = make('img'); (thumb as HTMLImageElement).src = u; (thumb as HTMLImageElement).alt = ''; }
  else { thumb = make('span', 'tile'); thumb.append(icon({ video: 'film', document: 'file-text', library: 'package' }[kind] ?? 'image', 20)); }
  const name = make('span', 'drop__name', file.name); name.title = file.name;
  const info = make('span'); info.append(name, make('span', 'drop__size', r.w ? `${size(file.size)} · ${r.w} × ${r.h} px` : size(file.size)));
  row.append(thumb, info, make('span', 'drop__change', 'Cambiar archivo'));
  row.hidden = false; drop.classList.add('has-file');
  if (r.error) { drop.dataset.invalid = '1'; setError(input, r.error); say(r.error); return; }
  if (input.name !== 'file') return;
  const list = $('[data-checks]', form);
  if (list) {
    list.replaceChildren(...r.checks.map((c) => {
      const li = make('li', `is-${c.tone}`), i = make('span');
      i.append(icon(c.tone === 'ok' ? 'check' : c.tone === 'info' ? 'info' : 'alert-triangle', 16));
      const t = make('span'); if (c.lead) t.append(make('b', '', c.lead), ' '); t.append(c.text);
      li.append(i, t); return li;
    }));
    list.hidden = !r.checks.length;
  }
  const cmp = $('[data-compare]', form);
  if (cmp && r.w) {
    $<HTMLImageElement>('[data-compare-new]', cmp)!.src = urls.get(drop)!;
    $('[data-compare-name]', cmp)!.textContent = `${file.name} · ${size(file.size)} · ${r.w} × ${r.h} px`;
    const maxW = Number(drop.dataset.maxWidth) || 0;
    $('[data-compare-save]', cmp)!.textContent = drop.dataset.crop === 'og' ? 'Así quedará: la recortamos a 1200 × 630 px.' : r.w > maxW ? `Se guardará a ${maxW} px de ancho.` : 'Se guardará en su tamaño actual.';
    cmp.hidden = false;
  }
  const ok = r.checks.filter((c) => c.tone === 'ok').length, warn = r.checks.filter((c) => c.tone === 'warn').length;
  const what = ({ image: 'Foto lista', video: 'Video listo', document: 'PDF listo' } as Record<string, string>)[kind] ?? 'Archivo listo';
  say(r.checks.length ? `${what} para revisar: ${file.name}. ${ok} ${ok === 1 ? 'comprobación correcta' : 'comprobaciones correctas'}, ${warn} ${warn === 1 ? 'aviso' : 'avisos'}.` : `${what} para revisar: ${file.name}.`);
  if (form.matches('[data-version-form]')) versionLine(form);
}

for (const drop of $$('label.drop[data-drop]')) {
  const input = $<HTMLInputElement>('input[type="file"]', drop)!;
  input.addEventListener('click', (e) => { if (uploading) e.preventDefault(); }); // readOnly does nothing on a file input
  input.addEventListener('change', () => { delete drop.dataset.folder; void chosen(drop); });
  drop.addEventListener('dragenter', () => drop.classList.add('is-over'));
  drop.addEventListener('dragleave', (e) => { if (!drop.contains(e.relatedTarget as Node)) drop.classList.remove('is-over'); });
  drop.addEventListener('drop', (e) => {
    drop.classList.remove('is-over');
    const entry = (e.dataTransfer?.items?.[0] as any)?.webkitGetAsEntry?.();
    if (entry?.isDirectory) { e.preventDefault(); drop.dataset.folder = '1'; clearDrop(drop); setError(input, 'Arrastraste una carpeta. Comprímela primero: clic derecho › Enviar a › Carpeta comprimida (en zip).'); drop.dataset.invalid = '1'; }
  });
}
for (const form of $$<HTMLFormElement>('form[data-upload]')) {
  form.noValidate = true; // our Spanish messages instead of the browser's
  form.addEventListener('reset', (e) => { if (uploading) e.preventDefault(); }); // «Cancelar» must not clear a file that is still going up
  form.addEventListener('reset', () => setTimeout(() => { for (const d of $$('label.drop[data-drop]', form)) clearDrop(d); versionLine(form); }));
}

// ---------- drag a file onto a whole card (§6.6) ----------
const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
for (const card of $$('[data-drop-target]')) {
  let depth = 0;
  card.addEventListener('dragenter', (e) => { if (!hasFiles(e) || uploading) return; depth++; card.classList.add('is-dragover'); });
  card.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; card.classList.remove('is-dragover'); } });
  card.addEventListener('dragover', (e) => { if (hasFiles(e) && !uploading) e.preventDefault(); });
  card.addEventListener('drop', (e) => {
    depth = 0; card.classList.remove('is-dragover');
    const files = e.dataTransfer?.files;
    if (!files?.length || (e.target as Element).closest('.drop')) return; // a drop zone takes it natively
    e.preventDefault();
    if (uploading) return;
    const details = $<HTMLDetailsElement>('details.slot__more', card)!, input = $<HTMLInputElement>('input[type="file"][name="file"]', card)!;
    details.open = true;
    const dt = new DataTransfer(); dt.items.add(files[0]); input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (files.length > 1) toast('info', `Solo se usa un archivo a la vez: tomamos «${files[0].name}».`);
    details.scrollIntoView({ block: 'nearest' });
  });
}
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); }); // never let the browser open the file and lose the page
window.addEventListener('drop', (e) => {
  if (!hasFiles(e) || (e.target as Element).closest?.('[data-drop-target], .drop')) return;
  e.preventDefault(); toast('info', 'Suelta el archivo sobre la tarjeta que quieres cambiar.');
});

// ---------- library form: live public line, duplicate check (§6.9) ----------
function versionVars(form: HTMLFormElement) {
  const n = String(($<HTMLInputElement>('[name="version"]', form)?.value ?? '')).trim().replace(/^v/i, '');
  const date = $<HTMLInputElement>('[name="dataDate"]', form)?.value ?? '';
  const file = $<HTMLInputElement>('input[name="file"]', form)?.files?.[0];
  return { n, v: `v${n}`, d: dataDate(date), s: file ? (file.size / MB).toFixed(0) : '', archivo: file?.name ?? '', actual: form.dataset.actual ?? '', date };
}
function versionLine(form: HTMLFormElement) {
  if (!form.matches('[data-version-form]')) return;
  const x = versionVars(form), okNum = /^\d{1,3}$/.test(x.n), hasFile = !!x.archivo && !$('label.drop[data-invalid]', form);
  const line = $('[data-preview-line]', form);
  if (line) { line.hidden = !(okNum && x.d && hasFile); $('p', line)!.textContent = `«${fill(form.dataset.tpl, x)}»`; }
  const cons = $('.consequence', form);
  if (cons && okNum) cons.textContent = fill(cons.dataset.jsText, x);
  const btn = $('[data-submit-text]', form);
  if (btn) btn.textContent = okNum ? `Publicar versión ${x.v}` : 'Publicar esta versión';
}
function versionErrors(form: HTMLFormElement) {
  const ver = $<HTMLInputElement>('[name="version"]', form), date = $<HTMLInputElement>('[name="dataDate"]', form);
  if (!ver || !date) return [];
  const x = versionVars(form), existing = (form.dataset.existing ?? '').split(',').filter(Boolean), bad: HTMLInputElement[] = [];
  const vErr = !/^\d{1,3}$/.test(x.n) ? 'Escribe solo números, por ejemplo 11.' : existing.includes(`v${Number(x.n)}`) ? `La v${Number(x.n)} ya existe. La siguiente libre es la ${form.dataset.next}.` : null;
  const dErr = !x.date ? 'Elige la fecha de los datos.' : date.max && x.date > date.max ? 'La fecha no puede ser futura.' : null;
  setError(ver, vErr); setError(date, dErr);
  if (vErr) bad.push(ver); if (dErr) bad.push(date);
  return bad;
}
for (const form of $$<HTMLFormElement>('form[data-version-form]')) {
  versionLine(form); // with JS the button names the version: «Publicar versión v11»
  for (const n of ['version', 'dataDate']) $(`[name="${n}"]`, form)?.addEventListener('input', () => { versionLine(form); if ($(`[name="${n}"][aria-invalid]`, form)) versionErrors(form); });
}

/** Local validation before sending: the first problem gets the focus; the submit button is never disabled (§6.5). */
function validate(form: HTMLFormElement) {
  const bad: HTMLElement[] = [];
  for (const drop of $$('label.drop[data-drop]', form)) {
    const input = $<HTMLInputElement>('input[type="file"]', drop)!;
    if (input.required && !input.files?.length) { setError(input, drop.dataset.kind === 'library' ? 'Elige primero el archivo .zip.' : 'Elige primero el archivo.'); bad.push(input); }
    else if (drop.dataset.invalid) bad.push(input);
  }
  bad.push(...versionErrors(form));
  bad[0]?.focus();
  return !bad.length;
}

// ---------- confirm dialog (§6.12) ----------
const dlg = $<HTMLDialogElement>('#confirm');
dlg?.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); }); // a click on the backdrop
function confirmWith(form: HTMLFormElement, vars: Record<string, string>): Promise<boolean> {
  if (!dlg || typeof dlg.showModal !== 'function') return Promise.resolve(true);
  const d = form.dataset, opener = doc.activeElement as HTMLElement | null;
  $('#dlg-t', dlg)!.textContent = fill(d.confirmTitle, vars);
  $('#dlg-d', dlg)!.textContent = fill(d.confirmText, vars);
  const detail = $('[data-dlg-detail]', dlg)!; detail.textContent = fill(d.confirmDetail, vars); detail.hidden = !d.confirmDetail;
  $('[data-dlg-ok]', dlg)!.textContent = fill(d.confirmOk, vars);
  $('[data-dlg-icon]', dlg)!.replaceChildren(icon(d.confirmIcon || 'package', 20));
  dlg.returnValue = '';
  dlg.showModal();
  $<HTMLButtonElement>('.dlg__act .btn--outline', dlg)?.focus(); // «No, volver»
  return new Promise((done) => dlg.addEventListener('close', () => { opener?.focus(); done(dlg.returnValue === 'ok'); }, { once: true }));
}

// ---------- one upload at a time, with progress, cancel and the JSON contract (§6.7, §6.8) ----------
let uploading: XMLHttpRequest | null = null;
const leaveGuard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
const PROCESSING: Record<string, string> = { image: 'Optimizando la foto…', video: 'Guardando el video…', document: 'Guardando la guía…', library: 'Revisando el .zip y calculando la huella…' };

function lockOthers(current: HTMLFormElement, on: boolean) {
  for (const b of $$<HTMLButtonElement>('form:not([method="dialog"]) [type="submit"]')) if (b.form !== current) on ? b.setAttribute('aria-disabled', 'true') : b.removeAttribute('aria-disabled');
  for (const f of $$<HTMLFormElement>('form[data-upload]')) {
    if (f === current) continue;
    const note = $('[data-lock-note]', f); if (note) note.hidden = !on;
    for (const d of $$('.drop', f)) d.classList.toggle('is-locked', on);
  }
}

function fail(form: HTMLFormElement, why: 'net' | '413' | '500') {
  const box = $('[data-upl-error]', form); if (!box) return;
  const [t, x] = why === 'net' ? ['Se cortó la conexión mientras subías el archivo.', 'Nada cambió en la web. Revisa tu internet y vuelve a intentarlo; el archivo sigue elegido.']
    : why === '413' ? ['El servidor rechazó el archivo por su tamaño.', 'Nada cambió en la web.']
    : ['Algo salió mal de nuestro lado', 'Si estabas subiendo un archivo, revisa en el panel si el cambio se aplicó antes de repetirlo. Si vuelve a pasar, avísale a Diego o a David.'];
  $('[data-upl-error-t]', box)!.textContent = t; $('[data-upl-error-x]', box)!.textContent = x;
  $('[data-upl-retry]', box)!.hidden = why !== 'net';
  box.hidden = false; box.focus();
}

function go(to: string) {
  const u = new URL(to || '/', location.href);
  if (u.origin !== location.origin) return; // never navigate away from the panel
  if (u.pathname === location.pathname) { // same document: assign() would only move the anchor, the notice needs a reload
    history.replaceState(null, '', u.pathname + u.search + u.hash);
    location.reload();
  } else location.assign(u.href);
}

function upload(form: HTMLFormElement) {
  const kind = form.dataset.kind ?? 'image', upl = $('[data-upl]', form)!, bar = $<HTMLProgressElement>('progress', upl)!;
  const btn = $<HTMLButtonElement>('[data-submit]', form)!, label = $('[data-submit-text]', btn) ?? btn, before = label.textContent;
  const file = $<HTMLInputElement>('input[name="file"]', form)?.files?.[0];
  const xhr = new XMLHttpRequest(); uploading = xhr;
  const card = form.closest('.slot');
  $('[data-upl-error]', form)!.hidden = true;
  $('.upl__name', upl)!.textContent = `Subiendo «${file?.name ?? ''}»`;
  $('.upl__pct', upl)!.textContent = '0 %'; $('.upl__sub', upl)!.textContent = '';
  bar.value = 0; upl.hidden = false; $('[data-upl-cancel]', upl)!.hidden = false;
  btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-disabled', 'true');
  label.textContent = 'Subiendo… 0 %';
  card?.classList.add('is-busy'); lockOthers(form, true);
  const own = $$<HTMLInputElement>('input:not([type=hidden])', form); // its own fields too (§4.3, §6.8)
  const lockOwn = (on: boolean) => {
    for (const i of own) { if (on) i.setAttribute('aria-disabled', 'true'); else i.removeAttribute('aria-disabled'); i.readOnly = on; } // not disabled: FormData is built after this
    for (const d of $$('.drop', form)) d.classList.toggle('is-locked', on);
  };
  lockOwn(true);
  window.addEventListener('beforeunload', leaveGuard);
  const start = Date.now(); let said = 0;
  const finish = () => {
    uploading = null; upl.hidden = true; card?.classList.remove('is-busy'); lockOthers(form, false); lockOwn(false);
    btn.removeAttribute('aria-busy'); btn.removeAttribute('aria-disabled'); label.textContent = before;
    window.removeEventListener('beforeunload', leaveGuard);
  };
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.floor((e.loaded / e.total) * 100), secs = (Date.now() - start) / 1000, rate = e.loaded / Math.max(secs, 0.001);
    const left = (e.total - e.loaded) / rate;
    bar.value = pct; $('.upl__pct', upl)!.textContent = `${pct} %`; label.textContent = `Subiendo… ${pct} %`;
    $('.upl__sub', upl)!.textContent = `${mb(e.loaded)} MB de ${mb(e.total)} MB${secs > 1 && left > 0 ? ` · quedan unos ${left < 60 ? `${Math.max(1, Math.round(left))} s` : `${Math.round(left / 60)} min`}` : ''}`;
    const step = Math.floor(pct / 25) * 25;
    if (step > said) { said = step; say(`Subida al ${step} %`); } // milestones only, never every point
  };
  xhr.upload.onload = () => {
    bar.removeAttribute('value'); $('.upl__name', upl)!.textContent = PROCESSING[kind] ?? 'Procesando el archivo…';
    $('.upl__pct', upl)!.textContent = ''; $('.upl__sub', upl)!.textContent = ''; $('[data-upl-cancel]', upl)!.hidden = true;
    say('Procesando el archivo');
  };
  xhr.onload = () => {
    finish();
    if (xhr.status === 413) return fail(form, '413'); // the proxy's limit
    if (xhr.status === 408) return fail(form, 'net'); // a proxy's time limit: the file is still chosen, «Reintentar» works
    if (xhr.status >= 500) return fail(form, '500');
    let to = '/'; try { to = JSON.parse(xhr.responseText).to || '/'; } catch { /* not JSON */ }
    go(to);
  };
  xhr.onerror = xhr.ontimeout = () => { finish(); fail(form, 'net'); };
  xhr.onabort = () => { finish(); toast('info', 'Nada cambió en la web.', 'Subida cancelada.'); say('Subida cancelada.'); btn.focus(); };
  $('[data-upl-cancel]', upl)!.onclick = () => xhr.abort();
  $('[data-upl-retry]', form)!.onclick = () => { if (!uploading && validate(form)) upload(form); };
  xhr.open('POST', form.action);
  xhr.setRequestHeader('X-Panel-Xhr', '1'); // the server answers 200 {to} instead of a 303 that XHR would follow silently
  xhr.send(new FormData(form)); // DOM order keeps _csrf first
}

// ---------- every form submit goes through here ----------
doc.addEventListener('submit', async (e) => {
  const form = e.target as HTMLFormElement, submitter = (e as SubmitEvent).submitter as HTMLElement | null;
  if (form.method === 'dialog') return;
  if (uploading) { e.preventDefault(); return; } // its buttons are aria-disabled meanwhile
  if (form.matches('[data-login]')) return loginSubmit(e, form);
  if (form.dataset.confirmed) { delete form.dataset.confirmed; return; } // confirmed: the native post goes ahead
  const isUpload = form.matches('[data-upload]');
  if (!isUpload && !form.matches('[data-confirm]')) return;
  e.preventDefault();
  if (isUpload && !validate(form)) return;
  if (form.matches('[data-confirm]') && !(await confirmWith(form, versionVars(form)))) return;
  if (isUpload) return upload(form);
  form.dataset.confirmed = '1'; form.requestSubmit(submitter && (submitter as HTMLButtonElement).form === form ? submitter : undefined);
});

// ---------- copy the SHA-256 (§6.15) ----------
for (const b of $$<HTMLButtonElement>('button[data-copy]')) {
  if (!navigator.clipboard) continue;
  b.hidden = false;
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy!); } catch { return; }
    const t = $('span', b)!; t.textContent = 'Copiada'; say('Huella copiada.'); toast('info', 'Huella copiada.');
    setTimeout(() => { t.textContent = 'Copiar huella'; }, 2000);
  });
}

// ---------- login (§6.1) ----------
const loginForm = $<HTMLFormElement>('form[data-login]');
function loginSubmit(e: Event, form: HTMLFormElement) {
  const email = $<HTMLInputElement>('#email', form)!, pw = $<HTMLInputElement>('#password', form)!, code = $<HTMLInputElement>('#code', form)!;
  const v = email.value.trim(), digits = code.value.replace(/\D/g, '');
  const errs: [HTMLInputElement, string | null][] = [
    [email, !v ? 'Escribe tu correo.' : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? 'Revisa el correo: le falta la @ o el dominio.' : null],
    [pw, pw.value ? null : 'Escribe tu contraseña.'],
    [code, digits.length === 6 ? null : 'El código tiene 6 números.'],
  ];
  for (const [i, t] of errs) setError(i, t);
  const first = errs.find(([, t]) => t);
  if (first) { e.preventDefault(); first[0].focus(); return; }
  code.value = digits; pw.type = 'password';
  const btn = $<HTMLButtonElement>('[data-submit]', form)!;
  btn.setAttribute('aria-busy', 'true'); $('[data-submit-text]', btn)!.textContent = 'Verificando…';
  setTimeout(() => { btn.disabled = true; }); // after the submission has started: no double post
}
if (loginForm) {
  loginForm.noValidate = true;
  const code = $<HTMLInputElement>('[data-otp]', loginForm);
  code?.addEventListener('input', () => { const d = code.value.replace(/\D/g, ''); if (d !== code.value) code.value = d; }); // «123 456» pasted works
  for (const b of $$<HTMLButtonElement>('[data-reveal-for]', loginForm)) {
    const input = $<HTMLInputElement>(`#${b.dataset.revealFor}`)!;
    b.hidden = false;
    b.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.textContent = show ? 'Ocultar' : 'Mostrar';
      b.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });
  }
  for (const hint of $$('[data-caps-for]', loginForm)) {
    const input = $<HTMLInputElement>(`#${hint.dataset.capsFor}`)!;
    const check = (e: KeyboardEvent) => { const on = !!e.getModifierState?.('CapsLock'); if (on && hint.hidden) say('Bloq Mayús está activado.'); hint.hidden = !on; };
    input.addEventListener('keydown', check); input.addEventListener('keyup', check);
    input.addEventListener('blur', () => { hint.hidden = true; });
  }
  window.addEventListener('pageshow', () => { // back/forward cache: the button must work again
    const btn = $<HTMLButtonElement>('[data-submit]', loginForm)!;
    btn.disabled = false; btn.removeAttribute('aria-busy'); $('[data-submit-text]', btn)!.textContent = 'Entrar al panel';
  });
}

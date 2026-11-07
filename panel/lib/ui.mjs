// Server-rendered HTML. The panel ships no JavaScript to the browser, so a strict CSP (script-src 'none') can be used.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const css = `
:root{--blue:#046bd2;--navy:#0f346e;--ink:#1e293b;--mist:#f0f5fa;--line:#dbe4ef}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--mist)}
header{background:var(--navy);color:#fff;padding:.9rem 1.2rem;display:flex;gap:1rem;align-items:center;justify-content:space-between;flex-wrap:wrap}
header b{letter-spacing:.04em}header form{margin:0}header a{color:#bcdcff;margin-right:1rem}
main{max-width:1180px;margin:0 auto;padding:1.5rem 1.2rem 4rem}
h1{font-size:1.5rem;margin:.2rem 0 1rem}h2{font-size:1.15rem;margin:2.2rem 0 .8rem;color:var(--navy)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:1rem}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:.9rem;display:grid;gap:.5rem;align-content:start}
.card img,.card video{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;background:#e8eef6}
.muted{color:#64748b;font-size:.82rem}.path{font-family:ui-monospace,Consolas,monospace;font-size:.78rem;color:#64748b;word-break:break-all}
button,.btn{background:var(--blue);color:#fff;border:0;border-radius:10px;padding:.6rem 1rem;font:inherit;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:#fff;border:1px solid #ffffff55}button.sec{background:#e8eef6;color:var(--navy)}
input[type=file],input[type=text],input[type=email],input[type=password],input[type=date]{width:100%;padding:.55rem .7rem;border:1px solid var(--line);border-radius:10px;font:inherit;background:#fff}
label{display:grid;gap:.25rem;font-weight:600;font-size:.85rem}form.stack{display:grid;gap:.7rem}
.flash{padding:.8rem 1rem;border-radius:10px;margin-bottom:1rem;font-weight:600}.ok{background:#dcfce7;color:#14532d}.err{background:#fee2e2;color:#7f1d1d}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}td,th{padding:.55rem .7rem;border-bottom:1px solid var(--line);text-align:left;font-size:.85rem}
.login{max-width:380px;margin:12vh auto;background:#fff;padding:1.6rem;border-radius:16px;border:1px solid var(--line)}
.tag{display:inline-block;background:#dbeafe;color:#1e3a8a;border-radius:999px;padding:.1rem .6rem;font-size:.75rem;font-weight:700}
`;

export const layout = ({ title, body, user, csrf }) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} · Panel Experts DDT</title><style>${css}</style></head><body>
${user ? `<header><b>Experts DDT · Panel de contenido</b><span><a href="/">Contenido</a><a href="/history">Historial</a>${esc(user)} <form method="post" action="/logout" style="display:inline"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="ghost" type="submit">Salir</button></form></span></header>` : ''}
<main>${body}</main></body></html>`;

export const loginPage = (flash) => layout({ title: 'Ingresar', body: `<form class="login stack" method="post" action="/login" autocomplete="on">
<h1>Panel de contenido</h1>${flash ? `<p class="flash err">${esc(flash)}</p>` : ''}
<label>Correo<input type="email" name="email" required autocomplete="username"></label>
<label>Contraseña<input type="password" name="password" required autocomplete="current-password"></label>
<label>Código de 6 dígitos (app de autenticación)<input type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></label>
<button type="submit">Entrar</button></form>` });

const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const fmt = (d) => (d ? new Date(d).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function dashboard({ user, csrf, flash, siteUrl, items, libs }) {
  const form = (slot, accept, extra = '') => `<form class="stack" method="post" action="/upload/slot" enctype="multipart/form-data"><input type="hidden" name="_csrf" value="${esc(csrf)}"><input type="hidden" name="slot" value="${esc(slot.id)}"><label>Nuevo archivo<input type="file" name="file" accept="${accept}" required></label>${extra}<button type="submit">Reemplazar</button></form>`;
  const media = (s) => {
    const url = `${siteUrl}/${s.path}?v=${s.mtime || 0}`;
    const meta = `<span class="muted">${s.size ? `${kb(s.size)} · ${fmt(s.mtime)}` : 'Aún no está en el servidor'}</span><span class="path">/${esc(s.path)}</span>`;
    if (s.kind === 'image') return `<div class="card">${s.size ? `<img src="${esc(url)}" alt="" loading="lazy">` : ''}<b>${esc(s.label)}</b>${meta}${form(s, 'image/webp,image/png,image/jpeg')}</div>`;
    if (s.kind === 'video') return `<div class="card">${s.size ? `<video src="${esc(url)}" ${s.poster ? `poster="${esc(`${siteUrl}/${s.poster}?v=${s.mtime}`)}"` : ''} controls preload="none" muted></video>` : ''}<b>${esc(s.label)}</b>${meta}${form(s, 'video/mp4', s.poster ? '<label>Imagen de portada (opcional)<input type="file" name="poster" accept="image/webp,image/png,image/jpeg"></label>' : '')}</div>`;
    return `<div class="card"><b>${esc(s.label)}</b>${meta}${s.size ? `<a href="${esc(url)}" target="_blank" rel="noopener">Ver el archivo actual</a>` : ''}${form(s, 'application/pdf')}</div>`;
  };
  const cur = libs.latest;
  const versions = libs.versions.map((v) => `<tr><td>${esc(v.version)}${cur?.file === v.file ? ' <span class="tag">activa</span>' : ''}</td><td>${esc(v.dataDate)}</td><td>${kb(v.bytes)}</td><td>${v.files}</td><td>${cur?.file === v.file ? '' : `<form method="post" action="/libraries/activate"><input type="hidden" name="_csrf" value="${esc(csrf)}"><input type="hidden" name="file" value="${esc(v.file)}"><button class="sec" type="submit">Activar</button></form>`}</td></tr>`).join('');
  return layout({ title: 'Contenido', user, csrf, body: `<h1>Contenido del sitio</h1>${flash ? `<p class="flash ${flash.type === 'ok' ? 'ok' : 'err'}">${esc(flash.text)}</p>` : ''}
<p class="muted">Los cambios se ven en la web en cuanto termina la subida (el navegador puede tardar hasta un día en olvidar la imagen anterior). Cada reemplazo guarda una copia de seguridad.</p>
<h2>Librerías Exocad gratuitas</h2>
<div class="card">${cur ? `<b>Versión activa: ${esc(cur.version)}</b><span class="muted">Datos del ${esc(cur.dataDate)} · ${kb(cur.bytes)} · ${cur.files ?? '?'} archivos · sha256 ${esc(String(cur.sha256 || '').slice(0, 12))}…</span>` : '<b>Todavía no hay una versión publicada</b>'}
<form class="stack" method="post" action="/upload/libraries" enctype="multipart/form-data"><input type="hidden" name="_csrf" value="${esc(csrf)}">
<label>Versión (por ejemplo 11)<input type="text" name="version" required pattern="v?[0-9]{1,3}" maxlength="4"></label>
<label>Fecha de los datos<input type="date" name="dataDate" required></label>
<label>Archivo .zip<input type="file" name="file" accept=".zip,application/zip" required></label>
<button type="submit">Publicar nueva versión</button></form>
${versions ? `<table><thead><tr><th>Versión</th><th>Fecha</th><th>Tamaño</th><th>Archivos</th><th></th></tr></thead><tbody>${versions}</tbody></table>` : ''}</div>
<h2>Documentos</h2><div class="grid">${items.filter((s) => s.kind === 'document').map(media).join('')}</div>
<h2>Imágenes</h2><div class="grid">${items.filter((s) => s.kind === 'image').map(media).join('')}</div>
<h2>Videos</h2><div class="grid">${items.filter((s) => s.kind === 'video').map(media).join('')}</div>` });
}

export const historyPage = ({ user, csrf, rows }) => layout({ title: 'Historial', user, csrf, body: `<h1>Historial de cambios</h1><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(fmt(r.ts))}</td><td>${esc(r.user)}</td><td>${esc(r.action)}</td><td>${esc(r.detail)}</td></tr>`).join('')}</tbody></table>` });

# Panel de contenido · Experts DDT — Diseño final

> **Fuente única de verdad** para construir el panel de `admin.expertsddt.com` con Astro. Fecha: 7 nov 2026.
>
> **Base:** propuesta «Navy Backstage», la de mayor puntuación combinada de los dos jueces (82). **Injertos:** de «Wizard tranquilo» vienen el deshacer y las versiones anteriores, la frase de consecuencia antes de publicar, los resultados dentro de la tarjeta, los datos de «dónde aparece» y los arreglos de datos. De «Consola Navy» vienen la recarga tras una subida con progreso, la comprobación de origen detrás del proxy, las fechas de datos en UTC, los iconos SVG en lugar de flechas de texto y las vistas previas sin recorte. **Todos los mustFix están resueltos**; el Anexo A dice dónde.
>
> La prosa está en español. Tokens, clases, rutas y archivos van en inglés. Los textos de la interfaz tutean.

**Datos reales usados en los ejemplos** (leídos del repositorio el 7 nov 2026):

- Librería activa: v10, 24 872 754 bytes (23.7 MB), 35 archivos, datos del 6 nov 2026.
- Guía PDF: 172 KB.
- `panel/slots.json`: 15 imágenes y 6 videos.
- `shop.expertsddt.com` es la tienda Shopify (CNAME a `xg6mcx-9e.myshopify.com`). Hoy redirige a `/password`, así que la tienda sigue cerrada.

---

## 1. Concepto y principios

### Concepto

El panel es la trastienda de expertsddt.com y está hecho con piezas que el equipo ya ve en la web:

- la franja navy de las páginas internas, con su brillo azul y la retícula de 64 px;
- los números calados 01–04 y las píldoras de salto de Servicios;
- el disco cónico de la página de librerías y la franja de la guía PDF;
- las tarjetas de 22 px y los botones píldora con destello.

Bajo la franja, la página es serena: lienzo neblina, tarjetas blancas, Poppins y cifras tabulares. Cada archivo reemplazable es una tarjeta. Primero enseña lo publicado y dónde aparece, y luego ofrece una sola acción. Antes de publicar se ven lado a lado la versión actual y la nueva, con una frase que dice qué cambiará. Después, el resultado aparece en la misma tarjeta, junto con la forma de volver atrás.

Todo funciona con formularios y redirecciones. JavaScript solo añade arrastrar y soltar, la vista previa, la barra de progreso, los diálogos y el cambio de tema.

### Principios

1. **La misma empresa.** Solo se usan los tokens, la tipografía, el logo y los recursos del sitio. Nada de plantillas de administrador: ni barra lateral, ni tarjetas de KPI tipo SaaS, ni librerías de UI.
2. **Primero el estado, después la acción.** Cada tarjeta enseña, antes del botón, el archivo publicado, su peso, su fecha y dónde aparece.
3. **Una acción obvia por tarjeta.** Lo técnico (rutas, SHA-256, formatos) va en «Detalles técnicos», cerrado por defecto.
4. **La consecuencia antes y la salida después.**
   - Encima de cada botón de publicar, una frase dice qué cambia.
   - Cada éxito ofrece «Deshacer» o «Volver a la v10».
   - Cada error termina con «Nada cambió en la web.»
5. **Sin JavaScript no se pierde nada.** El recorrido es formulario HTML → 303 → aviso en la página. JS mejora la experiencia, nunca la sustituye.
6. **Accesibilidad medida, no supuesta.** WCAG 2.2 AA en claro y en oscuro, con contrastes calculados (§8), uso completo con teclado, 375 px y movimiento reducido. MiniOS fuerza `prefers-reduced-motion` en la máquina de Diego.
7. **Lo mínimo que funcione.** Se conservan las rutas, las 18 pruebas, `lib/auth.mjs`, `lib/files.mjs` y la CLI. Lo nuevo es pequeño y está listado en §9.5.

---

## 2. Lenguaje visual

### 2.1 De dónde salen los tokens

- `panel/src/layouts/*.astro` importa **primero** `../../../src/styles/global.css` (el archivo del sitio, sin copiarlo) y **después** `panel/src/styles/panel.css`. Para el sitio no cambia nada.
- `panel.css` solo añade tokens y corrige contraste AA. No redefine colores de marca.
- **Regla de cascada.** `:root` y `[data-theme="dark"]` tienen la misma especificidad, así que gana el que va después. Por eso `panel.css` lleva un bloque claro en `:root` y uno oscuro en `:root[data-theme="dark"]`.
  - Todo token que el panel sobrescribe en `:root` y que global.css cambia en oscuro (hoy solo `--muted`) se vuelve a declarar en el bloque oscuro.
  - Sin esto, `--muted` se quedaría en #5b6b82 en oscuro (3.30:1, falla).

**Tokens del sitio que el panel usa tal cual** (global.css):

| Token | Claro | Oscuro | Uso en el panel |
|---|---|---|---|
| `--blue` | #046bd2 | #046bd2 | botón primario; en claro, enlaces, foco y cejas |
| `--blue-dark` | #045cb4 | #045cb4 | en claro, texto de etiquetas y píldoras; final de `--grad-blue` |
| `--blue-mid` / `--navy` | #2a7abf / #1d3273 | igual | disco de versión |
| `--navy-deep` | #0f346e | igual | barra, franja superior, login, avisos flotantes, tarjeta de versión |
| `--ink` | #1e293b | #eef2f8 | títulos y valores |
| `--slate` | #334155 | #b5c2d8 | texto corrido |
| `--mist` / `--surface` | #f0f5fa / #ffffff | #101d3a / #0b1630 | solo a través de `--canvas`, `--card` y `--well` |
| `--line` | #d1d5db | #24345a | solo divisores. Nunca como borde de un control en claro (1.47:1) |
| `--grad-blue` | 135deg #046bd2→#045cb4 | igual | `.btn--primary`, mosaicos de icono, avatar; relleno de progreso en claro |
| `--grad` | 160deg #2a7abf→#1d3273 | igual | **nunca detrás de texto** (blanco da 4.53 y #e4ecf9 da 3.81) |
| `--radius` | 22px (18px a ≤560) | igual | tarjetas |
| `--font` | 'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif | igual | todo el panel |
| `--ease-out` | cubic-bezier(.16,1,.3,1) | igual | transiciones |
| `color-scheme` | light | dark | controles nativos (fecha, archivo, barras de desplazamiento) |

**Tokens del panel** (`panel/src/styles/panel.css`, se carga después de global.css):

```css
:root {
  --muted: #5b6b82;                 /* el #64748b del sitio da 4.34:1 sobre neblina */
  --canvas: #f0f5fa;                /* fondo de página */
  --card: #ffffff;                  /* tarjetas */
  --well: #f0f5fa;                  /* zonas de soltar, marcos de vista previa, cajas dentro de tarjetas */
  --card-line: rgba(29,50,115,.06); /* borde de tarjeta (= .card del sitio) */
  --field: #7c8aa0;                 /* borde de inputs y zonas de soltar: 3.50 / 3.19 */
  --focus: #046bd2;
  --link: #046bd2;
  --pill-fg: #045cb4;  --pill-bg: rgba(4,107,210,.08);
  --ok: #15803d;   --ok-bg: #ecfdf3;   --ok-line: #bbf7d0;
  --err: #b91c1c;  --err-bg: #fef2f2;  --err-line: #fecaca;
  --warn: #92400e; --warn-bg: #fffbeb; --warn-line: #fde68a;
  --track: #dbe5f1; --fill: var(--grad-blue);
  --numeral: rgba(4,107,210,.4);
  --shadow-card: 0 1px 2px rgba(15,52,110,.06), 0 24px 48px -28px rgba(15,52,110,.35);
  --shadow-lift: 0 30px 60px -30px rgba(15,52,110,.5);
  --shadow-pop: 0 40px 100px -30px rgba(0,0,0,.6);
  --shadow-toast: 0 24px 60px -20px rgba(0,0,0,.5);
  --bar-h: 68px;
  --mono: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  /* superficies navy: iguales en los dos temas */
  --n-bg: #0f346e; --n-deep: #0a1a3a;
  --n-text: #c7d6ee; --n-strong: #ffffff; --n-label: #8fc1ff; --n-accent: #6fb6ff; --n-glass-text: #dbe7f7;
  --n-link: #bcdcff;                /* enlaces sobre navy: 8.53 plano, 6.09 sobre el brillo */
  --n-glass: rgba(10,26,58,.45); --n-glass-line: rgba(255,255,255,.14); --n-focus: #8fc1ff;
  --n-glow: radial-gradient(60% 80% at 80% 20%, rgba(4,107,210,.40), transparent 60%);
}
:root[data-theme="dark"] {
  --muted: #8fa0bd;
  --canvas: #0b1630;
  --card: #101d3a;                  /* en oscuro la tarjeta es más clara que el lienzo: la elevación se lee bien */
  --well: #0b1630;
  --card-line: #24345a;
  --field: #5b74a6;                 /* 3.57 sobre tarjeta, 3.84 sobre lienzo */
  --focus: #6fb6ff;
  --link: #6fb6ff;
  --pill-fg: #8fc1ff;  --pill-bg: rgba(111,182,255,.14);
  --ok: #86efac;   --ok-bg: rgba(34,197,94,.12);   --ok-line: rgba(134,239,172,.35);
  --err: #fca5a5;  --err-bg: rgba(239,68,68,.12);  --err-line: rgba(252,165,165,.35);
  --warn: #fcd34d; --warn-bg: rgba(245,158,11,.12); --warn-line: rgba(252,211,77,.35);
  --track: #24345a; --fill: #6fb6ff;  /* --grad-blue sobre #24345a da 2.36: falla */
  --numeral: rgba(111,182,255,.75);
  --shadow-card: 0 24px 48px -28px rgba(0,0,0,.6);
  --shadow-lift: 0 30px 60px -30px rgba(0,0,0,.7);
}
body { background: var(--canvas); }
.card { background: var(--card); border-color: var(--card-line); box-shadow: var(--shadow-card); }
:focus-visible { outline-color: var(--focus); }
.on-navy :focus-visible { outline-color: var(--n-focus); }
```

**Brillo navy.** El sitio usa dos brillos en `.page-hero`: arriba a la derecha a .55, y abajo a la izquierda. El panel usa **uno solo**, `--n-glow` a .40, arriba a la derecha:

- Con .55, #8fc1ff baja a 4.06:1 en el centro del brillo.
- El brillo de abajo a la izquierda cae justo debajo de las píldoras de salto.

Regla de colocación en las franjas:

- El texto pequeño #8fc1ff o #6fb6ff (cejas, números) va solo en la mitad izquierda, fuera del brillo.
- Los enlaces sobre navy usan `--n-link` (#bcdcff), que da ≥6.09 en cualquier punto.
- En la mitad derecha solo hay vidrio oscuro con texto #fff o #dbe7f7.

### 2.2 Tipografía

Se usa Poppins autoalojada con `@fontsource/poppins` (latin 400/500/600/700/800), importada como en `Base.astro`. Se precargan los woff2 de 400 y 800. No hay segunda familia: la monoespaciada es la del sistema y solo aparece en «Detalles técnicos».

| Rol | Clase | Tamaño / interlineado | Peso | Color |
|---|---|---|---|---|
| Título de página (en la franja) | `.h-xl` | clamp(1.85rem,4.6vw,3.4rem) / 1.08; a ≤560 clamp(1.8rem,8vw,2.4rem) | 800 | #fff; palabra acento #6fb6ff |
| Título de sección | `.h-lg` | clamp(1.4rem,3vw,2.2rem) / 1.08 | 700 | `--ink` |
| Título de tarjeta | `.card-t` | 1.15rem / 1.3; tarjeta navy 1.5rem | 700 | `--ink`; #fff en navy |
| Título de archivo | `.slot__title` | 1.05rem / 1.3 | 700 | `--ink` |
| Entradilla | `.lead` | clamp(1.05rem,1.4vw,1.25rem) / 1.65 | 400 | `--slate`; #c7d6ee en navy |
| Texto | `body` | 1rem / 1.65 (.95rem dentro de tarjetas) | 400 | `--slate` |
| Etiqueta de campo | `label` | .85rem | 600 | `--ink` |
| Ayuda y metadatos | `.hint`, `.meta` | .85rem / 1.5 | 400 | `--muted` |
| Ceja | `.eyebrow` (del sitio) | .78rem (.72rem a ≤560), .18em, mayúsculas, raya de 28×2 px | 600 | `--blue`; #6fb6ff en oscuro; #8fc1ff en navy |
| Micro-etiqueta | `.micro` | .72rem, .14em, mayúsculas | 600 | `--muted`; #dbe7f7 sobre vidrio |
| Botón | `.btn` (del sitio) | .95rem; `.btn--sm` .85rem | 600 | — |
| Píldora y chip | `.pill`, `.chip` | .75rem, .06em, mayúsculas | 600 | según el tono |
| Etiqueta «dónde aparece» | `.tags li` | .8rem | 600 | `--pill-fg` sobre `--pill-bg` |
| Número de sección calado | `.snum` | 3.5rem / .8 (2.6rem a ≤960); trazo 1.5px `--numeral` | 800 | transparente |
| Número de paso calado | `.step-n` | 2rem / 1; trazo 1.5px `--numeral` | 800 | transparente |
| Monoespaciada | `.mono` | .8rem | 400 | `--muted` |

- Tamaños, fechas, versiones, porcentajes y horas llevan `font-variant-numeric: tabular-nums`.
- **Glifos.** El subconjunto latin de Poppins no trae → ↗ ↓ ⓘ ✓ ▾. Todas las flechas, marcas e iconos son SVG (§2.6). Sí trae « » · × … –.
- Por eso el panel no usa la clase `.note` del sitio: su `::before` pinta ⓘ con la fuente del sistema. En su lugar usa `.hint` con un icono SVG.

### 2.3 Espaciado, rejilla y radios

- **Escala:** .25 · .5 · .75 · 1 · 1.25 · 1.5 · 2 · 2.5 · 3 · 4 rem.
- **Contenedor:** el `.wrap` del sitio, `min(1200px, 100% - 2rem)`, o `100% - 2.5rem` a ≤560. El margen lateral siempre es de al menos 16 px.
- **Secciones:** `padding-block: clamp(2.5rem, 5vw, 4rem)`. El 4–8.5rem del sitio es demasiado aire para una herramienta. Del encabezado al contenido hay 2rem.
- **Tarjetas:** padding de 1.5rem (1.25rem a ≤560). Las tarjetas de archivo tienen la imagen a sangre y el cuerpo con `1.1rem 1.25rem 1.25rem`.
- **Separaciones de rejilla:** 1.5rem (1rem a ≤560). En formularios: 1rem entre campos, .4rem de la etiqueta al control y .35rem del control a la ayuda.
- **Puntos de corte:**

  | Ancho | Qué cambia |
  |---|---|
  | 1180 | enlaces de sección en la barra |
  | 960 | franja, librerías y login a una columna; números calados a 2.6rem |
  | 760 | la barra deja de ser fija; aparece la fila de pestañas |
  | 560 | tarjetas de archivo en fila compacta, botones a todo el ancho, radio 18 |

- **Rejillas:**

  | Rejilla | Columnas | Notas |
  |---|---|---|
  | Imágenes | `repeat(auto-fill, minmax(min(100%, 17.5rem), 1fr))` | `align-items: start`, para que una tarjeta abierta no estire a sus vecinas |
  | Antes y después | `repeat(2, minmax(0,1fr))` a ≥760 | cada pareja queda alineada |
  | Videos | `minmax(min(100%, 20rem), 1fr)` | |
  | Librerías | `7fr 5fr` | debajo, la lista de versiones a todo el ancho |

- **Radios:**

  | Radio | Elementos |
  |---|---|
  | 999px | botones, píldoras, chips, pestañas, barra de progreso |
  | 12px | inputs, miniaturas, avisos, cajas internas |
  | 16px | zonas de soltar |
  | 18px | vidrio, avisos flotantes, filas de versión |
  | 22px | tarjetas (`--radius`; 18 a ≤560) |
  | 24px | tarjeta navy, diálogo, tarjeta de login |

### 2.4 Sombras

| Token | Valor | Dónde |
|---|---|---|
| `--shadow-card` | la de `.card` del sitio (oscuro: `0 24px 48px -28px rgba(0,0,0,.6)`) | todas las tarjetas |
| `--shadow-lift` | la de `.img-frame` del sitio | tarjeta navy de versión |
| `--shadow-pop` | la de `.lib-dialog` | diálogo de confirmación, tarjeta de login |
| `--shadow-toast` | la de `.consent` | avisos flotantes |
| brillo de botón | `0 10px 30px -10px rgba(4,107,210,.7)` (el del sitio) | `.btn--primary` |
| disco | `0 30px 60px -30px rgba(4,107,210,.9), inset 0 0 0 10px rgba(255,255,255,.06)` | disco de versión |

### 2.5 Superficies

1. **Franja navy** (`section.page-hero.phero.on-navy`). Usa la receta de `.page-hero` con `::before` sustituido por `--n-glow`, más `.grid-bg` (líneas de 64 px a .06, opacidad .35, máscara radial).
   - Padding: `clamp(2rem,4vw,3rem) 0 clamp(2.5rem,5vw,3.5rem)`. Anula el `calc(var(--nav-h) + 4rem)` del sitio, que asume una barra superpuesta.
   - En oscuro lleva `border-bottom: 1px solid rgba(143,193,255,.12)`, porque el navy sobre #0b1630 solo da 1.48:1.
2. **Lienzo** (`--canvas`). Es uno solo en toda la página, sin alternar secciones. Las secciones se separan con espacio, el número calado y el título.
3. **Tarjeta** (`.card`). Fondo `--card`, borde de 1px `--card-line`, `--shadow-card` y radio de 22 px. No se eleva al pasar el ratón: no es un enlace.
4. **Tarjeta navy destacada** (`.vcard`, versión activa). Fondo `--n-bg` plano, un solo brillo `radial-gradient(50% 70% at 100% 0, rgba(4,107,210,.40), transparent 60%)` en la esquina, radio de 24 px y `--shadow-lift`.
   - Dentro solo hay texto #fff, #dbe7f7 y #c7d6ee (≥5.87 en el peor punto) y botones `.btn--white` y `.btn--ghost`.
   - No lleva texto pequeño #8fc1ff ni #6fb6ff, ni nada sobre `--grad`.
5. **Vidrio oscuro** (`.glass`, resumen de la franja y lista del login). `--n-glass`, borde de 1px `--n-glass-line`, `backdrop-filter: blur(12px)` (sin soporte, cae a `rgba(10,26,58,.7)`), radio de 18 px.
   - Valores en #fff y etiquetas en #dbe7f7: 9.06:1 incluso sobre el centro del brillo.
   - **No** se usa el vidrio claro del sitio (`.portal__feature`): su #b9c8e2 baja a 3.4 sobre el brillo.
6. **Diálogo** (`dialog.dlg`). Copia `.lib-dialog`: radio de 24 px, `width: min(480px, 100% - 2rem)`, fondo `--card`, `--shadow-pop` y `::backdrop rgba(10,26,58,.62) + blur(4px)`. En oscuro suma un borde de 1px `--card-line`.
7. **Aviso flotante** (`.toast`). Fondo #0f346e en los dos temas, borde de 1px rgba(143,193,255,.22), radio de 18 px, `--shadow-toast` y texto #c7d6ee. Solo aparece en eventos del navegador (§6.13).
8. **Pie** (`.pfoot`). Fondo #0a1a3a, texto #9fb3d4 (8.08), palabra fantasma «EXPERTS DDT» (receta de `.footer__ghost` a `clamp(3rem,12vw,8rem)`). En oscuro lleva borde superior de 1px rgba(143,193,255,.12).
9. **Escenarios de vista previa** (`.stage--*`):

   | Escenario | Valor | Para |
   |---|---|---|
   | `--well` | por defecto | fotos opacas |
   | `navy` | `radial-gradient(circle at 55% 42%, #1d63bf 0%, #0f346e 45%, #0a1a3a 80%)`, el `.pillar__media--product` del sitio | recortes transparentes que en la web van sobre fondo oscuro |
   | `mist` | `var(--mist)`, como `.section--mist` en cada tema | el escaneo facial decorativo |
   | `dark` | #0a1a3a | videos |

   Todos los marcos llevan borde de 1px `--card-line`.

### 2.6 Iconos

- Son SVG en línea desde `src/components/Icon.astro`, un mapa de nombre a trazado.
- Mismo trazo que los iconos de `Base.astro`: `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`, siempre con `aria-hidden="true" focusable="false"`.
- **Tamaños:** 16 en botones pequeños, 18 en botones y barra, 20 en mosaicos de 44, 22 en mosaicos de 56, 14 en chips y mensajes de campo.
- **Mosaico de icono:** el `.portal__feature i` del sitio, de 44 px, radio de 12 px, `--grad-blue` y trazo blanco. Variantes de 56/16 (PDF y zonas de soltar grandes) y 48/14 (diálogos).
- Los trazados son de Lucide (licencia ISC) y se copian; no se instala ningún paquete. `upload` y `package` son del sitio.

| Nombre | Uso | Trazado |
|---|---|---|
| `upload` | reemplazar, zonas de soltar | `M12 16V4M7 9l5-5 5 5M4 20h16` (del sitio) |
| `package` | librerías | `M12 2l8 4.5v9L12 20l-8-4.5v-9zM12 20v-9M4 6.5l8 4.5 8-4.5` (del sitio) |
| `image` | imágenes | `<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>` |
| `film` | videos | `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4"/>` |
| `file-text` | guía PDF | `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>` |
| `clock` | historial, «En la web desde» | `<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>` |
| `check` | chips Activa y Recién actualizado, comprobaciones | `<path d="M20 6 9 17l-5-5"/>` |
| `check-circle` | aviso de éxito | `<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>` |
| `alert-circle` | aviso de error, errores de campo | `<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>` |
| `alert-triangle` | advertencias, Falta | `<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z"/><path d="M12 9v4M12 17h.01"/>` |
| `info` | avisos informativos, `.hint` | `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>` |
| `x` | cerrar diálogo o aviso, archivo rechazado | `<path d="M18 6 6 18M6 6l12 12"/>` |
| `chevron-down` | resúmenes desplegables (gira 180° al abrir) | `<path d="m6 9 6 6 6-6"/>` |
| `arrow-right` | botones de avanzar (sustituye →) | `<path d="M5 12h14M12 5l7 7-7 7"/>` |
| `external-link` | enlaces a la web (sustituye ↗) | `<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>` |
| `download` | descargar el zip (sustituye ↓) | `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>` |
| `rotate-ccw` | Deshacer, Volver a esta, Activar | `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>` |
| `copy` | copiar huella | `<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>` |
| `lock` | acceso pausado, Bloq Mayús | `<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>` |
| `shield-check` | verificación en dos pasos (login) | `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>` |
| `log-in` | historial: inició sesión | `<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>` |
| `log-out` | Salir; historial: cerró sesión | `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>` |
| `image-off` | archivo que falta, vista previa rota | `<path d="m2 2 20 20M10.4 10.4a2 2 0 1 1-2.8-2.8M13.5 13.5 6 21M18 12l3 3M3.6 3.6A2 2 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.6 0 1-.2 1.4-.6M21 15V5a2 2 0 0 0-2-2H9"/>` |
| `sun` / `moon` | cambio de tema | los de `Base.astro`, sin cambios |

### 2.7 Logo y recursos de marca

Todos los recursos se importan desde `public/` del sitio con `?url` (Vite los copia a `/_astro/` con hash). No se duplica ningún archivo.

| Superficie | Recurso | Tamaño |
|---|---|---|
| Barra (navy en los dos temas) | `img/brand/logo-light.webp` (761×96) | 26 px de alto; 22 px a ≤560 |
| Login y páginas de error (navy) | `logo-light.webp` | 30 px; 24 px a ≤560 |
| Pie (#0a1a3a) | `logo-light.webp` | 26 px |
| Pestaña del navegador | `favicon-32.png` | 32×32 |
| iOS | `apple-touch-icon.png` | — |
| `theme-color` | #0f346e | — |

- El logo solo aparece sobre navy, así que **no hace falta el cambio de logo** del sitio, y `logo.webp` no se usa.
- `mark.webp` no se usa como icono: iOS no acepta WebP en `apple-touch-icon`.
- `alt="Experts DDT"` en el logo de la barra. Es un enlace a `/` con el nombre «Experts DDT, inicio del panel».
- No hay fotos de archivo ni ilustraciones. Las únicas fotos son las del propio sitio, como vistas previas.

### 2.8 Movimiento

El panel tiene que verse terminado sin ningún movimiento: global.css lo anula todo con `prefers-reduced-motion` y MiniOS lo activa siempre.

| Efecto | Detalle |
|---|---|
| Botones | destello y elevación de -2px (comportamiento del sitio, `.35s var(--ease-out)`) |
| Desplegables | el chevron gira 180° en .25s |
| Avisos flotantes | entran de `translateY(16px)` a 0 con fundido en .4s |
| Diálogo | fundido y escala de .96 a 1 en .3s |
| Zona de soltar | `scale(1.01)` al arrastrar encima |
| Progreso | el valor se anima en .2s |
| Tarjeta recién cambiada | `:target` con contorno que se desvanece a los 3s |
| Disco | gira una vez (360° en 1.2s) cuando la versión se publicó hace menos de 10 minutos; es un guiño al disco que gira en la web |

Sin GSAP, sin Lenis, sin pantalla de carga, sin revelados al desplazar. El `scroll-behavior: smooth` solo se aplica dentro de `@media (prefers-reduced-motion: no-preference)`.

### 2.9 Claro y oscuro de un vistazo

- **Claro:** barra y franja navy, lienzo #f0f5fa, tarjetas blancas con sombra azulada, acentos #046bd2, etiquetas #045cb4 y números calados azul pálido.
- **Oscuro:** barra y franja navy iguales (más una línea fina debajo), lienzo #0b1630, tarjetas #101d3a con borde #24345a y sombras negras. Acentos, enlaces, foco y contornos en #6fb6ff, etiquetas en #8fc1ff y estados en tonos pastel (#86efac, #fca5a5, #fcd34d).
- **Iguales en los dos temas:** barra, franja, tarjeta de versión, disco, botones primarios, vidrio oscuro, avisos flotantes y pie. Así la marca no cambia con el tema.

---

## 3. Arquitectura de información y navegación

### 3.1 Rutas

Las rutas actuales **no cambian**, así que pruebas, marcadores y CLI siguen funcionando. Solo se añade `/restore`.

| Método y ruta | Qué es | Notas |
|---|---|---|
| GET `/login` | Iniciar sesión | única página sin sesión; con sesión válida redirige a `/` |
| POST `/login` | Verificar credenciales | 401/429 vuelve a pintar la página (sin redirección) con el correo conservado |
| GET `/` | Contenido | franja + 01–04 + «Bueno saber» |
| GET `/history?tipo=cambios\|accesos\|todo` | Historial | por defecto `cambios`; filtrado en el servidor |
| POST `/upload/slot` | Reemplazar imagen, video o PDF | multipart; `_csrf` va primero |
| POST `/upload/libraries` | Publicar versión de librerías | multipart; `_csrf` va primero |
| POST `/libraries/activate` | Activar una versión anterior | urlencoded |
| POST `/restore` | **Nuevo.** Volver a una versión anterior de un archivo | urlencoded: `_csrf`, `slot` y uno o más `file` |
| POST `/logout` | Salir | |
| 403 / 404 / 500 | Páginas de error con marca | `src/pages/404.astro`, `500.astro` y una vista 403 compartida |

**Anclas de `/`:**

- `#librerias`, `#documentos`, `#imagenes` y `#videos`;
- `#slot-<id>` en cada tarjeta;
- `#bueno-saber`;
- `#main` (destino del enlace para saltar al contenido).

No hay parámetro `next=`: tras entrar siempre se va a `/`.

### 3.2 Orden de la página «Contenido»

1. Barra.
2. Franja: saludo, entradilla, píldoras de salto y resumen.
3. Aviso de página, solo si el aviso no pertenece a una tarjeta.
4. **01 Librerías Exocad gratuitas:** versión activa, publicar una versión nueva y versiones publicadas.
5. **02 Documentos:** guía de servicios y tarifas.
6. **03 Imágenes:** «Páginas del sitio» (10), «Casos antes y después» (4) y «Al compartir en redes» (1).
7. **04 Videos:** 6.
8. Bueno saber.
9. Pie.

### 3.3 Navegación según el ancho

- **≥1180 px.** Barra fija (`position: sticky; top: 0`) de 68 px.
  - Izquierda: logo, divisor y micro-etiqueta «Panel».
  - Enlaces: «Librerías», «Documentos», «Imágenes», «Videos» (anclas de `/`), «Historial» y «Ver la web» (con icono externo).
  - Derecha: tema, avatar con nombre y «Salir».
- **761–1179 px.** Misma barra fija, pero los cuatro enlaces de sección se cambian por uno solo, «Contenido» (`/`). Las píldoras de la franja dan el salto a cada sección.
- **≤760 px.** La barra **deja de ser fija** para no comerse un 13 % de la pantalla del teléfono.
  - Fila 1 (60 px): logo, tema y «Salir» (solo icono a ≤400).
  - Fila 2: pestañas de 48 px a todo el ancho, «Contenido · Historial · Ver la web».
  - Es el mismo `<nav>`, que con `flex-wrap` baja a la segunda fila. Sin JS y sin menú hamburguesa.
- **Desplazamiento.** `html { scroll-padding-top: calc(var(--bar-h) + 1rem) }`, que a ≤760 baja a `1rem` porque la barra ya no es fija. Las anclas llevan además `scroll-margin-top` y el foco nunca queda debajo de la barra (2.4.11).
- **`aria-current="page"`:** en «Historial» dentro de `/history`, y en «Contenido» dentro de `/` cuando ese enlace es visible. Las anclas de sección no lo llevan; no hay scrollspy.

### 3.4 A dónde vuelve cada acción

| Acción | Éxito | Error |
|---|---|---|
| POST `/upload/slot` | 303 a `/#slot-<id>`: aviso ok dentro de la tarjeta, chip «Recién actualizado» y contorno `:target` | 303 a `/#slot-<id>`: aviso de error dentro de la tarjeta y su panel abierto |
| POST `/upload/libraries` | 303 a `/#librerias`: aviso ok (o «revísala» si el número de archivos cayó a menos de la mitad) encima de las tarjetas | 303 a `/#librerias`: aviso de error, con la versión y la fecha rellenadas otra vez |
| POST `/libraries/activate` | 303 a `/#librerias` + aviso ok con «Volver a la vX» | 303 a `/#librerias` + aviso de error |
| POST `/restore` | 303 a `/#slot-<id>` + aviso ok con «Deshacer» | 303 a `/#slot-<id>` + aviso de error |
| POST `/login` | 303 a `/` | se vuelve a pintar con 401 o 429 |
| POST `/logout` | 303 a `/login` + aviso info | 403 con marca |
| CSRF u origen inválidos | — | formulario normal: 403 con marca; XHR: 403 JSON `{to:"/"}` + aviso |
| Sesión caducada | — | GET o POST: 303 a `/login` + aviso info. XHR: 401 JSON `{to:"/login"}` + aviso |

Con la cabecera `X-Panel-Xhr: 1`, todas las rutas de subida responden **200 JSON `{"to": "..."}`** con la misma cookie de aviso, en vez del 303. El cliente usa ese `to` (§6.7).

---

## 4. Página por página

Leyenda de los wireframes:

- `[ ]` es un botón o un campo; `( )` es una píldora o un chip.
- `[↗]`, `[→]`, `[↓]`, `[⇪]`, `[⟲]` y `[✓]` son iconos SVG (§2.6), nunca glifos de texto.
- `╌` es un borde punteado.
- Los datos de ejemplo son reales cuando el repositorio los tiene: v10, 23.7 MB, 35 archivos, 172 KB.

### 4.1 Login (`/login`)

**Escritorio (≥960).** Es un `.page-hero` a pantalla completa (`min-height: 100svh`) con `--n-glow` detrás de la tarjeta, `.grid-bg` y la palabra fantasma.

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ [logo-light 30px]                                                                    (◐)   │
│                                                                                            │
│  ── PANEL DE CONTENIDO                              ┌─ .auth-card r24 · --shadow-pop ────┐ │
│  Tu sitio,                                          │ Iniciar sesión                (h1) │ │
│  siempre al día.        ← p.h-xl (no es un título); │ Solo para el equipo de Experts DDT.│ │
│                           «siempre al día» #6fb6ff  │ ┌ .alert (solo si hay) ──────────┐ │ │
│  Cambia fotos, videos y documentos de               │ │ (!) Credenciales inválidas.    │ │ │
│  expertsddt.com y publica las librerías Exocad,     │ │ Revisa el correo, la contra-   │ │ │
│  sin tocar código.                       (.lead)    │ │ seña y el código…              │ │ │
│                                                     │ └────────────────────────────────┘ │ │
│  ┌ .glass ─────────────────────────────────────┐    │ Correo electrónico                 │ │
│  │ [escudo] Verificación en dos pasos          │    │ [adela@expertsddt.com            ] │ │
│  │          Contraseña y código de tu teléfono.│    │ Contraseña              [Mostrar]  │ │
│  │ [⟲]      Siempre reversible                 │    │ [••••••••••••                    ] │ │
│  │          Cada archivo reemplazado se guarda.│    │ Código de verificación             │ │
│  │ [reloj]  Historial                          │    │ [ 1 2 3 4 5 6 ]   1.6rem, tabular  │ │
│  │          Cada cambio con fecha y autor.     │    │ Los 6 números de «ExpertsDDT       │ │
│  └─────────────────────────────────────────────┘    │ Panel» en tu app. Cambian cada 30 s│ │
│                                                     │ [        Entrar al panel  [→]    ] │ │
│                                                     │ ¿No tienes cuenta o cambiaste de   │ │
│                                                     │ teléfono? Escríbele a Diego o David│ │
│                                                     └────────────────────────────────────┘ │
│  © 2026 Fernando Polanco DDT LLC · Experts DDT                 [↗] Volver a expertsddt.com │
│ ░░░░░░░░░░░░░░░░░░░░░░░░  E X P E R T S   D D T   (fantasma)  ░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

Medidas:

- Rejilla `minmax(0,1fr) minmax(22.5rem, 27.5rem)`, gap `clamp(2rem,6vw,6rem)`, ancho `min(1120px, 100% - 2rem)`, centrado en vertical.
- Tarjeta: fondo `--card`, padding `clamp(1.5rem,4vw,2.25rem)`, radio de 24 px y `--shadow-pop`. En oscuro, borde de 1px `--card-line`.
- Enlaces sobre navy en `--n-link` (#bcdcff, subrayados).

**375 px.** Se ocultan la entradilla y la lista de vidrio. Los tres beneficios pasan a una línea de .8rem en #c7d6ee bajo la tarjeta.

```
┌───────────────────────────────────┐
│ [logo-light 24px]           (◐)   │
│ ── PANEL DE CONTENIDO             │
│ Tu sitio, siempre al día.         │  ≈1.8rem
│ ┌ .auth-card r18 · p 1.5rem ────┐ │
│ │ Iniciar sesión                │ │
│ │ Solo para el equipo de…       │ │
│ │ [alerta]                      │ │
│ │ Correo electrónico            │ │
│ │ [___________________________] │ │
│ │ Contraseña          [Mostrar] │ │
│ │ [___________________________] │ │
│ │ Código de verificación        │ │
│ │ [ 123456                    ] │ │  ancho completo a ≤560
│ │ Los 6 números de «ExpertsDDT… │ │
│ │ [     Entrar al panel  [→]  ] │ │  52 px, ancho completo
│ │ ¿No tienes cuenta o cambiaste │ │
│ │ de teléfono? Escríbele a…     │ │
│ └───────────────────────────────┘ │
│ Dos pasos · Reversible · Historial│
│ [↗] Volver a expertsddt.com       │
│ © 2026 Fernando Polanco DDT LLC   │
└───────────────────────────────────┘
```

**Estados del login:**

| Estado | Qué se ve | Foco al cargar | HTTP |
|---|---|---|---|
| Normal | tarjeta sin aviso | Correo (`autofocus`) | 200 |
| Enviando (JS) | botón «Verificando…» con spinner y `aria-busy="true"`, deshabilitado. Se rehabilita en `pageshow` (caché de atrás/adelante) | — | — |
| Credenciales inválidas | `.alert--err` con `role="alert"` y `id="login-alert"`; el correo se conserva, la contraseña y el código llegan vacíos | Contraseña, con `aria-describedby="login-alert"` | 401 |
| Acceso pausado | `.alert--warn` con icono `lock` | el aviso (`tabindex="-1"`) | 429 |
| Sesión terminada | `.alert--info` «Tu sesión terminó…» | Correo | 200 |
| Sesión terminada durante una subida | `.alert--info` con texto propio (§7) | Correo | 200 |
| Cerró sesión | `.alert--info` «Cerraste sesión. ¡Hasta pronto!» | Correo | 200 |
| Bloq Mayús (JS) | ayuda con icono `lock` en `--warn` bajo la contraseña, `role="status"` | — | — |
| Sin JS | no hay «Mostrar», ni aviso de Bloq Mayús, ni limpieza del código: el servidor quita los espacios | Correo | — |

El `<title>` lleva el resultado como prefijo («Error: Credenciales inválidas · Iniciar sesión · Panel Experts DDT»). Así un lector de pantalla lo oye al cargar, con o sin JS.

### 4.2 Contenido (`/`): marco y franja

**Escritorio (≥1180).**

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│[logo]│PANEL  Librerías Documentos Imágenes Videos  Historial  Ver la web[↗]  (◐) (AD) Adela [Salir]│ .bar 68 px, fija
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ── PANEL DE CONTENIDO                                            ┌ .glass 22.5rem ────────────┐  │
│ Hola, Adela.            (.h-xl; «Adela» en #6fb6ff)              │ LIBRERÍA ACTIVA            │  │
│                                                                  │ v10 · datos del 6 nov 2026 │  │
│ Aquí cambias las fotos, los videos y la guía PDF de              │ ────────────────────────── │  │
│ expertsddt.com, y publicas las librerías Exocad. Cada cambio     │ ÚLTIMO CAMBIO              │  │
│ sale en la web al terminar la subida y guarda una copia del      │ «Foto del equipo»          │  │
│ archivo anterior.                                                │ David · hace 2 horas       │  │
│                                                                  │ ────────────────────────── │  │
│ (01 Librerías) (02 Documentos) (03 Imágenes ·15) (04 Videos ·6)  │ ARCHIVOS EN LA WEB         │  │
│                                                                  │ 22 de 22                   │  │
│                                                                  └────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [aviso de página, solo si existe y no pertenece a una tarjeta]                  lienzo --canvas  │
│ 01 ── LIBRERÍAS EXOCAD GRATUITAS        … §4.3                                                   │
│ 02 ── DOCUMENTOS                        … §4.4                                                   │
│ 03 ── IMÁGENES                          … §4.5                                                   │
│ 04 ── VIDEOS                            … §4.6                                                   │
│ BUENO SABER                             … §4.7                                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ .pfoot #0a1a3a: [logo] © 2026 Fernando Polanco DDT LLC · ¿Algo no funciona? …  expertsddt.com[↗] │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  EXPERTS DDT (fantasma)  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Medidas:

- **Franja:** rejilla `minmax(0,1fr) 22.5rem`, gap 2.5rem, `align-items: end`. A ≤960 pasa a una columna y el vidrio queda bajo las píldoras.
- **Píldoras de salto:** si falta algún archivo, la cifra cambia a «1 falta» en tono de advertencia sobre navy (`rgba(252,211,77,.16)` / #fcd34d).
- **Resumen:** «Archivos en la web» muestra «21 de 22 · falta «Foto del equipo»» con icono `alert-triangle`.

**375 px.**

```
┌───────────────────────────────────┐
│ [logo 22px]          (◐)  [Salir] │  60 px, no fija ([Salir] solo icono a ≤400)
│ Contenido │ Historial │ Web [↗]   │  48 px; actual: #fff y subrayado inferior de 3px #6fb6ff
├───────────────────────────────────┤
│ ── PANEL DE CONTENIDO             │
│ Hola, Adela.                      │
│ Aquí cambias las fotos, los…      │
│ (01 Librerías) (02 Documentos)    │  píldoras de 44 px que bajan de línea
│ (03 Imágenes ·15) (04 Videos ·6)  │
│ ┌ .glass ───────────────────────┐ │
│ │ LIBRERÍA ACTIVA               │ │
│ │ v10 · datos del 6 nov 2026    │ │
│ │ ÚLTIMO CAMBIO                 │ │
│ │ «Foto del equipo»             │ │
│ │ David · hace 2 horas          │ │
│ │ ARCHIVOS EN LA WEB  22 de 22  │ │
│ └───────────────────────────────┘ │
├───────────────────────────────────┤
│ 01 ── LIBRERÍAS EXOCAD…           │  número calado de 2.6rem
```

### 4.3 01 · Librerías Exocad gratuitas (`#librerias`)

**Escritorio.**

```
│ 01  ── LIBRERÍAS EXOCAD GRATUITAS                                                                │
│     Librerías de implantes                                                       (h2 .h-lg)      │
│     Lo que publiques aquí es lo que descargan los doctores en expertsddt.com/exocad-libraries/.  │
│     El cambio es inmediato.                                                                      │
│ [aviso de la sección: ok / warn / err, solo después de publicar o activar]                       │
│ ┌ .vcard navy · 7fr ────────────────────────────────┐ ┌ .card .pubcard · 5fr ───────────────────┐ │
│ │ ╭────────╮  (● EN LÍNEA)                          │ │ Publicar una versión nueva              │ │
│ │ │VERSIÓN │  Versión v10                (1.5rem)   │ │ La versión actual queda guardada por si │ │
│ │ │  v10   │  Datos del 6 de noviembre de 2026      │ │ necesitas volver a ella.                │ │
│ │ ╰────────╯  disco 136 px                          │ │ 01 Elige el archivo .zip                │ │
│ │ ───────────────────────────────────────────────── │ │ ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐ │ │
│ │ TAMAÑO       ARCHIVOS     EN LA WEB DESDE         │ │ ╎ [⇪] Arrastra aquí el .zip           ╎ │ │
│ │ 23.7 MB      35           6 nov 2026 · Diego      │ │ ╎     o elige un archivo              ╎ │ │
│ │ Así la ven los doctores:                          │ │ ╎     Solo .zip · hasta 300 MB        ╎ │ │
│ │ «Versión v10 · actualizada el 6 de noviembre      │ │ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ │ │
│ │  de 2026 · 24 MB»                                 │ │ 02 Ponle número y fecha                 │ │
│ │ [Ver página pública [↗]]  [Descargar el zip [↓]]  │ │ Número de versión   Fecha de los datos  │ │
│ │ ▸ Detalles técnicos                               │ │ [v│ 11       ]      [ 07/11/2026    ]   │ │
│ └───────────────────────────────────────────────────┘ │ La siguiente libre es la 11.            │ │
│                                                       │ 03 Revisa y publica                     │ │
│                                                       │ ┌ --well · solo JS ─────────────────┐   │ │
│                                                       │ │ ASÍ SE VERÁ EN LA WEB             │   │ │
│                                                       │ │ «Versión v11 · actualizada el 7 de│   │ │
│                                                       │ │  noviembre de 2026 · 49 MB»       │   │ │
│                                                       │ └───────────────────────────────────┘   │ │
│                                                       │ Al publicar, los doctores empiezan a    │ │
│                                                       │ descargar esta versión de inmediato. La │ │
│                                                       │ actual queda guardada.                  │ │
│                                                       │ [     Publicar versión v11   [→]     ]  │ │
│                                                       │ (i) Un archivo grande puede tardar…     │ │
│                                                       └─────────────────────────────────────────┘ │
│ ┌ .card · Versiones publicadas ─────────────────────────────────────────────────────────────────┐ │
│ │ ¿Algo salió mal? Activa una versión anterior y la web la ofrecerá al instante. No se borra     │ │
│ │ ninguna.                                                                                       │ │
│ │ VERSIÓN      DATOS DEL        TAMAÑO      ARCHIVOS                   (fila visual, aria-hidden) │ │
│ │▌v10          6 nov 2026       23.7 MB     35              (✓ ACTIVA)                           │ │
│ │ v9           4 nov 2026       9.7 MB      3               [⟲ Activar la v9]                    │ │
│ └────────────────────────────────────────────────────────────────────────────────────────────────┘ │
```

Notas:

- «EN LA WEB DESDE» sale del último `library_publish` o `library_activate` del historial. Si no aparece, la columna se omite.
- La frase «Así la ven los doctores» usa **exactamente** la plantilla pública `Versión {v} · actualizada el {d} · {s} MB`, con la fecha en `es` y `T12:00:00` y el tamaño `(bytes/1048576).toFixed(0)`. Por eso dice «24 MB» mientras la estadística dice «23.7 MB».
- El «300 MB» de la zona no está escrito a mano: sale de `LIB_MAX_MB` (§9.5). No se anuncia hasta que una subida real de 300 MB pase el proxy de Hostinger (§10).
- Sin JS no hay recuadro «Así se verá en la web». El botón dice «Publicar esta versión» y la frase de consecuencia es genérica.
- Si `versions.json` no existe pero `latest.json` sí (es el caso real de hoy), la lista muestra la versión activa como única fila.

**375 px.**

```
┌───────────────────────────────────┐
│ 01  ── LIBRERÍAS EXOCAD GRATUITAS │
│     Librerías de implantes        │
│     Lo que publiques aquí…        │
│ ┌ .vcard ───────────────────────┐ │
│ │ (disco 104)   (● EN LÍNEA)    │ │
│ │ Versión v10                   │ │
│ │ Datos del 6 nov 2026          │ │
│ │ TAMAÑO 23.7 MB  ARCHIVOS 35   │ │
│ │ Así la ven los doctores: «…»  │ │
│ │ [ Ver página pública [↗]    ] │ │  ancho completo
│ │ [ Descargar el zip [↓]      ] │ │
│ │ ▸ Detalles técnicos           │ │
│ └───────────────────────────────┘ │
│ ┌ Publicar una versión nueva ───┐ │
│ │ 01 Elige el archivo .zip      │ │
│ │ [zona 168 px · Toca para      │ │  en pantallas táctiles: «Toca para elegir el .zip»
│ │  elegir el .zip]              │ │
│ │ 02 Número de versión          │ │
│ │ [v│ 11                      ] │ │
│ │    Fecha de los datos         │ │
│ │ [ 07/11/2026                ] │ │
│ │ 03 Al publicar, los doctores… │ │
│ │ [ Publicar versión v11 [→]  ] │ │
│ └───────────────────────────────┘ │
│ ┌ Versiones publicadas ─────────┐ │
│ │ v10 · datos del 6 nov 2026    │ │
│ │ 23.7 MB · 35 archivos         │ │
│ │ (✓ ACTIVA)                    │ │
│ │ ───────────────────────────── │ │
│ │ v9 · datos del 4 nov 2026     │ │
│ │ 9.7 MB · 3 archivos           │ │
│ │ [ [⟲] Activar la v9         ] │ │
│ └───────────────────────────────┘ │
```

**Estados de 01:**

```
VACÍO (no hay latest.json)                    ARCHIVO ELEGIDO (JS)
┌ .vcard ────────────────────────────────┐    ┌ .pubcard ──────────────────────────────┐
│ ╭──────╮  (SIN PUBLICAR)  chip aviso   │    │ 01 [zip] exocad-libs-v11.zip · 49 MB   │ zona plegada a fila
│ │  —   │  Aún no hay una versión       │    │        [Cambiar archivo]               │
│ ╰──────╯  publicada                    │    │ 02 [v│11]  [07/11/2026]                │
│ Mientras tanto, la página pública dice │    │ 03 ASÍ SE VERÁ EN LA WEB «…»           │
│ «La descarga no está disponible por    │    │    Al publicar, los doctores…          │
│ ahora».                                │    │    [Publicar versión v11 [→]]          │
└────────────────────────────────────────┘    └────────────────────────────────────────┘
La lista de versiones se cambia por «Las versiones que publiques aparecerán aquí.» y el número
de versión propuesto es 1.

SUBIENDO (JS, tras el diálogo)                REVISANDO (JS, subida al 100 %)
┌ .pubcard ──────────────────────────────┐    ┌ .pubcard ──────────────────────────────┐
│ Subiendo «exocad-libs-v11.zip»   52 %  │    │ Revisando el .zip y calculando la      │
│ [██████████████░░░░░░░░░░░░░░]         │    │ huella…                                │
│ 25 MB de 49 MB · quedan unos 40 s      │    │ [░░░▒▒▒▓▓▓░░░░░░░░░░░] indeterminada   │
│ No cierres esta pestaña hasta que      │    │ No cierres esta pestaña.               │
│ termine.             [Cancelar subida] │    │                                        │
└────────────────────────────────────────┘    └────────────────────────────────────────┘
Durante la subida, los campos tienen aria-disabled, los demás botones de enviar de la página
quedan bloqueados (§6.8) y beforeunload pide confirmación al salir.

PUBLICADA (tras la redirección, en #librerias)
┌ .alert--ok · role=status · tabindex=-1 · autofocus ───────────────────────────────────────┐
│ [✓] Listo: la versión v11 ya está en la web.                                              │
│     Quien descargue las librerías desde ahora recibe la v11 (37 archivos).                │
│     [Ver página pública [↗]]   [[⟲] Volver a la v10]                                      │
└───────────────────────────────────────────────────────────────────────────────────────────┘
La .vcard muestra v11 con el chip «Publicada hace un momento», el disco gira una vez y la fila
v11 aparece como «Activa».

PUBLICADA, PERO SOSPECHOSA (la v11 trae menos de la mitad de archivos que la v10)
┌ .alert--warn · role=alert ────────────────────────────────────────────────────────────────┐
│ [!] Publicada, pero revísala: la v11 tiene 3 archivos y la v10 tenía 35.                  │
│     ¿Elegiste el .zip correcto? Si no, vuelve a la v10 con un clic.                       │
│     [[⟲] Volver a la v10]                                                                 │
└───────────────────────────────────────────────────────────────────────────────────────────┘

ERROR (tras la redirección)
┌ .alert--err · role=alert ─────────────────────────────────────────────────────────────────┐
│ [!] No se pudo publicar la versión.                                                       │
│     La versión v10 ya existe. Usa un número nuevo, por ejemplo 11. Nada cambió en la web.  │
└───────────────────────────────────────────────────────────────────────────────────────────┘
El formulario vuelve con la versión y la fecha que se enviaron (3.3.7); el archivo hay que
elegirlo otra vez, y su zona lo dice.
```

### 4.4 02 · Documentos (`#documentos`)

```
│ 02  ── DOCUMENTOS                                                                                │
│     Guía de servicios y tarifas                                                                  │
│     Es el PDF que se descarga en la página Servicios con el botón «Descargar guía de servicios». │
│     El mismo archivo sirve a la web en inglés y en español.                                      │
│ ┌ article.card.slot.slot--doc#slot-guide-pdf · r24 ──────────────────────────────────────────┐   │
│ │ [aviso de resultado, solo si pertenece a este archivo]                                      │   │
│ │ ┌────┐ ── SERVICIOS · PDF                                        [Abrir la guía actual [↗]] │   │
│ │ │PDF │ Guía de servicios y tarifas                     (1.25rem)                           │   │
│ │ └────┘ 172 KB · actualizada el 12 sep 2026, 3:10 p.m.                                       │   │
│ │ mosaico (Servicios)                                                                         │   │
│ │ 56 px  [[⇪] Reemplazar PDF                    ▾]  ← summary, ancho automático               │   │
│ │ ─── abierto ─────────────────────────────────────────────────────────────────────────────── │   │
│ │ ┌╌ .drop ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐ │   │
│ │ ╎ [⇪] Arrastra el PDF aquí · o elige un archivo · Solo PDF, hasta 10 MB                  ╎ │   │
│ │ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ │   │
│ │ ┌ .alert--warn (fijo, mientras el texto del sitio esté escrito a mano) ──────────────────┐ │   │
│ │ │ [!] Ojo: junto al botón, la web dice «PDF · actualizado en septiembre de 2026 · en      │ │   │
│ │ │ inglés». Ese texto no cambia solo: si la guía nueva es de otro mes o en otro idioma,    │ │   │
│ │ │ avísale a Diego o a David.                                                              │ │   │
│ │ └─────────────────────────────────────────────────────────────────────────────────────────┘ │   │
│ │ Al publicar, quien descargue la guía desde la web recibe este PDF. El actual queda guardado.│   │
│ │ [Publicar en la web]   Cancelar                                                             │   │
│ │ ▸ Versiones anteriores (2)        ▸ Detalles técnicos                                       │   │
│ └─────────────────────────────────────────────────────────────────────────────────────────────┘   │
```

- **375 px:** el mosaico y el texto se apilan; «Abrir la guía actual» y «Reemplazar PDF» ocupan todo el ancho.
- **Estados:** iguales a los de una imagen (§4.5), con dos diferencias. No hay comparación: tras elegir archivo se ve una fila con el nombre, el peso y la comprobación «Es un PDF de menos de 10 MB». Y el estado vacío es «Todavía no hay PDF en la web», con el botón «Subir PDF».
- **No hay vista previa local del PDF nuevo.** Abrir un `blob:` heredaría la CSP `default-src 'none'` y el visor de PDF puede fallar.

### 4.5 03 · Imágenes (`#imagenes`)

**Escritorio.**

```
│ 03  ── IMÁGENES                                                                                  │
│     Fotos del sitio                                                                              │
│     Sube una foto PNG, JPG o WebP: el panel la convierte al formato de la web, la ajusta al      │
│     tamaño correcto y le quita los datos ocultos (como la ubicación GPS). La foto anterior       │
│     queda guardada.                                                                              │
│     (i) Las fotos y precios de los productos de la tienda (shop.expertsddt.com) se cambian en    │
│         Shopify, no aquí.                                                                        │
│ PÁGINAS DEL SITIO · 10 ────────────────────────────────────────────────────────── (h3 .sgroup)   │
│ ┌────────────────────────┐ ┌────────────────────────┐ ┌────────────────────────┐                 │
│ │                        │ │░░ escenario navy ░░░░░░│ │                        │                 │
│ │ vista previa 4:3       │ │░  laptop (contain)    ░│ │ foto (contain)         │                 │
│ │ contain sobre --well   │ │░░░░░░░░░░░░░░░░░░░░░░░░│ │                        │                 │
│ ├────────────────────────┤ ├────────────────────────┤ ├────────────────────────┤                 │
│ │ (Inicio)               │ │ (Inicio)               │ │ (Inicio) (Servicios)   │                 │
│ │ Fondo de la portada    │ │ Laptop del Doctor      │ │ Foto del equipo        │                 │
│ │ 77 KB · 7 nov 2026     │ │ Portal                 │ │ 105 KB · 7 nov 2026    │                 │
│ │       Ver en la web [↗]│ │ 96 KB · 7 nov  web [↗] │ │       Ver en la web [↗]│                 │
│ │ [[⇪] Reemplazar foto  ▾]│ │ [[⇪] Reemplazar foto  ▾]│ │ [[⇪] Reemplazar foto  ▾]│                 │
│ └────────────────────────┘ └────────────────────────┘ └────────────────────────┘                 │
│ … (10 en el orden en que aparecen en la web: portada, pilares, servicios, nosotros, recursos,    │
│    tienda)                                                                                       │
│ CASOS ANTES Y DESPUÉS · 4 ───────────────────────────────────────────────────────────────────── │
│ Las dos fotos de cada caso deben tener el mismo encuadre y proporción para que el comparador     │
│ de la web funcione.                                                                              │
│ [Caso A · Antes  ] [Caso A · Después ]     ← siempre 2 columnas a ≥760: cada pareja alineada     │
│ [Caso B · Antes  ] [Caso B · Después ]       (marco 16:10, el de .ba en la web)                   │
│ AL COMPARTIR EN REDES · 1 ───────────────────────────────────────────────────────────────────── │
│ Es la imagen que aparece cuando alguien comparte expertsddt.com por WhatsApp, Facebook o         │
│ LinkedIn. No se ve dentro de la web.                                                             │
│ [tarjeta og · marco 1200:630 · máx. 36rem]                                                       │
```

**Anatomía de una tarjeta** (`article.card.slot#slot-team`). Las áreas de la rejilla se explican en §5.16.

```
┌ media ───────────────────────────┐  marco 4:3 (16:10 en parejas, 1200:630 en og), object-fit: contain,
│ (✓ RECIÉN ACTUALIZADO)           │  fondo de escenario; chip arriba a la izquierda solo si cambió hace < 10 min
│        imagen actual             │  img de https://expertsddt.com/<path>?v=<mtime>, loading=lazy
├ banner ──────────────────────────┤  aviso de resultado (solo si el aviso es de esta tarjeta)
├ body ────────────────────────────┤
│ (Inicio) (Servicios)             │  ul.tags (no son enlaces)
│ Foto del equipo                  │  h4.slot__title
│ 105 KB · 7 nov 2026, 2:40 p.m.   │  p.meta, y a la derecha «Ver en la web [↗]» (.btn--quiet, 44 px)
├ more ────────────────────────────┤
│ [[⇪] Reemplazar foto          ▾] │  details > summary.btn.btn--outline.btn--block
└──────────────────────────────────┘
```

**Estados de la tarjeta:**

```
A · REPOSO                      B · ABIERTA, SIN JS             C · ARCHIVO ELEGIDO (JS)
┌──────────────────────────┐    ┌──────────────────────────┐    ┌──────────────────────────┐
│ vista previa 4:3         │    │ vista previa             │    │ vista previa             │
├──────────────────────────┤    ├──────────────────────────┤    ├──────────────────────────┤
│ (Inicio)(Servicios)      │    │ …título y datos…         │    │ …título y datos…         │
│ Foto del equipo          │    │ [[⇪] Cerrar           ▴] │    │ [[⇪] Cerrar           ▴] │
│ 105 KB · 7 nov 2026  [↗] │    │ ┌╌ zona punteada ╌╌╌╌╌╌┐ │    │ ACTUAL          NUEVA    │
│ [[⇪] Reemplazar foto  ▾] │    │ ╎ [Elegir archivo]     ╎ │    │ [mini] [→]  [mini]       │
└──────────────────────────┘    │ ╎ Ningún archivo…      ╎ │    │ equipo-2026.jpg          │
                                │ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ │    │ 3.4 MB · 4032 × 3024 px  │
                                │ PNG, JPG o WebP · al     │    │ Se guardará a 1800 px.   │
                                │ menos 800 px de ancho    │    │ [✓] Formato aceptado     │
                                │ Al publicar, la foto     │    │ [✓] Tamaño suficiente    │
                                │ nueva reemplaza…         │    │ [!] Otra proporción que  │
                                │ [Publicar en la web]     │    │     la actual: podría    │
                                │ Cancelar                 │    │     verse recortada.     │
                                │ ▸ Versiones anteriores   │    │ Al publicar, la foto…    │
                                │ ▸ Detalles técnicos      │    │ [Publicar en la web]     │
                                └──────────────────────────┘    │ Cancelar                 │
                                                                └──────────────────────────┘
D · NO VÁLIDO (JS)              E · SUBIENDO / PROCESANDO (JS)  F · ÉXITO (tras redirección)
┌──────────────────────────┐    ┌──────────────────────────┐    ┌──────────────────────────┐
│ …                        │    │ vista previa (opacidad .6)│   │ (✓ RECIÉN ACTUALIZADO)   │
│ ┌ zona · borde --err ──┐ │    │ …                        │    │ imagen nueva             │
│ │ foto-640.jpg         │ │    │ Subiendo «equipo…» 45 %  │    ├──────────────────────────┤
│ └──────────────────────┘ │    │ [█████████░░░░░░░░░░░]   │    │ ┌ .alert--ok ──────────┐ │
│ [x] No se puede usar:    │    │ 1.5 MB de 3.4 MB ·       │    │ │ [✓] Listo: la foto   │ │
│ mide 640 px de ancho y   │    │ quedan unos 10 s         │    │ │ nueva ya está en la  │ │
│ aquí se necesitan 800.   │    │ [Cancelar subida]        │    │ │ web. Si aún ves la   │ │
│ (role=alert)             │    │ ── al 100 %: ──          │    │ │ anterior, recarga…   │ │
│ [Publicar en la web]     │    │ Optimizando la foto…     │    │ │ [[⟲] Deshacer]       │ │
│ → al pulsar, el foco va  │    │ [░▒▓░░ indeterminada]    │    │ └──────────────────────┘ │
│   al error               │    └──────────────────────────┘    │ contorno 2px --focus     │
└──────────────────────────┘                                    │ (:target), se desvanece  │
                                                                └──────────────────────────┘
G · ERROR (tras redirección)    H · FALTA EN LA WEB             I · ARRASTRANDO ENCIMA (JS)
┌──────────────────────────┐    ┌──────────────────────────┐    ┌──────────────────────────┐
│ vista previa             │    │ ┌╌ marco --well ╌╌╌╌╌╌╌┐ │    │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
├──────────────────────────┤    │ ╎ [image-off]          ╎ │    │▓ Suelta para reemplazar ▓│ capa rgba(15,52,110,.85),
│ ┌ .alert--err ─────────┐ │    │ ╎ Falta en la web      ╎ │    │▓ «Foto del equipo»      ▓│ texto #fff 600, borde
│ │ [!] No se pudo cambiar│ │    │ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ │    │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ interior discontinuo
│ │ la foto. La foto mide │ │    │ (! FALTA)                │    │ contorno 2px --focus     │ #8fc1ff
│ │ 640 px… Nada cambió.  │ │    │ Foto del equipo          │    └──────────────────────────┘
│ └──────────────────────┘ │    │ La web muestra un hueco  │
│ [[⇪] Cerrar           ▴] │    │ aquí hasta que subas una.│
│ panel abierto por el     │    │ [[⇪] Subir foto       ▾] │ ← .btn--primary
│ servidor; zona con borde │    └──────────────────────────┘
│ --err y el mismo mensaje │
│ bajo ella (aria-invalid) │
└──────────────────────────┘
```

- **J · Vista previa rota.** Si expertsddt.com no responde, el script cambia la imagen por el marco `--well` con `image-off` y «No se pudo cargar la vista previa desde expertsddt.com.». Sin JS se ve el `alt`, con estilo (.85rem, `--muted`, centrado) dentro del marco.
- **K · Bloqueada por otra subida (JS).** Mientras otra tarjeta sube, el botón «Publicar en la web» de esta lleva `aria-disabled="true"` y una nota: «Espera a que termine la subida en curso.». La zona tiene opacidad .55 y `pointer-events: none`.
- **Advertencias que no bloquean:** proporción distinta de la actual o de su pareja, JPG en un recorte transparente y og que no mide 1200 × 630.
- **Errores que bloquean:** tipo no admitido, HEIC, menos ancho del mínimo y más de 13 MB.

**375 px: tarjetas en fila compacta** (a ≤560). Quince tarjetas de 410 px serían 6 000 px de desplazamiento; en fila ocupan unos 2 000.

```
┌───────────────────────────────────┐
│ ┌──────┐ (Inicio)(Servicios)      │  media 6.5rem (4:3, contain); áreas "media body" / "more more"
│ │thumb │ Foto del equipo          │
│ │ 4:3  │ 105 KB · 7 nov 2026      │
│ └──────┘ Ver en la web [↗]        │
│ [[⇪] Reemplazar foto           ▾] │  el panel abierto ocupa todo el ancho debajo
└───────────────────────────────────┘
```

**Variantes** (definidas en `slots.json`, §9.6):

- **Recortes transparentes.** `hero-laptop` y `scanner-front` usan el escenario navy de la web; `facial-scan` usa el escenario `mist`. «Actual» y «Nueva» se comparan sobre el mismo fondo. Si el archivo elegido es JPG, aparece la advertencia de fondo transparente.
- **og.** El marco es 1200:630. En «Nueva», la imagen se ve con `object-fit: cover`, porque así la recortará el servidor (§9.5), y el pie dice «Así quedará: la recortamos a 1200 × 630 px.». Es la única vista previa con recorte.
- **Parejas antes/después.** La proporción se compara con la de la foto pareja, además de con la actual.
- **`scanner-front`** (468×1083, vertical) se ve entera y pequeña dentro del marco 4:3: es la verdad, sin recorte.

### 4.6 04 · Videos (`#videos`)

```
│ 04  ── VIDEOS                                                                                    │
│     Videos del sitio                                                                             │
│     Sube un MP4 de hasta 12 MB. En la web se reproducen solos, sin sonido y en bucle: deben      │
│     entenderse sin audio.                                                                        │
│ ┌ article.card.slot.slot--video ─┐ ┌────────────────────────────────┐ ┌───────────────────────┐ │
│ │ ┌ marco 16:10 · #0a1a3a ──────┐ │ │ …                              │ │ …                     │ │
│ │ │ <video controls preload=none│ │ │                                │ │                       │ │
│ │ │  muted playsinline poster>  │ │ │                                │ │                       │ │
│ │ └─────────────────────────────┘ │ │                                │ │                       │ │
│ │ (Inicio) (Servicios)            │ │                                │ │                       │ │
│ │ Software del escáner facial     │ │                                │ │                       │ │
│ │ 1.0 MB de 12 MB · 3 oct 2026 [↗]│ │                                │ │                       │ │
│ │ [[⇪] Reemplazar video        ▾] │ │                                │ │                       │ │
│ └─────────────────────────────────┘ └────────────────────────────────┘ └───────────────────────┘ │
│ ─── panel abierto ───                                                                            │
│ ┌╌ .drop · MP4 ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐                                                               │
│ ╎ Arrastra el video aquí · o     ╎                                                               │
│ ╎ elige un archivo · Solo MP4,   ╎                                                               │
│ ╎ hasta 12 MB                    ╎                                                               │
│ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘                                                               │
│ Portada (opcional)                ← solo en los 5 videos con portada                              │
│ ┌╌ .drop--sm · 96 px ╌╌╌╌╌╌╌╌╌╌╌╌┐  La imagen que se ve mientras carga el video. Si cambias el     │
│ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘  video, cambia también la portada para que coincidan.          │
│ Al publicar, el video nuevo reemplaza al actual en Inicio y Servicios. El actual queda guardado. │
│ [Publicar en la web]  Cancelar      ▸ Versiones anteriores   ▸ Detalles técnicos                 │
```

- **Vista previa actual:** el póster va con `object-fit: contain`. `v-smile-design` no tiene póster propio y usa `img/design-services.webp`, igual que la web.
- **Sin reproducción local del video nuevo.** No hace falta `blob:` en `media-src`. Tras elegir el archivo se ve una fila con el nombre, el peso y las comprobaciones «Es un MP4» y «Pesa menos de 12 MB».
- **Notas fijas por video** (campo `hint`):
  - `v-smile-design`: «Mientras carga, se ve la imagen «Fondo de la portada» (sección Imágenes).»
  - `v-exocad-denture`: «La portada de este video también es una imagen de la Tienda.»
- **Estados:** los mismos que una imagen. El procesando dice «Guardando el video…».

### 4.7 Bueno saber y pie

```
│ ┌ section#bueno-saber > .card.info ─────────────────────────────────────────────────────────┐ │
│ │ Bueno saber                                                              (h2, 1.15rem)    │ │
│ │ (i) Los textos de la web no se cambian aquí. Pídeselos a Diego o a David.                 │ │
│ │ (i) Las fotos y precios de los productos de la tienda (shop.expertsddt.com) se cambian en │ │
│ │     Shopify.                                                                              │ │
│ │ (i) Si algo no quedó bien, abre ese archivo y usa «Deshacer» o «Versiones anteriores».    │ │
│ │ (i) Si todavía ves lo anterior en la web, recarga la página: algunos navegadores guardan  │ │
│ │     las imágenes hasta un día.                                                            │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────────────────────────────────────────────┤
│ .pfoot: [logo-light 26] © 2026 Fernando Polanco DDT LLC · Experts DDT · Panel de contenido,   │
│ solo para personal autorizado.   ¿Algo no funciona? Escríbele a Diego o a David.              │
│                                                                   [↗] Ir a expertsddt.com     │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  EXPERTS DDT  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
```

Pie: padding `2.5rem 0 calc(2.5rem + clamp(3rem,10vw,7rem))`, para dejar sitio a la palabra fantasma. El año sale de la fecha del servidor.

### 4.8 Historial (`/history`)

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ .bar  («Historial» con aria-current="page")                                                │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ ── REGISTRO DE ACTIVIDAD                                     franja compacta               │
│ Historial                                                     padding 2rem 0 2.5rem        │
│ Quién cambió qué y cuándo. Las horas son de Florida.                                       │
│ [Cambios en la web] (Accesos) (Todo)       ← actual: fondo #fff, texto #0f346e             │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌ .card.log ─────────────────────────────────────────────────────────────────────────────┐ │
│ │ HOY · SÁBADO 7 DE NOVIEMBRE                         (h2 .log__day, .72rem, --pill-fg)  │ │
│ │ 2:40 p.m.   (AD)  [⇪] Adela cambió la foto «Foto del equipo»                           │ │
│ │                       img/team.webp                                  (.mono --muted)   │ │
│ │ ─────────────────────────────────────────────────────────────────────────────────────  │ │
│ │ 2:31 p.m.   (DV)  [▣] David publicó la versión v11 de las librerías                    │ │
│ │                       37 archivos · 49.1 MB                                            │ │
│ │ AYER · VIERNES 6 DE NOVIEMBRE                                                          │ │
│ │ 11:15 p.m.  (DI)  [⟲] Diego volvió a una versión anterior de «Caso A · Antes»          │ │
│ └────────────────────────────────────────────────────────────────────────────────────────┘ │
│ Se muestran los últimos 200 eventos.                                                       │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Vista «Accesos»:**
  - Entradas y salidas con el icono `log-in` o `log-out`.
  - Los intentos fallidos y bloqueados se ven con fondo `--warn-bg`, el icono `alert-triangle`, la frase «Intento de acceso fallido con ana@gmail.com» y debajo «IP 45.x.x.x».
  - La IP solo se muestra en estos dos tipos.
- **375 px:** cada entrada se apila. Línea 1: «2:40 p.m. · Adela» (.8rem `--muted`). Línea 2: la frase. Línea 3: el detalle. El avatar se oculta.
- **Vacío:** tarjeta con mosaico `clock` y «Todavía no hay cambios registrados.», o, con filtro, «No hay eventos de este tipo entre los últimos 200.».
- **Estructura:** es una lista, no una tabla. Cada día es un `<section>` con un `<h2>` y un `<ol class="log">`. La frase se lee completa en orden y no hay que recolocar roles de tabla en móvil.

### 4.9 Páginas de error y sesión

```
┌ .auth (navy a pantalla, min-height 70svh) ──┐
│ [logo-light]                                │
│ ┌ .auth-card ─────────────────────────────┐ │
│ │ (ERROR 404)   chip neutro               │ │
│ │ Esta página no existe            (h1)   │ │
│ │ Puede que el enlace esté mal escrito.   │ │
│ │ [ Volver al panel  [→] ]                │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

- La 403 y la 500 usan la misma vista con su texto (§7.12). La 500 recuerda revisar si una subida se aplicó antes de repetirla.
- **Sesión caducada:** no tiene pantalla propia. El middleware redirige a `/login` con el aviso informativo (§4.1). Durante una subida con JS, la respuesta es 401 JSON `{to:"/login"}` y el cliente navega (§6.7).

### 4.10 Diálogo y aviso flotante

```
ESCRITORIO                                               375 px
┌ dialog.dlg · r24 · min(480px, 100%-2rem) ─── (×) ┐     ┌ dialog 100%-2rem ──── (×) ┐
│ [mosaico 48 · package]                            │     │ [mosaico]                 │
│ ¿Publicar la versión v11?          (h2 1.4rem)    │     │ ¿Publicar la versión v11? │
│ Los doctores empezarán a descargar este archivo   │     │ Los doctores empezarán…   │
│ de inmediato. La v10 queda guardada y puedes      │     │ ┌ --well ──────────────┐  │
│ volver a ella con un clic.                        │     │ │ v11 · 49 MB · …      │  │
│ ┌ --well r12 ────────────────────────────────────┐│     │ └──────────────────────┘  │
│ │ v11 · actualizada el 7 de noviembre de 2026 ·  ││     │ [ Sí, publicar la v11  ]  │
│ │ 49 MB · exocad-libs-v11.zip                    ││     │ [ No, volver           ]  │
│ └────────────────────────────────────────────────┘│     └───────────────────────────┘
│                  [No, volver] [Sí, publicar la v11]│     a ≤560: column-reverse, botones a todo el ancho
└───────────────────────────────────────────────────┘
::backdrop rgba(10,26,58,.62) + blur(4px). El foco inicial va a «No, volver».

AVISO FLOTANTE (solo eventos del navegador; abajo a la derecha, a ≤560 de lado a lado)
┌ .toast #0f346e r18 ──────────────────────────────────┐
│ (i) Subida cancelada                             (×) │  disco de 32 px: info --grad-blue, error #b91c1c
│     Nada cambió en la web.                           │
└──────────────────────────────────────────────────────┘
```

### 4.11 Sin JavaScript

| Pantalla | Qué cambia sin JS | Qué sigue igual |
|---|---|---|
| Login | sin «Mostrar», sin aviso de Bloq Mayús, sin estado «Verificando…» | validación nativa (`required`, `type=email`, `pattern`); avisos del servidor; correo conservado |
| Tema | siempre claro; el botón de tema no se pinta (`hidden`) | todo |
| Barra y pestañas | — | todo (son enlaces) |
| Desplegables | — | `<details>` nativo |
| Zona de soltar | se ve el `<input type=file>` nativo dentro del recuadro punteado, con su botón como píldora; el navegador acepta soltar sobre el input | `accept`, `required` |
| Comparación, comprobaciones, progreso | no aparecen | el servidor valida y explica el error exacto |
| Publicar | envío multipart normal; la nota avisa de que puede tardar minutos | aviso en la tarjeta tras el 303; chip «Recién actualizado»; `:target` |
| Librerías | sin recuadro «Así se verá», sin diálogo de confirmación (se puede deshacer y la frase de consecuencia está a la vista) | versión propuesta y fecha de hoy ya rellenas por el servidor |
| Activar, Deshacer, Volver a esta | se envían directamente (todo es reversible) | aviso con la acción contraria |
| Copiar huella | no aparece; la huella es texto seleccionable | — |
| Historial | — | filtros por enlace (`?tipo=`) |

### 4.12 Matriz de estados

| Componente | Estados |
|---|---|
| Login | normal · enviando · 401 · 429 · sesión terminada · sesión terminada al subir · cerró sesión · Bloq Mayús |
| Versión activa | activa · recién publicada (giro, chip) · vacía · huella copiada |
| Publicar versión | reposo · campo no válido · versión repetida · archivo elegido · diálogo · subiendo · revisando · cancelada · error de red · error del servidor (valores conservados) |
| Versiones publicadas | activa · inactiva · vacía · confirmando activación |
| Tarjeta de archivo | reposo · abierta (con y sin JS) · archivo elegido · advertencia · no válido · arrastrando encima · subiendo · procesando · cancelada · error de red · éxito · error · falta en la web · vista previa rota · bloqueada por otra subida |
| Versiones anteriores | con copias (hasta 6) · sin copias (no se pinta) · confirmando · restaurada (aviso con «Deshacer») |
| Aviso | ok · warn · err · info, en tarjeta, en sección, en página o en login |
| Aviso flotante | entrando · visible · en pausa (hover/foco) · saliendo · apilados (máx. 3) |
| Historial | con eventos · filtrado · vacío · filtro vacío |
| Páginas de error | 403 · 404 · 500 |

---

## 5. Inventario de componentes

Todos son componentes `.astro` sin framework en `panel/src/components/`. Los estilos compartidos están en `panel.css` y los propios van en el `<style>` del componente; Astro los empaqueta en un CSS externo. Ningún componente usa `style=`, `define:vars` ni `<script>` propio: el comportamiento va por atributos `data-*` en `src/scripts/panel.ts` (§9.8).

### 5.1 `Panel.astro` (marco de la aplicación)

**Para qué:** el marco de toda página con sesión.

```astro
---
import '../../../src/styles/global.css';
import '../styles/panel.css';
import '@fontsource/poppins/latin-400.css'; /* … 500, 600, 700, 800 */
import p400 from '@fontsource/poppins/files/poppins-latin-400-normal.woff2?url';
import p800 from '@fontsource/poppins/files/poppins-latin-800-normal.woff2?url';
import favicon from '../../../public/favicon-32.png?url';
import touch from '../../../public/apple-touch-icon.png?url';
const { title } = Astro.props;            /* «Contenido» | «Historial» */
const { flash } = Astro.locals;           /* {type,title,text,…} | null */
const head = flash ? `${flash.type === 'err' ? 'Error: ' : ''}${flash.title} · ` : '';  /* los títulos ok ya empiezan por «Listo:» */
---
<html lang="es">
<head>
  <meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex, nofollow" /><meta name="theme-color" content="#0f346e" />
  <title>{head}{title} · Panel Experts DDT</title>
  <link rel="icon" href={favicon} type="image/png" sizes="32x32" /><link rel="apple-touch-icon" href={touch} />
  <link rel="preload" as="font" type="font/woff2" crossorigin href={p400} />
  <link rel="preload" as="font" type="font/woff2" crossorigin href={p800} />
  <script is:inline src="/theme-init.js"></script>   <!-- externo y bloqueante; sin código en línea -->
</head>
<body>
  <a class="skip" href="#main">Saltar al contenido</a>
  <Bar />
  <main id="main" tabindex="-1"><slot /></main>
  <Footer />
  <div class="toasts" aria-live="polite"></div>
  <p id="sr-status" class="sr-only" role="status" aria-live="polite"></p>
  <ConfirmDialog />
  <script>import '../scripts/panel.ts';</script>   <!-- Astro lo emite como /_astro/*.js -->
</body>
</html>
```

**CSS:** `main:focus { outline: none }`, porque es solo destino del salto.

### 5.2 `Auth.astro` (login y errores)

**Para qué:** marco navy para las páginas sin barra.

- Mismo `<head>` que `Panel.astro`.
- `<body class="auth on-navy">` lleva: fila superior con logo y tema, `<main>` con la rejilla de login o la tarjeta de error, línea inferior (copyright y «Volver a expertsddt.com»), palabra fantasma (`aria-hidden`), el `#sr-status` y el mismo script.
- **CSS:** el fondo es la receta `.page-hero` con `--n-glow` y `.grid-bg` a pantalla completa. `.auth-card` lleva `--card`, radio de 24 px y `--shadow-pop`, y en oscuro un borde de 1px `--card-line`.

### 5.3 `Bar.astro` (barra superior)

```html
<header class="bar on-navy">
  <div class="bar__in">
    <a class="bar__brand" href="/"><img src={logoLight} alt="Experts DDT" width="206" height="26" />
      <span class="bar__div" aria-hidden="true"></span><span class="micro">Panel</span></a>
    <nav class="bar__nav" aria-label="Principal">
      <a class="bar__sec" href="/#librerias">Librerías</a> … Documentos · Imágenes · Videos
      <a class="bar__all" href="/" aria-current={isHome ? 'page' : undefined}>Contenido</a>
      <a href="/history" aria-current={isHistory ? 'page' : undefined}>Historial</a>
      <a href="https://expertsddt.com/es/" target="_blank" rel="noopener">Ver la web <Icon name="external-link" size={14} /><span class="sr-only"> (se abre en otra pestaña)</span></a>
    </nav>
    <div class="bar__end">
      <ThemeToggle />
      <span class="who"><span class="av" aria-hidden="true">AD</span><span class="who__name"><span class="sr-only">Sesión iniciada como </span>Adela</span></span>
      <form method="post" action="/logout"><input type="hidden" name="_csrf" value={csrf} />
        <button class="btn btn--ghost btn--sm" type="submit"><Icon name="log-out" size={16} /><span class="bar__out">Salir</span></button></form>
    </div>
  </div>
</header>
```

**Estados de los enlaces:** reposo (#c7d6ee), hover (#fff con subrayado), actual (#fff con subrayado fijo) y foco (anillo #8fc1ff).

**CSS:**

| Elemento | Estilo |
|---|---|
| Barra | `position: sticky; top: 0; z-index: 50; height: var(--bar-h)` a ≥761; fondo `rgba(15,52,110,.94)` con `backdrop-filter: blur(16px) saturate(160%)` (sin soporte: #0f346e); `border-bottom: 1px solid rgba(255,255,255,.08)`; color #c7d6ee |
| Interior | `width: min(1240px, 100% - 2rem)`, flex, gap 1rem |
| Enlaces | .86rem, peso 500, `min-height: 44px`, inline-flex. `::after` es una línea de 2px #6fb6ff que pasa de `scaleX(0)` a 1 (el patrón `.nav__links` del sitio). `aria-current` los pone en #fff con la línea visible |
| ≥1180 | `.bar__sec` visibles y `.bar__all` oculto |
| <1180 | al revés |
| ≤960 | `.who__name` queda como `sr-only` |
| ≤760 | `position: static`, alto automático. El `nav` toma `order: 3; flex-basis: 100%` y una rejilla de 3 columnas iguales de 48 px (.9rem, 600). El actual lleva `box-shadow: inset 0 -3px 0 #6fb6ff` |
| ≤400 | «Salir» pasa a círculo de 44 px solo con icono (`.bar__out` es `sr-only`) |

### 5.4 `ThemeToggle.astro`

```html
<button class="theme-toggle tbtn" type="button" data-theme-toggle hidden aria-pressed="false" aria-label="Cambiar a modo oscuro">
  <svg class="sun" …/><svg class="moon" …/>
</button>
```

- Reutiliza la regla `.theme-toggle .moon` de global.css para cambiar el icono.
- **CSS:** círculo de 44 px, borde `1.5px solid currentColor`, opacidad .85, hover con fondo `rgba(255,255,255,.12)`.
- **Estados:** claro (`aria-pressed=false`, «Cambiar a modo oscuro»), oscuro (`true`, «Cambiar a modo claro») y oculto sin JS.

### 5.5 `Hero.astro` (franja de página)

```html
<section class="page-hero phero on-navy" aria-labelledby="page-t">
  <div class="grid-bg" aria-hidden="true"></div>
  <div class="wrap phero__in">
    <div class="stack">
      <span class="eyebrow">Panel de contenido</span>
      <h1 class="h-xl" id="page-t">Hola, <span class="accent">Adela</span>.</h1>
      <p class="lead">…</p>
      <nav class="jump" aria-label="Secciones del panel">
        <a href="#librerias"><span class="jump__n">01</span>Librerías</a>
        <a href="#imagenes"><span class="jump__n">03</span>Imágenes <b>15</b></a> …
      </nav>
    </div>
    <aside class="glass glance" aria-label="Resumen"><dl>…</dl></aside>   <!-- solo en / -->
  </div>
</section>
```

**CSS:**

| Elemento | Estilo |
|---|---|
| Brillo | `.phero::before { background: var(--n-glow) }` |
| Padding | el de §2.5 |
| Acento | `.on-navy .accent { color: #6fb6ff }`. El `.accent` global es `--blue`: 2.33 sobre navy |
| Píldora `.jump a` | 44 px de alto; padding `.6rem 1rem`; radio 999; `border: 1px solid rgba(255,255,255,.3)` (el sitio usa .18; se sube por legibilidad); .85rem, peso 500, #fff |
| Número `.jump__n` | #8fc1ff, peso 700. El #6fb6ff del sitio baja a 4.24 en hover |
| Cifra `b` | .72rem, peso 700, padding `.1rem .5rem`, radio 999, fondo `rgba(255,255,255,.12)`; `.is-warn` con `rgba(252,211,77,.16)` / #fcd34d |
| Hover | fondo `rgba(255,255,255,.1)`, borde #fff |
| Resumen (`.glance dl`) | rejilla, gap .9rem. `dt` como `.micro` en #dbe7f7; `dd` 1rem, 600, #fff, con segunda línea .85rem #dbe7f7; divisores de 1px `rgba(255,255,255,.12)` |

**Variantes:** con resumen (`/`) y compacta con filtros (`/history`, padding `2rem 0 2.5rem`).

### 5.6 `SectionHead.astro`

```html
<section id="librerias" class="psec" aria-labelledby="librerias-t">
  <div class="wrap">
    <header class="shead"><span class="snum" aria-hidden="true">01</span>
      <div class="stack"><span class="eyebrow">Librerías Exocad gratuitas</span>
        <h2 class="h-lg" id="librerias-t">Librerías de implantes</h2><p>…</p></div></header>
    <slot />
  </div>
</section>
```

**CSS:**

- `.psec`: `padding-block: clamp(2.5rem,5vw,4rem); scroll-margin-top: calc(var(--bar-h) + 1rem)`.
- `.shead`: `grid-template-columns: auto 1fr`, gap 1.25rem, `margin-bottom: 2rem`; el `p` va en `--slate` con máx. 62ch.
- `.snum`: lo de §2.2.
- `.sgroup`: subgrupo `h3` en estilo `.micro` con su cifra, flex, `::after` de 1px `--line` con `flex: 1`, margen `2rem 0 1rem`. Dentro de un subgrupo los títulos de tarjeta son `h4`.

### 5.7 `Alert.astro` (aviso en línea y de resultado)

```html
<div class="alert alert--ok" role="status" data-flash="ok" id="resultado" tabindex="-1" autofocus>
  <Icon name="check-circle" size={20} />
  <div class="alert__body">
    <p class="alert__t"><b>Listo:</b> la foto nueva ya está en la web.</p>
    <p>Si todavía ves la anterior, recarga la página de la web…</p>
    <div class="alert__act"><!-- formularios o enlaces: Deshacer, Volver a la v10, Ver página pública --></div>
  </div>
</div>
```

- **Propiedades:** `tone` (ok, warn, err o info), `title`, `text`, `focus` (pone `tabindex=-1` y `autofocus`, solo en avisos de resultado) y la ranura de acciones.
- **Rol:** ok e info llevan `role="status"`; warn y err, `role="alert"`.
- **Pruebas:** `data-flash` siempre lleva el tipo; las pruebas lo leen (§9.9).
- **CSS:** rejilla `20px 1fr`, gap .7rem, padding `.9rem 1rem`, radio 12, texto `--ink` (≥12.2:1 sobre cualquier tinte), icono en el color del tono. Variantes `--ok`, `--warn` y `--err` con `--x-bg` y borde de 1px `--x-line`; `--info` con `--well` y borde `--card-line`. Las acciones van en flex con wrap y gap .5rem.
- **Regla:** siempre icono, palabra inicial en negrita («Listo:», «Ojo:», «No se pudo…») y texto. Nunca solo color.

### 5.8 `Chip.astro`

Chip: `span.chip.chip--{ok|warn|neutral|solid-ok|solid-warn|navy}` con icono de 12 px y una palabra.

- **CSS base:** inline-flex, gap .35rem, padding `.3rem .65rem`, radio 999, .72rem, 600, .06em, mayúsculas, `border: 1px solid transparent` (para que se vean en colores forzados).
- **Tonos:**

  | Variante | Colores | Uso |
  |---|---|---|
  | `ok` | `--ok` sobre `--ok-bg` | «Activa» |
  | `warn` | `--warn` sobre `--warn-bg` | «Falta» dentro del cuerpo |
  | `solid-ok` | #fff sobre #15803d (5.02) | «Recién actualizado» sobre la imagen |
  | `solid-warn` | #fff sobre #92400e (7.09) | «Falta» sobre el marco |
  | `navy` | #fff sobre `rgba(255,255,255,.1)` con punto de 8 px #4ade80 | «En línea» en la tarjeta de versión |
  | `navy-warn` | #fcd34d sobre `rgba(252,211,77,.16)` | «Sin publicar» |
  | `neutral` | `--slate` sobre `--well` | «Error 404» |

### 5.9 `Tags` (dónde aparece)

- **Markup:** `ul.tags > li`, que no es interactivo. Copia `.tags` de Servicios: .8rem, 600, radio 999, padding `.4rem .8rem`.
- **Color:** `--pill-fg` sobre `--pill-bg`, es decir, #045cb4 en claro (5.87) en vez del `--blue` del sitio (4.25 sobre neblina) y #8fc1ff en oscuro.

### 5.10 Botones (`.btn` del sitio y modificadores del panel)

- **Se usan sin cambios:** `.btn--primary`, `.btn--outline`, `.btn--ghost` y `.btn--white` (estos dos, solo sobre navy).
- **Arreglo del panel:** en oscuro, `.btn--outline:hover` lleva texto #fff sobre #046bd2 y borde #046bd2. En el sitio, la regla oscura gana a la de hover y deja #6fb6ff sobre #046bd2 (2.43:1).

**Modificadores nuevos:**

| Modificador | Estilo |
|---|---|
| `.btn--sm` | padding `.55rem 1.05rem`, .85rem, gap .45rem, `min-height: 44px` |
| `.btn--block` | `width: 100%; white-space: normal; justify-content: space-between` en los `summary` |
| `.btn--quiet` | transparente, sin borde, color `--link`, 600, .85rem, padding `.5rem .75rem`, `min-height: 44px`, radio 999; hover con fondo `rgba(4,107,210,.08)` (oscuro `rgba(111,182,255,.14)`) y subrayado con offset 3px. Sobre navy: `--n-link` |
| `summary.btn` | `list-style: none`; `::-webkit-details-marker { display: none }`. El chevron gira 180° con `details[open]`; dos `span` alternan «Reemplazar foto» y «Cerrar» |
| Deshabilitado (`:disabled`, `[aria-disabled="true"]`) | opacidad .55, `cursor: not-allowed`, sin elevación, sombra ni destello |
| Ocupado (`[aria-busy="true"]`) | spinner de 16 px (anillo de 2px `currentColor` con el lado derecho transparente, .8s lineal; quieto con movimiento reducido) y texto cambiado («Subiendo… 45 %», «Verificando…») |
| Foco | `outline: 3px solid var(--focus); outline-offset: 3px`; #8fc1ff sobre navy |
| ≤560 | `.btn { white-space: normal }` (el sitio pone `nowrap`); en formularios, `.btn--block` |

### 5.11 `Field.astro` (campo)

```html
<label class="field"><span>Número de versión</span>
  <span class="field--affix"><span aria-hidden="true">v</span>
    <input name="version" value="11" inputmode="numeric" pattern="v?[0-9]{1,3}" required aria-describedby="ver-h ver-e" /></span>
  <span class="hint" id="ver-h">La siguiente libre es la 11.</span>
  <span class="field__error" id="ver-e" hidden><Icon name="alert-circle" size={14} /><span class="sr-only">Error: </span>…</span>
</label>
```

**CSS:**

| Parte | Estilo |
|---|---|
| Etiqueta | rejilla, gap .4rem, .85rem, 600, `--ink` |
| Control | `font: inherit`, 1rem, padding `.85rem 1rem`, radio 12, borde `1.5px solid var(--field)`, fondo `--card` (oscuro: `--well`), color `--ink`, `min-height: 48px`; marcador en `--muted` |
| Foco | `border-color: var(--focus)` + `box-shadow: 0 0 0 4px rgba(4,107,210,.18)` (oscuro `rgba(111,182,255,.22)`); `outline: 0` |
| No válido | `[aria-invalid="true"]` con borde `--err`. `.field__error` en .82rem, 600, `--err`, con icono |

**Variantes:**

| Variante | Detalle |
|---|---|
| `--affix` | `inline-grid 44px 1fr`. La celda «v» lleva `--well`, `--muted`, 700 y el mismo borde, sin el derecho; radios `12 0 0 12` y `0 12 12 0` |
| `--code` (TOTP) | 1.6rem, 600, `letter-spacing: .4em`, tabular, `max-width: 15ch` (100 % a ≤560); `type=text`, `inputmode=numeric`, `autocomplete=one-time-code`, `pattern="[0-9 ]{6,7}"`, **sin `maxlength`** |
| `--password` | `padding-right: 6.5rem`; «Mostrar» es un `.btn--quiet` en posición absoluta a la derecha, oculto sin JS |
| `date` | nativa; el selector oscuro viene de `color-scheme` |

**Estados:** reposo, foco, no válido, deshabilitado y conservado tras un error (valor que manda el servidor).

### 5.12 `Dropzone.astro` (zona de soltar)

```html
<label class="drop" data-drop data-kind="image" data-max-bytes="13631488" data-min-width="800">
  <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-describedby="team-req team-err" />
  <span class="drop__ui" aria-hidden="true">
    <span class="tile"><Icon name="upload" size={22} /></span>
    <b>Arrastra la foto aquí</b><span>o <u>elige un archivo</u></span>
  </span>
  <span class="drop__file" hidden><!-- FileRow, lo rellena JS --></span>
</label>
<p class="hint" id="team-req">PNG, JPG o WebP · al menos 800 px de ancho · hasta 13 MB</p>
<p class="field__error" id="team-err" role="alert" hidden></p>
```

**CSS base:** `position: relative`, rejilla, `place-items: center`, gap .35rem, centrado, padding 1.25rem, `border: 2px dashed var(--field)`, radio 16, fondo `--well`. Alto mínimo: 132 px; 168 px para el zip; 96 px para la portada (`.drop--sm`).

- **Sin JS:** el input se ve dentro del recuadro. `::file-selector-button` es una píldora `--grad-blue` (#fff, 600, .85rem, padding `.6rem 1.1rem`, radio 999, `margin-right: .9rem`). La copia «Arrastra…» no aparece.
- **Con `html.js`:**
  - **Lo pone el propio paquete del panel, no `theme-init.js`.** Si el paquete falla, el input sigue visible y usable.
  - El input pasa a `position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer`. Así cubre la zona y el clic, el teclado y el soltar nativo siguen funcionando.
  - `.drop__ui` se ve.
  - Los dos estados miden lo mismo, para que no haya salto de maquetación.
- **Estados:**

  | Estado | Estilo |
  |---|---|
  | hover | borde `--focus` |
  | foco | `.drop:has(input:focus-visible) { outline: 3px solid var(--focus); outline-offset: 3px }` |
  | `.is-over` | borde sólido `--focus`, fondo `rgba(4,107,210,.08)`, `scale(1.01)`, título «Suelta el archivo para revisarlo» |
  | `.has-file` | se pliega a una fila de 56 px (FileRow) |
  | `.is-invalid` | borde `--err` y el error debajo |
  | `.is-locked` | opacidad .55 y `pointer-events: none` |

- **En pantallas táctiles** (`@media (hover: none)`), el título dice «Toca para elegir la foto».

### 5.13 `FileRow` (archivo elegido; dentro de la zona; solo JS)

- **Contenido:** rejilla `2.75rem 1fr auto`. Lleva un mosaico de tipo (miniatura `blob:` de 44 px con radio 10 si es imagen; `film`, `file-text` o `package` si no), el nombre (600, puntos suspensivos en medio y el nombre completo en `title`), el peso (.82rem, `--muted`, tabular) y «Cambiar archivo» (.btn--quiet, visual).
- **Comportamiento:** toda la fila sigue dentro del `label`, así que cualquier clic reabre el selector. Para quitar el archivo se usa «Cancelar» (`type=reset`) del formulario.

### 5.14 `Compare` y `Checks` (solo JS; ocultos con `hidden` hasta elegir archivo)

**Compare** (solo imágenes):

- Rejilla `1fr auto 1fr`, gap .75rem.
- Dos marcos (`.frame`, 4:3, o 16:10 / 1200:630 según el archivo) sobre el mismo escenario que la tarjeta, con `object-fit: contain`. En og, la «Nueva» va con `cover`.
- Etiquetas «ACTUAL» y «NUEVA» como insignias (#fff sobre `rgba(10,26,58,.72)`, 6.92 incluso sobre una foto blanca) arriba a la izquierda, y una flecha `arrow-right` de 20 px en `--muted`.
- Debajo, en .85rem: nombre, «3.4 MB · 4032 × 3024 px» y «Se guardará a 1800 px de ancho.» o «Se guardará en su tamaño actual.».

**Checks:** `ul.checks > li` en rejilla `18px 1fr`. Siempre icono más texto, con la palabra inicial en negrita:

| Tipo | Icono y color | Fondo |
|---|---|---|
| ok | `check` en `--ok` | — |
| info | `info` en `--link` | — |
| warn | `alert-triangle` en `--warn` | `--warn-bg`, radio 12, padding `.6rem .8rem` |
| err | `x` en `--err` | `--err-bg`, radio 12, padding `.6rem .8rem` |

### 5.15 `UploadProgress.astro` (solo JS; `hidden` hasta enviar)

```html
<div class="upl" data-upl hidden>
  <p class="upl__head"><span class="upl__name">Subiendo «equipo-2026.jpg»</span><b class="upl__pct">45 %</b></p>
  <progress max="100" value="45" aria-label="Progreso de la subida"></progress>
  <p class="upl__sub">1.5 MB de 3.4 MB · quedan unos 10 s</p>
  <button type="button" class="btn btn--quiet" data-upl-cancel>Cancelar subida</button>
</div>
```

**CSS:**

- `progress`: `appearance: none`, alto 8 px, radio 999, pista `--track`, relleno `--fill` (`::-webkit-progress-value` y `::-moz-progress-bar`).
- El porcentaje va en 700 y tabular.
- **Procesando:** se quita `value` y el `progress:not([value])` muestra una franja que se mueve; con movimiento reducido es una barra quieta al 40 % de opacidad más el texto.

**Estados:** subiendo, procesando, cancelada (desaparece y salta un aviso flotante) y fallida (se cambia por `.alert--err` en el sitio, con «Reintentar»).

### 5.16 `SlotCard.astro` (tarjeta de archivo: `image`, `video`, `document`)

```html
<article class="card slot slot--image is-fresh" id="slot-team" aria-labelledby="slot-team-t"
         data-slot="team" data-drop-target>
  <div class="slot__media frame r-4x3 stage--well">
    <img src="https://expertsddt.com/img/team.webp?v=1731007200000" alt="Imagen actual de «Foto del equipo»"
         loading="lazy" decoding="async" data-preview />
    <span class="chip chip--solid-ok"><Icon name="check" size={12} />Recién actualizado</span>
  </div>
  {flashForThisSlot && <Alert focus … />}                      <!-- área "banner" -->
  <div class="slot__body">
    <ul class="tags"><li>Inicio</li><li>Servicios</li></ul>
    <h4 class="slot__title" id="slot-team-t">Foto del equipo</h4>
    <p class="meta"><span>105 KB · 7 nov 2026, 2:40 p.m.</span>
      <a class="btn btn--quiet" href="https://expertsddt.com/es/services/#support" target="_blank" rel="noopener">Ver en la web <Icon name="external-link" size={14} /><span class="sr-only"> (se abre en otra pestaña)</span></a></p>
  </div>
  <details class="slot__more" open={flashForThisSlot?.type === 'err'}>
    <summary class="btn btn--outline btn--sm btn--block">
      <Icon name="upload" size={16} /><span class="when-closed">Reemplazar foto</span><span class="when-open">Cerrar</span>
      <span class="sr-only"> «Foto del equipo»</span><Icon name="chevron-down" size={16} /></summary>
    <div class="slot__panel">
      <form method="post" action="/upload/slot" enctype="multipart/form-data" data-upload data-kind="image">
        <input type="hidden" name="_csrf" value={csrf} />      <!-- SIEMPRE el primer campo -->
        <input type="hidden" name="slot" value="team" />
        <Dropzone … />  <Compare />  <ul class="checks" data-checks hidden></ul>
        <p class="consequence">Al publicar, la foto nueva reemplaza a la actual en Inicio (pilar «Soporte y contacto») y en Servicios («Visitas de consultoría y soporte»). La actual queda guardada.</p>
        <UploadProgress />
        <div class="slot__actions"><button class="btn btn--primary btn--sm" type="submit">Publicar en la web</button>
          <button class="btn btn--quiet" type="reset">Cancelar</button></div>
      </form>
      <Copies slot={slot} />  <Tech slot={slot} />
    </div>
  </details>
</article>
```

**CSS:**

- `.slot`: rejilla con `grid-template-areas: "media" "banner" "body" "more"`, padding 0, `overflow: clip`.
- **Contorno del destino:** `.slot:target` y `.slot.is-flash` llevan `outline: 2px solid var(--focus); outline-offset: 4px`, que se desvanece a los 3 s.
- **Marco** (`.frame`): `position: relative`, `aspect-ratio` por clase (`r-4x3`, `r-16x10`, `r-og` = 1200/630), escenario por clase y borde inferior de 1px `--card-line`.
  - `img` y `video` con `width: 100%; height: 100%; object-fit: contain`. **Nunca `cover` para lo publicado.**
  - El `alt` lleva estilo (.85rem, `--muted`, centrado), para cuando falla la carga.
  - El chip va arriba a la izquierda, a .75rem.
- **Cuerpo** (`.slot__body`): padding `1.1rem 1.25rem .75rem`, gap .4rem. `.meta` es flex con `justify-content: space-between` y `min-height: 44px`.
- **Desplegable** (`.slot__more`): padding `0 1.25rem 1.25rem`. `.slot__panel`: `border-top: 1px solid var(--line)`, `padding-top: 1rem`, rejilla con gap .9rem.
- `.consequence`: .9rem, `--slate`.
- **Fila compacta (≤560):** `grid-template-columns: 6.5rem 1fr`, áreas `"banner banner" "media body" "more more"`, marco con radio 12 y padding .75rem.
- **Variante `--video`:** marco 16:10 con escenario `dark`, `<video controls preload="none" muted playsinline poster aria-label="Video actual: «…»">` y la meta «1.0 MB de 12 MB».
- **Variante `--doc`** (§4.4): áreas `"tile body link" "banner banner banner" "more more more"`; el `summary` es de ancho automático.

**Estados:** los de §4.5 (A–K). La clase `.is-fresh` la pone el servidor si `mtime` es de hace menos de 10 min; `.is-missing` si el archivo no existe (marco vacío, chip «Falta», `summary` primario «Subir foto»).

**El servidor abre como mucho una tarjeta:** la del aviso de error. No se usa `<details name>` exclusivo: cerraría una tarjeta en plena subida.

### 5.17 `Copies.astro` (versiones anteriores)

```html
<details class="copies"><summary class="btn btn--quiet">Versiones anteriores (3) <Icon name="chevron-down" size={14} /></summary>
  <ol>
    <li><span class="chip chip--neutral">La anterior</span>
      <span>Estuvo en la web hasta el 7 nov 2026, 2:40 p.m. · 98 KB</span>
      <form method="post" action="/restore" data-confirm data-confirm-title="…" data-confirm-text="…" data-confirm-ok="Sí, volver a esta versión">
        <input type="hidden" name="_csrf" value={csrf} /><input type="hidden" name="slot" value="team" />
        <input type="hidden" name="file" value="2026-11-07T19-40-10-123Z__team.webp" />
        <button class="btn btn--outline btn--sm" type="submit"><Icon name="rotate-ccw" size={16} />Volver a esta<span class="sr-only"> versión del 7 nov 2026, 2:40 p.m.</span></button></form></li> …
  </ol>
  <p class="hint">Volver a una versión guarda la actual, así que también se puede deshacer.</p>
</details>
```

- Muestra las 6 copias más recientes, sin miniatura: no hay ruta de vista previa de copias (§9.5).
- En videos, cada fila lleva el chip «Video» o «Portada».
- Si no hay copias, el componente no se pinta.
- **CSS:** cada `li` es una rejilla `auto 1fr auto` (a ≤560 se apila), padding `.75rem 0` y borde superior `--line`.

### 5.18 `Tech.astro` (detalles técnicos)

- **Markup:** `details.tech > summary.btn.btn--quiet` «Detalles técnicos» y un `dl` en .8rem; `dt` en `--muted`; `dd` con `.mono` y `overflow-wrap: anywhere`.
- **Contenido en un archivo:** archivo en la web (`img/team.webp`), formato final («WebP, se convierte solo»), ancho mínimo, ancho máximo guardado y medidas actuales (las rellena JS desde `naturalWidth`).
- **Contenido en la librería:** nombre del archivo y huella SHA-256 completa, con el botón «Copiar huella» (`.btn--ghost.btn--sm`, solo JS, `data-copy`).
- En la tarjeta navy, el `summary` va en #dbe7f7.

### 5.19 `VersionCard.astro` (versión activa con disco)

- **Markup:** `article.vcard.on-navy` en rejilla `136px 1fr` (a ≤560, disco de 104 px arriba). Lleva:
  - `div.disc` (`aria-hidden`) con «VERSIÓN» y «v10»;
  - el chip navy «En línea» y `h3` «Versión v10» (1.5rem, 800, #fff);
  - la fecha en #c7d6ee;
  - un `dl` de estadísticas en 3 columnas con divisores `rgba(255,255,255,.14)` (`dt` .7rem en mayúsculas #c7d6ee; `dd` 1.05rem, 700, #fff, tabular);
  - la frase «Así la ven los doctores» (.9rem, #c7d6ee);
  - las acciones `.btn--white.btn--sm` «Ver página pública» y `.btn--ghost.btn--sm` «Descargar el zip» (enlace directo al zip: no crea contactos falsos en n8n);
  - `Tech`.
- **Disco:** círculo de 136 px con `conic-gradient(from 200deg, #046bd2, #1d3273, #2a7abf, #046bd2)` y la sombra de §2.4. «VERSIÓN» en .7rem, 700, .3em; «v10» en 2.1rem, 800, tabular, #fff (≥4.53 sobre el tramo más claro). En reposo no gira. `.is-fresh` lo hace girar una vez (sin movimiento reducido).
- **Estados:** activa, recién publicada (chip «Publicada hace un momento» y giro), vacía (disco con «—», chip «Sin publicar», texto de §7 y sin acciones) y huella copiada.

### 5.20 `PublishCard.astro` (publicar una versión nueva)

```html
<form class="card pubcard" method="post" action="/upload/libraries" enctype="multipart/form-data" data-upload data-kind="library"
      data-version-form data-existing="v9,v10" data-tpl="Versión {v} · actualizada el {d} · {s} MB"
      data-confirm data-confirm-title="¿Publicar la versión {v}?" data-confirm-ok="Sí, publicar la {v}">
  <input type="hidden" name="_csrf" value={csrf} />    <!-- primero -->
  <h3 class="card-t">Publicar una versión nueva</h3><p>…</p>
  <ol class="steps">
    <li><span class="step-n" aria-hidden="true">01</span><h4>Elige el archivo .zip</h4><Dropzone kind="library" /></li>
    <li><span class="step-n" aria-hidden="true">02</span><h4>Ponle número y fecha</h4><Field version /><Field dataDate /></li>
    <li><span class="step-n" aria-hidden="true">03</span><h4>Revisa y publica</h4>
      <div class="well preview" data-preview-line hidden>…</div><p class="consequence">…</p><UploadProgress />
      <button class="btn btn--primary btn--block" type="submit">Publicar esta versión <Icon name="arrow-right" /></button>
      <p class="hint"><Icon name="info" size={14} />Un archivo grande puede tardar varios minutos en subir: no cierres esta pestaña.</p></li>
  </ol>
</form>
```

- **Fecha:** `type=date`, `required`, `max` igual a hoy en Florida y `value` igual a hoy.
- **Número de versión:** el servidor propone el siguiente libre.
- **CSS:** `.steps` hace eco de `.step b` de la página de librerías. Cada `li` es una rejilla `2.5rem 1fr`; `.step-n` es el número calado de 2rem; borde superior `--line` entre pasos. Los dos campos van lado a lado a ≥560.

### 5.21 `VersionList.astro` (versiones publicadas)

- **Markup:** `ol.versions`, más una fila visual de encabezados con `aria-hidden="true"`.
- **Cada `li`:** «v9» (1rem, 700), «datos del 4 nov 2026», «9.7 MB», «3 archivos» y la acción. Se lee completo sin encabezados.
- **Escritorio:** rejilla `6rem 1fr 6rem 7rem 13rem`.
- **≤560:** dos líneas (versión y acción; resto en .85rem).
- **Fila activa:** `box-shadow: inset 3px 0 0 var(--focus)`, fondo `rgba(4,107,210,.05)` (oscuro `rgba(111,182,255,.08)`) y el chip «Activa» con `check`.
- **Otras filas:** formulario a `/libraries/activate` (`_csrf` y `file`) con `data-confirm` y el botón `.btn--outline.btn--sm` «Activar la v9».
- **Vacía:** `EmptyState` con «Las versiones que publiques aparecerán aquí.».

### 5.22 `ConfirmDialog.astro` (una sola instancia en el marco)

```html
<dialog class="dlg" id="confirm" aria-labelledby="dlg-t" aria-describedby="dlg-d">
  <form method="dialog" class="dlg__in">
    <button class="dlg__x" value="cancel" aria-label="Cerrar"><Icon name="x" /></button>
    <span class="tile tile--48" data-dlg-icon><Icon name="package" /></span>
    <h2 id="dlg-t">…</h2><p id="dlg-d">…</p><div class="well" data-dlg-detail hidden></div>
    <div class="dlg__act"><button class="btn btn--outline" value="cancel" autofocus>No, volver</button>
      <button class="btn btn--primary" value="ok">…</button></div>
  </form>
</dialog>
```

- El contenido sale de los atributos `data-confirm-*` del formulario que lo abre.
- **CSS:** padding `clamp(1.4rem,4vw,2rem)`, gap 1rem, `h2` de 1.4rem / 700; la «×» es de 44 px como `.lib-close`. Las acciones van en flex al final con gap .6rem; a ≤560 usan `column-reverse` con botones a todo el ancho.

### 5.23 `Toasts` (región; los avisos los crea JS)

- **Región:** `div.toasts[aria-live=polite]`, fija con `right: 1rem` y `bottom: max(1rem, env(safe-area-inset-bottom))`, `z-index: 120`, `width: min(420px, 100% - 2rem)`, rejilla con gap .6rem. A ≤560 se pega a 1rem de cada lado.
- **Cada aviso** (`.toast[data-tone=info|err]`): rejilla `32px 1fr 44px`, padding `.9rem 1rem`, §2.5, título .9rem / 700 #fff y «×» de 44 px «Cerrar aviso».
  - Los de error llevan `role="alert"`.
  - Los informativos se ocultan a los 6 s, con pausa al pasar el ratón o al enfocar.
  - Como mucho hay 3 a la vez.
- **Nunca se pintan desde el servidor.**

### 5.24 `EmptyState.astro`

- **Markup:** rejilla centrada, gap .6rem, padding `2rem 1.25rem`, borde `1.5px dashed var(--field)`, radio 16. Lleva un mosaico de 44 px, título 1rem / 600 `--ink`, texto .9rem `--muted` (máx. 46ch) y un botón opcional.
- **Usos:** librería vacía, lista de versiones vacía, historial vacío y filtro vacío.

### 5.25 `HistoryList.astro` y filtros

- **Filtros:** `nav.jump[aria-label="Filtrar historial"]` dentro de la franja, con enlaces `?tipo=cambios|accesos|todo`. El actual lleva `aria-current="page"`, fondo #fff y texto #0f346e (12.09).
- **Lista:** `section > h2.log__day` (.72rem, 600, .16em, mayúsculas, `--pill-fg`) y `ol.log > li`.
  - Cada `li` es una rejilla `6.5rem 2rem 1fr`, gap .75rem, padding `.85rem 0` y borde superior `--line`.
  - La hora va en .9rem, 600, tabular. El avatar es de 28 px.
  - La frase va en .95rem `--ink`, con el nombre en 600 y el icono de la acción de 16 px en `--link`.
  - El detalle va en `.mono` .75rem `--muted`.
- **Fallidos o bloqueados:** fondo `--warn-bg`, radio 12, `padding-inline: .75rem` e icono `alert-triangle` en `--warn`.

### 5.26 `Footer.astro`

Es lo descrito en §4.7. Los enlaces van en `--n-link` y pasan a #fff con hover.

### 5.27 Salto y regiones vivas

- **`.skip`:** `position: fixed; top: .75rem; left: .75rem`, con `translateY(-200%)` hasta `:focus`. Entonces se ve con fondo #fff, texto #0f346e, .9rem 600, padding `.7rem 1.1rem`, radio 999 y `z-index: 200`. Va a `main#main`. (El salto del sitio es `.sr-only` y nunca se ve: aquí se corrige.)
- **`#sr-status`:** con `role=status` y `aria-live=polite`, ya en el HTML. Anuncia hitos de subida, archivo aceptado, copia y cancelación.

### 5.28 `Avatar` (`.av`)

Círculo de 36 px (28 px en el historial) con `--grad-blue` y las iniciales del nombre de `users.json` en blanco (700, .78rem / .68rem). Lleva `aria-hidden`.

### 5.29 `Icon.astro`

- **Propiedades:** `name` y `size` (16 por defecto). Pinta un `<svg>` con los atributos de §2.6 y el trazado del mapa.
- **Sin `style`:** el tamaño va por los atributos `width` y `height`.

### 5.30 `InfoList` (Bueno saber)

- **Markup:** `ul.info > li` en rejilla `18px 1fr`, gap .6rem, .95rem `--slate`, con icono `info` en `--link`.

---

## 6. Interacciones y su alternativa sin JavaScript

Regla general: toda acción es un `<form method="post">` cuyo primer campo es `_csrf`. Sin JS, el formulario se envía, el servidor responde con un 303 y la página nueva muestra el aviso. JS nunca sustituye el formulario: intercepta el envío para validar, mostrar el progreso o confirmar, y siempre termina en el mismo flujo del servidor.

### 6.1 Iniciar sesión

- **Sin JS.** POST a `/login`.
  - Si falla con 401, el servidor vuelve a pintar la página con «Credenciales inválidas.», el correo conservado y el foco en la contraseña.
  - Con 429 muestra el aviso de acceso pausado.
  - Si todo va bien, redirige con 303 a `/`.
- **Con JS:**
  - Se evita el doble envío: el botón pasa a «Verificando…» con `aria-busy` y se rehabilita en `pageshow`.
  - El campo del código quita espacios y todo lo que no sea dígito al escribir y al pegar, así que «123 456» funciona.
  - Aparece el aviso de Bloq Mayús en la contraseña, mediante `getModifierState('CapsLock')`.
  - El botón «Mostrar» y «Ocultar» cambia el `type` del campo y su `aria-pressed`, y vuelve a `password` al enviar.
- **Siempre:**
  - Se puede pegar en los tres campos.
  - `autocomplete` es `username`, `current-password` y `one-time-code`, así que los gestores de contraseñas que guardan TOTP lo rellenan.
  - El servidor quita los espacios del código antes de comprobar `/^\d{6}$/`.

### 6.2 Tema claro u oscuro

- **Sin JS:** tema claro y sin botón.
- **Con JS:** `public/theme-init.js` es un script clásico externo y bloqueante en el `<head>`. Aplica el tema guardado (`localStorage 'theme'`) o el del sistema antes de pintar. Solo pone `data-theme`; **no** pone `html.js`.

  ```js
  (function(){var d=document.documentElement,t=null;try{t=localStorage.getItem('theme')}catch(e){}
  if(t!=='dark'&&t!=='light')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.dataset.theme=t})();
  ```

- El botón quita su `hidden`, cambia `data-theme`, lo guarda y actualiza `aria-pressed` y `aria-label`.

### 6.3 Navegación y anclas

- Todo son enlaces normales. Las píldoras y los enlaces de sección son anclas con `scroll-margin-top`.
- Con `prefers-reduced-motion: no-preference`, el desplazamiento es suave.
- No hay menú que dependa de JS: a ≤760 está la fila de pestañas.

### 6.4 Abrir el panel de reemplazo

- Es un `<details>` nativo; con o sin JS se abre con Enter o Espacio.
- Tras un error del servidor, la tarjeta afectada llega con `open`, el aviso dentro y el error bajo la zona (`aria-invalid` y `aria-describedby`).
- No se usa `details[name]` exclusivo.

### 6.5 Elegir un archivo y comprobarlo en el navegador

- **Sin JS:** input nativo dentro del recuadro. El navegador valida `required` y `accept`, y el servidor valida todo.
- **Con JS:** al cambiar el archivo se comprueba con las reglas del servidor, antes de subir un solo byte:

| Tipo | Acepta | Máximo | Bloquea | Avisa sin bloquear |
|---|---|---|---|---|
| Imagen | `image/png`, `image/jpeg`, `image/webp`; sin sharp (`canConvert=false`), solo el formato del archivo actual | 13 MB | otro tipo; HEIC o HEIF (mensaje propio); ancho menor que `minWidth`; no se puede decodificar (`createImageBitmap` falla) | proporción distinta en más del 10 % de la actual (`naturalWidth/Height`) o de su pareja; JPG en un recorte (`alpha: true`); og que no mide 1200×630 (info: «la recortamos») |
| Portada de video | igual que imagen | 13 MB | igual, con mínimo de 320 px | — |
| Video | `video/mp4` / `.mp4` | `maxBytes` (12 MB) | otro tipo; `.mov` o `video/quicktime` (mensaje propio); peso | — |
| PDF | `application/pdf` | 10 MB | otro tipo; peso | — |
| Zip | `.zip`, `application/zip`, `application/x-zip-compressed` | `LIB_MAX_MB` | otro tipo; peso; una carpeta soltada (`webkitGetAsEntry().isDirectory`) | — |
| Cualquiera | — | — | archivo de 0 bytes | — |
| Versión | `^v?\d{1,3}$` | — | vacía; no numérica; repetida (`data-existing`) | — |
| Fecha de los datos | `YYYY-MM-DD` | `max` = hoy en Florida | vacía o futura (el atributo `max` bloquea también sin JS) | — |

- **Al pasar las comprobaciones:**
  - Se muestran Compare (en imágenes, con un `blob:` creado por `URL.createObjectURL` y revocado al cambiar o cancelar) y las comprobaciones.
  - La zona se pliega a FileRow.
  - `#sr-status` anuncia «Foto lista para revisar: equipo-2026.jpg. 2 comprobaciones correctas, 1 aviso.».
- **Si un error bloquea:** el botón «Publicar en la web» **no se deshabilita**. Al pulsarlo, el foco va al input con el error en su `aria-describedby`. Se pone `form.noValidate = true` para usar los mensajes propios en español.

### 6.6 Arrastrar y soltar (solo JS)

- **Sobre la zona.** Es nativo: el input cubre la zona. JS solo pone `.is-over` con `dragenter` y lo quita con `dragleave` y `drop`.
- **Sobre la tarjeta entera** (`[data-drop-target]`):
  - Al arrastrar encima se muestra la capa «Suelta para reemplazar «…»», sin abrir nada: así la tarjeta no cambia de tamaño bajo el cursor.
  - Al soltar se abre el `details`, se hace `input.files = e.dataTransfer.files`, se lanza `change` y el panel se desplaza a la vista (`block: 'nearest'`).
- **Varios archivos:** se usa el primero y un aviso flotante lo dice.
- **Fuera de un objetivo:** en `window`, `dragover` y `drop` llevan `preventDefault`, para que el navegador no abra el archivo y se pierda la página. Un aviso flotante dice «Suelta el archivo sobre la tarjeta que quieres cambiar.».
- **Alternativa sin arrastre:** el clic y el teclado siempre abren el selector (2.5.7).

### 6.7 Publicar un reemplazo (contrato con el servidor)

- **Sin JS.** POST multipart a `/upload/slot`. El servidor:
  1. valida, convierte, quita los metadatos y guarda una copia;
  2. responde con 303 a `/#slot-<id>` y la cookie de aviso;
  3. al recargarse, la página muestra el aviso dentro de la tarjeta, el chip «Recién actualizado», el contorno `:target` y el prefijo del `<title>`.
- **Con JS** (`form[data-upload]`):

```ts
const xhr = new XMLHttpRequest();
xhr.open('POST', form.action);
xhr.setRequestHeader('X-Panel-Xhr', '1');                 // el servidor responde 200 {to} en vez de 303
xhr.upload.onprogress = (e) => progress(e.loaded, e.total); // barra, %, «x de y MB · quedan unos n s»
xhr.upload.onload = () => processing();                    // barra indeterminada: «Optimizando la foto…»
xhr.onload = () => {
  if (xhr.status === 413) return fail('El servidor rechazó el archivo por su tamaño.'); // proxy
  let to = '/'; try { to = JSON.parse(xhr.responseText).to || '/'; } catch {}
  const u = new URL(to, location.href);
  if (u.origin !== location.origin) return;                // nunca navegar fuera
  if (u.pathname === location.pathname) {                  // mismo documento: assign() solo movería el ancla
    history.replaceState(null, '', u.pathname + u.search + u.hash);
    location.reload();                                     // obligatorio para que se pinte el aviso del servidor
  } else location.assign(u.href);                          // p. ej. /login
};
xhr.onerror = xhr.ontimeout = () => fail('red');           // aviso en línea + «Reintentar»; el archivo sigue elegido
xhr.send(new FormData(form));                              // el orden del DOM mantiene _csrf primero
```

- **Por qué no se sigue el 303 desde XHR:** XHR seguiría la redirección en silencio, y ese GET oculto consumiría la cookie de aviso. Por eso existe la rama JSON.
- **Tras la recarga:**
  - El navegador va al ancla.
  - `autofocus` lleva el foco al aviso, y JS hace `focus()` de respaldo si el aviso existe y no lo tiene.
  - En `#sr-status` se anuncian los hitos 25, 50, 75 y 100 % (nunca cada punto) y «Procesando el archivo».

### 6.8 Una subida a la vez, cancelar y salir

- **Una sola subida a la vez.** Al navegar al terminar, cualquier subida paralela se abortaría. Mientras hay una en curso, los demás botones de enviar llevan `aria-disabled="true"` y la nota «Espera a que termine la subida en curso.». JS ignora sus envíos.
- **«Cancelar subida»:** llama a `xhr.abort()`, devuelve el formulario a «archivo elegido» y muestra el aviso flotante «Subida cancelada. Nada cambió en la web.». El foco va al botón «Publicar en la web». El servidor ve que la petición se abortó y borra los temporales (§9.4).
- **Salir a mitad:** mientras se sube, `beforeunload` pide confirmación.
- **Errores de la subida:**
  - **Red:** aviso en línea `role="alert"` (§7.8) con el botón «Reintentar» (envía de nuevo).
  - **413 del proxy:** mensaje de tamaño.
  - **Sesión caducada:** el servidor responde 401 `{to:"/login"}` y la página de login lo explica.

### 6.9 Publicar una versión de librerías

- **Sin JS:**
  - Valen `required`, `pattern="v?[0-9]{1,3}"` y `max` en la fecha. El servidor ya propone el número y la fecha.
  - Se envía, y vuelve con 303 a `/#librerias`.
  - La nota avisa de que los archivos grandes tardan minutos. No hay diálogo: se puede volver a la versión anterior y la frase de consecuencia está a la vista.
- **Con JS:**
  1. El número y la fecha actualizan en vivo la línea «Así se verá en la web», con la plantilla pública y el peso del zip elegido, y también el botón («Publicar versión v11») y la frase de consecuencia.
  2. Se comprueba que la versión no exista.
  3. Al enviar se abre el diálogo «¿Publicar la versión v11?».
  4. Si se confirma, sigue el flujo XHR de §6.7, con «Revisando el .zip y calculando la huella…» como estado de procesando.

### 6.10 Activar una versión anterior

- **Sin JS:** POST a `/libraries/activate`, 303 a `/#librerias` y aviso con «Volver a la v10».
- **Con JS:** el diálogo «¿Volver a la versión v9?». Si se confirma, se llama a `form.requestSubmit()` con la marca `data-confirmed` (envío nativo, sin XHR).

### 6.11 Deshacer y versiones anteriores

- **«Deshacer»** aparece en el aviso de éxito de un reemplazo o de una restauración. Es un formulario a `/restore` con el `slot` y el o los `file` de las copias que acaba de crear ese cambio (la del video y la de la portada, si se cambiaron las dos).
- **«Volver a esta»** está en «Versiones anteriores» y manda la copia elegida.
- **Funcionamiento:** el servidor copia la versión guardada a un temporal y la coloca con `placeFile`. Así, lo que había antes queda guardado como copia nueva, y restaurar también se puede deshacer.
- **Sin JS:** se envía directamente. **Con JS:** primero el diálogo (§7.9).

### 6.12 Diálogo de confirmación

1. Al enviar un formulario con `data-confirm`, JS rellena título, texto, detalle y botón de aceptar con `data-confirm-*` (sustituye `{v}`, `{actual}` y `{fecha}`).
2. Guarda el elemento que tenía el foco y llama a `showModal()`. El foco va a «No, volver».
3. **Cancelar:** Esc, la «×», un clic en el fondo (`e.target === dialog`) y «No, volver». El evento `close` lee `returnValue`; si es `ok`, sigue la acción pendiente.
4. El foco vuelve al botón que lo abrió.
5. Sin JS no hay diálogo: el formulario se envía.

### 6.13 Avisos de resultado y avisos flotantes

- **Avisos de resultado** (`Alert`): los pinta el servidor, siempre en el flujo de la página.
  - Van dentro de la tarjeta (si el aviso trae `slot`), al principio de 01 (si trae `slot: 'libraries'`) o bajo la franja (en los demás casos).
  - Siguen ahí hasta la siguiente navegación y no tapan nada.
  - El `<title>` lleva el prefijo «Listo:» o «Error:».
- **Avisos flotantes** (`.toast`): solo para eventos que ocurren en el navegador. Son subida cancelada, huella copiada, varios archivos soltados, archivo soltado fuera de un objetivo y vista previa que no carga.
  - Los informativos se ocultan a los 6 s, con pausa al pasar el ratón o al enfocar.
  - Los de error se quedan hasta que se cierran.
  - **Nunca transmiten un resultado del servidor.**

### 6.14 Dónde queda el foco

| Momento | Foco |
|---|---|
| Carga normal | sin mover; el primer Tab va a «Saltar al contenido» |
| Tras una redirección con aviso | el aviso (`autofocus` y `tabindex=-1`, con `focus()` de respaldo) |
| Login con 401 | la contraseña |
| Login con 429 | el aviso |
| Abrir el diálogo | «No, volver» |
| Cerrar el diálogo | el botón que lo abrió |
| Soltar sobre una tarjeta | no se mueve; se anuncia en `#sr-status` y el panel se desplaza a la vista |
| «Publicar» con un error local | el input del archivo o el campo no válido |
| Error de red | el aviso en línea (`tabindex=-1`) |
| Cancelar la subida | el botón «Publicar en la web» de ese formulario |
| Cerrar un aviso flotante | no se mueve |

### 6.15 Otros comportamientos

- **Copiar la huella (solo JS):** `navigator.clipboard.writeText(hash)`. El botón dice «Copiada» durante 2 s y `#sr-status` dice «Huella copiada.».
- **Vista previa que falla:**
  - Con JS, ante el evento `error`, o si al iniciar `complete && naturalWidth === 0`, se cambia por el marco con `image-off` y el texto.
  - Sin JS se ve el `alt` con estilo.
  - JS también rellena las medidas reales en «Detalles técnicos» y en Compare.
- **Filtros del historial:** enlaces GET (`?tipo=`). El servidor filtra y agrupa por día en la hora de Florida.
  - `cambios`: `replace`, `restore`, `library_publish`, `library_activate`.
  - `accesos`: `login`, `logout`, `login_failed`, `login_blocked`.
- **Salir:** formulario POST con `_csrf` y 303 a `/login` con «Cerraste sesión. ¡Hasta pronto!».
- **Sesión caducada:** si llega una cookie `edp_sid` que no se puede verificar, el middleware la borra y manda a `/login` con el aviso informativo. Pasa igual con y sin JS; en XHR responde 401 JSON.

---

## 7. Textos de la interfaz (español, tuteo)

### 7.1 Global

- **Títulos de pestaña:**
  - «Iniciar sesión · Panel Experts DDT», «Contenido · Panel Experts DDT», «Historial · Panel Experts DDT».
  - Con aviso, el título del aviso va delante: «Listo: la foto nueva ya está en la web. · Contenido · Panel Experts DDT». Si es un error, lleva además «Error:»: «Error: No se pudo cambiar la foto. · Contenido · Panel Experts DDT».
- **Saltar al contenido:** «Saltar al contenido».
- **Barra:**
  - Logo: «Experts DDT», micro-etiqueta «Panel».
  - Enlaces: «Librerías», «Documentos», «Imágenes», «Videos», «Contenido», «Historial» y «Ver la web» (oculto: «(se abre en otra pestaña)»).
  - Menú: «Principal». Usuario: «Sesión iniciada como {nombre}». Salida: «Salir».
- **Tema:** «Cambiar a modo oscuro» y «Cambiar a modo claro».
- **Pie:**
  - «© {año} Fernando Polanco DDT LLC · Experts DDT · Panel de contenido, solo para personal autorizado.»
  - «¿Algo no funciona? Escríbele a Diego o a David.»
  - «Ir a expertsddt.com».
- **Frases comunes:** «Ver en la web», «Detalles técnicos», «Versiones anteriores», «Cancelar», «Cerrar», «Cerrar aviso», «Volver al panel», «(opcional)», «Nada cambió en la web.».
- **Formatos** (es-US, America/New_York):

  | Dato | Formato |
  |---|---|
  | Pesos | «105 KB», «23.7 MB» |
  | Fecha y hora | «7 nov 2026, 2:40 p.m.» |
  | Relativo | «hace 2 horas», «ayer» |
  | Día del historial | «Hoy · sábado 7 de noviembre» |
  | Fecha de datos (en UTC) | «6 de noviembre de 2026» |
  | Cantidades | «1 archivo», «35 archivos» |

### 7.2 Login

- **Lado de marca:**
  - Ceja: «Panel de contenido». Frase grande: «Tu sitio, siempre al día.», con acento en «siempre al día».
  - Entradilla: «Cambia fotos, videos y documentos de expertsddt.com y publica las librerías Exocad, sin tocar código.».
  - Beneficios: «Verificación en dos pasos» / «Contraseña y código de tu teléfono en cada acceso.» · «Siempre reversible» / «Cada archivo que reemplazas queda guardado.» · «Historial» / «Cada cambio queda anotado con fecha y autor.».
  - Versión a 375 px: «Dos pasos · Reversible · Historial».
- **Tarjeta:**
  - Título: «Iniciar sesión» / «Solo para el equipo de Experts DDT.».
  - Campos: «Correo electrónico», «Contraseña», «Código de verificación».
  - Ayuda del código: «Los 6 números de «ExpertsDDT Panel» en tu app de autenticación (Google Authenticator, Microsoft Authenticator o Authy). Cambian cada 30 segundos.».
  - Botón de contraseña: «Mostrar» / «Ocultar» (aria: «Mostrar contraseña» / «Ocultar contraseña»). Aviso: «Bloq Mayús está activado.».
  - Botón: «Entrar al panel»; ocupado: «Verificando…».
  - Ayuda: «¿No tienes cuenta o cambiaste de teléfono? Las cuentas las crea el equipo técnico: escríbele a Diego o a David.».
  - Enlace: «Volver a expertsddt.com».
- **Validación (JS):** «Escribe tu correo.» · «Revisa el correo: le falta la @ o el dominio.» · «Escribe tu contraseña.» · «El código tiene 6 números.».
- **Avisos:** los de §7.13: `login_401`, `login_429`, `expired`, `expired_upload` y `logout`.

### 7.3 Franja de «Contenido»

- **Ceja:** «Panel de contenido». **Título:** «Hola, {nombre}.»; sin nombre, «Hola.».
- **Entradilla:** «Aquí cambias las fotos, los videos y la guía PDF de expertsddt.com, y publicas las librerías Exocad. Cada cambio sale en la web al terminar la subida y guarda una copia del archivo anterior.».
- **Píldoras** (aria: «Secciones del panel»): «01 Librerías» · «02 Documentos» · «03 Imágenes 15» · «04 Videos 6»; con falta, «03 Imágenes · 1 falta».
- **Resumen** (aria: «Resumen»):
  - «Librería activa»: «v10 · datos del 6 nov 2026», o «Ninguna todavía».
  - «Último cambio»: «Foto del equipo», con «David · hace 2 horas» debajo, o «Sin cambios todavía».
  - «Archivos en la web»: «22 de 22», o «21 de 22 · falta «Foto del equipo»», o «20 de 22 · faltan 2».

### 7.4 01 · Librerías Exocad gratuitas

- **Encabezado:**
  - Ceja: «Librerías Exocad gratuitas». Título: «Librerías de implantes».
  - Texto: «Lo que publiques aquí es lo que descargan los doctores en expertsddt.com/exocad-libraries/. El cambio es inmediato.».
- **Versión activa:**
  - Chip «En línea»; recién publicada, «Publicada hace un momento».
  - Título: «Versión {v}». Fecha: «Datos del {6 de noviembre de 2026}». Disco: «Versión» / «{v}».
  - Estadísticas: «Tamaño», «Archivos», «En la web desde» («6 nov 2026 · Diego»).
  - «Así la ven los doctores: «Versión v10 · actualizada el 6 de noviembre de 2026 · 24 MB»».
  - Botones: «Ver página pública» · «Descargar el zip».
  - Detalles técnicos: «Nombre del archivo» · «Huella SHA-256» · «Copiar huella» → «Copiada».
- **Vacía:**
  - Chip: «Sin publicar». Título: «Aún no hay una versión publicada».
  - Texto: «Mientras tanto, la página pública dice «La descarga no está disponible por ahora». Publica la primera con el formulario de al lado.».
- **Publicar:**
  - Título: «Publicar una versión nueva» / «La versión actual queda guardada por si necesitas volver a ella.».
  - Pasos: «Elige el archivo .zip» · «Ponle número y fecha» · «Revisa y publica».
  - Zona: «Arrastra aquí el .zip» / «o elige un archivo» / «Solo .zip · hasta {LIB_MAX_MB} MB». En táctil: «Toca para elegir el .zip». Al arrastrar: «Suelta el archivo para revisarlo».
  - Tras un error del servidor (la página vuelve sin el archivo elegido): con un error del zip, la zona dice «Vuelve a elegir el archivo .zip.»; con un error de número o fecha, la línea de requisitos pasa a «Vuelve a elegir el archivo .zip · hasta {LIB_MAX_MB} MB».
  - «Número de versión», con ayuda «La siguiente libre es la {n}. Usa siempre un número nuevo.» (sin versiones: «Solo números, por ejemplo 1.»).
  - «Fecha de los datos», con ayuda «El día en que se actualizaron los archivos. Los doctores la ven junto a la versión.».
  - Vista previa (JS): «Así se verá en la web» y «Versión {v} · actualizada el {d} · {s} MB».
  - Consecuencia:
    - Con JS: «Al publicar, los doctores empiezan a descargar la {v} de inmediato. La {actual} queda guardada y puedes volver a ella con un clic.».
    - Sin JS: «Al publicar, los doctores empiezan a descargar esta versión de inmediato. La actual queda guardada y puedes volver a ella con un clic.».
  - Botón: con JS «Publicar versión {v}»; sin JS «Publicar esta versión».
  - Nota: «Un archivo grande puede tardar varios minutos en subir: no cierres esta pestaña.».
  - Progreso: «Subiendo «{archivo}»» · «{x} MB de {y} MB · quedan unos {n} s» (o «{n} min», o «menos de un minuto») · «No cierres esta pestaña hasta que termine.» · «Cancelar subida» · «Revisando el .zip y calculando la huella…».
  - Validación (JS): «Elige primero el archivo .zip.» · «Este archivo no es un .zip. Las librerías se publican comprimidas en .zip.» · «Arrastraste una carpeta. Comprímela primero: clic derecho › Enviar a › Carpeta comprimida (en zip).» · «Este .zip pesa {x} MB y el máximo es {LIB_MAX_MB} MB.» · «Escribe solo números, por ejemplo 11.» · «La {v} ya existe. La siguiente libre es la {n}.» · «Elige la fecha de los datos.» · «La fecha no puede ser futura.».
- **Versiones publicadas:**
  - Título: «Versiones publicadas» / «¿Algo salió mal? Activa una versión anterior y la web la ofrecerá al instante. No se borra ninguna.».
  - Columnas visuales: «Versión», «Datos del», «Tamaño», «Archivos».
  - Chip «Activa». Botón «Activar la {v}».
  - Vacía: «Las versiones que publiques aparecerán aquí.».

### 7.5 02 · Documentos

- **Encabezado:**
  - Ceja: «Documentos». Título: «Guía de servicios y tarifas».
  - Texto: «Es el PDF que se descarga en la página Servicios con el botón «Descargar guía de servicios». El mismo archivo sirve a la web en inglés y en español.».
- **Tarjeta:**
  - Ceja: «Servicios · PDF». Título: «Guía de servicios y tarifas».
  - Meta: «{172 KB} · actualizada el {12 sep 2026, 3:10 p.m.}».
  - Botones: «Abrir la guía actual» · «Reemplazar PDF» / «Cerrar».
- **Zona:** «Arrastra el PDF aquí» / «o elige un archivo» / «Solo PDF, hasta 10 MB».
- **Comprobaciones:** «Listo: es un PDF de {1.2 MB} (máximo 10 MB).» · «No se puede usar: no es un PDF.» · «No se puede usar: pesa {14.2} MB y el máximo es 10 MB.».
- **Aviso fijo:** «Ojo: junto al botón, la web dice «PDF · actualizado en septiembre de 2026 · en inglés». Ese texto no cambia solo: si la guía nueva es de otro mes o en otro idioma, avísale a Diego o a David.».
- **Consecuencia:** «Al publicar, quien descargue la guía desde la web recibe este PDF. El actual queda guardado.». **Botón:** «Publicar en la web».
- **Falta:** «Todavía no hay PDF en la web.» / «La página Servicios enlaza este PDF: mientras falte, la descarga da error.» / «Subir PDF».

### 7.6 03 · Imágenes

- **Encabezado:**
  - Ceja: «Imágenes». Título: «Fotos del sitio».
  - Texto:
    - Con sharp: «Sube una foto PNG, JPG o WebP: el panel la convierte al formato de la web, la ajusta al tamaño correcto y le quita los datos ocultos (como la ubicación GPS). La foto anterior queda guardada.».
    - Sin sharp: «Sube una imagen {FORMATO} de al menos {min} px de ancho. La anterior queda guardada.».
  - Nota: «Las fotos y precios de los productos de la tienda (shop.expertsddt.com) se cambian en Shopify, no aquí.».
- **Subgrupos:**
  - «Páginas del sitio».
  - «Casos antes y después», con ayuda «Las dos fotos de cada caso deben tener el mismo encuadre y proporción para que el comparador de la web funcione.».
  - «Al compartir en redes», con ayuda «Es la imagen que aparece cuando alguien comparte expertsddt.com por WhatsApp, Facebook o LinkedIn. No se ve dentro de la web.».
- **Tarjeta:**
  - Chip «Recién actualizado». Meta: «{105 KB} · {7 nov 2026, 2:40 p.m.}».
  - Enlace «Ver en la web». Botones: «Reemplazar foto» / «Cerrar». Alt: «Imagen actual de «{título}»».
  - Falta: chip «Falta», marco «Falta en la web», texto «La web muestra un hueco aquí hasta que subas una.», botón «Subir foto».
  - Vista previa rota: «No se pudo cargar la vista previa desde expertsddt.com.».
- **Zona:** «Arrastra la foto aquí» / «o elige un archivo» / «PNG, JPG o WebP · al menos {min} px de ancho · hasta 13 MB». En táctil: «Toca para elegir la foto». Al arrastrar sobre la tarjeta: «Suelta para reemplazar «{título}»».
- **Comparación:** «Actual» · «Nueva» · «{archivo} · {3.4 MB} · {4032 × 3024} px» · «Se guardará a {1800} px de ancho.» o «Se guardará en su tamaño actual.». En og: «Así quedará: la recortamos a 1200 × 630 px.».
- **Comprobaciones:**
  - «Listo: formato aceptado.» · «Listo: tamaño suficiente ({2400} px de ancho).».
  - «Quitaremos los datos ocultos de la foto, como la ubicación GPS.».
- **Avisos:**
  - «Ojo: tiene otra proporción que la foto actual ({16:10} frente a {3:4}). En la web podría verse recortada.»
  - «Ojo: tiene otra proporción que su pareja «{Caso A · Después}». El comparador de la web no coincidiría.»
  - «Ojo: esta imagen necesita fondo transparente (PNG o WebP). Una foto JPG se verá como un rectángulo sobre el fondo.»
- **Bloqueos:**
  - «No se puede usar: mide {640} px de ancho y aquí se necesitan al menos {800}. Busca la foto original o una más grande.»
  - «No se puede usar: es HEIC, el formato del iPhone. Ábrela y guárdala como JPG, o en el iPhone activa Ajustes › Cámara › Formatos › Más compatible.»
  - «No se puede usar: no es una foto PNG, JPG o WebP.»
  - «No se puede usar: pesa {18} MB y el máximo es 13 MB.»
  - «No pudimos abrir esta foto. Puede estar dañada.»
  - «El archivo está vacío.»
- **Consecuencia:** «Al publicar, la foto nueva reemplaza a la actual en {Inicio (pilar «Soporte y contacto») y en Servicios («Visitas de consultoría y soporte»)}. La actual queda guardada.».
  - Si falta: «Al publicar, esta foto aparecerá en {lugares}.».
  - og: «Al publicar, esta será la imagen que se ve al compartir expertsddt.com. La actual queda guardada.».
- **Botones y estados:** «Publicar en la web» · «Cancelar» · «Subiendo… {45} %» · «Optimizando la foto…» · «Espera a que termine la subida en curso.».

### 7.7 04 · Videos

- **Encabezado:**
  - Ceja: «Videos». Título: «Videos del sitio».
  - Texto: «Sube un MP4 de hasta 12 MB. En la web se reproducen solos, sin sonido y en bucle: deben entenderse sin audio.».
- **Tarjeta:** meta «{1.0 MB} de 12 MB · {3 oct 2026}», botones «Reemplazar video» / «Cerrar» y aria «Video actual: «{título}»».
- **Zona:** «Arrastra el video aquí» / «o elige un archivo» / «Solo MP4, hasta 12 MB».
- **Portada:** «Portada (opcional)», con ayuda «La imagen que se ve mientras carga el video. Si cambias el video, cambia también la portada para que coincidan. PNG, JPG o WebP, al menos 320 px de ancho.».
- **Notas fijas:**
  - `v-smile-design`: «Mientras carga, se ve la imagen «Fondo de la portada» (sección Imágenes).»
  - `v-exocad-denture`: «La portada de este video también es una imagen de la Tienda.»
- **Comprobaciones:** «Listo: es un MP4.» · «Listo: pesa {8.4} MB (máximo 12 MB).».
- **Bloqueos:**
  - «No se puede usar: es un MOV del iPhone. Expórtalo como MP4 o pídele ayuda al equipo técnico.»
  - «No se puede usar: no es un video MP4.»
  - «No se puede usar: pesa {18.3} MB y el máximo es 12 MB. Pide una versión más liviana (por ejemplo, exportada en 1080p o más corta).»
- **Consecuencia:** «Al publicar, el video nuevo reemplaza al actual en {lugares}. El actual queda guardado.». **Procesando:** «Guardando el video…».

### 7.8 Subidas (común)

- **Errores de red y servidor:**
  - Red: «Se cortó la conexión mientras subías el archivo.» + «Nada cambió en la web. Revisa tu internet y vuelve a intentarlo; el archivo sigue elegido.» + «Reintentar».
  - 413: «El servidor rechazó el archivo por su tamaño. Nada cambió en la web.».
- **`#sr-status`:** «Subida al {25} %» · «Procesando el archivo» · «Foto lista para revisar: {archivo}. {2} comprobaciones correctas, {1} aviso.».

### 7.9 Versiones anteriores, deshacer y diálogos

- **Lista:**
  - «Versiones anteriores ({n})». Chip «La anterior» (video: «Video» o «Portada»).
  - «Estuvo en la web hasta el {7 nov 2026, 2:40 p.m.} · {98 KB}».
  - Botón «Volver a esta». Pie: «Volver a una versión guarda la actual, así que también se puede deshacer.».
- **Diálogo «Publicar»:** «¿Publicar la versión {v}?» / «Los doctores empezarán a descargar este archivo de inmediato. La {actual} queda guardada y puedes volver a ella con un clic.» (sin versión activa: «La página de librerías empezará a ofrecer esta versión de inmediato.»). Detalle: «{v} · actualizada el {d} · {s} MB · {archivo}». Botones: «No, volver» · «Sí, publicar la {v}».
- **Diálogo «Activar»:** «¿Volver a la versión {v}?» / «Los doctores descargarán la {v} (datos del {fecha}) en lugar de la {actual}. La {actual} no se borra: puedes volver a ella cuando quieras.». Botones: «No, volver» · «Sí, activar la {v}».
- **Diálogo «Volver a esta»:** «¿Volver a esta versión de «{título}»?» / «El archivo que está ahora en la web se cambiará por el que estuvo hasta el {fecha}. El actual quedará en «Versiones anteriores».». Botones: «No, volver» · «Sí, volver a esta versión».
- **Diálogo «Deshacer»:** «¿Deshacer el cambio de «{título}»?» / «Vuelve a la web lo que había antes de tu cambio. Lo que subiste queda guardado en «Versiones anteriores».». Botones: «No, volver» · «Sí, deshacer».
- La «×» del diálogo tiene el nombre accesible «Cerrar».

### 7.10 Avisos flotantes

- Títulos: «Aviso» y «No se pudo completar». Cierre: «Cerrar aviso».
- «Subida cancelada.» / «Nada cambió en la web.»
- «Huella copiada.»
- «Solo se usa un archivo a la vez: tomamos «{nombre}».»
- «Suelta el archivo sobre la tarjeta que quieres cambiar.»
- «No se pudo cargar la vista previa de «{título}» desde expertsddt.com.»

### 7.11 Historial

- **Franja:** ceja «Registro de actividad», título «Historial», entradilla «Quién cambió qué y cuándo. Las horas son de Florida.».
- **Filtros** (aria: «Filtrar historial»): «Cambios en la web» · «Accesos» · «Todo».
- **Días:** «Hoy · {sábado 7 de noviembre}» · «Ayer · {viernes 6 de noviembre}» · «{Jueves 5 de noviembre de 2026}».
- **Frases por acción** (el `{nombre}` sale de `users.json`; si no existe, el correo):

| Acción | Frase | Detalle (segunda línea) |
|---|---|---|
| `replace` (imagen) | «{nombre} cambió la foto «{título}»» | `img/team.webp` |
| `replace` (video) | «{nombre} cambió el video «{título}»» o «… y su portada» | `video/scan-ui.mp4` |
| `replace` (PDF) | «{nombre} cambió la guía de servicios y tarifas» | `downloads/…pdf` |
| `restore` | «{nombre} volvió a una versión anterior de «{título}»» | «copia del {fecha}» |
| `library_publish` | «{nombre} publicó la versión {v} de las librerías» | «{37} archivos · {49.1} MB» |
| `library_activate` | «{nombre} volvió a poner en la web la versión {v} de las librerías» | — |
| `login` | «{nombre} entró al panel» | — |
| `logout` | «{nombre} salió del panel» | — |
| `login_failed` | «Intento de acceso fallido con {correo}» | «IP {ip}» |
| `login_blocked` | «Acceso pausado 15 minutos por demasiados intentos ({correo})» | «IP {ip}» |

- **Vacío:** «Todavía no hay cambios registrados.» / «Cuando alguien cambie una foto, un video, la guía o las librerías, aparecerá aquí.». Con filtro: «No hay eventos de este tipo entre los últimos 200.».
- **Pie:** «Se muestran los últimos 200 eventos.».

### 7.12 Páginas de error

- **404:** chip «Error 404» · «Esta página no existe» · «Puede que el enlace esté mal escrito o que la página haya cambiado.» · «Volver al panel».
- **403:** chip «Error 403» · «No pudimos confirmar la acción» · «La página estuvo abierta mucho tiempo o el formulario se envió dos veces. Vuelve al panel e inténtalo de nuevo. Nada cambió en la web.» · «Volver al panel».
- **500:** chip «Error 500» · «Algo salió mal de nuestro lado» · «Si estabas subiendo un archivo, revisa en el panel si el cambio se aplicó antes de repetirlo. Si vuelve a pasar, avísale a Diego o a David.» · «Volver al panel».

### 7.13 Mensajes del servidor (clave → título → texto)

Los errores terminan siempre con « Nada cambió en la web.».

| Clave | Tipo | Título | Texto |
|---|---|---|---|
| `csrf` | err | No se pudo completar | La página estaba desactualizada (¿entraste en otra pestaña?). Recárgala y vuelve a intentarlo. |
| `no_file` | err | No se pudo cambiar el archivo | No llegó ningún archivo. Elígelo y vuelve a intentarlo. |
| `unknown_slot` | err | No se pudo cambiar el archivo | Ese archivo ya no está en la lista. Recarga la página. |
| `too_big` | err | No se pudo cambiar el archivo | El archivo pesa más de {max} MB. |
| `img_type` | err | No se pudo cambiar la foto | El archivo no es una foto PNG, JPG o WebP válida. |
| `img_format` (sin sharp) | err | No se pudo cambiar la foto | Este espacio solo acepta imágenes {FORMATO}. |
| `img_small` | err | No se pudo cambiar la foto | La foto mide {w} px de ancho y aquí se necesitan al menos {min} px. |
| `img_unreadable` | err | No se pudo cambiar la foto | No pudimos leer la foto: está dañada o es demasiado grande. |
| `video_type` | err | No se pudo cambiar el video | El archivo no es un video MP4 válido. |
| `video_mov` | err | No se pudo cambiar el video | Es un MOV del iPhone. Expórtalo como MP4 y vuelve a intentarlo. |
| `video_big` | err | No se pudo cambiar el video | El video pesa {x} MB y el máximo es 12 MB. |
| `poster` | err | No se pudo cambiar el video | Portada: {motivo de imagen} |
| `no_poster` | err | No se pudo cambiar el video | Este video no usa imagen de portada. |
| `pdf` | err | No se pudo cambiar la guía | Sube un PDF válido de hasta 10 MB. |
| `lib_meta` | err | No se pudo publicar la versión | Revisa el número de versión (solo números, por ejemplo 11) y la fecha. |
| `lib_file` | err | No se pudo publicar la versión | Falta el archivo o pesa más de {LIB_MAX_MB} MB. |
| `lib_not_zip` | err | No se pudo publicar la versión | El archivo no es un .zip. |
| `zip_no_eocd` | err | No se pudo publicar la versión | El .zip está incompleto o no es un .zip de verdad. ¿Se cortó la descarga? Vuelve a descargarlo o a comprimirlo. |
| `zip_64` | err | No se pudo publicar la versión | El .zip está en un formato especial (ZIP64) que no aceptamos. Comprime la carpeta de nuevo con Windows: clic derecho › Enviar a › Carpeta comprimida (en zip). |
| `zip_many` | err | No se pudo publicar la versión | El .zip tiene {n} archivos y el máximo es 5000. |
| `zip_corrupt` | err | No se pudo publicar la versión | El .zip está dañado. Vuelve a comprimirlo. |
| `zip_unsafe` | err | No se pudo publicar la versión | El .zip contiene rutas de carpeta no permitidas ({ruta}). |
| `zip_big` | err | No se pudo publicar la versión | Descomprimido ocuparía más de 1 GB. |
| `lib_dup` | err | No se pudo publicar la versión | La versión {v} ya existe. Usa un número nuevo, por ejemplo {n}. |
| `lib_unknown` | err | No se pudo activar la versión | Esa versión ya no existe. Recarga la página. |
| `restore_unknown` | err | No se pudo volver a esa versión | Esa copia ya no existe. Recarga la página. |
| `ok_image` | ok | Listo: la foto nueva ya está en la web. | Si todavía ves la anterior, recarga la página de la web (Ctrl + F5 en la computadora; en el celular, desliza hacia abajo). Algunos navegadores tardan hasta un día. + [Deshacer] |
| `ok_video` | ok | Listo: el video nuevo ya está en la web. (o «el video y su portada ya están en la web.») | igual + [Deshacer] |
| `ok_pdf` | ok | Listo: la guía nueva ya está en la web. | Quien la descargue desde ahora recibe este PDF. + [Deshacer] |
| `ok_publish` | ok | Listo: la versión {v} ya está en la web. | Quien descargue las librerías desde ahora recibe la {v} ({n} archivos). + [Ver página pública] [Volver a la {anterior}] |
| `warn_publish` | warn | Publicada, pero revísala: la {v} tiene {n} archivos y la {anterior} tenía {m}. | ¿Elegiste el .zip correcto? Si no, vuelve a la {anterior} con un clic. + [Volver a la {anterior}] |
| `ok_activate` | ok | Listo: la versión {v} vuelve a estar en la web. | La {anterior} sigue guardada. + [Volver a la {anterior}] |
| `ok_restore` | ok | Listo: volviste a una versión anterior de «{título}». | La que estaba quedó guardada en «Versiones anteriores». + [Deshacer] |
| `logout` | info | Cerraste sesión. | ¡Hasta pronto! |
| `expired` | info | Tu sesión terminó. | Por seguridad, las sesiones duran 8 horas. Vuelve a entrar. |
| `expired_upload` | info | Tu sesión terminó mientras subías el archivo. | Entra de nuevo y vuelve a elegirlo. Nada cambió en la web. |
| `login_401` | err | Credenciales inválidas. | Revisa el correo, la contraseña y el código. Si el código cambió mientras lo escribías, usa el nuevo. |
| `login_429` | warn | Acceso pausado por seguridad. | Hubo demasiados intentos fallidos. Espera 15 minutos y vuelve a intentarlo. |

Se sustituyen los textos actuales de `server.mjs`. En concreto, «la suya» pasa a «la tuya» y desaparecen los motivos en inglés de `inspectZip` (§9.5).

### 7.14 Bueno saber

- Título: «Bueno saber».
- «Los textos de la web no se cambian aquí. Pídeselos a Diego o a David.»
- «Las fotos y precios de los productos de la tienda (shop.expertsddt.com) se cambian en Shopify.»
- «Si algo no quedó bien, abre ese archivo y usa «Deshacer» o «Versiones anteriores».»
- «Si todavía ves lo anterior en la web, recarga la página: algunos navegadores guardan las imágenes hasta un día.»

---

## 8. Accesibilidad (WCAG 2.2 AA, en los dos temas)

### 8.1 Contraste

Las cifras están calculadas con la fórmula WCAG. El umbral AA es 4.5 para texto, y 3 para texto grande, componentes y foco. Los colores con transparencia se mezclaron sobre su fondo real.

**Claro:**

| Par | Uso | Contraste |
|---|---|---|
| `--ink` #1e293b sobre #fff / #f0f5fa | títulos, valores | 14.63 / 13.34 |
| `--slate` #334155 sobre #fff / #f0f5fa | texto | 10.35 / 9.44 |
| `--muted` #5b6b82 sobre #fff / #f0f5fa | ayudas, metadatos | 5.43 / 4.95 |
| `--blue` #046bd2 sobre #fff / #f0f5fa | enlaces, cejas | 5.20 / 4.74 |
| `.btn--quiet` en hover (#046bd2 sobre tinte .08) | botón discreto | 4.65 |
| `--pill-fg` #045cb4 sobre `--pill-bg` (sobre #fff / #f0f5fa) | etiquetas, píldoras | 5.87 / 5.38 |
| #fff sobre `--grad-blue` (#046bd2 → #045cb4) | botón primario, mosaicos | 5.20 – 6.57 |
| `--ok` #15803d sobre `--ok-bg` / #fff | estado ok | 4.76 / 5.02 |
| #fff sobre #15803d | chip «Recién actualizado» | 5.02 |
| `--err` #b91c1c sobre `--err-bg` / #fff | errores | 5.91 / 6.47 |
| `--warn` #92400e sobre `--warn-bg` / #fff | advertencias | 6.84 / 7.09 |
| #fff sobre #92400e | chip «Falta» | 7.09 |
| `--ink` sobre los tintes ok, err y warn | texto de avisos | 13.37 – 14.11 |
| #fff sobre `rgba(10,26,58,.72)` encima de una foto blanca | insignias ACTUAL y NUEVA | 6.92 |
| #fff sobre la capa navy .85 encima de blanco | «Suelta para reemplazar» | 7.80 |
| `--field` #7c8aa0 frente a #fff / #f0f5fa (componente) | borde de inputs y zonas | 3.50 / 3.19 |
| relleno #046bd2 frente a la pista #dbe5f1 (componente) | progreso | 4.08 |
| foco #046bd2 frente a #fff / #f0f5fa | anillo | 5.20 / 4.74 |

**Superficies navy** (iguales en los dos temas):

| Par | Uso | Contraste |
|---|---|---|
| #fff / #dbe7f7 / #c7d6ee sobre #0f346e | títulos, vidrio, texto | 12.09 / 9.67 / 8.22 |
| #bcdcff (`--n-link`) sobre #0f346e / sobre el brillo .40 | enlaces | 8.53 / 6.09 |
| #8fc1ff sobre #0f346e / sobre el brillo .40 | cejas, números de píldora | 6.47 / 4.62 |
| #6fb6ff sobre #0f346e | acento grande, subrayado actual | 5.65 |
| #c7d6ee sobre el brillo .40 (peor punto) | texto | 5.87 |
| #fff / #dbe7f7 sobre vidrio oscuro encima del brillo .55 | resumen, beneficios del login | 11.34 / 9.06 |
| #fff / #8fc1ff sobre píldora en hover (blanco .10) | píldoras de salto | 9.07 / 4.86 |
| #fff sobre la cifra de la píldora (blanco .12) | cifras | 8.54 |
| #fcd34d sobre `rgba(252,211,77,.16)` encima de navy | «Sin publicar», «1 falta» | 6.00 |
| #c7d6ee sobre la barra .94 encima de contenido blanco | enlaces de la barra | 6.95 |
| #9fb3d4 / #c7d6ee / #bcdcff sobre #0a1a3a | pie | 8.08 / 11.69 / ≥9 |
| #fff sobre #2a7abf (tramo más claro del disco) | «v10» en el disco | 4.53 |
| #8fc1ff frente a #0f346e (componente) | foco sobre navy | 6.47 |

**Oscuro:**

| Par | Uso | Contraste |
|---|---|---|
| `--ink` #eef2f8 sobre `--card` #101d3a / `--canvas` #0b1630 | títulos | 14.85 / 15.95 |
| `--slate` #b5c2d8 | texto | 9.27 / 9.96 |
| `--muted` #8fa0bd (redeclarado en el bloque oscuro) | ayudas | 6.30 / 6.77 |
| `--link` y `--focus` #6fb6ff | enlaces, foco, botón de contorno | 7.79 / 8.37 |
| `.btn--quiet` en hover (#6fb6ff sobre tinte .14) | botón discreto | 5.95 |
| `--pill-fg` #8fc1ff sobre `--pill-bg` | etiquetas | 6.81 / 7.42 |
| `--ok` / `--err` / `--warn` sobre su tinte encima de `--card` | estados | 9.72 / 7.96 / 9.57 |
| `--ink` sobre los tintes | avisos | 12.15 – 13.44 |
| `--field` #5b74a6 (componente) | bordes de control | 3.57 / 3.84 |
| relleno #6fb6ff frente a la pista #24345a (componente) | progreso | 5.72 |
| #fff sobre #046bd2 (hover del botón de contorno, corregido) | botón | 5.20 |

**Pares prohibidos** (fallan y por eso no aparecen):

| Par | Contraste |
|---|---|
| #64748b sobre neblina | 4.34 |
| `--blue` del sitio en píldoras sobre neblina | 4.25 |
| #5b6b82 en oscuro (error de cascada) | 3.30 |
| texto pequeño #8fc1ff / #6fb6ff sobre el brillo .55 | 4.06 / 3.54 |
| #6fb6ff sobre la píldora en hover | 4.24 |
| chip blanco translúcido sobre `--grad` | 3.44 |
| #e4ecf9 sobre `--grad` | 3.81 |
| `--grad-blue` sobre la pista oscura | 2.36 |
| #6fb6ff sobre #046bd2 (hover del sitio) | 2.43 |
| `--line` como borde de control | 1.47 / 1.36 |

El navy sobre el lienzo oscuro da 1.48. No es texto, pero la franja lleva una línea fina debajo para que su borde se lea.

### 8.2 Foco

- `:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px }`. Sobre navy (`.on-navy`, avisos flotantes, `.vcard`) el anillo es #8fc1ff.
- En los inputs, el borde pasa a `--focus` con un halo de 4px.
- En las zonas de soltar se usa `:has(input:focus-visible)`.
- **2.4.11 (foco no tapado):**
  - `scroll-padding-top` igual al alto de la barra fija más 1rem; a ≤760 la barra no es fija.
  - No hay avisos fijos del servidor que puedan tapar nada.
  - Los flotantes son de esquina y temporales, y no reciben foco. Mientras hay uno visible, `html` recibe un `scroll-padding-bottom` igual a su alto, así que el elemento enfocado nunca queda debajo.

### 8.3 Teclado

Orden:

1. «Saltar al contenido».
2. Barra: logo, enlaces, «Ver la web», tema y «Salir».
3. Píldoras de la franja.
4. Sección 01: botones de la tarjeta navy, «Detalles técnicos», número, fecha, archivo, «Publicar» y «Activar».
5. Sección 02.
6. Cada tarjeta de 03 y 04: «Ver en la web» y «Reemplazar»; dentro, archivo, «Publicar», «Cancelar», «Versiones anteriores» y «Detalles técnicos».
7. Bueno saber.
8. Pie.

Todo es nativo: enlaces, botones, `summary` (Enter o Espacio), `input type=file` (Enter o Espacio abre el selector) y `dialog` modal (fondo inerte, Esc y vuelta del foco). No hay trampas de foco ni atajos de una sola tecla (2.1.4).

### 8.4 Tamaño de los objetivos

Todo control mide al menos 44×44 px: `.btn` 48, `.btn--sm` y `.btn--quiet` 44, tema 44, «×» 44, píldoras y filtros 44, pestañas 48, filas de «Versiones anteriores» 44 y `summary` 44. Las etiquetas «dónde aparece» no son interactivas.

### 8.5 Formularios y errores

- Cada control tiene una etiqueta visible. Ayudas y errores van por `aria-describedby`, y el control con error lleva `aria-invalid="true"`.
- El error va junto al campo, con icono y una palabra inicial («No se puede usar:»), y se repite en el aviso del servidor.
- El único campo opcional dice «(opcional)».
- **3.3.7 (no repetir datos):** el login conserva el correo y la librería conserva la versión y la fecha tras un error.
- **3.3.8 (autenticación accesible):**
  - Se puede pegar.
  - `autocomplete` es `username`, `current-password` y `one-time-code`.
  - No hay `maxlength` en el código.
  - Hay «Mostrar contraseña».
  - No hay pruebas cognitivas.

### 8.6 Mensajes de estado (4.1.3) y regiones vivas

- Los avisos de resultado llevan `role=status` u `role=alert`, el foco y el prefijo en el `<title>`. Tras una redirección completa, el título es lo que el lector anuncia al cargar, con o sin JS.
- `#sr-status` (educado, presente desde el HTML) anuncia los hitos de subida, el archivo aceptado, la copia y la cancelación.
- Los errores del navegador llevan `role=alert` en línea. Los avisos flotantes de error también llevan `role="alert"`.

### 8.7 No solo con color (1.4.1)

Todo estado tiene texto e icono: «Activa», «En línea», «Recién actualizado», «Falta», «Sin publicar», las palabras iniciales «Listo:», «Ojo:» y «No se puede usar:», y el porcentaje en el progreso. La fila activa tiene, además de la barra, su chip con texto. Los enlaces dentro del texto van subrayados.

### 8.8 Estructura

- `<html lang="es">`. Un solo `h1` por página: en el login, el de la tarjeta; la frase grande es un `p`.
- **Títulos:** `h2` por sección; `h3` para las tarjetas de librerías y para los subgrupos de imágenes; `h4` para las tarjetas dentro de un subgrupo.
- **Puntos de referencia:** `header` de la barra, `nav` «Principal», `nav` «Secciones del panel», `main#main`, `aside` «Resumen» y `footer`.
- **Decorativo** (`aria-hidden`): números calados, retícula, brillos, palabra fantasma, iconos, disco y fila de encabezados de versiones.

### 8.9 Medios

- **Imágenes:** `alt="Imagen actual de «{título}»"`.
- **Videos:** `controls`, `muted`, `preload="none"`, sin reproducción automática y `aria-label="Video actual: «{título}»"`.
- **Logo:** `alt="Experts DDT"`.

### 8.10 Tiempo, movimiento, reajuste y otros

- **Tiempo (2.2.1):** los flotantes informativos se ocultan a los 6 s con pausa al pasar el ratón o al enfocar, y su información sigue en la página (chip, aviso o título). Los de error no se ocultan.
- **Movimiento:** todo es decorativo y se anula con `prefers-reduced-motion`. El panel está completo sin movimiento, como lo ve Diego.
- **Reajuste (1.4.10):** a 320 px hay una sola columna sin desplazamiento horizontal. El zoom de texto al 200 % funciona porque no hay alturas fijas en el texto.
- **Colores forzados:** los botones conservan el borde transparente de 2px del sitio y los chips el de 1px. El foco usa `outline`, el progreso es nativo y los iconos usan `currentColor`.
- **Ayuda consistente (3.2.6):** «Escríbele a Diego o a David» está en el mismo sitio (pie y tarjeta de login) en todas las páginas.
- **Idioma y hora:** todo está en español y las horas van en America/New_York, rotuladas como «hora de Florida». El servidor de Hostinger y el equipo técnico están en otras zonas.

---

## 9. Notas de implementación

### 9.1 Estructura de archivos

```
panel/
├── astro.config.mjs
├── package.json              astro ^7.3.3 · @astrojs/node (versión compatible con Astro 7) · @fontsource/poppins ^5.3.0 · busboy ^1.6.0 · opcional sharp ^0.35.5
├── slots.json                ampliado (§9.6)
├── cli.mjs                   sin cambios (sigue importando ./lib/auth.mjs)
├── lib/
│   ├── auth.mjs              sin cambios
│   ├── files.mjs             sniff() devuelve también la marca ftyp; inspectZip() devuelve {code}
│   ├── panel.mjs             NUEVO: lo que hoy hace server.mjs (config por env, slots, audit, receive, prepareImage, handlers, restore, datos del panel y del historial)
│   └── format.mjs            NUEVO: pesos, fechas (es-US + America/New_York; dataDate en UTC), relativo, días, «lugares»
├── public/
│   └── theme-init.js         script clásico externo (§6.2)
├── src/
│   ├── middleware.ts         cabeceras, CSP, origen, sesión, aviso (§9.3)
│   ├── env.d.ts              tipos de Astro.locals
│   ├── layouts/  Panel.astro · Auth.astro
│   ├── components/  Bar · ThemeToggle · Hero · SectionHead · Alert · Chip · Field · Dropzone · Compare · UploadProgress ·
│   │                SlotCard · Copies · Tech · VersionCard · PublishCard · VersionList · ConfirmDialog · EmptyState ·
│   │                HistoryList · InfoList · Footer · Icon   (.astro)
│   ├── pages/
│   │   ├── index.astro · history.astro · login.astro (GET y POST) · 404.astro · 500.astro
│   │   ├── logout.ts · restore.ts · libraries/activate.ts
│   │   └── upload/slot.ts · upload/libraries.ts
│   ├── scripts/panel.ts      el único paquete de cliente
│   └── styles/panel.css      tokens del panel y primitivas compartidas
└── test/panel.test.mjs       las 18 pruebas, adaptadas, y las nuevas (§9.9)
```

`server.mjs` y `lib/ui.mjs` se borran cuando la versión Astro pase todas las pruebas.

### 9.2 Configuración de Astro

```js
// panel/astro.config.mjs
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  build: { inlineStylesheets: 'never' },        // nunca <style> en línea (el sitio usa 'auto')
  vite: {
    build: { assetsInlineLimit: 0 },            // Astro 7.3.3 mete en línea scripts < 4096 B (plugin-scripts.js): rompería la CSP
    server: { fs: { allow: ['..'] } },          // importar ../src/styles/global.css y ../public/* en desarrollo
  },
  security: {
    checkOrigin: false,                         // con true, un POST sin Origin o tras el proxy (http://localhost) da 403;
                                                // el middleware hace la misma comprobación que server.mjs, cubierta por las pruebas
    allowedDomains: [{ protocol: 'https', hostname: 'admin.expertsddt.com' }],  // Astro.url correcto tras el proxy TLS
  },
  devToolbar: { enabled: false },
});
```

- **Límite de cuerpo:** si el `@astrojs/node` instalado expone `bodySizeLimit`, se fija en `(LIB_MAX_MB + 10) * 1024 * 1024`. El núcleo (`core/app/node.js`, `limitAsyncIterable`) solo lo aplica si el adaptador se lo pasa. Si no se lo pasa, el límite lo pone busboy (`limits.fileSize`).
- **No se activa `security.csp`.** La CSP va como cabecera (§9.3), para incluir `frame-ancestors` y no arriesgar un `'unsafe-inline'`.
- **Scripts:** `"build": "astro build"`, `"start": "node dist/server/entry.mjs"`, `"test": "astro build && node --test test/*.test.mjs"`.

### 9.3 Middleware (`src/middleware.ts`)

```ts
export const onRequest = defineMiddleware(async (ctx, next) => {
  const { request, url } = ctx;
  if (request.method === 'POST' && !sameOrigin(request)) return secure(view403());   // igual que server.mjs: Origin ausente se acepta; 'null' o ajeno no
  ctx.locals.flash = readFlash(request);                                             // cookie firmada edp_flash
  const s = await session(request);                                                  // edp_sid + users.json + tokenVersion
  if (!s && url.pathname !== '/login') {
    const set = [clearCookie('edp_sid')];
    if (hasCookie(request, 'edp_sid')) set.push(flashCookie('info', request.method === 'POST' ? 'expired_upload' : 'expired'));
    return secure(isXhr(request) ? json({ to: '/login' }, 401, set) : seeOther('/login', set));
  }
  if (s && url.pathname === '/login' && request.method === 'GET') return secure(seeOther('/'));
  Object.assign(ctx.locals, s ? { user: s.user, csrf: csrfFor(s, secret) } : {});
  const res = await next();
  if (ctx.locals.flash && request.method === 'GET') res.headers.append('Set-Cookie', clearCookie('edp_flash'));
  return secure(res);
});
```

**Cabeceras de `secure()`** (en todas las respuestas que no son archivos estáticos):

| Cabecera | Valor |
|---|---|
| `Content-Security-Policy` | solo cuando `import.meta.env.PROD`, porque Vite mete scripts en línea en desarrollo. El valor está debajo |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `same-origin` (no `no-referrer`: haría que el navegador mande `Origin: null`) |
| `Cache-Control` | `no-store` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `X-Robots-Tag` | `noindex, nofollow` |
| `Strict-Transport-Security` | `max-age=31536000`, salvo con `COOKIE_SECURE=0` |

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://expertsddt.com blob:;
media-src https://expertsddt.com; font-src 'self'; connect-src 'self'; form-action 'self';
frame-ancestors 'none'; base-uri 'none'; object-src 'none'
```

Respecto de la política actual, solo hay tres añadidos:

- `script-src 'self'`, para el paquete y `theme-init.js`.
- `blob:` en `img-src`, para la vista previa local.
- `connect-src 'self'`, para el progreso con XHR.

Se quitan `style-src 'unsafe-inline'` y `data:`.

### 9.4 Subidas: lectura en flujo, cancelación y respuesta

```js
// lib/panel.mjs: tmps lo crea quien llama, así su finally siempre limpia, incluso si receive() falla o se aborta
function receive(request, { maxFile, maxFiles, names, csrf, tmps }) {
  return new Promise((resolve, reject) => {
    const src = Readable.fromWeb(request.body);
    const bb = Busboy({ headers: Object.fromEntries(request.headers), limits: { files: maxFiles, fields: 10, parts: 20, fileSize: maxFile } });
    const fail = (e) => { src.destroy(); bb.destroy(); reject(e); };
    request.signal.addEventListener('abort', () => fail(new Error('aborted')), { once: true }); // «Cancelar subida» o pestaña cerrada
    src.on('error', fail); bb.on('error', fail);
    /* … field: _csrf primero (eq); file: si !csrfOk o nombre desconocido → resume(); si no → tmp = join(dataDir,'tmp',rand); tmps.push(tmp); … */
    /* al pasar el límite: tooBig = name y se sigue vaciando el cuerpo. No se corta, porque cortar a mitad hace que el navegador
       muestre «conexión restablecida» en vez del aviso */
    bb.on('close', async () => { try { await Promise.all(pending); } catch (e) { return reject(e); } resolve({ fields, files, csrfOk, tooBig }); });
    src.pipe(bb);
  });
}
// en cada endpoint:  const tmps = []; try { … } catch (e) { if (e.message === 'aborted') return new Response(null, { status: 499 }); throw e; } finally { await cleanup(...tmps); }
const done = (request, to, cookie) =>
  request.headers.get('x-panel-xhr') === '1' ? json({ to }, 200, [cookie]) : seeOther(to, [cookie]);
```

- **Nunca** se usa `request.formData()` (guarda todo el cuerpo en RAM) ni Astro Actions (`actionBodySizeLimit` es de 1 MB).
- `_csrf` sigue siendo el **primer** campo de todo formulario: busboy solo acepta archivos después de un token válido.
- `login.astro`, `logout.ts`, `activate.ts` y `restore.ts` leen formularios urlencoded con un lector de flujo con tope de 8 KB (`readForm`). No usan `formData()`.

### 9.5 Cambios de servidor

Todos son pequeños y reutilizan `files.mjs`.

1. **Aviso:**
   - Contenido: `{type, key, title, text, slot?, undo?: {action, fields, label}, keep?: {version, dataDate}, exp}`. Va firmado y dura 60 s.
   - `type` es `ok`, `warn`, `err` o `info`. `key` es la clave de §7.13.
2. **Redirecciones a anclas** (§3.4) y **rama XHR** con la cabecera `X-Panel-Xhr: 1` → 200 JSON `{to}` y la misma cookie (§9.4).
3. **TOTP:** `code.replace(/\s+/g, '')` antes de `verifyTotp`; en el formulario se quita `maxlength`.
4. **Login:**
   - Un 401 o 429 vuelve a pintar la página con el correo.
   - `logout` deja el aviso informativo.
   - Una sesión inválida con cookie presente lleva a `expired` o `expired_upload`.
   - No hay `next=`.
5. **`receive()`:** lectura en flujo, `tmps` de quien llama y cancelación por `request.signal` (§9.4).
6. **`sniff()`:** devuelve también la marca mayor `ftyp` (bytes 8–12). Con `'qt  '`, es decir, un MOV de iPhone, se rechaza con `video_mov`.
7. **`inspectZip()`:** devuelve `{ok:false, code:'no_eocd'|'zip64'|'too_many'|'corrupt'|'unsafe_path'|'too_big', detail}`. Los textos en español están en §7.13. Ningún texto en inglés llega a la interfaz.
8. **`prepareImage()`:**
   - Textos en tuteo («la tuya»).
   - Con `slot.crop === 'og'`: `resize(1200, 630, { fit: 'cover', position: 'centre' })`, porque hoy un cuadrado se quedaría en 1200×1200.
9. **Datos de `slots.json`** (§9.6):
   - `minWidth` de `facial-scan` y `training-main` pasa a **760**: los archivos reales miden 768 px y hoy ni se podría volver a subir el original.
   - Se quita `posterSize.maxBytes`, que no se usa.
10. **`POST /restore`:**
    - Exige sesión y CSRF, y que el `slot` exista.
    - Cada `file` tiene que estar **literalmente** en `readdir(DATA_DIR/backups/<slot.id>)` y terminar en `__<basename(slot.path)>` o `__<basename(slot.poster)>`.
    - La copia se lleva con `copyFile` a `DATA_DIR/tmp` y se coloca con `placeFile(tmp, dest, backupDir)`, así que lo actual queda guardado.
    - Se registra `restore` en el historial con `slot`.
    - El aviso `ok_restore` lleva `undo` hacia la copia que se acaba de crear.
    - No hay almacén nuevo ni ruta para ver copias. Si algún día se añade, tiene que exigir sesión, aceptar solo nombres de `readdir`, mandar `Content-Disposition: attachment` y `Content-Security-Policy: sandbox`, y nunca servir PDFs en línea en `admin.`.
11. **Retención:** después de cada `placeFile` de un archivo, se borran las copias más allá de las **10 más recientes** de ese nombre. `ponytail:` es un tope por cantidad; si el disco aprieta, se pasa a uno por tamaño. La lista de la interfaz muestra 6. Para la hora, se pasa el ISO del nombre (`2026-11-07T19-40-10-123Z`) a `2026-11-07T19:40:10.123Z`.
12. **Publicar una librería:**
    - Si `versions.json` no existe pero `latest.json` sí (el caso real de hoy), se siembra `versions.json` con la entrada activa antes de añadir la nueva. Sin esto, la v10 desaparecería de la lista y no se podría volver a ella.
    - Comprobación: si la nueva tiene menos de la mitad de archivos que la anterior, el aviso es `warn_publish`.
    - `undo` permite activar la anterior.
    - Historial legible: `"v11 · 37 archivos · 49.1 MB"`, con `version`, `files` y `bytes` como campos.
13. **Historial:**
    - Los registros `replace` y `restore` incluyen `slot`.
    - Los registros antiguos se interpretan por la ruta y con la expresión `/^(v\d+) \((\d+) archivos, (\d+) bytes\)$/`.
14. **Datos del panel:**
    - Por archivo: `size`, `mtime`, `missing`, `fresh` (<10 min) y `backups` (≤6).
    - Librerías: `latest` y `versions` (unidas), `nextVersion` y `existing`.
    - `lastChange` (de las últimas líneas de `audit.jsonl`), cifras por tipo, `canConvert` (sharp cargado), `libMaxMb`, nombre e iniciales del usuario, y `csrf`.
15. **Datos del historial:** las últimas 200 líneas, el filtro `tipo`, grupos por día en America/New_York, nombres desde `users.json` y la IP solo en `login_failed` y `login_blocked`. `ponytail:` hoy lee el archivo entero; cuando pase de unos MB, se cambia por la lectura del final.
16. **Fechas:**
    - Las marcas de tiempo van en `es-US` con `timeZone: 'America/New_York'`.
    - `dataDate` (`YYYY-MM-DD`) va con `timeZone: 'UTC'`: en Nueva York, «2026-11-06» saldría como «5 de noviembre».
17. **`LIB_MAX_MB`** (variable de entorno, 300 por defecto) la usan `receive()`, la copia y el límite de cuerpo.
18. **README:**
    - Inicio: `npm run build` y `node dist/server/entry.mjs`.
    - El bloqueo real es de **8 intentos por correo y 20 por IP** (el README dice 5).
    - Variable nueva: `LIB_MAX_MB`.

### 9.6 `slots.json` ampliado

Esquema por archivo:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | igual que hoy |
| `path` | string | igual que hoy |
| `label` | string | título corto, sin «Inicio ·» |
| `group` | string | `paginas`, `casos` o `redes` (solo imágenes) |
| `where` | array de `{page, section, url}` | `url` relativa a `SITE_URL`, en español |
| `stage` | string | `well`, `navy`, `mist` o `dark` |
| `frame` | string | `4x3`, `16x10` u `og` |
| `minWidth`, `maxWidth` | número | |
| `alpha` | true | opcional |
| `pair` | id | opcional |
| `crop` | `"og"` | opcional |
| `poster` | string | opcional |
| `thumb` | string | opcional |
| `hint` | string | opcional |

El orden del archivo es el orden en pantalla, que es el orden de la web.

```json
{ "id": "team", "path": "img/team.webp", "label": "Foto del equipo", "group": "paginas",
  "where": [ { "page": "Inicio", "section": "pilar «Soporte y contacto»", "url": "/es/#pillars" },
             { "page": "Servicios", "section": "«Visitas de consultoría y soporte»", "url": "/es/services/#support" } ],
  "stage": "well", "frame": "4x3", "minWidth": 800, "maxWidth": 1800 }
```

**Imágenes:**

| id | label | group | where | stage | frame | min / max | extra |
|---|---|---|---|---|---|---|---|
| design-services | Fondo de la portada | paginas | Inicio · portada (fondo en celulares y tablets; en computadora, mientras carga el video) → /es/#hero | well | 4x3 | 800 / 1800 | hint |
| hero-laptop | Laptop del Doctor Portal | paginas | Inicio · portada → /es/#hero | navy | 4x3 | 800 / 1800 | alpha |
| scanner-front | Escáner Experts DDT | paginas | Inicio · pilar «Escáner facial» → /es/#pillars | navy | 4x3 | 400 / 1200 | alpha |
| training-main | Foto de capacitación | paginas | Inicio · pilar «Capacitación e implementación» → /es/#pillars | well | 4x3 | **760** / 1800 | — |
| team | Foto del equipo | paginas | Inicio · pilar «Soporte y contacto» → /es/#pillars; Servicios · «Visitas de consultoría y soporte» → /es/services/#support | well | 4x3 | 800 / 1800 | — |
| facial-scan | Escaneo facial (decoración) | paginas | Inicio · fondo de «Nuestros principales servicios» → /es/#services | mist | 4x3 | **760** / 1800 | alpha |
| fernando | Foto de Fernando | paginas | Inicio · «Nosotros» → /es/#about | well | 4x3 | 700 / 1600 | — |
| lib-gingiva | Librería con encía virtual | paginas | Inicio · «Recursos» (tarjeta del curso) → /es/#resources | well | 4x3 | 600 / 1600 | — |
| lib-occlusion | Librería en oclusión | paginas | Inicio · «Recursos» (tarjeta de la tienda) → /es/#resources; Tienda → /es/store/ | well | 4x3 | 600 / 1600 | — |
| lib-natural | Librería natural | paginas | Tienda → /es/store/ | well | 4x3 | 600 / 1600 | — |
| smile-a-before | Caso A · Antes | casos | Inicio · «Mira la transformación», «Rehabilitación de arcada completa» → /es/#smiles | well | 16x10 | 600 / 1600 | pair smile-a-after |
| smile-a-after | Caso A · Después | casos | igual | well | 16x10 | 600 / 1600 | pair smile-a-before |
| smile-b-before | Caso B · Antes | casos | Inicio · «Mira la transformación», «Rediseño de sonrisa anterior» → /es/#smiles | well | 16x10 | 600 / 1600 | pair smile-b-after |
| smile-b-after | Caso B · Después | casos | igual | well | 16x10 | 600 / 1600 | pair smile-b-before |
| og | Imagen al compartir en redes | redes | (no se ve en la web) | well | og | 1200 / 1200 | crop og |

**Videos** (todos con `stage: "dark"`, `frame: "16x10"` y `maxBytes: 12582912`):

| id | label | where | portada | hint |
|---|---|---|---|---|
| v-smile-design | Video de fondo de la portada | Inicio · portada (solo en computadoras) → /es/#hero | `thumb: img/design-services.webp` | «Mientras carga, se ve la imagen «Fondo de la portada» (sección Imágenes).» |
| v-smile-preview | Simulación de sonrisa | Inicio · pilar «Servicios de diseño» → /es/#pillars | `poster` | — |
| v-scan-ui | Software del escáner facial | Inicio · pilar «Escáner facial» → /es/#pillars; Servicios · «Tecnología de vanguardia en escaneo facial 3D» → /es/services/#scanning | `poster` | — |
| v-clinic-scan | Escaneo intraoral en clínica | Servicios · «Capacitación especializada» → /es/services/#training | `poster` | — |
| v-exocad-smile | Diseño de sonrisa en Exocad | Servicios · «Servicios de diseño premium» → /es/services/#design | `poster` | — |
| v-exocad-denture | Prótesis en Exocad | Cursos → /es/courses/; Tienda (usa la portada) → /es/store/ | `poster` | «La portada de este video también es una imagen de la Tienda.» |

**Documento:** `guide-pdf` · «Guía de servicios y tarifas» · Servicios · franja «Servicios digitales y tarifas 2026» → /es/services/ · lleva la nota fija de §7.5.

### 9.7 Estilos: reutilizar global.css sin romper nada

- **Orden de importación:** `global.css`, las fuentes y luego `panel.css`. Los estilos de los componentes van en su `<style>` (con ámbito). No hay `<style is:global>` ni `is:inline`.
- **Nombres prohibidos** en el panel: `.nav`, `.menu`, `.burger`, `.footer`, `.floats`, `.wa`, `.fab`, `.consent`, `.loader`, `.logo`, `.note`, `.section` (se usa `.psec`) y `.img-frame`, este último porque su `img` hace `scale(1.06)` y además recorta.
- **Nunca** se pone `data-reveal`, `data-split` ni `data-stagger`: global.css los oculta con `opacity: 0` y aquí no hay GSAP.
- **Sobrescrituras obligatorias en `panel.css`:**
  - `body { background: var(--canvas) }` y `.card { background: var(--card) }`.
  - El padding de `.page-hero.phero`.
  - `.btn { white-space: normal }` a ≤560.
  - El hover oscuro de `.btn--outline`.
  - `.on-navy .accent` y `.on-navy .eyebrow { color: #8fc1ff }` en los dos temas.
  - El color del foco con `--focus`.
- **Se reutilizan tal cual:** `.wrap`, `.stack`, `.eyebrow`, `.h-xl`, `.h-lg`, `.lead`, `.btn`, `.btn--*`, `.card`, `.pill`, `.grid-bg`, `.sr-only`, `.cta-row`, `.theme-toggle` (cambio de icono) y el bloque de `prefers-reduced-motion`.
- **Si el sitio cambia un token, el panel cambia con él.** Es lo que se busca, pero después de cada cambio de tokens del sitio hay que revisar §10 en los dos temas.

### 9.8 Scripts compatibles con la CSP

- **Un solo módulo:** `src/scripts/panel.ts`, unos 9 KB. Se importa con `<script>import '../scripts/panel.ts';</script>` en los dos marcos y Astro lo emite como `/_astro/*.js` gracias a `assetsInlineLimit: 0`.
- **Lo primero que hace** es `document.documentElement.classList.add('js')`. Así, si el paquete no carga, la página queda en modo sin JS, con el input visible. No se usa `@media (scripting)`.
- **Ganchos** (contrato entre el HTML y el script):

| Gancho | Para qué |
|---|---|
| `form[data-upload]` | subida XHR con progreso |
| `label.drop[data-drop]` | arrastre, comprobaciones, plegado |
| `[data-drop-target]` | soltar sobre la tarjeta entera |
| `[data-compare]` y `[data-checks]` | comparación y comprobaciones |
| `[data-upl]` y `[data-upl-cancel]` | progreso y cancelación |
| `form[data-confirm]` con `data-confirm-title/text/detail/ok/icon` | diálogo de confirmación |
| `form[data-version-form]` con `data-existing` y `data-tpl` | vista previa de la librería y versión repetida |
| `button[data-theme-toggle]` | tema |
| `button[data-copy]` | copiar la huella |
| `input[data-otp]` | limpieza del código |
| `button[data-reveal-for]` | «Mostrar» contraseña |
| `[data-caps-for]` | aviso de Bloq Mayús |
| `img[data-preview]` | vista previa rota y medidas reales |
| `.toasts` | avisos flotantes |
| `#sr-status` | anuncios |
| `#resultado` | foco de respaldo |

- **Valores dinámicos** solo con `<progress value>`, atributos `hidden` y `aria-*`, clases o `el.style.setProperty()` (CSSOM, que la CSP permite). Nunca con `innerHTML` de datos del usuario: se usa `textContent`.
- Sin manejadores `on*=` en el HTML, sin `eval` y sin bibliotecas externas.

### 9.9 Pruebas

- **Arnés:**
  - `npm test` primero ejecuta `astro build`.
  - Luego arranca `node dist/server/entry.mjs` en un puerto libre con las variables de entorno de prueba (`SITE_ROOT` y `DATA_DIR` temporales, `PANEL_SECRET`, `COOKIE_SECURE=0`, `SITE_URL`). Esto sustituye a `createApp()`.
  - El resto de cada prueba no cambia.
- **Solo cambian dos aserciones:**
  - El aviso se lee con `/data-flash="(ok|err|warn|info)"/` en lugar de `class="flash (ok|err)"` (línea 111).
  - La CSP: en vez de «no tiene `script-src`» (línea 117), se espera `script-src 'self'` y que no aparezca `unsafe-inline`.
- **Comprobación de HTML:** en lugar de «no hay `<script`» (línea 119), ninguna página servida (`/login`, `/`, `/history`, 404) puede tener un `<script>` sin `src`, un `<style>`, un atributo `style=` ni uno `on*=`.
- **Pruebas nuevas:**
  - `/restore` intercambia el archivo, guarda el actual, lo registra y rechaza un nombre que no esté en `readdir`, `../` y el archivo de otro espacio.
  - Con `X-Panel-Xhr: 1`, se recibe 200 `{"to":"/#slot-hero-laptop"}` y `Set-Cookie: edp_flash`.
  - El código «123 456» entra.
  - Una subida abortada deja vacío `DATA_DIR/tmp`.
  - El og subido sale en 1200×630.
  - Un MP4 con marca `qt  ` se rechaza.
  - La primera publicación sin `versions.json` conserva la versión activa en la lista.
  - Ningún texto de respuesta contiene palabras en inglés de `inspectZip`.

### 9.10 Despliegue en Hostinger

- **Aplicación:** una Node.js Web App en `admin.expertsddt.com`, con la carpeta `panel/`, Node 22, compilación `npm ci && npm run build` e inicio `node dist/server/entry.mjs`. Hostinger fija `PORT`, que el modo standalone respeta. Las variables de entorno son las de siempre más `LIB_MAX_MB`.
- **Compilación:** se hace desde el repositorio completo (despliegue Git o GitHub Actions), porque el panel importa `../src/styles/global.css` y `../public/*`. Si algún día solo se sube `panel/`, se compila antes en CI y se sube `dist/`. Nunca se copia el CSS a mano.
- **Antes de anunciar «300 MB»:**
  1. Subir un zip real de 300 MB a través del proxy de Hostinger.
  2. Mirar la memoria RSS durante la subida para confirmar la lectura en flujo.
  3. Mirar los tiempos de espera.
  4. Si el proxy corta antes, bajar `LIB_MAX_MB`; la copia sigue sola.
- **Plan B** si el modo standalone da problemas con el proxy o el cuerpo: `@astrojs/node` en modo `middleware`, montado dentro del `server.mjs` actual. Los POST y su seguridad se quedan como están y Astro solo pinta los GET. La interfaz no cambia.

### 9.11 Qué NO hacer

- Nada de `<script>` con código en línea. El único `is:inline` permitido es `<script is:inline src="/theme-init.js">`, sin cuerpo.
- Nada de `define:vars`, atributos `style=`, `<ClientRouter>`, directivas `transition:`, islas `client:*`, React, Tailwind, CDN ni fuentes externas.
- No usar `request.formData()` ni Astro Actions para subir archivos. No mover `_csrf` del primer lugar.
- No dejar `checkOrigin` activo sin `allowedDomains`: cada POST en producción daría 403. Aquí va desactivado, con la comprobación propia.
- No seguir el 303 desde XHR, ni llamar a `location.assign()` para ir al mismo camino con otra ancla sin recargar.
- No usar `#64748b` sobre neblina, ni texto pequeño sobre `--grad` o sobre el centro de un brillo.
  - Tampoco chips blancos translúcidos sobre degradados, `--grad-blue` como relleno de progreso en oscuro ni `--line` como borde de un control.
- No sobrescribir un token en `:root` sin volver a declararlo en `:root[data-theme="dark"]`.
- No poner `object-fit: cover` en las vistas previas de lo publicado (salvo la vista del recorte og).
  - Tampoco `<details name>` exclusivo ni abrir más de una tarjeta desde el servidor.
- No pintar avisos flotantes desde el servidor ni comunicar un resultado solo con un aviso flotante.
- No ocultar el input de archivo con `@media (scripting)`: solo con `html.js`, que pone el paquete.
- No usar las flechas de texto → ↗ ↓ ni ⓘ ✓ ▾: todo va como SVG.
- No usar `mark.webp` como icono, ni `logo.webp`.
- No mostrar rutas ni SHA fuera de «Detalles técnicos».
- No formatear `dataDate` en America/New_York.
- No renombrar rutas ni añadir `next=`.
- No servir copias de seguridad ni PDFs subidos en línea desde `admin.`.
- No poner GSAP, Lenis, pantalla de carga ni revelados al desplazar.

---

## 10. Criterios de aceptación visual

**Capturas que hay que hacer.** Son reales, de `npm run build && npm start`, con datos del repositorio:

- **Login:**
  - 1440×900 y 375×812, en claro y en oscuro.
  - Los estados 401, 429 y «sesión terminada».
- **Contenido:**
  - 1440×900 en claro y en oscuro, con la franja y 01; 1440 a la altura de 03; 375×812 en claro y en oscuro.
  - Estados: tarjeta abierta con archivo elegido y advertencia, subiendo, éxito con «Deshacer» y error.
  - Librería vacía, publicada sospechosa, el diálogo de publicar y un aviso flotante.
- **Historial:** 1440 y 375, con el filtro «Accesos».
- **Páginas de error:** 404 y 500.
- **Con JS desactivado:** login, tarjeta abierta con el input nativo y la página tras subir.
- **Comparación de marca:** una captura lado a lado de la franja de expertsddt.com/es/services/ y la del panel.

**Marca y composición:**

- [ ] Se ve Poppins (en DevTools, «Rendered fonts» = Poppins) en títulos, texto y botones.
- [ ] El logo es `logo-light.webp` y solo aparece sobre navy: barra, login, pie y errores.
- [ ] La franja tiene un solo brillo, arriba a la derecha, más la retícula de 64 px. Las cejas #8fc1ff están en la mitad izquierda y el resumen en vidrio oscuro.
- [ ] Los números 01–04 calados se ven en los dos temas y no se anuncian.
- [ ] La barra mide 68 px y queda fija al desplazar (≥761). A 375 px no es fija y las pestañas miden 48 px.
- [ ] Las tarjetas tienen radio de 22 px (18 a ≤560). En oscuro, la tarjeta #101d3a es más clara que el lienzo #0b1630 y lleva borde #24345a.
- [ ] La tarjeta de versión es navy plana con el disco cónico. No hay texto sobre `--grad`.
- [ ] Ningún glifo → ↗ ↓ ⓘ ✓ ▾ como texto (buscar en el HTML servido): todo es SVG.
- [ ] La captura lado a lado con Servicios se lee como la misma empresa: mismo navy, cejas, píldoras, botones y tipografía.

**Contenido y estados:**

- [ ] Ninguna vista previa de lo publicado está recortada: `scanner-front` se ve entera y vertical; la laptop y el escáner van sobre el escenario navy.
- [ ] Una tarjeta abierta no estira a sus vecinas de fila. Las parejas antes/después están alineadas en 2 columnas.
- [ ] A 375 px las tarjetas de archivo son filas compactas y el panel abierto ocupa todo el ancho.
- [ ] Rutas y SHA solo aparecen dentro de «Detalles técnicos».
- [ ] Tras subir (con y sin JS), el aviso aparece **dentro** de la tarjeta, con «Deshacer», el chip «Recién actualizado», el contorno de destino y el prefijo «Listo:» en el título de la pestaña.
- [ ] Con JS, al arrastrar una foto sobre una tarjeta se abre el panel con «Actual» y «Nueva», la barra avanza y al terminar la página **se recarga sola** y muestra el aviso.
- [ ] «Cancelar subida» muestra el aviso flotante y `DATA_DIR/tmp` queda vacío.
- [ ] Publicar una versión pide confirmación. Con menos de la mitad de archivos, sale el aviso «revísala» con «Volver a la v10».
- [ ] Con `latest.json` y sin `versions.json`, la v10 aparece como «Activa» y sigue en la lista después de publicar la v11.
- [ ] La fecha de datos dice «6 de noviembre de 2026» con el servidor en UTC.
- [ ] El historial se lee en frases, en hora de Florida, y la IP solo aparece en intentos fallidos o bloqueados.
- [ ] No hay ningún texto en inglés (probar con un zip64 y con un zip con `../`).
- [ ] «300 MB» solo aparece en la interfaz después de la subida real a través de Hostinger.

**Accesibilidad:**

- [ ] axe DevTools da 0 errores en login, contenido, historial y 404, en claro y en oscuro.
- [ ] Con un cuentagotas o en «Computed»: `--muted` vale #5b6b82 en claro y #8fa0bd en oscuro. Las etiquetas y los chips coinciden con §8.1.
- [ ] Tab por toda la página en los dos temas: el foco se ve en cada control, es #8fc1ff sobre navy y nunca queda debajo de la barra.
- [ ] Todos los objetivos miden al menos 44×44. Medir `.btn--sm`, `.btn--quiet`, píldoras, pestañas, la «×» y «Volver a esta».
- [ ] El diálogo abre con el foco en «No, volver»; Esc cierra y el foco vuelve al botón.
- [ ] Tras una redirección, el lector de pantalla anuncia el resultado (título y aviso enfocado). En el login con 401, el foco está en la contraseña.
- [ ] Pegar «123 456» en el código funciona.
- [ ] Con movimiento reducido (como lo ve Diego) la página está completa: nada invisible esperando una animación.
- [ ] A 320 y 375 px no hay desplazamiento horizontal en ninguna página. El zoom de texto al 200 % no corta nada.

**Seguridad y sin JS:**

- [ ] En producción la consola no muestra ninguna violación de CSP. La prueba automática de HTML (sin script en línea, `<style>`, `style=` ni `on*=`) pasa.
- [ ] Con JS desactivado se puede entrar, reemplazar una foto, publicar una versión, activar otra, deshacer y salir.
- [ ] `npm test` pasa: las 18 pruebas adaptadas y las nuevas de §9.9.

---

## Anexo A. Dónde se resuelve cada mustFix

| mustFix (jueces 1 y 2) | Resuelto en |
|---|---|
| XHR al mismo camino con otra ancla no recarga | §6.7 (`replaceState` + `reload`), §10 |
| `checkOrigin` sin `allowedDomains` da 403 en producción | §9.2 (`checkOrigin: false` + comprobación propia + `allowedDomains`), §9.3 |
| `--muted` #64748b sobre #f0f5fa (4.34) | §2.1 (#5b6b82 en claro, #8fa0bd en oscuro), §8.1 |
| Error de cascada: `--muted` claro en oscuro (3.30) | §2.1 (regla y bloque `:root[data-theme="dark"]`), §9.11 |
| Texto pequeño sobre `--grad`, chips translúcidos o el centro del brillo | §2.1 (un brillo a .40 y regla de colocación), §2.5 (tarjeta navy plana), §5.5 (números #8fc1ff), §8.1 |
| Contraste del progreso en oscuro | §2.1 (`--fill: #6fb6ff`), §8.1 |
| Aviso flotante del servidor sin JS que no se cierra y tapa el foco | §5.7, §6.13 (resultados en el flujo; flotantes solo del navegador), §8.2 |
| `<details name>` exclusivo / una subida a la vez / una tarjeta abierta | §5.16, §6.4, §6.8 |
| No renombrar rutas; 18 pruebas; solo cambian el regex del aviso y la CSP | §3.1, §9.9 |
| `next=` y redirección abierta | §3.1 (no hay `next=`) |
| `receive()` cuelga y deja temporales al abortar | §9.4, §9.5.5, §9.9 |
| `minWidth` de `facial-scan`/`training-main`; recorte de og a 1200×630 | §9.5.8–9, §9.6, §4.5 |
| TOTP con espacios; quitar `maxlength` | §5.11, §6.1, §9.5.3, §9.9 |
| `dataDate` en UTC | §9.5.16, §10 |
| Nunca `cover` en la vista previa de lo publicado | §4.5, §5.16, §9.11 |
| CSP de compilación: `assetsInlineLimit: 0`, `inlineStylesheets: 'never'`, sin `ClientRouter`, `is:inline`, `define:vars` ni `style=`; cabecera solo en producción | §9.2, §9.3, §9.8, §9.11 |
| Solo `blob:` y `connect-src 'self'` añadidos; que Astro no meta `unsafe-inline` | §9.3 (sin `security.csp`) |
| Subidas en flujo con busboy; nada de `formData()` ni Actions; `_csrf` primero; `bodySizeLimit` ≥ 310 MB; prueba real de 300 MB; plan B en modo middleware | §9.2, §9.4, §9.10 |
| Restaurar: sesión, `readdir`, `placeFile`, historial, 6 más recientes, sin almacén nuevo | §9.5.10–11, §5.17 |
| Si se añaden vistas previas de copias: sesión, `readdir`, `Content-Disposition`, `sandbox`, sin PDF en línea | §9.5.10 (no se añaden en esta versión) |
| `favicon-32.png` y `apple-touch-icon.png`, no `mark.webp` | §2.7 |
| Rutas y SHA en «Detalles técnicos» | §5.18, §10 |
| No prometer 300 MB antes de la prueba real | §4.3, §7.4 (`{LIB_MAX_MB}`), §9.10, §10 |
| Texto fijo «actualizado en septiembre de 2026» | §4.4 (aviso fijo), §7.5, Anexo B |
| Solo español: motivos de `inspectZip` y «la suya» | §7.13, §9.5.7–8 |
| Reutilizar global.css sin `data-reveal` ni clases del sitio; sobrescribir el padding de `.page-hero` y el `nowrap` de `.btn` | §2.1, §9.7 |
| Ocultar el input solo con `html.js` que pone el paquete, no con `@media (scripting)` | §5.12, §6.2, §9.8 |

---

## Anexo B. Hallazgos fuera del panel (sitio y repositorio)

1. **Tienda confirmada.**
   - `shop.expertsddt.com` es el Shopify de Experts DDT: el CNAME `shops.myshopify.com` tiene el alias `xg6mcx-9e.myshopify.com` y la respuesta lleva `powered-by: Shopify`.
   - Hoy responde 302 a `/password`, es decir, la tienda sigue cerrada. Mientras siga así, `npm run check:shop` fallará.
   - `PUBLIC_SHOP_URL` está vacío en `.env.example`. Hay que fijarlo en `https://shop.expertsddt.com` cuando se abra.
   - El panel solo lo menciona como texto («se cambian en Shopify»). Si algún día se enlaza el admin de Shopify, la URL tiene que salir de una variable y confirmarse antes.
2. **Botón de contorno en oscuro (sitio).** `[data-theme="dark"] .btn--outline` gana a `.btn--outline:hover`, que tiene la misma especificidad y va antes. En hover queda #6fb6ff sobre #046bd2 (2.43:1). Arreglo de una línea en global.css: `[data-theme="dark"] .btn--outline:hover { color: #fff; border-color: var(--blue); }`.
3. **El salto al contenido del sitio** es `.sr-only` y nunca se ve con el foco (2.4.7).
4. **Glifos fuera de la fuente (sitio).** `.note::before` (ⓘ) y las flechas `.arrow` (→ ↗ ↓) no están en el subconjunto latin de Poppins y se pintan con la fuente del sistema.
5. **Etiquetas `.tags` en las filas `section--mist` de Servicios:** #046bd2 sobre el tinte encima de neblina da 4.25:1 y falla AA. Con `--blue-dark` daría 5.38.
6. **Fecha de la guía escrita a mano** en `src/i18n/es.js:137` y `en.js:138` («actualizado en septiembre de 2026»). Hay que leerla del archivo al compilar o quitar el mes. Mientras tanto, el panel muestra el aviso.
7. **README del panel:** dice 5 intentos; el código bloquea a los 8 por correo y a los 20 por IP.
8. **`public/downloads/libraries/`** tiene `latest.json` (v10) pero no `versions.json`. Lo cubre §9.5.12; sin ese arreglo, la primera publicación desde el panel perdería la v10 de la lista.

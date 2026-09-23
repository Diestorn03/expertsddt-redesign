# Experts DDT · Propuesta de rediseño web

Rediseño de [expertsddt.com](https://expertsddt.com) construido con **Astro 7**, **GSAP 3.15** (ScrollTrigger + SplitText) y **Lenis**. Reutiliza los colores, la tipografía (Poppins), los textos, las imágenes, los vídeos y la estructura de la web actual (WordPress + Elementor) y los envuelve en una experiencia cinematográfica. Bilingüe (inglés y español), con modo oscuro y versión móvil sobria.

## Arrancar en local

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # sitio estático en /dist
```

## Despliegue

### GitHub Pages (actual)

Cada push a `main` ejecuta [.github/workflows/deploy.yml](.github/workflows/deploy.yml) y publica en `https://<usuario>.github.io/<repo>/`.
Requisitos una sola vez: repositorio público y **Settings → Pages → Source: GitHub Actions**.

El workflow define `PAGES_BASE=/<repo>` y `SITE_URL=https://<usuario>.github.io`. Si se conecta un dominio propio (por ejemplo `nuevo.expertsddt.com`), añade el archivo `public/CNAME` con el dominio y quita `PAGES_BASE` del workflow.

### Hostinger / dominio final

`npm run build` sin variables produce `/dist` con rutas desde la raíz y `site = https://expertsddt.com`. Basta subir la carpeta al hosting. `vercel.json` ya incluye redirecciones y cabeceras por si se usa Vercel.

## Integraciones (variables de entorno)

Todas opcionales. En GitHub: **Settings → Secrets and variables → Actions → Variables**. En local: copia `.env.example` a `.env`.

| Variable | Qué activa |
|---|---|
| `PUBLIC_GA_ID` | Google Analytics 4, cargado solo tras aceptar el banner de cookies |
| `PUBLIC_N8N_FORM_WEBHOOK` | El formulario de contacto envía JSON a n8n. Sin ella abre el cliente de correo |
| `PUBLIC_N8N_CHAT_WEBHOOK` | Widget oficial `@n8n/chat` para "Apex". Sin ella el botón lleva a contacto |
| `PUBLIC_GCAL_EMBED` | Agenda de citas de Google Calendar incrustada en `/contact/` |
| `PUBLIC_SHOP_URL` | Tienda Shopify: el menú "Store", el carrito y los "Add to cart" apuntan ahí |
| `PUBLIC_WHATSAPP` | Número del botón flotante de WhatsApp (por defecto 15106760418) |

### Google Calendar (reservas)

1. En el Google Calendar de la empresa: **Crear → Agenda de citas**, duración 1 hora.
2. Abrir la agenda → **Compartir → Insertar** → copiar la URL del `src` del iframe.
3. Guardarla en `PUBLIC_GCAL_EMBED`. Las citas caen directamente en ese calendario.

### Chat Apex (n8n)

El widget que usa la web actual es `@n8n/chat`. Solo hace falta la URL del **Chat Trigger** del workflow de n8n en `PUBLIC_N8N_CHAT_WEBHOOK` (y añadir el dominio de la web a *Allowed Origins* del trigger).

## Idiomas

Inglés en `/`, español en `/es/`. Todo el texto vive en [src/i18n/en.js](src/i18n/en.js) y [src/i18n/es.js](src/i18n/es.js) con la misma estructura; las páginas solo maquetan. Las rutas `/es/*` son envoltorios de una línea de la página en inglés. Hay `hreflang` y sitemap por idioma.

## Qué cambia respecto a la web actual

| Actual (WordPress + Elementor) | Propuesta (Astro) |
|---|---|
| Tema Astra + Elementor, ~40 scripts y hojas de estilo | HTML estático, CSS y un único bundle JS. Sin base de datos |
| Tabs estáticos en el hero | Escena fijada con scroll: el hero se transforma en el capítulo del Doctor Portal |
| Carrusel de servicios | Scroll horizontal "Four pillars" + grid de servicios con tilt 3D |
| Texto plano "About us" | Texto que se ilumina palabra a palabra, foto con badge "The Wizard" |
| Reseñas en columnas | Tarjetas apiladas (card stack) |
| Traducción automática GTranslate | Español real, con SEO por idioma |
| Sin modo oscuro | Interruptor claro/oscuro persistente |
| Navegación con recarga completa | Transiciones entre páginas con cabecera persistente |

## Paleta y tipografía (extraídas del sitio actual)

| Token | Valor | Origen |
|---|---|---|
| `--blue` | `#046bd2` | ast-global-color-0 |
| `--blue-dark` | `#045cb4` | ast-global-color-1 |
| `--blue-mid` | `#2a7abf` | inicio del degradado de tarjetas |
| `--navy` | `#1d3273` | fin del degradado de tarjetas |
| `--ink` / `--slate` | `#1e293b` / `#334155` | títulos y texto |
| `--mist` | `#f0f5fa` | fondo de secciones claras |
| Fuente | Poppins 400–800 | títulos de la web actual |

## Estructura

```
src/
  layouts/Base.astro        cabecera, menú móvil, footer, tema, hreflang, ClientRouter
  components/Cta.astro      bloque de contacto reutilizado
  components/Apex.astro     WhatsApp + concierge (n8n chat o enlace)
  components/Analytics.astro GA4 + banner de cookies
  i18n/en.js, es.js         contenido
  pages/                    index, services, courses, store, exocad-libraries, contact (+ es/)
  scripts/motion.js         motor de animación por data-attributes
  styles/global.css         tokens (claro/oscuro), botones, nav, footer, reduced-motion
public/img, public/video    assets de expertsddt.com y del paquete del cliente (ver abajo)
public/img/brand            logo oficial (original y versión clara para fondos oscuros) y símbolo
```

## Assets del cliente

Procesados desde el paquete `assets.rar` del cliente (el original pesa 850 MB y no se versiona).

| Uso | Archivo | Origen |
|---|---|---|
| Logo en cabecera, pie, loader, favicon e imagen para compartir | `img/brand/*`, `favicon-32.png`, `apple-touch-icon.png`, `og.jpg` | LOGO EXPERTS DDT.png (la versión clara se genera a partir del original) |
| Pilar 02 "Facial scanner" | `img/scanner-front.webp`, `video/scan-ui.mp4` | Foto del escáner Experts DDT (fondo limpiado) y grabación de su software |
| Pilar 01 y servicios 01 | `video/exocad-smile.mp4` | Grabación de diseño de sonrisa en Exocad |
| Cursos, tienda y recursos | `video/exocad-denture.mp4`, `img/lib-*.webp` | Grabación de prótesis y renders de las librerías en oclusión |
| Servicios 04 | `video/clinic-scan.mp4` | Escaneo intraoral en clínica |
| Pilar 04 y servicios 05 | `img/team.webp` | Foto del equipo |
| Comparador antes/después | `img/smile-*.webp` | Simulaciones generadas; se muestran con aviso de "simulación ilustrativa" |

Vídeos: bucles de 10 a 14 s, 720 px, H.264 sin audio (0,4 a 1 MB). Imágenes: WebP con pérdida.

## Accesibilidad y rendimiento

- `prefers-reduced-motion`: desactiva scroll suave y animaciones.
- Móvil: sin vídeo de fondo ni escenas fijadas, reveals suaves, botones a ancho completo, áreas táctiles ≥ 44 px.
- Durante el scroll solo se animan `transform`, `opacity` y `clip-path`; el oscurecido del hero es una capa de opacidad, no un filtro.
- Scroll suave con Lenis en modo `lerp` (sigue la rueda fotograma a fotograma). Escenas fijadas cortas: el recorrido horizontal de los pilares avanza unos 1,8 px por px de rueda.
- Elementos decorativos con `aria-hidden`, foco visible, skip link, formulario con honeypot.

## Decisiones acordadas y pendientes

- WordPress sigue vivo en Hostinger; la propuesta enlaza a booking, librerías y portal actuales.
- Tienda, cursos y plantillas se venderán en **Shopify** (pendiente `PUBLIC_SHOP_URL`).
- Membresías eliminadas. Portal solo con enlaces a login/signup.
- Reseñas marcadas como **muestra** hasta tener testimonios verificados.
- Logo: se usa el PNG oficial del cliente (2250 px). Si aparece el vectorial (SVG o AI), basta con sustituir `public/img/brand/*`.
- Productos físicos: sin datos públicos, se cubren desde Shopify.

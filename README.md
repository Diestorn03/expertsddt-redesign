# Experts DDT · Propuesta de rediseño web

Rediseño de [expertsddt.com](https://expertsddt.com) construido con **Astro 7**, **GSAP 3.15** (ScrollTrigger + SplitText) y **Lenis**. Reutiliza los colores, la tipografía (Poppins), los textos, las imágenes, los vídeos y la estructura de la web actual (WordPress + Elementor), y los envuelve en una experiencia cinematográfica.

## Arrancar

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # sitio estático en /dist, listo para Netlify, Vercel, Cloudflare o cualquier hosting
```

## Qué cambia respecto a la web actual

| Actual (WordPress + Elementor) | Propuesta (Astro) |
|---|---|
| Tema Astra + Elementor, ~40 scripts y hojas de estilo, carga pesada | HTML estático, CSS y un único bundle JS. Sin base de datos |
| Tabs estáticos en el hero | Escena fijada con scroll: el hero se transforma en el capítulo del Doctor Portal con el portátil como protagonista |
| Carrusel de servicios | Scroll horizontal "Four pillars" + grid de servicios con tilt 3D y glow al pasar el ratón |
| Texto plano "About us" | Texto que se ilumina palabra a palabra al hacer scroll, foto con badge "The Wizard" |
| Reseñas en columnas | Tarjetas apiladas (card stack) que se van recogiendo |
| Sin secciones de recursos ni tienda en la home | Librerías gratuitas, curso y plantillas destacadas con precios reales |
| Navegación con recarga completa | Transiciones entre páginas (View Transitions) con la cabecera persistente |

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
  layouts/Base.astro     cabecera glass, menú móvil, footer, botón "Ask Apex", ClientRouter
  components/Cta.astro   bloque de contacto reutilizado en todas las páginas
  pages/                 index, services, courses, store, libraries, contact
  scripts/motion.js      motor de animación (data-attributes: data-reveal, data-split, data-lit, data-stagger, data-parallax, data-count, data-tilt, data-magnetic)
  styles/global.css      tokens, botones, nav, footer, reduced-motion
public/img, public/video assets descargados de expertsddt.com
```

## Accesibilidad y rendimiento

- `prefers-reduced-motion`: desactiva el scroll suave y todas las animaciones.
- Móvil (`pointer: coarse` / < 960px): el hero fluye sin pin y los pilares se apilan en vertical.
- Solo se animan `transform`, `opacity`, `filter` y `clip-path`.
- Elementos decorativos con `aria-hidden`, foco visible, skip link.

## Pendiente para producción

- Tienda y carrito: conectar con WooCommerce (Store API) o migrar a Stripe Checkout / Shopify Buy Button.
- Formulario de contacto: hoy abre el cliente de correo; cambiar a n8n, Formspree o Netlify Forms.
- Reservas: embeber el widget de booking actual o Cal.com / Calendly.
- Idiomas: la web actual usa GTranslate (10 idiomas); en Astro se puede hacer i18n nativo con rutas `/es`, `/pt`, etc.
- Chat "Apex": incrustar el widget de n8n existente.
- Productos físicos de la tienda: faltan nombres e imágenes (no son públicos en el sitio actual).

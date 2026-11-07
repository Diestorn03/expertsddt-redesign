# Panel de contenido (Node.js)

Permite al equipo de Fernando **reemplazar imágenes, videos y la guía PDF** del sitio y **publicar versiones de las librerías Exocad gratuitas**, sin tocar código ni FTP. Todo funciona sin JavaScript en el navegador, con 2FA obligatorio y registro de cada cambio. El diseño completo está en `DESIGN.md`.

## Qué hace y qué no

- Hace: reemplazo de los archivos listados en `slots.json` (se convierten a WebP/JPG y se reducen si hace falta, con copia de seguridad), vuelta a una copia anterior («Deshacer», «Versiones anteriores»), publicación de zips de librerías con versión, fecha, hash y marcha atrás, historial.
- No hace: editar textos (quedaron fuera por decisión), crear páginas, ni editar el código del sitio.
- Un cambio de código que toque la misma imagen la pisaría en el siguiente despliegue; el panel registra cada reemplazo en el Historial.

## Código

- `lib/panel.mjs`: el núcleo, sin framework (sesión, subidas en flujo, restaurar, librerías, historial y los datos que pinta cada página).
- `lib/format.mjs`: pesos, fechas en hora de Florida, fechas de datos en UTC, tiempo relativo y «lugares».
- `lib/auth.mjs` y `lib/files.mjs`: contraseñas, TOTP, cookies firmadas, tipo real de archivo, zips sin extraer y colocación atómica con copias.
- `server.mjs` + `lib/ui.mjs`: la interfaz HTML provisional; la reemplaza la interfaz Astro.

## Instalación en Hostinger (Node.js Web App)

1. Crear el subdominio `admin.expertsddt.com` y una *Node.js Web App* con la carpeta `panel/` y Node 22.
   - Con la interfaz Astro: compilación `npm ci && npm run build`, inicio `node dist/server/entry.mjs` (compilar desde el repositorio completo: usa `../src/styles/global.css`).
   - Mientras tanto: `npm ci` e inicio `node server.mjs`.
2. Variables de entorno (hPanel):

| Variable | Valor |
|---|---|
| `PANEL_SECRET` | 64 caracteres aleatorios (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `SITE_ROOT` | carpeta pública del sitio, p. ej. `/home/<usuario>/domains/expertsddt.com/public_html` |
| `DATA_DIR` | carpeta **fuera** de `public_html` para usuarios, copias y registro, p. ej. `/home/<usuario>/panel-data` (el panel no arranca si está dentro de `SITE_ROOT`) |
| `SITE_URL` | `https://expertsddt.com` |
| `LIB_MAX_MB` | tope de un zip de librerías en MB (300 por defecto). No anunciar 300 hasta probar una subida real de ese tamaño a través del proxy de Hostinger |
| `COOKIE_SECURE` | `0` solo en pruebas locales sin HTTPS (quita `Secure` y HSTS) |
| `TRUST_PROXY` | `0` si no hay proxy delante (por defecto se lee la IP de `X-Forwarded-For`) |

3. Crear las cuentas (no hay página de registro): `DATA_DIR=... node cli.mjs add-user adela@expertsddt.com "Adela"`. Imprime una contraseña única y el código para la app de autenticación; guardarlos en un gestor de contraseñas.
4. `node cli.mjs revoke <correo>` cierra todas sus sesiones; `set-password` genera una contraseña nueva (y también cierra sus sesiones).

## Seguridad (resumen)

Contraseña con scrypt + código TOTP; cookie `HttpOnly`/`Secure`/`SameSite=Strict`; token CSRF y comprobación de origen; bloqueo de 15 min tras 8 intentos fallidos por correo y 20 por IP; tipo de archivo por contenido (no por nombre); zips revisados sin extraer (rutas, bombas, ZIP64); imágenes recodificadas (quita metadatos como el GPS); ruta de destino siempre dentro de `SITE_ROOT`; copias y registro en `DATA_DIR` (10 copias por archivo); CSP estricta como cabecera, sin `unsafe-inline` en scripts.

Límites conocidos: el bloqueo de intentos vive en memoria (se reinicia con la app); una sola instancia; sin cambio de contraseña desde la interfaz.

## Pruebas

```bash
cd panel && npm ci && npm test   # autenticación, subidas, zips maliciosos, restaurar, versiones, avisos en español, cabeceras
```

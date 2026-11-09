# Panel de contenido (Astro SSR en Node.js)

Permite al equipo de Fernando **reemplazar imágenes, videos y la guía PDF** del sitio y **publicar versiones de las librerías Exocad gratuitas**, sin tocar código ni FTP. Usa el mismo diseño que expertsddt.com (los tokens de `../src/styles/global.css`, Poppins y el logo), tiene 2FA obligatorio y registra cada cambio. Todo funciona sin JavaScript (formularios y redirecciones); con JavaScript se suman arrastrar y soltar, la vista previa, la barra de progreso, los diálogos y el cambio de tema. El diseño completo está en `DESIGN.md`.

## Qué hace y qué no

- Hace: reemplazo de los archivos listados en `slots.json` (se convierten a WebP/JPG y se reducen si hace falta, con copia de seguridad), vuelta a una copia anterior («Deshacer», «Versiones anteriores»), publicación de zips de librerías con versión, fecha, hash y marcha atrás, historial.
- No hace: editar textos (quedaron fuera por decisión), crear páginas, ni editar el código del sitio.
- Un cambio de código que toque la misma imagen la pisaría en el siguiente despliegue; el panel registra cada reemplazo en el Historial.

## Código

- `lib/panel.mjs`: el núcleo, sin framework (sesión, subidas en flujo, restaurar, librerías, historial y los datos que pinta cada página).
- `lib/format.mjs`: pesos, fechas en hora de Florida, fechas de datos en UTC, tiempo relativo y «lugares».
- `lib/auth.mjs` y `lib/files.mjs`: contraseñas, TOTP, cookies firmadas, tipo real de archivo, zips sin extraer y colocación atómica con copias.
- `src/middleware.ts`: comprobación de origen en cada POST, sesión, aviso y cabeceras (CSP como cabecera, sin `unsafe-inline`).
- `src/pages/`: `login.astro` (GET y POST), `index.astro`, `history.astro`, `403/404/500.astro` y los POST `logout`, `restore`, `libraries/activate`, `upload/slot`, `upload/libraries` (envoltorios finos de `lib/panel.mjs`).
- `src/components/`, `src/layouts/`, `src/styles/panel.css`: la interfaz. `src/scripts/panel.ts` es el único script del navegador.
- `server.mjs`: el servidor de producción (se copia a `dist/server/entry.mjs` al compilar).
- `cli.mjs`: cuentas (no hay página de registro).

| Ruta | Qué es |
|---|---|
| GET/POST `/login` | iniciar sesión (contraseña + código de 6 números) |
| GET `/` | contenido: librerías, guía PDF, imágenes, videos |
| GET `/history?tipo=cambios\|accesos\|todo` | historial |
| POST `/upload/slot` | reemplazar imagen, video o PDF (multipart, `_csrf` primero) |
| POST `/upload/libraries` | publicar una versión de librerías (multipart, `_csrf` primero) |
| POST `/libraries/activate` | activar una versión anterior |
| POST `/restore` | volver a una copia anterior de un archivo |
| POST `/logout` | salir |

Con la cabecera `X-Panel-Xhr: 1` las subidas responden `200 {"to": "..."}` en vez de `303` (lo usa la barra de progreso).

## Desarrollo

```bash
cd panel && npm ci
npm run build                 # astro build → dist/ (dist/server/entry.mjs es server.mjs; el paquete de Astro queda en dist/server/app.mjs)
PANEL_SECRET=... SITE_ROOT=... DATA_DIR=... COOKIE_SECURE=0 node dist/server/entry.mjs   # http://127.0.0.1:8080 (o HOST/PORT)
npm run dev                   # astro dev (sin la cabecera CSP: Vite mete scripts en línea en desarrollo)
```

`server.mjs` es el servidor de producción (el «plan B» de DESIGN §9.10): comprueba la configuración y borra los temporales de subidas cortadas **antes** de escuchar (si algo está mal, la app sale con un mensaje claro y hPanel la muestra caída), quita el límite de 300 s de Node para subidas lentas (las cabeceras siguen con 60 s y una conexión sin datos durante 2 min se cierra), responde 405 con las cabeceras de seguridad a métodos como TRACE y pasa la IP del socket al panel.

## Instalación en Hostinger (Node.js Web App)

1. Crear el subdominio `admin.expertsddt.com` y una *Node.js Web App* con la carpeta `panel/` y **Node 22.19 o más nuevo** (lo exigen Astro 7 y su undici).
   - Compilación: `npm ci && npm run build`. Inicio: `node dist/server/entry.mjs`. Hostinger fija `PORT`.
   - Compilar desde el **repositorio completo** (despliegue Git o GitHub Actions): el panel importa `../src/styles/global.css` y `../public/*` (logo, favicon). Si algún día solo se sube `panel/`, compilar antes en CI, subir `panel/` con `dist/` y usar `npm ci --omit=dev` sin paso de compilación (lo prueba `test/ops/clean-install.mjs`). Nunca copiar el CSS a mano.
   - Después de `npm ci`, comprobar que sharp carga: `node -e "require('sharp')"`. Sin sharp el panel arranca, pero avisa en el registro y las fotos se publican **con** sus metadatos (EXIF, GPS) y sin convertir.
2. Variables de entorno (hPanel):

| Variable | Valor |
|---|---|
| `PANEL_SECRET` | 64 caracteres aleatorios (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `SITE_ROOT` | carpeta pública del sitio, p. ej. `/home/<usuario>/domains/expertsddt.com/public_html`. Tiene que existir: si no, el registro lo dice al arrancar y toda subida se rechaza |
| `DATA_DIR` | carpeta **fuera** de `public_html` para usuarios, copias y registro, p. ej. `/home/<usuario>/panel-data` (el panel no arranca si está dentro de `SITE_ROOT`) |
| `SITE_URL` | `https://expertsddt.com` (URL completa; de ahí salen las vistas previas y entra en la CSP) |
| `PANEL_URL` | `https://admin.expertsddt.com` (por defecto). El origen que manda el navegador: se acepta aunque el proxy cambie la cabecera `Host` |
| `LIB_MAX_MB` | tope de un zip de librerías en MB (300 por defecto). Se lee al arrancar: basta reiniciar, no hace falta recompilar. Un valor que no sea un número impide arrancar |
| `HOST` | `127.0.0.1` por defecto. Poner `0.0.0.0` solo si el proxy de Hostinger no conecta por la interfaz local (síntoma: 502 con el registro diciendo «Server listening») |
| `PORT` | lo fija Hostinger (8080 por defecto) |
| `COOKIE_SECURE` | `0` solo en pruebas locales sin HTTPS (quita `Secure`, HSTS y el prefijo `__Host-` de la cookie) |
| `TRUST_PROXY` | vacío por defecto: `X-Forwarded-For` solo se lee si la conexión llega desde la propia máquina (un proxy local), y entonces se toma la **última** entrada, la que añadió el proxy. `1` si el proxy de Hostinger conecta desde otra dirección (síntoma: en «Accesos» todos los intentos fallidos muestran la misma IP). La IP siempre se valida |

3. Crear las cuentas **por SSH**, nunca en los comandos de compilación o inicio (imprime la contraseña): `DATA_DIR=... node cli.mjs add-user adela@expertsddt.com "Adela"`. Imprime una contraseña única y el código para la app de autenticación; guardarlos en un gestor de contraseñas.
4. `node cli.mjs revoke <correo>` cierra todas sus sesiones; `set-password` genera una contraseña nueva (y también cierra sus sesiones); `list` muestra las cuentas.
5. **Comprobación después de cada despliegue:** `curl -sI https://admin.expertsddt.com/login` debe dar `200` con una cabecera `content-security-policy`. Los mensajes del panel (arranque, «sharp could not be loaded», «SITE_ROOT … does not exist», «users.json cannot be read») salen por la salida estándar y de errores de la app, en los registros de hPanel.
6. **Antes de anunciar «300 MB»:** subir un zip real de 300 MB a través del proxy de Hostinger, mirar la memoria (RSS) durante la subida y los tiempos de espera. El panel no corta subidas lentas, pero el proxy puede tener su propio límite de tiempo o de tamaño; si corta antes, bajar `LIB_MAX_MB` (la interfaz muestra ese valor sola).

### Qué hay en DATA_DIR (y qué respaldar)

- `users.json`: las cuentas (respaldar). `cli.mjs` lo escribe de forma atómica; si se edita a mano y queda roto, el panel lo dice en el registro y sigue con la última copia buena hasta reiniciar.
- `backups/`: las 10 copias más recientes de cada archivo reemplazado y de cada zip de librerías reemplazado (respaldar si se quiere conservar el historial de archivos).
- `audit.jsonl` y `audit.jsonl.1`: el historial. Rota a los 5 MB y guarda un archivo anterior; las páginas leen los últimos 2 MB.
- `tmp/`: subidas en curso; se vacía al arrancar.

Los zips de librerías publicados viven en `public_html/downloads/libraries/` y **no se borran nunca** (cada versión sigue disponible para «Activar»): vigilar el espacio en disco, que se comparte con el sitio.

## Seguridad (resumen)

Contraseña con scrypt + código TOTP; cookie `__Host-edp_sid` `HttpOnly`/`Secure`/`SameSite=Strict` de 8 horas, revocable con `tokenVersion`; token CSRF en cada POST (el primer campo en los multipart) y comprobación de origen (sin `Origin` se acepta; `null` o ajeno, no; nunca se fía de `X-Forwarded-Host`); bloqueo de 15 min tras **8 intentos fallidos por correo y 20 por IP**; tipo de archivo por contenido (no por nombre); zips revisados sin extraer (rutas, bombas, ZIP64; el directorio central y las cabeceras locales tienen que coincidir); imágenes recodificadas con sharp (quita metadatos como el GPS; si sharp no carga, el registro lo avisa); ruta de destino siempre dentro de `SITE_ROOT`; copias y registro en `DATA_DIR` (10 copias por archivo); CSP estricta como cabecera (`script-src 'self'`, `style-src 'self'`, sin `unsafe-inline`, sin CDN), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Cache-Control: no-store`. Ningún HTML servido lleva `<script>` en línea, `<style>`, `style=` ni `on*=` (lo comprueban las pruebas).

Límites conocidos: el bloqueo de intentos vive en memoria (se reinicia con la app) y anota una sola línea por bloqueo; una sola instancia (las publicaciones de librerías se ordenan en memoria); sin cambio de contraseña desde la interfaz.

## Pruebas

```bash
cd panel && npm ci && npm test   # astro build + node --test test/*.test.mjs
```

- `test/core.test.mjs`: autenticación, TOTP, zips, tipos de archivo, formatos, mensajes en español y el núcleo (`lib/panel.mjs`) llamado como lo llaman las rutas.
- `test/adversarial/` y `test/ops/` (fuera de `npm test`, después de `npm run build`): `node --test test/adversarial/*.test.mjs`, `node --test --test-concurrency=1 test/ops/*.test.mjs` (`OPS_SLOW=1` añade la subida lenta de 6 minutos; hacen falta unos 2 GB libres) y `node test/ops/clean-install.mjs`.
- `test/e2e.test.mjs`: arranca `node dist/server/entry.mjs` con `SITE_ROOT` y `DATA_DIR` temporales y prueba por HTTP cabeceras y CSP, HTML sin código en línea, login, CSRF y origen, reemplazos (formulario normal y rama XHR), restaurar, librerías (incluida la v10 sin `versions.json`), historial, 403/404/500 y la sesión caducada.

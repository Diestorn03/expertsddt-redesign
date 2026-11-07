# Panel de contenido (Node.js)

Permite al equipo de Fernando **reemplazar imágenes, videos y la guía PDF** del sitio y **publicar versiones de las librerías Exocad gratuitas**, sin tocar código ni FTP. Sin dependencias de navegador (cero JavaScript en el cliente), 2FA obligatorio y registro de cada cambio.

## Qué hace y qué no

- Hace: reemplazo de los archivos listados en `slots.json` (se convierten a WebP/JPG y se reducen si hace falta, con copia de seguridad), publicación de zips de librerías con versión, fecha, hash y marcha atrás, historial.
- No hace: editar textos (quedaron fuera por decisión), crear páginas, ni editar el código del sitio.
- Un cambio de código que toque la misma imagen la pisaría en el siguiente despliegue; el panel registra cada reemplazo en el Historial.

## Instalación en Hostinger (Node.js Web App)

1. Crear el subdominio `admin.expertsddt.com` y una *Node.js Web App* apuntando a la carpeta `panel/` (archivo de inicio `server.mjs`, Node 22).
2. Variables de entorno (hPanel):

| Variable | Valor |
|---|---|
| `PANEL_SECRET` | 64 caracteres aleatorios (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `SITE_ROOT` | carpeta pública del sitio, p. ej. `/home/<usuario>/domains/expertsddt.com/public_html` |
| `DATA_DIR` | carpeta **fuera** de `public_html` para usuarios, copias y registro, p. ej. `/home/<usuario>/panel-data` |
| `SITE_URL` | `https://expertsddt.com` |

3. Crear las cuentas (no hay página de registro): `DATA_DIR=... node cli.mjs add-user adela@expertsddt.com "Adela"`. Imprime una contraseña única y el código para la app de autenticación; guardarlos en un gestor de contraseñas.
4. `node cli.mjs revoke <correo>` cierra todas sus sesiones; `set-password` genera una contraseña nueva.

## Seguridad (resumen)

Contraseña con scrypt + código TOTP; cookie `HttpOnly`/`Secure`/`SameSite=Strict`; token CSRF y comprobación de origen; bloqueo de 15 min tras 5 intentos fallidos por usuario (20 por IP); tipo de archivo por contenido (no por nombre); zips revisados sin extraer (rutas, bombas); imágenes recodificadas (quita metadatos como el GPS); ruta de destino siempre dentro de `SITE_ROOT`; CSP `default-src 'none'`.

Límites conocidos: el bloqueo de intentos vive en memoria (se reinicia con la app); una sola instancia; sin cambio de contraseña desde la interfaz.

## Pruebas

```bash
cd panel && npm ci && npm test   # 18 pruebas: autenticación, subidas, zips maliciosos, versiones, cabeceras
```

# Despliegue a Hostinger (GitHub Actions)

Nada sale a `expertsddt.com` sin que alguien lance el workflow **Deploy to Hostinger** a mano (Actions → Run workflow). El de producción espera aprobación. El sitio se compila en GitHub, se audita (`npm test`) y se sube por FTPS; después corre una prueba de humo sobre la URL real.

## Configuración (una sola vez)

1. **Hostinger → Archivos → Cuentas FTP:** crear una cuenta FTP limitada a la carpeta del sitio (`public_html`). No usar la cuenta principal.
2. **GitHub → Settings → Environments:** crear `staging` y `production`. En `production`, activar *Required reviewers* (Diego y David).
3. **Secretos por entorno** (cada Environment): `FTP_HOST`, `FTP_USERNAME`, `FTP_PASSWORD` y, si no es 21, `FTP_PORT`.
4. **Variables por entorno:** `FTP_SERVER_DIR` (termina en `/`, p. ej. `/public_html/`).
5. **Variables del repositorio:** `STAGING_URL` (si hay subdominio de ensayo), `PUBLIC_SHOP_URL`, `PUBLIC_N8N_FORM_WEBHOOK`, `PUBLIC_N8N_CHAT_WEBHOOK`, `PUBLIC_GCAL_EMBED`, `PUBLIC_WHATSAPP`, y `PUBLIC_GA_ID` solo cuando se active la analítica.
6. Producción exige `PUBLIC_SHOP_URL`, `PUBLIC_N8N_FORM_WEBHOOK` y `PUBLIC_GCAL_EMBED`; el workflow se detiene si faltan.

El webhook de n8n recibe JSON con `source`: `contact` (formulario de contacto) o `exocad-libraries` (descarga de librerías, con `name`, `email`, `version`). Un nodo *Switch* por `source` decide si manda correo o agrega una fila a Google Sheets. En el webhook hay que permitir el origen `https://expertsddt.com` (Options → Allowed Origins).

## Archivos que viven en el servidor, no en el repo

- `/downloads/libraries/` con el zip de las librerías y `latest.json` (`version`, `dataDate`, `file`, `bytes`). Al subir una versión nueva y cambiar `latest.json`, la web la ofrece sin recompilar.
- Cualquier medio que el panel de contenido suba. El workflow los excluye y nunca los borra.

## Antes del corte (lista de verificación)

- [ ] Respaldo completo de Hostinger (archivos + base de datos) y copia del `.htaccess` actual como `.htaccess.wp-backup`.
- [ ] Exportar de WordPress: pedidos y clientes de WooCommerce, citas de Simply Schedule Appointments y envíos del formulario de librerías (Contact Form 7). Quien ya compró el curso pierde su acceso al cerrar WordPress: migrarlo a Shopify antes.
- [ ] Subir a `/downloads/libraries/` el zip v10 y su `latest.json`.
- [ ] Probar en `staging`: formulario de contacto, descarga de librerías, reserva en Google Calendar, enlaces a Shopify, ES/EN, claro/oscuro, móvil.
- [ ] Producción en modo **dry run**: revisar la lista de archivos que subiría.
- [ ] Fecha y hora del corte acordadas con Fernando.

## Corte

1. Run workflow → `production`, `dry_run` desactivado, aprobar. Termina con el *smoke test*.
2. Revisar a mano: inicio, `/es/`, servicios, tienda, librerías, contacto, legales y una URL vieja (p. ej. `/producto/templates-package/`).
3. Enviar `https://expertsddt.com/sitemap-index.xml` a Google Search Console.
4. Los archivos de WordPress (`wp-admin`, `wp-content`, `wp-includes`, `*.php`) quedan en el servidor pero inaccesibles (`.htaccess` responde 410). Después de 7 días sin incidencias, descargarlos como archivo y borrarlos.

## Vuelta atrás

- **Un despliegue nuevo falló:** Run workflow con `ref` = el tag o commit anterior bueno. Cada ejecución guarda además el sitio compilado como artefacto durante 90 días.
- **Hay que volver a WordPress:** restaurar el respaldo de Hostinger (y `.htaccess.wp-backup`). Por eso el respaldo previo es obligatorio.

## Comprobaciones locales

```bash
npm run build && npm test   # redirecciones simuladas + auditoría del sitio compilado
```

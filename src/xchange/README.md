# DDT Xchange (Scan Studio)

Free browser tool for expertsddt.com: replace the implant geometry of a capture (scan-body mesh or position table)
with library geometry in the same positions, optionally align everything to the jaw scan, and export a ZIP.
Clean TypeScript rebuild; the client's ChatGPT prototype is a specification only (no code or data copied).

Commands (from the repo root): `npm run test:xchange`, `npm run typecheck:xchange`, one file:
`npx vitest run src/xchange/<path>`.

## Folders

| Folder | What lives there |
|---|---|
| `core/` | Shared types, errors, limits, vec3/mat4 (row-major rigid), rigid fits, mesh helpers, sampling, binary STL writer, strict text decoding. Pure, worker-safe, no dependencies |
| `io/mesh/` | STL (binary/ASCII), PLY, OBJ parsers -> indexed `TriMesh`, content-based detection, limits |
| `io/positions/` | Implant position files: MicronMapper CSV, ScanAdaptor XML (strict mini XML reader, no DOMParser), matrix tables, JSON, ImplantPositions XML, iCam TXT. XLSX is out of scope for v1 (users export CSV) |
| `geometry/` | Weld, connected components, PCA, BVH (closest point, ray pick) |
| `detect/` | Implant frames from a capture mesh: component split, reference fitting, index ambiguity, linking position files to components; replacement assemblies (`planAssembly`, `verifyAssemblyLayout`) |
| `align/` | k-d tree, trimmed ICP, multi-start auto alignment, guided landmarks 1-2-3-4, metrics, deviation map (µm), Web Worker protocol + Promise client |
| `export/` | Replacement placement, combined/individual STLs, jaw copied byte for byte, `report.json`, README (ES/EN), stored ZIP |
| `state/` | Later: typed case store, geometry library (IndexedDB) |
| `viewer/` | Later: three.js scene, exocad-style controls, picking, manipulation |
| `ui/` | Later: the 4-step wizard, i18n, accessibility, optional e-mail capture |
| `test/fixtures/` | Deterministic synthetic generators (scan bodies, arch, frames, full cases) and file encoders |
| `test/adversarial/` | Review findings reproduced as tests (names start with `BUG:`); all fixed, they now guard against regressions |
| `test/integration.test.ts` | Files in, ZIP out, through every module, checked against the ground truth |

`CONTRACTS.md` has the exact exported signatures, error codes and rules for each module.

## Privacy rules (non-negotiable)

- Files never leave the user's computer: parsing, alignment and export run in the browser. No upload, no telemetry.
  The only network call is the optional marketing e-mail, sent by the UI.
- No login and no patient data. Never store, show, log or export input **file names** (they often contain the
  patient's name). No type in `core/types.ts` has a file-name field; keep it that way.
- Error and warning details carry codes, numbers and reason ids only: never file names or text copied from a file.
- Tests use synthetic data generated in code (`test/fixtures`). Never commit or load real scans, and never open the
  client's sample archive (it contains a real patient name).

## Estado (2026-11-07)

**Funciona en la interfaz** (`/ddt-xchange/` y `/es/ddt-xchange/`, dentro del sitio, con su motion, Lenis y ClientRouter):
- Paso 1: arcada superior/inferior e importación de la captura (malla de scan bodies o uno o varios archivos de
  posiciones; la misma etiqueta en dos archivos solo se acepta si las matrices coinciden en 1e-7). Posiciones
  provisionales con confirmar o dejar fuera.
- Paso 2: geometría de reemplazo desde "Tus geometrías" (IndexedDB, 50 como máximo, favoritas, renombrar, eliminar
  con confirmación, copia de seguridad en JSON). Elegir una la aplica al instante a todos o al implante elegido en este
  paso, con Deshacer; aplicada a todos, pasa sola al paso 3.
- Paso 3: escaneo de la mandíbula (opcional) y, al cargarlo, alineación automática.
- Paso 4: automática, puntos guiados 1-2-3-4 (clic, toque en tableta o Enter con la mira desde el teclado; se pueden
  omitir implantes y alinear con los puntos puestos), resultado con RMS, cobertura, tabla por implante y mapa de
  colores 0-100 µm; ajuste a mano (arrastrar, Ctrl + arrastrar, panel de 30°/5°, voltear 180°), re-medido 250 ms
  después; Deshacer y Restablecer. Exportar el ZIP para Exocad tras pedir el correo una vez (webhook
  `PUBLIC_N8N_FORM_WEBHOOK`; nunca bloquea la descarga).
- Visor bajo demanda (60 fps, pausa fuera de pantalla), tema claro/oscuro en vivo, movimiento reducido respetado,
  todo liberado al salir de la página (workers, WebGL, URLs blob, IndexedDB).
- Aspecto del visor: el look A "Fiel a exocad" (fondo índigo, encía con los colores del escáner, piezas beige-dorado,
  aro de selección), con barra de iconos, dial de vistas, barra de escala y leyenda con las marcas en su valor
  (`VIEWER-POLISH.md` §3.5).

**Cómo probar la demo:** `npm run build` y `npx astro preview`, abrir `/ddt-xchange/` y pulsar "Try a sample case"
(o "Probar un caso de ejemplo"). Se genera en el navegador un caso sintético (`sample/`: arcada superior desdentada
All-on-4 con paladar y scan bodies escaneados, PLY con color de ~280 k triángulos y archivo MicronMapper) que pasa por
el pipeline real; en el paso 2 se elige "Sample scan body", en el paso 3 "Use the sample jaw scan", y el paso 4 alinea
solo (Good fit, unos 4 µm) y exporta el ZIP.

**Probado:** 403 tests de Vitest (motor, estado, visor, revisiones adversariales y de UX: foco, tiempos de
animación, contraste, toque, ciclo de vida); `npm run typecheck:xchange` y `npm test` sin errores, `npm run build`
correcto. Verificado en Chrome 156: foco con teclado en cada paso, puntos guiados con teclado y con toque en tableta,
cambio de 1280 a 1100 px sin saltar al inicio, movimiento reducido sin desplazamientos, ES a 960 px sin botones
cortados.

**Limitaciones conocidas:**
- No hay plantilla integrada: la H6.6 del prototipo no se copia. La detección en malla necesita un cuerpo de
  referencia de la biblioteca.
- Las métricas no recortan: la parte del cuerpo bajo la encía baja la cobertura aunque la pose sea exacta.
- Con un solo cuerpo redondo, el giro axial queda arbitrario; se marca, no se adivina.
- Quedan dos ICP y dos árboles de punto más cercano (`detect/` con BVH, `align/` con k-d tree). Es deuda aceptada:
  conviene unificarlos con casos reales para comparar.
- La copia de la biblioteca es un solo JSON de hasta 256 MB (caben 50 piezas comunes); una mayor se descarga igual
  con un aviso. Si las bibliotecas reales crecen más, hay que partirla en varios archivos.
- La CSP de producción aún necesita `'unsafe-inline'` en script-src por el script de tema de `Base.astro` (moverlo a
  un hash o a un archivo antes de quitarlo).
- XLSX y los formatos nativos PIC, Tupel y BEB se rechazan. El ZIP se arma en memoria (pico de unas 2 veces el
  paquete, máximo 512 MB).
- Todo se validó solo con datos sintéticos: una tira de encía y cilindros, sin dientes, paladar ni artefactos de escaneo.

**Necesita al cliente (Fernando)**, con casos anonimizados:
- P5/P14: 3-5 casos con la alineación correcta hecha en exocad, para calibrar los umbrales, que hoy son heurísticos.
  Alineación: RMS 50/100 µm, cobertura 95/80 %, ambigüedad 1,1 veces o 5 µm. Detección: 30 µm y 98 %, cobertura de
  la referencia 50 %.
- P1: exportaciones reales de MicronMapper, ScanAdaptor e iCam (los lectores siguen el prototipo y su guía).
- P11: tamaños reales de mandíbulas y capturas para ajustar los límites (hoy 150 MB y 3 M triángulos; se avisa de
  unidades si una mandíbula mide menos de 15 mm).
- P3/P4: el CAD de los cuerpos de escaneo de referencia, con su licencia, y qué hacer con el giro axial de los
  cuerpos redondos.
- Confirmar los ejes de las vistas predefinidas (`viewer/presets.ts`: se asume +Z oclusal en la inferior y -Y
  anterior) con un caso real.
- n8n: definir `PUBLIC_N8N_FORM_WEBHOOK` y añadir al flujo la rama `source: 'ddt-xchange'`.

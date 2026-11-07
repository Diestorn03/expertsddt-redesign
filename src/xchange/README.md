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

**Funciona** (motor completo, todavía sin interfaz):
- Importar mallas (STL binario y ASCII, PLY, OBJ) y las 6 familias de archivos de posiciones, con los límites de la
  sección 7.4 comprobados antes de reservar memoria.
- Recuperar los marcos de implante de una captura en malla con un cuerpo de referencia de la biblioteca, también
  cuando la base del cuerpo no se escaneó; enlazar un archivo de posiciones con la malla.
- Alinear con la mandíbula: automático (multiarranque), guiado 1-2-3-4, ajuste manual medido; métricas por implante y
  mapa de desviación en µm, en un worker cancelable.
- Exportar el ZIP: `combined.stl`, `replacements.stl`, un STL por implante, la mandíbula byte a byte, `report.json`
  y `README.txt` (ES/EN).

**Probado:** 261 tests de Vitest en unos 12 s: unitarios por módulo, 33 adversariales (los hallazgos de la revisión,
todos corregidos) y 2 de integración de punta a punta (malla de captura → sitios → alineación → ZIP; archivo de
posiciones + malla → clics guiados → ZIP), con menos de 2 µm de error en los reemplazos exportados.
`npm run typecheck:xchange` sin errores y `npm run build` correcto.

**Falta:** `state/` (caso, biblioteca en IndexedDB, regla de la misma etiqueta en dos archivos), `viewer/` y `ui/`.

**Limitaciones conocidas:**
- No hay plantilla integrada: la H6.6 del prototipo no se copia. La detección en malla necesita un cuerpo de
  referencia de la biblioteca.
- Las métricas no recortan: la parte del cuerpo bajo la encía baja la cobertura aunque la pose sea exacta.
- Con un solo cuerpo redondo, el giro axial queda arbitrario; se marca, no se adivina.
- Quedan dos ICP y dos árboles de punto más cercano (`detect/` con BVH, `align/` con k-d tree). Es deuda aceptada:
  conviene unificarlos con casos reales para comparar.
- XLSX y los formatos nativos PIC, Tupel y BEB se rechazan. El ZIP se arma en memoria (pico de unas 2 veces el
  paquete, máximo 512 MB).
- Todo se validó solo con datos sintéticos: una tira de encía y cilindros, sin dientes, paladar ni artefactos de escaneo.

**Necesita casos reales de Fernando** (anonimizados):
- P5/P14: 3-5 casos con la alineación correcta hecha en exocad, para calibrar los umbrales, que hoy son heurísticos.
  Alineación: RMS 50/100 µm, cobertura 95/80 %, ambigüedad 1,1 veces o 5 µm. Detección: 30 µm y 98 %, cobertura de
  la referencia 50 %.
- P1: exportaciones reales de MicronMapper, ScanAdaptor e iCam (los lectores siguen el prototipo y su guía).
- P11: tamaños reales de mandíbulas y capturas para ajustar los límites (hoy 150 MB y 3 M triángulos; se avisa de
  unidades si una mandíbula mide menos de 15 mm).
- P3/P4: el CAD de los cuerpos de escaneo de referencia, con su licencia, y qué hacer con el giro axial de los
  cuerpos redondos.

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
| `align/` | k-d tree, trimmed ICP, multi-start auto alignment (starts seeded from the scan bodies seen in the jaw, PCA matchings and their turns about the jaw's normal, untrimmed polish), guided landmarks 1-2-3-4, metrics, deviation map (µm), Web Worker protocol + Promise client |
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

## Estado (2026-11-09)

**Funciona en la interfaz** (`/ddt-xchange/` y `/es/ddt-xchange/`, dentro del sitio, con su motion, Lenis y ClientRouter):
- Paso 1: arcada superior/inferior e importación de la captura (malla de scan bodies o uno o varios archivos de
  posiciones; la misma etiqueta en dos archivos solo se acepta si las matrices coinciden en 1e-7). Posiciones
  provisionales con confirmar o dejar fuera. CSV de MicronMapper con cualquier familia de marcadores (AXO, AHY, BTH…,
  una por archivo). Una tapa con su inserto cuenta como un solo cuerpo, también al detectar y al exportar. Si el archivo
  de posiciones y la malla no comparten sistema de coordenadas, no se emparejan y un aviso ofrece usar solo uno.
  Un STL de posiciones elegido como geometría cuyos cuerpos no caen sobre los implantes no se aplica (paso 2, con el
  mismo aviso).
- Paso 2: geometría de reemplazo desde "Tus geometrías" (IndexedDB, 50 como máximo, favoritas, renombrar, eliminar
  con confirmación, copia de seguridad en JSON). Elegir una la aplica al instante a todos o al implante elegido en este
  paso, con Deshacer; aplicada a todos, pasa sola al paso 3, o de vuelta al paso 4 si el paso 3 ya está hecho. Si cada
  implante trae su cuerpo en el archivo de posiciones (un STL, solo o emparejado con el CSV), la lista empieza con
  «Sin intercambio: usar los cuerpos del archivo»: cada implante conserva su cuerpo y el caso se alinea sin elegir un
  reemplazo (workflow 2 de Fernando: alinear y después intercambiar).
- Regla `alignedWith`: la alineación se mide con los cuerpos que había al hacerla. Un intercambio posterior solo cambia
  lo que se exporta: no se vuelve a medir con la pieza nueva (que no está en el escaneo; antes salía «débil» y los
  implantes «No coincide»), el avance vuelve al paso 4 con la nota «Alineado con … · Se exporta …», el mapa de color no
  se dibuja sobre la pieza intercambiada y report.json guarda `matchedWith`. Volver a alinear usa lo que esté puesto.
  Así los dos órdenes de Fernando (intercambiar y alinear, o alinear e intercambiar) usan los mismos 4 pasos.
- Paso 3: escaneo de la mandíbula (opcional) y, al cargarlo, alineación automática. «Exportar sin escaneo» es un botón
  primario, del mismo peso que cargar el escaneo: exportar sin arcada es un camino normal. La búsqueda arranca también desde
  los scan bodies que ve en el escaneo y, si no los encuentra, gira cada arranque PCA alrededor de la normal oclusal; el
  ajuste final no recorta pares. En las 8 arcadas de Fernando llega a la misma pose desde cualquier arranque y desde el
  marco de su CSV, a 0,02-0,07 mm de su alineación (caso 2 superior: 0,32 mm, el escaneo viene estirado ~1 %), con
  mejor puntaje propio que la suya, en 0,7-1,6 s (mediana).
- Paso 4: automática, puntos guiados 1-2-3-4 (clic, toque en tableta o Enter con la mira desde el teclado; se pueden
  omitir implantes y alinear con los puntos puestos), resultado con RMS, cobertura, tabla por implante y mapa de
  colores 0-100 µm, medidos sobre la parte de los cuerpos que ve el escaneo: lo que queda bajo la encía no cuenta y el
  mapa lo pinta de gris (antes toda alineación correcta de Fernando salía «débil» y una «fallida»; ahora sus 8 arcadas
  salen «buena», o «aceptable» el caso 2 superior con el escaneo estirado, y las mismas poses movidas 2 mm y 3° salen
  «fallida»); ajuste a mano (arrastrar, Ctrl + arrastrar, panel de 30°/5° con Fino para pasos de 5° · 0,1 mm
  también en tablet, voltear 180°), re-medido 250 ms
  después; Deshacer y Restablecer. Exportar el ZIP para Exocad tras pedir el correo una vez (webhook
  `PUBLIC_N8N_FORM_WEBHOOK`; nunca bloquea la descarga). El archivo principal se llama como los de Fernando,
  `<upper|lower>_implant_position.stl` (el grupo, antes `replacements.stl`), y va primero; siguen `combined.stl`, un
  STL por implante, la copia de la arcada, `report.json` y `README.txt`. El resumen del paso 4 muestra la geometría
  exportada con [Cambiar] (vuelve al paso 2).
- Visor bajo demanda (60 fps, pausa fuera de pantalla), tema claro/oscuro en vivo, movimiento reducido respetado,
  todo liberado al salir de la página (workers, WebGL, URLs blob, IndexedDB).
- Aspecto del visor: el look A "Fiel a exocad" (fondo índigo, encía con los colores del escáner, piezas beige-dorado,
  aro de selección), con barra de iconos, dial de vistas, barra de escala y leyenda con las marcas en su valor
  (`VIEWER-POLISH.md` §3.5).
- Navegación como en exocad (`VIEWER-POLISH.md` §4.14): vistas con el teclado numérico o la fila de números (1 frontal,
  2 inferior, 3 posterior, 4 izquierda, 5 encuadrar, 6 derecha, 8 superior, 0 vista inicial), que siguen el marco de
  cada caso: oclusal según los ejes de los implantes y frente según su arco (sin implantes sobre el escaneo, según el
  escaneo); en las 8 arcadas de Fernando quedan a menos de 9° del lado correcto (la tabla fija erraba 57-178°), flechas para desplazar,
  Shift + flechas y Re Pág/Av Pág para girar, Inicio fija el centro de giro, Ctrl + arrastrar en cualquier parte gira
  el conjunto (paso 4), mantener presionado en tablet fija el centro de giro, Shift / Ctrl + clic central sobre un
  objeto cambia su transparencia o lo oculta, y S lo vuelve a mostrar.
- Herramientas de inspección (`VIEWER-POLISH.md` §5.10): corte con un plano (botón Corte o P; posición, Shift + rueda,
  mostrar el otro lado, seguir la vista; las caras cortadas de las piezas se ven planas en azul y el escaneo, una
  superficie abierta, sigue iluminado por ambos lados), distancia entre dos puntos (botón o
  R; clic, toque o Enter con la mira, arrastrar un punto, valor en mm con dos decimales y anunciado), D alterna el mapa
  de color como C, y los clics sobre superficies se resuelven en la GPU (1-3 ms en 3 M triángulos en vez de 0,2-0,4 s).
  Nada de esto mueve el conjunto ni el escaneo: lo que se exporta sigue siendo lo que se ve.
- Correcciones de las revisiones de UX y adversarial (`VIEWER-POLISH.md` §5.11): 32 hallazgos, entre ellos la pose
  mostrada = guardada aunque llegue un Deshacer o una alineación durante un arrastre, el primer P sin congelar la vista
  (de 70-100 ms a un cuadro de 21 ms con 3 M triángulos), ambos botones desplazan, la rueda sobre los controles hace zoom.

**Cómo probar la demo:** `npm run build` y `npx astro preview`, abrir `/ddt-xchange/` y pulsar "Try a sample case"
(o "Probar un caso de ejemplo"). Se genera en el navegador un caso sintético (`sample/`: arcada superior desdentada
All-on-4 con paladar y scan bodies escaneados, PLY con color de ~280 k triángulos, archivo MicronMapper y su STL de
posiciones) que pasa por el pipeline real. Workflow 1: en el paso 2 se elige "Sample scan body", en el paso 3 "Use the
sample jaw scan", y el paso 4 alinea solo (Good fit, unos 4 µm) y exporta el ZIP. Workflow 2: en el paso 2 "No
exchange", el mismo escaneo, y después Geometría [Change] → "Sample scan body": vuelve al paso 4 con la alineación
intacta y la nota.

**Probado:** 595 tests de Vitest (motor, estado, visor, revisiones adversariales y de UX: foco, tiempos de
animación, contraste, toque, ciclo de vida); `npm run typecheck:xchange` y `npm test` sin errores, `npm run build`
correcto. Verificado en Chrome 156: foco con teclado en cada paso, puntos guiados con teclado y con toque en tableta,
cambio de 1280 a 1100 px sin saltar al inicio, movimiento reducido sin desplazamientos, ES a 960 px sin botones
cortados.

**Limitaciones conocidas:**
- No hay plantilla integrada: la H6.6 del prototipo no se copia. La detección en malla necesita un cuerpo de
  referencia de la biblioteca.
- Los umbrales de calidad son provisionales (`align/metrics.ts` `DEFAULT_QUALITY`): salen de las 8 arcadas de Fernando
  y los fija su tolerancia por implante. Un conjunto empujado hacia la encía a lo largo de los ejes resbala por las
  paredes escaneadas y solo se nota en los topes: desde 0,3 mm ya no sale «buena» y el RMS crece con el empuje, pero
  0,75-1 mm aún sale «aceptable» en 5 de 8 arcadas.
- Una pieza de la biblioteca con un inserto (L03, L04…) se alinea entera: las caras del inserto paralelas a la tapa
  cuentan como fallos. En el diseño real de Fernando las etiquetas no cambian; los cuerpos del archivo de posiciones se
  alinean solo con la tapa. Las piezas apiladas (una sobresale de la otra, L02 y L71-L76) siguen contando como dos
  cuerpos si se importan como captura.
- Con un solo cuerpo redondo, el giro axial queda arbitrario; se marca, no se adivina.
- Quedan dos ICP y dos árboles de punto más cercano (`detect/` con BVH, `align/` con k-d tree). Es deuda aceptada:
  conviene unificarlos con casos reales para comparar.
- La copia de la biblioteca es un solo JSON de hasta 256 MB (caben 50 piezas comunes); una mayor se descarga igual
  con un aviso. Si las bibliotecas reales crecen más, hay que partirla en varios archivos.
- La CSP de producción aún necesita `'unsafe-inline'` en script-src por el script de tema de `Base.astro` (moverlo a
  un hash o a un archivo antes de quitarlo).
- XLSX y los formatos nativos PIC, Tupel y BEB se rechazan. El ZIP se arma en memoria (pico de unas 2 veces el
  paquete, máximo 512 MB).
- Los tests del repositorio usan solo datos sintéticos. Los 5 casos reales de Fernando (8 arcadas) se corren aparte,
  con el harness del análisis (`analysis/harness/xcase.mts --root <este repo>`), nunca desde el repositorio.

**Necesita al cliente (Fernando)**, con casos anonimizados:
- P5/P14 (pregunta 1 del informe de casos reales): su tolerancia por implante. Los umbrales de alineación ya están
  calibrados con sus 5 casos, sobre la parte visible: buena hasta RMS 110 µm y 75 % a menos de 100 µm, aceptable hasta
  160 µm y 50 %, ambas con al menos el 55 % de los cuerpos visible; fallida bajo el 45 %. Ambigüedad 1,1 veces o 5 µm.
  Detección: 30 µm y 98 %, cobertura de la referencia 50 %.
- P1: exportaciones reales de ScanAdaptor e iCam (los lectores siguen el prototipo y su guía). De MicronMapper ya hay
  5 CSV reales y se leen todos.
- Pregunta 16 del informe de casos reales: si le basta el STL `<arcada>_implant_position.stl` con el grupo, si sirven
  los STL por implante, `combined.stl` y la copia de la arcada, y si sin arcada prefiere un STL directo en vez del ZIP.
  Hoy se mantiene el paquete completo con su archivo principal primero.
- P11: tamaños reales de mandíbulas y capturas para ajustar los límites (hoy 150 MB y 3 M triángulos; se avisa de
  unidades si una mandíbula mide menos de 15 mm).
- P3/P4: el CAD de los cuerpos de escaneo de referencia, con su licencia, y qué hacer con el giro axial de los
  cuerpos redondos.
- n8n: definir `PUBLIC_N8N_FORM_WEBHOOK` y añadir al flujo la rama `source: 'ddt-xchange'`.

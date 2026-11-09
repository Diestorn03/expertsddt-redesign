# QA de movimiento y pantalla de carga: verificación final

> **Actualización (9 nov, después de este informe):** la regresión del #20 ya está corregida. El cuadro de mensaje de /contact/ ya no lleva `data-lenis-prevent` y Lenis usa `allowNestedScroll: true` (src/scripts/motion.js), así que el cuadro se desplaza por dentro y luego devuelve el scroll a la página. Comprobado con el sitio recompilado: `fix-textarea-pages` (/contact/ y /es/contact/, escritorio, laptop y teléfono, con y sin movimiento, CPU x1 y x4) y `fix-textarea-prevent` (rueda sobre el cuadro vacío): 0 FAIL, 0 WARN. Con eso el veredicto pasa a **apto**, con los riesgos de abajo.


9 de noviembre de 2026 · rama `site-fixes` en `2f427ad` (los 6 commits de arreglos sobre `a1ed6ae`: 71a33f8, 09d9255, 35474f2, 0eea24c, 096d781, 2f427ad) · arnés `tools/qa` (sin commitear) · en esta etapa no se tocó el código del sitio ni se hizo ningún commit.

## Veredicto

**Todavía no se puede pasar a producción: queda una regresión que bloquea.** Es pequeña y su arreglo está localizado.

- De los 36 hallazgos del sitio, 34 están resueltos y comprobados con el arnés y con capturas. El #36 (scroll con CPU lenta) mejoró, pero a CPU x4 sigue habiendo algún fotograma de ~130 ms.
- El #20 resolvió lo que pedía: la rueda sobre el formulario de contacto ya va suave. Pero su arreglo dejó una **trampa de scroll en el cuadro de mensaje** de /contact/ y /es/contact/. En escritorio, la rueda con el puntero sobre el cuadro vacío no mueve la página. En móvil, un deslizamiento que empieza sobre el cuadro se queda parado. Detalles y arreglo propuesto en "Regresiones y riesgos".
- Los 4 hallazgos del arnés (#11, #25, #26, #39) están corregidos en `tools/qa`. En esta etapa aparecieron 6 fallos más del propio arnés, también corregidos. El autotest pasa 18/18.
- Antes de los arreglos, las 16 ejecuciones de la auditoría sumaban 251 FAIL (y el arnés de entonces no veía, por ejemplo, el secuestro del botón del hero). Ahora el único FAIL real es el del cuadro de mensaje.

## Qué se comprobó

- **Builds**: el build de QA de HEAD (`out/.dist-default`, recompilado otra vez por `predeploy.mjs`), un build con testimonios (`PUBLIC_SHOW_REVIEWS=1`, `out/.dist-reviews`) y un build tipo producción con GA y el chat n8n (`out/.dist-prod`, con `G-TEST123` y un webhook ficticio `127.0.0.1:9`, sin datos reales).
- **19 páginas**: `/`, `/services/`, `/courses/`, `/store/`, `/exocad-libraries/`, `/contact/`, `/terms-and-conditions/`, `/refund-policy/`, `/privacy-policy/` y `/404/`, más las 9 de `/es/`.
- **7 viewports**: desktop 1440x900 y laptop 1280x720 (ratón), y tablet 768x1024, tablet-land 1024x768, phone 390x844, phone-small 375x667 e iPad Pro horizontal 1194x834 (táctiles). El iPad Pro recibe el layout de escritorio con pins.
- **Ajustes**: movimiento permitido y reducido (emulado siempre de forma explícita), CPU x1 y x4, red local y 4G lenta (1,6 Mb/s, 150 ms), testimonios activados y desactivados.
- **Escenarios**:
  - pantalla de carga (una pasada medida sin grabar y otra con filmstrip);
  - barrido de scroll realista y rápido, con paradas, capturas y detectores (reveals atascados, desbordes, UI fija encima, clics fantasma);
  - escenas fijadas y teclado (PageDown, Espacio, End, Home y un recorrido con Tab);
  - los 10 escenarios límite: recarga, router, atrás/adelante, bfcache, anclas, resize/rotación, tema, pestaña oculta, fling y zoom;
  - scripts sueltos: `inner.mjs` (diálogo, router entre páginas internas, saltos internos, formulario, vídeos, resize), `probes.mjs` (una sonda por causa raíz), `home/probe.mjs` (Doctor Portal con movimiento reducido, rejilla de clics, foco, red lenta, card stack), `nav-state`, `focus-keys`, `loader-net` y `long-session`;
  - el build de producción (banner de cookies y chat a través del router).
- **Capturas revisadas a ojo**: las hojas de contacto de `tools/qa/out/scratch/` (`v-*.jpg` y `v2-*.jpg`) más las capturas sueltas citadas abajo.

## Ejecuciones de esta etapa (todas en `tools/qa/out/`)

| Ejecución | Qué cubre | Resultado |
|---|---|---|
| verify-m1-a, verify-m1-b | 19 páginas x 6 viewports, movimiento, CPU x1 (loader, sweep, pins, keys) | 11 FAIL: 9 eran clics fantasma sobre espacio en blanco (reclasificados como WARN, ver verify-ghost1) y 2 son la regresión de /contact/ en phone |
| verify-ghost1 | las páginas de esos clics fantasma con el detector final | 0 FAIL, 10 WARN ("entrada pendiente") |
| verify-r1-a, verify-r1-b | 19 x 6, movimiento reducido, CPU x1 | 0 FAIL, 1 WARN |
| verify-m4-a, verify-m4-b | 19 x 6, movimiento, CPU x4 | 2 FAIL (/contact/ y /es/contact/ en phone: regresión), 34 WARN (tiempos) |
| verify-r4-a, verify-r4-b | 19 x 6, reducido, CPU x4 | 0 FAIL, 5 WARN |
| verify-ipad | iPad Pro: /, /es/ y /services/, movimiento y reducido, CPU x1 y x4 | 0 FAIL, 19 WARN (tiempos a x4) |
| verify-rev-m1, verify-rev-r1, verify-rev-4 | testimonios: / y /es/; 6 viewports a x1 y desktop, laptop y phone a x4 | 0 FAIL; 52 WARN, todos de tiempos |
| verify-rev-rep, verify-rev-loader4-solo | repeticiones en solitario de los peores tiempos con testimonios | 0 FAIL, 3 WARN |
| verify-net | 4G lenta: /, /services/ y /es/ en desktop, phone e iPad, movimiento y reducido | 0 FAIL, 16 WARN |
| verify-edge-m, -m2, -m3 | escenarios límite con movimiento, 7 viewports x CPU x1 y x4 | 0 FAIL, 3 WARN (tablet/tablet-land de -m se repitieron en -m2 tras corregir el arnés) |
| verify-edge-r, -r2, -r3 | escenarios límite con movimiento reducido, 7 viewports x CPU x1 y x4 | 0 FAIL (las combinaciones táctiles de -r y el iPad de -r2 fallaron por el arnés y se repitieron) |
| verify-edge-check, -check2, -anchor, verify-zoom-fix2 | comprobaciones tras corregir el arnés | 0 FAIL |
| verify-inner | inner.mjs: desktop, tablet, phone y phone-small x movimiento y reducido x EN y ES | 1 FAIL (regresión del cuadro de mensaje), 2 WARN |
| verify-inner-prevent | la comprobación nueva del cuadro de mensaje, desktop y laptop | 2 FAIL (la regresión) |
| verify-probes | probes.mjs | 0 FAIL |
| verify-home-probe, -home-probe-rev | sondas de la home y card stack | todo correcto |
| verify-nav-state2 | anclas, historial, hamburguesa y 1180 px | 0 FAIL, 0 WARN (verify-nav-state se cayó por un fallo del arnés, ya corregido) |
| verify-focus-keys | Tab x70 en desktop y laptop | 0 FAIL, 0 WARN |
| verify-loader-net | 4G lenta y rápida con caché fría, y bfcache | 0 FAIL |
| verify-long, verify-long5 | sesión de 15 y de 5 navegaciones | 0 FAIL; WARN de una retención fija de una página |
| verify-cpu4-solo, -solo2 | desktop y laptop a CPU x4 sin las otras ejecuciones | 0 FAIL; ver #36 |
| verify-prod.log | build tipo producción | correcto |
| verify-selftest*.log | autotest de los detectores | 18/18 (el primer intento dio 17/18 por un temporizador frágil del propio autotest, ya corregido) |
| verify-predeploy-* | `node predeploy.mjs verify-predeploy`, completo y sin nada más corriendo (09:16-12:32) | código 1: selftest ok · pages FAIL · home ok · edge ok · inner FAIL · probes ok. Los FAIL son solo la regresión del cuadro de mensaje |

El registro paso a paso, con hora y veredicto de cada ejecución, está en `tools/qa/out/verify-progress.md`.

## Resultados por página, viewport y ajuste

Las tablas salen de los `report.json` de las ejecuciones de 19 páginas, iPad Pro, testimonios y 4G lenta. Los clics fantasma de verify-m1-a y verify-m1-b se cuentan como WARN, que es como los clasifica el detector final.

Leyenda: **F** = FAIL, **W** = WARN.
- "scroll bloqueado" = la regresión de /contact/.
- "entrada pendiente" = un enlace todavía invisible, sobre espacio en blanco, en el 14 % inferior de la primera pantalla.
- "fotogramas" y "cortinilla" = avisos de tiempos.
- "loader >2 s" = la pantalla de carga tapó la página más de 2 s.
- "CLS en carga" = desplazamiento de layout detrás del loader.

#### Por página

Celda: viewports probados y, si hubo, FAIL (F) / WARN (W) con su tipo.

| Página | Mov. x1 | Mov. x4 | Red. x1 | Red. x4 | Testimonios Mov. x1 | Testimonios Red. x1 | Testimonios Mov. x4 | Testimonios Red. x4 | 4G lenta mov. | 4G lenta red. |
|---|---|---|---|---|---|---|---|---|---|---|
| / | 7: 2W cortinilla, 6W fotogramas | 7: 2W loader >2 s, 2W cortinilla, 12W fotogramas, 1W layout | 7 ok | 7: 1W cortinilla, 1W CLS en carga | 6: 1W cortinilla, 4W fotogramas | 6 ok | 3: 2W loader >2 s, 2W cortinilla, 13W fotogramas | 3: 12W fotogramas, 2W loader >2 s | 3: 2W loader >2 s, 3W cortinilla | 3: 3W cortinilla, 1W loader >2 s |
| /services/ | 7 ok | 7 ok | 7 ok | 7: 2W fotogramas | - | - | - | - | 3 ok | 3 ok |
| /courses/ | 6 ok | 6 ok | 6 ok | 6 ok | - | - | - | - | - | - |
| /store/ | 6: 2W entrada pendiente | 6: 1W cortinilla, 3W fotogramas, 2W entrada pendiente | 6 ok | 6 ok | - | - | - | - | - | - |
| /exocad-libraries/ | 6: 2W entrada pendiente | 6: 2W cortinilla, 2W entrada pendiente | 6 ok | 6 ok | - | - | - | - | - | - |
| /contact/ | 6: 2F scroll bloqueado | 6: 1F scroll bloqueado | 6 ok | 6 ok | - | - | - | - | - | - |
| /terms-and-conditions/ | 6: 1W cortinilla | 6 ok | 6 ok | 6 ok | - | - | - | - | - | - |
| /refund-policy/ | 6 ok | 6 ok | 6 ok | 6 ok | - | - | - | - | - | - |
| /privacy-policy/ | 6 ok | 6 ok | 6 ok | 6 ok | - | - | - | - | - | - |
| /404/ | 6 ok | 6 ok | 6 ok | 6 ok | - | - | - | - | - | - |
| /es/ | 7: 1W fotogramas | 7: 2W loader >2 s, 12W fotogramas, 1W cortinilla, 1W layout | 7 ok | 7: 2W CLS en carga | 6 ok | 6: 2W fotogramas | 3: 8W fotogramas, 1W loader >2 s | 3: 1W loader >2 s, 4W fotogramas | 3: 3W loader >2 s, 1W cortinilla | 3: 3W cortinilla |
| /es/services/ | 6 ok | 6 ok | 6: 1W CLS en carga | 6 ok | - | - | - | - | - | - |
| /es/courses/ | 6 ok | 6 ok | 6 ok | 6 ok | - | - | - | - | - | - |
| /es/store/ | 6: 1W entrada pendiente | 6: 1W entrada pendiente | 6 ok | 6 ok | - | - | - | - | - | - |
| /es/exocad-libraries/ | 6: 3W entrada pendiente | 6: 3W entrada pendiente | 6 ok | 6 ok | - | - | - | - | - | - |
| /es/contact/ | 6: 1W entrada pendiente | 6: 1W entrada pendiente, 1F scroll bloqueado | 6 ok | 6 ok | - | - | - | - | - | - |
| /es/terms-and-conditions/ | 6 ok | 6 ok | 6 ok | 6 ok | - | - | - | - | - | - |
| /es/refund-policy/ | 6 ok | 6 ok | 6 ok | 6 ok | - | - | - | - | - | - |
| /es/privacy-policy/ | 6 ok | 6 ok | 6 ok | 6 ok | - | - | - | - | - | - |

#### Por viewport

Celda: páginas probadas, FAIL/WARN y el tiempo hasta que el loader se retira (`is-done`, mediana / máximo en ms).

| Viewport | Mov. x1 | Mov. x4 | Red. x1 | Red. x4 | Testimonios Mov. x1 | Testimonios Red. x1 | Testimonios Mov. x4 | Testimonios Red. x4 | 4G lenta mov. | 4G lenta red. |
|---|---|---|---|---|---|---|---|---|---|---|
| desktop | 19 pág. · 0F 4W · 750 / 1168 | 19 pág. · 0F 11W · 1120 / 2842 | 19 pág. · 0F 0W · 787 / 1532 | 19 pág. · 0F 2W · 1051 / 2359 | 2 pág. · 0F 3W · 1270 / 1270 | 2 pág. · 0F 0W · 1428 / 1428 | 2 pág. · 0F 10W · 3040 / 3040 | 2 pág. · 0F 2W · 2287 / 2287 | 3 pág. · 0F 3W · 2727 / 3064 | 3 pág. · 0F 2W · 2456 / 2511 |
| laptop | 19 pág. · 0F 3W · 743 / 939 | 19 pág. · 0F 9W · 1035 / 2470 | 19 pág. · 0F 1W · 752 / 1035 | 19 pág. · 0F 2W · 1059 / 1466 | 2 pág. · 0F 0W · 1001 / 1001 | 2 pág. · 0F 0W · 998 / 998 | 2 pág. · 0F 10W · 3374 / 3374 | 2 pág. · 0F 3W · 2639 / 2639 | - | - |
| tablet | 19 pág. · 0F 1W · 720 / 927 | 19 pág. · 0F 3W · 1070 / 1720 | 19 pág. · 0F 0W · 776 / 1045 | 19 pág. · 0F 1W · 1098 / 1717 | 2 pág. · 0F 0W · 966 / 966 | 2 pág. · 0F 0W · 1043 / 1043 | - | - | - | - |
| tablet-land | 19 pág. · 0F 2W · 685 / 1154 | 19 pág. · 0F 4W · 1120 / 2136 | 19 pág. · 0F 0W · 743 / 1329 | 19 pág. · 0F 0W · 1140 / 2139 | 2 pág. · 0F 0W · 848 / 848 | 2 pág. · 0F 0W · 1147 / 1147 | - | - | - | - |
| phone | 19 pág. · 2F 3W · 675 / 808 | 19 pág. · 2F 4W · 1130 / 1937 | 19 pág. · 0F 0W · 687 / 807 | 19 pág. · 0F 0W · 1138 / 1644 | 2 pág. · 0F 0W · 984 / 984 | 2 pág. · 0F 0W · 1035 / 1035 | 2 pág. · 0F 6W · 2138 / 2138 | 2 pág. · 0F 14W · 3347 / 3347 | 3 pág. · 0F 3W · 2467 / 2681 | 3 pág. · 0F 2W · 2444 / 2491 |
| phone-small | 19 pág. · 0F 2W · 694 / 810 | 19 pág. · 0F 3W · 1032 / 2070 | 19 pág. · 0F 0W · 679 / 780 | 19 pág. · 0F 0W · 1068 / 1607 | 2 pág. · 0F 2W · 857 / 857 | 2 pág. · 0F 2W · 1379 / 1379 | - | - | - | - |
| iPad Pro | 3 pág. · 0F 4W · 1043 / 1803 | 3 pág. · 0F 14W · 2698 / 4389 | 3 pág. · 0F 0W · 1034 / 1117 | 3 pág. · 0F 1W · 1564 / 1891 | - | - | - | - | 3 pág. · 0F 3W · 2695 / 2876 | 3 pág. · 0F 3W · 2543 / 2640 |

Las columnas "Testimonios x4" se midieron con el PC compartido. En solitario (verify-rev-loader4-solo), la home con testimonios a CPU x4 se retira a 2442 ms en desktop con movimiento, 1478 ms en desktop reducido, 1710 ms en phone con movimiento y 1168 ms en phone reducido.

**Escenarios límite** (home; recarga, router, historial, bfcache, anclas, resize/rotación, tema, pestaña oculta, fling y zoom; movimiento y reducido; CPU x1 y x4):

| Viewport | Movimiento x1 | Movimiento x4 | Reducido x1 | Reducido x4 |
|---|---|---|---|---|
| desktop | ok | 1 W (cortinilla 62 ms) | ok | ok |
| laptop | ok | ok | ok | ok |
| tablet | ok | 1 W (cortinilla 55 ms) | ok | ok |
| tablet-land | ok | ok | ok | ok |
| phone | ok | ok | ok | ok |
| phone-small | ok | ok | ok | ok |
| iPad Pro (táctil 1194x834) | ok | 1 W (cortinilla p95 28 ms) | ok | ok |

En todas las combinaciones:
- las anclas dejan la sección justo debajo del nav (75-76 px en escritorio, 64 px en móvil);
- atrás y adelante vuelven al mismo píxel;
- la bfcache restaura la página en su sitio;
- el router no cambia el número de ScrollTriggers ni de instancias de Lenis, y los listeners no crecen;
- el giro del iPad Pro, que cruza los 1180 px, mantiene al lector en su sitio con los pins de vuelta;
- el cambio de tema no mueve el scroll.

**Tiempo hasta que el loader se retira (CPU x1, 258 cargas)**: a la vista 514-595 ms tras el primer pintado (el 80 % entre 519 y 526 ms); `is-done` con mediana de 0,73 s y máximo de 1,8 s (home del iPad Pro). Los fotogramas bajo la cortinilla tienen p95 de 7 ms de mediana y de 21 ms en el peor caso. A CPU x4, desktop y laptop tardan 2,4-2,8 s en la home y los móviles 1,6-2,1 s. Con 4G lenta, 2,3-3,1 s desde el inicio de la navegación, de los que el loader está a la vista 0,8-1,8 s.

## Antes y después de cada hallazgo (duplicados agrupados)

| Hallazgos | Problema | Antes | Después | Evidencia |
|---|---|---|---|---|
| #0, #13, #31 (crítico) | La hamburguesa deja de funcionar tras una navegación y congela el scroll | Tras ir a otra página, la X aparecía pero el menú seguía cerrado y la página quedaba bloqueada: FAIL `router` en cross-edge (tablet, phone), cross-edge-b, cross-edge-reduced, cross-edge-cpu4, validation-home e inner-custom-b/d | El menú se abre en los 4 saltos, en EN y ES, en tablet, phone y phone-small, con movimiento y reducido. Con el menú abierto la página no se mueve (es lo que se quiere); al cerrarlo, vuelve a hacer scroll (730 / 892 px) | verify-inner (router), verify-edge-m2/-r2 (router por el menú), verify-nav-state2; captura `verify-nav-state2/burger-phone-after-nav.jpg` |
| #1, #35 | "Sobre nosotros" (`/#about`) y Atrás hacia la home caían en otro sitio | Desde /services/ se llegaba a y=4308 con #about 4248 px más abajo (la suma de los dos pin spacers); Atrás devolvía a y=0 | #about a 76 px del borde superior (debajo del nav) en escritorio y a 64 px en móvil: desde y=0, desde y=1600, en /es/ y en carga directa. Atrás vuelve a 6000 si se dejó en 6000 | verify-nav-state2, anclas de todas las ejecuciones edge; `scratch/v2-sheet-navstate.jpg`, `scratch/v2-sheet-edge-m-desktop.jpg` |
| #14 | Los saltos internos (`.jump` de /services/, #catalog de /courses/) saltaban y luego volvían arriba | #scanning pulsado en y=160: 160 → 2315 → 90, con la sección 2225 px por debajo | Desde y=0 y desde ~160 aterriza con la sección a 76 px (64 px en móvil), sin rebote (pico = posición final) | verify-inner (anchors), edge `anchor`; `scratch/v2-sheet-inner.jpg` |
| #2, #21, #34 | Cruzar los 1180 px (ventana, zoom, giro del iPad Pro) mandaba arriba, dejaba los pilares en blanco y quitaba el vídeo | Home: y 3000 → 0, pilares estáticos, altura 11845 → 10667, vídeo sin src. Páginas internas: 3000 → 0. iPad: 4385 → 0 | Home: 6400 → 4660 → 6400 (siempre #services), pilares otra vez horizontales y vídeo en marcha. /terms/ y /services/: 3000 → 3000. iPad: 5064 → 5064 y 3270 → 3270. Zoom 125 % y vuelta: mismo panel y nada oculto | verify-nav-state2, verify-probes (breakpoint), verify-zoom-fix2, verify-edge-m/-m2/-m3/-r3 (resize); `scratch/v2-sheet-zoom-fix2.jpg`, `scratch/v2-sheet-probes.jpg` |
| #3, #30 | El Tab desplazaba de lado el capítulo de los pilares y dejaba el foco en botones invisibles | `#pillars.scrollLeft` pasaba de 1579 a 5330 px; al 50 % del capítulo el carril quedaba fuera de pantalla | `scrollLeft` se queda en 0. Tras tabular, la rueda deja el carril al 5/50/95 % (intro, panel 02, panel 04). Solo se señalan los `.ba__range`, transparentes a propósito | verify-focus-keys; pasada Tab de `keys` en m1/m4/r1/r4 sin FAIL; verify-home-probe (focus); `scratch/v2-sheet-focus.jpg` |
| #4, #38 | Sesión larga: páginas retenidas y animaciones acumuladas en el botón Booking | Nodos DOM tras GC 1723 → 10850; listeners JS 249 → 1871; listeners del botón Booking 1 → 16; tweens 2 → 32; listeners `load` de window 3 → 7 | Tras 15 navegaciones: ScrollTriggers 17 → 17, Lenis 1 → 1, listeners de window 31 → 31, tweens del botón Booking 2 → 2, marquee a 1 escritura por fotograma. Queda una retención fija de una página (nodos 1724 → 2865, listeners 242 → 357), igual con 5 que con 15 saltos | verify-long, verify-long5, edge `router`; `scratch/v2-sheet-long.jpg` |
| #5, #12, #17, #28, #29, #33 | Movimiento reducido: títulos invisibles, contenido animado, Doctor Portal oculto en escritorio, intro y vídeos en marcha | home-reduced-cpu1: 79 FAIL. inner-en-reduced: 43. inner-es-reduced: 10. cross-edge-reduced: 32 (triggers a 421 px). Testimonios: 45. El portal no se veía nunca en escritorio; la intro pasaba por 166-245 estados; los vídeos se reproducían en bucle | 0 FAIL en las 19 páginas x 7 viewports a CPU x1 y x4, con testimonios y en los límites. El portal se ve bajo el hero y los botones del hero reciben el clic. La intro tiene 1 solo estado. El loader se funde sobre el hero ya completo. Los vídeos quedan en pausa en el primer fotograma (t ≤ 0,03 s) | verify-r1-a/-b, -r4-a/-b, -rev-r1, -edge-r/-r2/-r3, verify-probes (reduced-split, softnav-split), verify-home-probe (reduced-hero, reduced-flash), verify-inner (videos); `scratch/v-r1-desk-home.jpg`, `scratch/v-sheet-phsmall-es-services-red.jpg`, `scratch/v2-sheet-reduced-flash-tablet.jpg`, `scratch/v-sheet-edge-r-desktop.jpg` |
| #6 | Atrás y Adelante solo a veces restauraban el scroll | /services/ en 1600 → /courses/ desplazado a 600 → Atrás = 0. En la home, Atrás = 0 | Atrás = 1600; la home vuelve a 6000 con los pins coherentes; Adelante y un Atrás sin desplazar también exactos, en todos los viewports | verify-nav-state2, edge `history` |
| #7, #32 | El loader esperaba a `window load` (también a los vídeos): el tope de 2 s no era real | 4G lenta: desktop a 4652 ms (3,2 s a la vista), phone a 4320 ms. CPU x1 tablet-land: 4090 ms. CPU x4 desktop: 5610 ms. Los móviles descargaban el vídeo del hero | 4G lenta: desktop a 2623 ms (1,5 s a la vista), phone a 2486 ms (1,7 s), ya antes de `load`. CPU x1: mediana 0,73 s y máximo 1,8 s. CPU x4: desktop 2,4-2,8 s y móviles 1,6-2,1 s. 0 KB de vídeo del hero en móvil | verify-loader-net, verify-net, verify-home-probe (net-loader), matrices |
| #8, #22, #37 | La cortinilla parecía un parpadeo, daba tirones y a veces se cortaba | Visible 52-60 ms en escritorio, 215-299 ms al recargar; fotogramas de 50-152 ms a x1 y 289-380 ms a x4 bajo la cortinilla; "retirado antes de transitionend" | Visible 514-595 ms en todas partes (el 80 % entre 519 y 526 ms); cada cortinilla termina en `transitionend`; fotogramas bajo la cortinilla con p95 de 7-21 ms a x1. Queda un fotograma de render de 70-111 ms sin script en la home de escritorio y del iPad (ver riesgos) | todas las ejecuciones `loader`; filmstrips `verify-m1-a/desktop-1440x900-motion-cpu1/home/loader-filmstrip.jpg` y `verify-m4-a/desktop-1440x900-motion-cpu4/home/loader-filmstrip.jpg` |
| #15 | El loader podía tapar la página para siempre (sin JS o si falla un módulo) | 8 s después seguía tapando, con `clip-path inset(0)` | Sin JS, con el chunk del router abortado o con el de motion abortado, la página se ve (fail-safe CSS a los 4 s y regla noscript) | verify-probes (failsafe); `verify-probes/failsafe-*.jpg` |
| #16 | /services/ mantenía el loader hasta el tope de 2 s | `is-done` a 2574-2975 ms (4615 a x4) | 770-870 ms: no hay imagen eager en el primer pantallazo y espera solo a las fuentes. /store/ igual | verify-probes (loader-img), matrices |
| #18 | La entrada del título de las páginas internas se reproducía detrás del loader | /contact/: las palabras se animaban entre 270 y 883 ms, y el h1 no se destapaba hasta 945 | Las palabras están al 0 % cuando la cortinilla las destapa, en las 10 combinaciones de página y dispositivo; terminan hacia 1,7-2,1 s | verify-probes (entrance) |
| #9 | Solo en producción: banner de cookies en `<head>`; los scripts de cookies y del chat se reejecutaban en cada navegación | El banner caía en `<head>` y los scripts se ejecutaban otra vez en cada salto | El banner está en `<body>` y los preloads siguen en `<head>`. Hay un solo chat a lo largo de 4 saltos y, si está abierto, sigue abierto. Los listeners de `astro:page-load` pasan de 6 a 7 y no crecen. 0 errores | `out/verify-prod.log`; `scratch/verify-prod-final.jpg` |
| #10 | El marquee forzaba un layout síncrono en cada fotograma | 55 ms del tick del marquee en los primeros 2 s | El marquee no aparece entre las funciones con más tiempo del perfil de CPU a x4 | `scratch/fsl-cpuprof.mjs` (registro del 9-nov 07:50) |
| #36 | A CPU x4 la rueda en la home de escritorio iba a 36-48 fps con picos | Desktop: p50 20,9 / p95 41,7 / peor 132 ms, 13 tareas largas, 447 de 827 fotogramas perdidos. Laptop: 27,8 / 62,5 / 292 ms | Desktop en solitario: p50 14 / p95 34,7 / peor 132 ms, 2 tareas largas, 211 de 942 perdidos. Laptop: p50 13,9-20,8 / p95 ~35 / peor 42-83 ms. **Mejorado, no del todo**: con el PC ocupado sube (un intento dio p95 69,5 y peor 451 ms) | verify-cpu4-solo2, verify-cpu4-solo, verify-m4-a |
| #19 | El diálogo de descarga no bloqueaba el scroll de la página | La rueda sobre el fondo movía la página de 0 a 600 px; en phone, un deslizamiento de 0 a 285 px | 0 px con la rueda o el dedo sobre la caja o el fondo, y con PageDown, en todas las combinaciones EN y ES | verify-inner (dialog); `scratch/v2-sheet-inner.jpg` |
| #20 | La rueda sobre el formulario de contacto no se suavizaba y peleaba con Lenis | 3 saltos nativos de 100 px; retrocesos de hasta -100 px | Sobre el formulario: 88 fotogramas suaves, paso máximo de 9 px, sin retrocesos. **Pero el cuadro de mensaje es ahora una trampa de scroll** (regresión, ver abajo) | verify-inner (prevent) |
| #23 | El título del diálogo chocaba con la X en móviles estrechos | EN a 360 px y ES a 375 px tocaban la X | Sin solape a 360, 375, 390 y 414 px, en EN y ES | verify-probes (dialog-title) |
| #24 | Un cambio de página por el router borraba las clases `js` y `lenis*` de `<html>` | Tras el cambio, `class=""`; el diálogo perdía `overscroll contain` y la primera rueda desplazaba la página 100 px | `js motion lenis` tras el cambio, `contain` en el diálogo, rueda = 0 px | verify-probes (softnav-classes) |
| #27 (crítico) | Enlaces invisibles del Doctor Portal encima de los botones del hero | Un clic en "Book a consultation" abría portal.expertsddt.com/signup | Ninguna rejilla de clics fantasma (arriba, en cada parada y en cada estado de los pins) encuentra secuestros en ninguna ejecución. La sonda de clics no da resultados. Si se vuelve a provocar el fallo, el detector lo marca como FAIL (`scratch/verify-ghost-27.mjs`) | todas las ejecuciones, verify-home-probe (ghost-clicks); `scratch/v-m1-desk-home.jpg` |
| #11, #25, #26, #39 (arnés) | Huecos y falsos positivos del arnés | Ver la sección del arnés | Corregidos | `node qa.mjs --selftest`: 18/18 |

## Regresiones y riesgos que quedan

**1. Regresión que bloquea: trampa de scroll en el cuadro de mensaje (/contact/ y /es/contact/).** Viene del arreglo del #20 (commit 09d9255).
- **Causa**: el textarea lleva `data-lenis-prevent` (`src/pages/contact.astro`, línea 51). Por eso recibe `overscroll-behavior: contain`, tanto de `lenis/dist/lenis.css` como de `src/styles/global.css:43`.
- **Escritorio**: con el puntero sobre el cuadro vacío, la rueda no mueve la página (626 → 626 en desktop y 615 → 615 en laptop).
- **Móvil**: un deslizamiento que empieza sobre el cuadro se queda parado: phone fastUp parado en y=1713/1749/1821 a CPU x1; fastDown en y=1152 a CPU x4, 8 de 8 veces en EN y ES. En phone el cuadro ocupa media pantalla (`scratch/verify-textarea-down-1152.jpg`, `verify-predeploy-pages/phone-390x844-motion-cpu1/contact/sweep-zz-back-at-top.jpg`).
- **Arreglo recomendado** (probado solo en tiempo de ejecución): quitar `data-lenis-prevent` del textarea y añadir `allowNestedScroll: true` en `src/scripts/motion.js:68` (`new Lenis({ lerp: 0.16, wheelMultiplier: 1, smoothWheel: true, allowNestedScroll: true })`; Lenis 1.3.26 ya lo admite). Resultado: la página avanza 300 px con suavidad (paso máximo 10 px), un cuadro lleno sigue desplazándose por dentro y en móvil hay 0 atascos de 10. La opción revisa los contenedores anidados en cada evento de rueda; después del cambio hay que repetir el barrido a CPU x4. El diálogo de descarga conserva su `data-lenis-prevent`.
- **Mínimo de una línea**: `textarea[data-lenis-prevent] { overscroll-behavior: auto; }`. Resultado: la página avanza, pero a pasos nativos de 100 px sobre el cuadro.
- Después, volver a pasar `node scenarios/inner/inner.mjs --only prevent --viewports desktop,laptop --motion no-preference --lang en --out x` (hoy da FAIL) y el barrido de /contact/ en phone a CPU x4.

**2. Pantalla de carga de más de 2 s en equipos lentos.** La home tarda 2,4-2,8 s en desktop y laptop a CPU x4, y 4,4 s en el iPad con el PC cargado. Con 4G lenta, 2,3-3,1 s.
- El tope de 2 s no puede actuar antes de que se ejecute el módulo de 56 KB (llega con `DOMContentLoaded`). Levantarlo antes enseñaría contenido aún sin preparar.
- Mejora posible: arrancar con menos trabajo (por ejemplo, `ScrollTrigger.batch` para los reveals).

**3. Scroll a CPU x4 en la home de escritorio.** Mejoró, pero depende de la carga del PC (p95 28-70 ms, peor fotograma 130-450 ms).
- `scrollTo` de Lenis y la lectura de scroll de ScrollTrigger se llevan ~1 s cada uno de cada 10-13 s muestreados. Es el coste del scroll suave por JS.
- Quitarlo en equipos lentos (`smoothWheel: false`) cambiaría la sensación elegida, así que no se tocó.

**4. Fotogramas largos sin script.** Sale un fotograma de 70-150 ms bajo la cortinilla o al desplazar la home en escritorio, iPad y phone-small.
- En el perfil, ese fotograma tiene 2-7 ms de render y 0 de script: espera al compositor (raster de imágenes grandes o vídeo).
- En headless sale inflado. Para confirmarlo en la GPU real: `node qa.mjs --headed --no-build --viewports desktop --scenarios loader,sweep`.

**5. Resize sin cruzar los 1180 px dentro de los pilares** (por ejemplo, una ventana de 1440 encajada a 1280). El lector avanza un panel (del 02 al final del capítulo). Ya existía antes; el giro y los cruces de 1180 px sí se resolvieron.

**6. CLS detrás del loader con movimiento reducido** (cambio de fuente de Poppins 500-700): 0,10 en /es/services/ y 0,14-0,23 en la home a CPU x4.
- No se ve, porque el loader lo tapa, pero cuenta en Core Web Vitals.
- Arreglo: precargar esos pesos o usar una fuente de reserva con `size-adjust`.

**7. /exocad-libraries/**: la línea "Versión … · 42 MB" aparece cuando llega el manifiesto JSON. Empuja el contenido 26 px después de levantar el loader si la red es lenta. Arreglo: reservarle altura (`min-height`).

**8. "Entrada pendiente"** (WARN): en /store/, /exocad-libraries/ y /es/contact/, en laptop, tablet y móvil, un botón o tarjeta del 14 % inferior de la primera pantalla aún no ha hecho su entrada (los reveals empiezan en `top 86%`). Es invisible pero se puede pulsar sobre espacio en blanco. Riesgo bajo.

**9. Detalles visuales menores:**
- En el iPad Pro horizontal, el botón flotante de WhatsApp tapa parte del CTA del pilar 03 mientras el carril está a medio desplazar (y≈3603-3629, a CPU x1 y x4). Es transitorio.
- En producción, el botón del chat n8n tapa la píldora de WhatsApp (`scratch/verify-prod-final.jpg`). Es un problema de layout de los flotantes, fuera del movimiento.
- En /services/ en móvil, los títulos partidos por líneas se recolocan en 2 renglones tras girar el móvil. Ya pasaba antes y no se ve nada cortado.

**10. Memoria:** tras la primera navegación queda retenida una página (~1140 nodos y ~115 listeners) por la caché interna de `body` de GSAP. Es fija y no crece.

**11. Fusión con ddt-xchange** (comprobado con `git merge-tree`, sin tocar ningún worktree): hay un conflicto, un solo bloque en `src/scripts/motion.js`, el de los listeners después de `initLenis()`.
- **Resolución**: quedarse con el bloque de site-fixes y añadir los listeners `scroll-lock` y `scroll-to`.
- `scroll-to` debe restar `getComputedStyle(el).scrollMarginTop`, como el manejador de anclas, porque ahora `:target` tiene `scroll-margin-top`.
- El `toggleMenu(false)` de `astro:before-swap` llama a `lenis.start()`: al salir de /ddt-xchange/ libera un `scroll-lock`, que seguramente es lo que se quiere.
- Los `return` tempranos de movimiento reducido coinciden y no se duplican.

**Límites del arnés:**
- Headless: no hay vsync real, y la pestaña oculta y el zoom se simulan.
- Sin inercia táctil.
- Los tiempos varían con la carga del PC; en esta etapa había otras sesiones, mpv y Discord. Por eso los avisos de tiempos a CPU x4 sirven para comparar, no como puerta.

## Cambios en el arnés (`tools/qa`, sin commitear)

**#11:**
- `scrollY` se lee desde un listener pasivo.
- Los nombres de las cajas se resuelven al final; antes se calculaban justo cuando empezaba la cortinilla y la frenaban.
- El calentamiento con /robots.txt va seguido de `about:blank`.
- Atrás sin desplazar; anclas desde una página desplazada; enlace a /services/#scanning.
- Pasada de Tab; listeners en los controles del nav y nodos DOM tras GC.
- bfcache activa y escenario `bfcache`.

**#25:**
- Las cajas suman el borde de cada `offsetParent`.
- Dos pasadas de loader: medida sin screencast y filmada.
- Manifiesto de librerías de prueba en el build de QA.
- "Nunca se vio entero" cuando el primer pintado llega tarde.

**#26:** las rutas de Git Bash se deshacen con `cygpath`; README actualizado.

**#39:**
- Rejilla de clics fantasma: el secuestro de un control visible es FAIL, el espacio en blanco es WARN.
- El portal cuenta como contenido cuando no está fijado.
- Actividad de movimiento reducido medida desde `DOMContentLoaded`.
- Viewports `touch:AxB`, `--net slow4g|fast4g`, un contexto por página y el aviso de la cortinilla renombrado.

**Fallos del arnés encontrados y corregidos en esta etapa:**
1. Las capturas `zoom-125.jpg` salían a 100 %: `page.screenshot()` deshacía el zoom emulado. Ahora se capturan por CDP y la vuelta al 100 % es explícita.
2. En táctil, los escenarios a mitad de página iban al final de la página por un "fling". Ahora usan deslizamientos realistas.
3. El enlace interno se pulsaba en el mismo fotograma en que Playwright lo traía a la vista. Ahora se trae primero, como haría un visitante.
4. A 1194 px se usaba la hamburguesa en vez del nav. Además, los `ERR_ABORTED` de navegaciones canceladas se marcan como benignos.
5. `nav-state.mjs`: el Atrás de la bfcache esperaba un `load` que no llega nunca.
6. Autotest: el reveal tardío se medía desde el parseo. Ahora se mide desde el inicio del observador.

**Nuevas comprobaciones:**
- `probes.mjs` da veredicto por sonda y sale con código 1 si alguna falla.
- `resize` da FAIL si el lector acaba arriba del todo.
- `inner.mjs prevent` comprueba la rueda sobre el cuadro de mensaje.
- `predeploy.mjs` agrupa todo en un comando.

## Comando antes de cada despliegue

```bash
cd "C:/Users/Diestorn/Desktop/expertsddt-sitefix/tools/qa"
node predeploy.mjs
```

Tarda unas 3 h 15 min con el PC libre.
- Compila el build de QA desde el árbol de trabajo y pasa el autotest.
- Prueba las 19 páginas en desktop, laptop y phone, con movimiento y reducido.
- Prueba la home en tablet, tablet-land, phone-small e iPad Pro.
- Pasa los escenarios límite en desktop, laptop, tablet y phone, más `inner.mjs` y `probes.mjs`.
- Código de salida: 0 = sin FAIL, 1 = algún FAIL, 2 = un paso se cayó. Al final imprime el estado de cada paso; los resúmenes quedan en `out/predeploy-<fecha>-*/summary.md`.
- Con el código actual da 1 por la regresión del cuadro de mensaje; tras arreglarla debe dar 0.

Si se van a publicar los testimonios, hay que añadir:

```bash
node qa.mjs --reviews --pages /,/es/ --viewports desktop,laptop,tablet,phone --motion no-preference,reduce --out reviews-predeploy
```

Este comando se ejecutó completo el 9 de noviembre (`out/verify-predeploy-*`, 3 h 16 min). Resultado:
- autotest 18/18;
- páginas: 4 FAIL, todos en /contact/ y /es/contact/ en phone (el scroll se queda en y=1749 y en y=1821), más 8 WARN;
- home: 0 FAIL;
- escenarios límite: 0 FAIL y 0 WARN;
- inner: 1 FAIL (la rueda sobre el cuadro de mensaje, 626 → 626);
- sondas: 0 FAIL.

La puerta detecta la regresión y no da ningún otro FAIL.

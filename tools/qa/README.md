# QA de movimiento (tools/qa)

Comprueba, antes de pasar a producción, que la pantalla de carga y las animaciones de scroll se ven bien y no se rompen: escritorio, tablet y móvil, con movimiento permitido y reducido, con CPU normal y frenada. Usa el **Google Chrome instalado** a través de `playwright-core` (no descarga navegadores) y tiene su propio `package.json`, así que las dependencias de la web no cambian.

## Instalar (una vez)

```bash
cd tools/qa
npm install
```

Chrome se busca en `C:\Program Files\Google\Chrome\Application\chrome.exe`; otra ruta con la variable `CHROME_PATH`.

## Ejecutar

```bash
cd tools/qa
node qa.mjs --selftest                 # los detectores encuentran los defectos plantados en selftest.html (30 s)
node qa.mjs                            # home, desktop + phone, movimiento permitido, CPU x1, todos los escenarios (~9 min)
node qa.mjs --pages /,/services/,/courses/,/store/,/exocad-libraries/,/contact/ \
  --viewports desktop,laptop,tablet,tablet-land,phone,phone-small \
  --motion no-preference,reduce --cpu 1,4 --out pre-prod
node qa.mjs --reviews --pages / --out con-reviews       # build con PUBLIC_SHOW_REVIEWS=1 (testimonios visibles)
node qa.mjs --no-build --viewports phone --scenarios loader,sweep   # reutiliza el último build de QA
node qa.mjs --no-build --viewports touch:1194x834 --net slow4g --scenarios loader   # iPad Pro horizontal en 4G lenta
```

### Antes de cada despliegue

```bash
cd tools/qa
node predeploy.mjs                     # unas 3 h 15 min con el PC libre; código 0 = sin FAIL, 1 = algún FAIL, 2 = un paso se cayó
```

Compila el build de QA desde el árbol de trabajo y encadena: autotest de los detectores, las 19 páginas (EN + ES) en desktop, laptop y phone con movimiento permitido y reducido, la home en tablet, tablet-land, phone-small y iPad Pro, los escenarios límite en desktop, laptop, tablet y phone, `scenarios/inner/inner.mjs` y `scenarios/inner/probes.mjs`. Al final imprime el estado de cada paso; los resúmenes quedan en `out/predeploy-<fecha>-*/`. Si se van a publicar los testimonios (`PUBLIC_SHOW_REVIEWS=1`), añade `node qa.mjs --reviews --pages /,/es/ --viewports desktop,laptop,tablet,phone --motion no-preference,reduce --out reviews-predeploy`. La CPU x4 (`--cpu 4`) da avisos de tiempos que dependen de la carga del PC: úsala para comparar, no como puerta.

En Git Bash una ruta que empieza por `/` llega convertida (`/services/` -> `C:/Program Files/Git/services/`); `qa.mjs` la deshace con `cygpath`. También valen nombres sin barra (`--pages services,es/services`) o `MSYS_NO_PATHCONV=1` delante.

| Opción | Por defecto | Qué hace |
|---|---|---|
| `--pages` | `/` | Rutas separadas por comas. Los escenarios límite siempre usan `/` (y `/services/`, `/courses/` para navegar). |
| `--viewports` | `desktop,phone` | `desktop` 1440x900, `laptop` 1280x720, `tablet` 768x1024, `tablet-land` 1024x768, `phone` 390x844, `phone-small` 375x667, `ANCHOxALTO` (ratón) o `touch:ANCHOxALTO` (táctil). `tablet*`, `phone*` y `touch:*` son táctiles (isMobile + hasTouch, DPR 2). |
| `--motion` | `no-preference` | `no-preference` y/o `reduce`. Se emula siempre de forma explícita: este PC fuerza "reducir movimiento". |
| `--cpu` | `1` | Factores de `Emulation.setCPUThrottlingRate`, por ejemplo `1,4`. |
| `--net` | sin límite | `slow4g` (1,6 Mb/s, 150 ms) o `fast4g` (9 Mb/s, 60 ms) para todas las combinaciones (los mismos perfiles que `scenarios/cross/loader-net.mjs`). |
| `--scenarios` | `all` | `loader`, `sweep`, `pins`, `keys` y `edge` (= `reload,router,history,bfcache,anchor,resize,theme,visibility,fling,zoom`), separados por comas. |
| `--out` | fecha y hora | Nombre de la ejecución: todo queda en `out/<nombre>/`. |
| `--reviews` | apagado | Compila con `PUBLIC_SHOW_REVIEWS=1` para auditar también los testimonios (card stack). |
| `--no-build` | | No compila: sirve el último build de QA de esa variante (o `dist/` si no hay). |
| `--headed` | | Chrome visible: GPU real (tiempos de fotograma más realistas) y pestaña oculta de verdad en `visibility`. Abre ventanas en pantalla. |

Cada página de cada combinación viewport x movimiento x CPU usa su propio contexto de navegador (caché fría en todas, así `/` y `/es/` son comparables); los escenarios límite comparten otro. Chrome se lanza con la caché atrás/adelante (bfcache) activa, como la tiene un visitante (Playwright la desactiva por defecto). El build va a `out/.dist-default` o `out/.dist-reviews` (`npm run build -- --outDir ...`), nunca a `dist/`, para que un build con testimonios no se pueda desplegar por error. Se sirve con `astro preview --host 127.0.0.1 --port <puerto libre> --ignore-lock` (lo mismo que `npx astro preview`, lanzado con `node` para poder cerrarlo en Windows). El manifiesto de las librerías (`/downloads/libraries/latest.json`) vive en el hosting y no está en git: el arnés escribe uno de prueba en el build de QA para que `/exocad-libraries/` se comporte como en producción.

Código de salida: `0` sin FAIL, `1` con algún FAIL, `2` si el propio arnés falló.

## Salida

```
out/<run>/summary.md        resumen corto: mediciones clave y la lista de FAIL/WARN con enlace a su captura
out/<run>/report.json       todos los datos (se reescribe tras cada combinación: un apagón no borra lo ya medido)
out/<run>/<combo>/<página>/ capturas: loader-*, sweep-*, pin-*, keys-*
out/<run>/<combo>/edge/     capturas y filmstrips de los escenarios límite
```

`<combo>` es por ejemplo `phone-390x844-motion-cpu4` o `desktop-1440x900-reduced-cpu1`. **Mira las capturas**: los números no ven todo.

## Qué comprueba

### Pantalla de carga (`loader`)
Primera carga de cada página con la pestaña ya abierta en el mismo origen (`/robots.txt`, luego `about:blank` para que desmontar ese documento no caiga en los primeros fotogramas medidos), caché fría. **Dos pasadas**: la medida va sin grabar (el screencast frena el hilo principal: en `/contact/` los fotogramas de la cortinilla pasaban de 7 a 70-83 ms) y una segunda carga igual, grabada, da el filmstrip y los fotogramas negros (sus tiempos no se juzgan).
- **Filmstrip** de lo que había en pantalla a los 0, 100, 300, 600, 1000, 1500, 2000 y 2600 ms (fotogramas reales del compositor vía `Page.startScreencast`), más cada fotograma en JPG.
- Momentos: primer pintado, `is-done` (evento `loader:done`), inicio y fin de la transición `clip-path` (`transitionstart`/`transitionend`), retirada del nodo.
- **Tiempo visible del loader** = inicio de la cortinilla - primer pintado. Menos de 300 ms se lee como un parpadeo (WARN); si el primer pintado llega después de empezar la salida, "nunca se vio entero" (WARN).
- **Hilo principal bajo la cortinilla**: fotogramas rAF durante la transición y los *long animation frames* que la frenan, con el script culpable. El `clip-path` va en el compositor; lo que da tirones es la intro del hero y lo que anima JS a la vez ("main thread janked under the wipe").
- **Contenido ya maquetado detrás**: posiciones de layout (cadena de `offset*` más el borde de cada `offsetParent`, sin transforms) de títulos, textos, imágenes y botones del primer pantallazo en `is-done` y después de retirar el loader; cualquier movimiento o CLS tras la revelación es FAIL. También fuentes cargadas e imagen del hero decodificada en `is-done`. Los nombres de los elementos se calculan al final, no en el primer fotograma de la cortinilla.
- Fotogramas negros (más del 25 % de píxeles casi negros).
- Con movimiento reducido: ningún elemento animado por JavaScript desde el primer parseo (una intro que se reproduzca detrás o justo después del loader es FAIL).

### Barrido de scroll (`sweep`)
- Ida y vuelta **realista** (rueda 100 px cada 80 ms; en táctil, deslizamientos del 45 % de la pantalla) hasta el footer y de vuelta arriba, y otra ida y vuelta **rápida** (400 px cada 16 ms). Tiempos de fotograma por pasada: p50/p95/peor, fotogramas perdidos a 60 Hz, tareas largas y los *long animation frames* con su script.
- **Paradas** en cada altura de pantalla y en cada `[data-scene]`, con captura `sweep-NN-y<scroll>.jpg` tras 1,6 s.
- Detectores, activos durante todo el tiempo que la página está abierta:
  - **Reveals atascados**: `[data-reveal]`, `[data-split]`, hijos de `[data-stagger]`, `[data-lit]`, `[data-count]` y la copia de los pilares que llevan más de 1,5 s dentro de la franja 10-80 % de la pantalla y siguen ocultos (opacidad < 0,05, `visibility:hidden`, `clip-path` cerrado, desplazados más de 40 px, la mitad de las partes del SplitText ocultas, contador en 0). Al final de la página cuenta cualquier trozo visible: un trigger al que no se puede llegar es un fallo.
  - **Desbordamiento horizontal**: si la página se puede desplazar de lado (FAIL) y contenido visible cortado por el borde de la pantalla (WARN; ignora lo decorativo `aria-hidden`).
  - **UI fija encima del contenido**: nav, WhatsApp/Apex o el banner de cookies tapando enlaces, botones o títulos dentro de una escena fijada o, al final de la página, los flotantes de abajo.
  - **Clics fantasma**: rejilla de `elementFromPoint` cada 24 px arriba del todo, en cada parada y en cada estado de los pins; un enlace o botón invisible (opacidad < 0,1) que se queda con el clic de un control visible es FAIL (así se colaban los enlaces ocultos del Doctor Portal sobre los botones del hero); si debajo no hay nada visible (una entrada que aún no se ha reproducido, por ejemplo un CTA en el 14 % inferior del primer pantallazo) es WARN. El rango del antes/después (`.ba`) es transparente a propósito.
  - Con el hero sin fijar (móvil, tablet, movimiento reducido) el Doctor Portal cuenta como contenido normal: título, tarjetas y botones deben verse.
- **Volver arriba = estado inicial**: tras llegar al footer y subir, el estado (scroll, altura, nav, pins, hero, pilares, vídeo) debe ser el de la primera carga.
- Reglas de layout: sin escenas fijadas ni vídeo de fondo hasta 1180 px (y aviso si el vídeo del hero se descarga en móvil aunque no se vea); con movimiento reducido, sin Lenis, sin pins, **todo visible sin hacer scroll** y ningún elemento animado por JavaScript al hacer scroll (escrituras de `style` contadas con un MutationObserver).

### Escenas fijadas (`pins`)
Para cada `.pin-spacer` (hero -> Doctor Portal y los cuatro pilares en escritorio): la altura del spacer coincide con el recorrido del ScrollTrigger, la sección siguiente empieza donde acaba el spacer, la escena se queda en `top: 0` durante el pin, no salta al entrar ni al salir y no pisa ni deja hueco con la siguiente sección. Estados del capítulo hero/portal al inicio, mitad y final (copia del hero visible al inicio; portal completo, laptop en reposo, entero en pantalla y sin solaparse con el texto al final) y del carril de pilares (empieza en 0, llega exactamente al final, barra al 100 %, contador `04`). Capturas `pin-<id>-start|mid|end.jpg`.

### Teclado (`keys`, solo viewports no táctiles)
PageDown y Espacio avanzan siempre (también dentro de los pins), End llega al final y Home vuelve al estado inicial. Después, **Tab** por todos los controles desde arriba: cada uno con el foco tiene que estar en pantalla y visible, y ningún contenedor `overflow: hidden` puede quedar desplazado por el foco (así se rompían los pilares). El input transparente del antes/después (`.ba__range`) se ignora: su figura muestra el anillo de foco.

### Escenarios límite (`edge`, sobre la home)
| Escenario | Qué hace |
|---|---|
| `reload` | Recarga a mitad de página y dentro del hero fijado: filmstrip del loader en la recarga y, después, el mismo estado que una carga limpia. |
| `router` | Navegación ClientRouter index -> services -> courses -> atrás -> atrás (en táctil por el menú hamburguesa). Cuenta ScrollTriggers e instancias de Lenis (los encuentra en el heap con `Runtime.queryObjects`, no están en `window`), los listeners de `window`, `document` y de los controles del nav que el router conserva (`.nav__book`, `.burger`, `.theme-toggle`) y los nodos DOM vivos tras recolectar basura (`Memory.getDOMCounters`) antes y después; fotogramas negros y loader en las transiciones; la home de vuelta debe ser idéntica y seguir animando hasta el final. Más del doble de nodos = las páginas visitadas se quedan en memoria (WARN). |
| `history` | Atrás/adelante entre `/` y `/services/` habiendo hecho scroll, y un segundo Atrás sin tocar `/services/`: cada uno vuelve a donde se dejó la página (±50 px, si no FAIL), pins coherentes con la posición, nada oculto a la vista. |
| `bfcache` | Salir a mitad de la home a otro documento (`/robots.txt`, navegación completa) y volver con Atrás: restaurada desde la bfcache, en el mismo sitio, sigue haciendo scroll y animando, y arriba es igual que una carga limpia. Si Chrome no la restaura lo dice (Info) con el motivo. |
| `anchor` | Enlace "About us" (`/#about`) desde `/services/` arriba y bajando hasta y=1600, carga directa de `/#about`, el CTA del pilar 02 de la home a `/services/#scanning` y los saltos internos de `/services/` pulsados arriba y tras bajar un poco: la sección debe quedar arriba y el título fuera del nav. |
| `resize` | Escritorio: cambio a otro tamaño en mitad de los pilares, cruce del breakpoint de 1180 px y vuelta al tamaño original (debe quedar como una carga limpia). Táctil: girar y volver (con `touch:1194x834` el giro cruza los 1180 px, como un iPad Pro). En cada paso el lector tiene que seguir donde estaba: acabar arriba del todo es FAIL. |
| `theme` | Cambiar el tema a mitad de página: no se mueve el scroll ni la altura y todo sigue coherente. |
| `visibility` | Pestaña oculta y visible otra vez: el vídeo del hero vuelve a reproducirse y el scrub responde. Headless no puede ocultar una pestaña, así que se simula (`document.hidden` + pausa del vídeo + `visibilitychange`); con `--headed` primero intenta minimizar la ventana. |
| `fling` | Scroll muy rápido hasta el final y de vuelta arriba (rueda 1200 px cada 8 ms; en táctil, deslizamientos casi de pantalla completa sin pausa). |
| `zoom` | Zoom del 125 % a mitad de página (menos píxeles CSS y DPR 1,25: en 1440 px cruza el breakpoint) y vuelta al 100 %. Solo escritorio. |

## Cómo leer el resultado

- **FAIL**: roto, hay que arreglarlo antes de producción. **WARN**: revisar la captura enlazada. **Info**: dato útil, no es un fallo.
- Los tiempos de fotograma son ruidosos en este PC de 4 núcleos con otros trabajos: compara ejecuciones y repite lo sospechoso antes de darlo por bueno. Headless también usa la GPU (WebGL informa de ANGLE con la GTX 1080 Ti), pero sin ventana ni vsync de pantalla; `--headed` da números más cercanos a un usuario y una pestaña oculta de verdad.
- `refreshHz` en el informe es la frecuencia a la que Chrome dio fotogramas (la de la pantalla del PC, 144 Hz aquí; con `--cpu 4` baja a la mitad); los "perdidos" se cuentan a 60 Hz.
- Pantalla de carga en local: todos los archivos llegan a la vez. En una red real (`--net slow4g`) el loader aparece antes y se ve más tiempo. El tope de 2 s de `initLoader` cuenta desde el inicio de la navegación y el mínimo de 0,5 s desde el primer pintado; con la CPU frenada el loader puede seguir más tiempo porque `DOMContentLoaded` (evaluar los módulos y arrancar) llega tarde.
- Cada aviso de un mismo elemento sale una vez por combinación, con la primera captura en que apareció.

## Límites conocidos

- El deslizamiento táctil por CDP no genera inercia en headless: en táctil, "rápido" y "fling" son deslizamientos seguidos.
- El zoom es emulado (métricas del dispositivo), no el zoom de la interfaz de Chrome. Su captura del 125 % va por CDP (`Page.captureScreenshot`): `page.screenshot()` de Playwright vuelve a aplicar su propio viewport y deshacía el zoom a mitad de la captura (las capturas `zoom-125.jpg` anteriores al 9-nov muestran la página ya de vuelta a 100 %, a medio reconstruir).
- Si un futuro bundle cambia la forma de ScrollTrigger o Lenis, sus contadores salen `null`; la comparación de listeners y de estado sigue funcionando.
- El teclado no se prueba en táctil.

## Archivos

- `qa.mjs`: CLI, build y servidor, escenarios, informe.
- `inpage.js`: sondas inyectadas en la página antes de sus scripts (`window.__qa`): observadores de rendimiento, reloj de fotogramas, detectores.
- `selftest.html`: página con defectos a propósito para `--selftest` (también un enlace fantasma sobre un botón visible y otro sobre una zona vacía, una caja `overflow: hidden` que el foco desplaza, un foco invisible y un ancestro con borde que recibe un transform).

### Escenarios sueltos (`scenarios/`)
Scripts independientes que sirven el build de QA ya hecho (`out/.dist-default`, no compilan) y escriben en `out/<nombre>/`. Cubren lo que no es "una página y un scroll":

| Script | Qué mira |
|---|---|
| `scenarios/inner/inner.mjs --out X --viewports desktop,tablet,phone --motion no-preference,reduce --lang en,es` | diálogo de descarga (bloqueo de scroll, Esc/x/fondo, foco), router entre páginas internas (hamburguesa), saltos internos arriba y tras bajar, `data-lenis-prevent` del formulario de contacto, vídeos en bucle con movimiento reducido, títulos `lines` tras un cambio de ancho |
| `scenarios/inner/probes.mjs --out X` | una sonda por causa raíz de las páginas internas (titulares divididos con movimiento reducido, entrada detrás del loader, imagen que espera el loader, loader a prueba de fallos sin JS, clases de `<html>` tras el router, cruce de 1180 px, título del diálogo en móviles); cada sonda tiene su veredicto y el script sale con código 1 si alguna falla |
| `scenarios/home/probe.mjs --probe reduced-hero,ghost-clicks,focus,net-loader,scroll-during-loader,intro-scroll,card-stack,reduced-flash --out X` | sondas de la home (Doctor Portal con movimiento reducido, clics fantasma en rejilla, foco, loader en red lenta, scroll durante el loader, intro contra scroll, card stack con `--dist out/.dist-reviews`) |
| `scenarios/cross/nav-state.mjs --out X` | anclas desde páginas con scroll, Atrás/Adelante, bfcache, hamburguesa tras navegar, cruce de 1180 px |
| `scenarios/cross/focus-keys.mjs --out X --viewports desktop,laptop` | Tab por la home con detalle por paso (pilares y hero) |
| `scenarios/cross/loader-net.mjs --out X --viewports desktop,phone` | loader con 4G lenta/rápida y caché fría, coste del vídeo del hero, bfcache |
| `scenarios/cross/long-session.mjs --out X --viewports desktop,phone --hops 15` | sesión larga: listeners, ScrollTriggers, Lenis, nodos DOM tras GC, marquee, botón Booking |

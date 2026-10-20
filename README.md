# Duplicados: extensión privada para Firefox

Detecta pestañas duplicadas **con precisión**, te avisa en cuanto abres una página que ya tenías abierta (y salta directamente a esa pareja en la lista) y explica en castellano sencillo **por qué** considera que dos pestañas son la misma página.

Toma como punto de partida [Duplicate Tabs Closer](https://github.com/Peuj/duplicate-tabs-closer), pero el motor de detección está escrito desde cero.

---

## Por qué la original marcaba como duplicadas pestañas distintas

Revisando su código salen tres causas:

1. **Compara por similitud de título.** Los títulos de una misma web se parecen muchísimo: todos los perfiles de Instagram acaban en «• Instagram photos and videos» y todos los vídeos en «- YouTube». Con el umbral de similitud, perfiles distintos quedan como «el mismo».
2. **«Ignorar la ruta»** (`ignorePathPart`) aparece en el popup por defecto. Si se activa, todo `instagram.com/...` o `youtube.com/...` se reduce a `instagram.com` o `youtube.com`, así que cualquier perfil, lista o canal es «duplicado» de cualquier otro.
3. **«Ignorar la consulta»** (`ignoreSearchPart`) borra todo lo que va tras `?`. Así `youtube.com/playlist?list=AAA` y `?list=BBB` se vuelven iguales, y también todos los vídeos `watch?v=...`.

Son opciones globales y a ciegas: arreglan un sitio y rompen otros.

## Cómo lo hace esta extensión

- **Solo mira la dirección (URL), nunca el título.**
- **Elimina lo que nunca cambia la página:** `http`/`https`, `www.`, la versión móvil `m.`, la barra final, el orden de los parámetros y los parámetros de rastreo (`utm_*`, `fbclid`, `gclid`, `si`, `igsh`…).
- **Aplica reglas por sitio** donde hace falta entender la web: YouTube, Instagram, X/Twitter, Reddit, Wikipedia, Google, Amazon, Facebook, TikTok, GitHub, Spotify, Google Docs/Drive y Gmail.
- **Da tres resultados posibles:**
  - **Duplicado**: es la misma página.
  - **Dudoso**: casi la misma, pero con un matiz (otro minuto del mismo vídeo, el mismo vídeo dentro de una lista, otra hoja del mismo documento, el modo lectura, un `?ref=`…). Decides tú.
  - **Distintas**: no aparecen.

Tus ejemplos:

| A | B | Resultado |
|---|---|---|
| `youtube.com/playlist?list=PLfnlh…` | `youtube.com/@eldescampaopodcast/videos` | Distintas |
| `youtube.com/@eldescampaopodcast/videos` | `youtube.com/@eldescampaopodcast/shorts` | Distintas |
| `instagram.com/nasa/` | `instagram.com/esa/` | Distintas |
| `instagram.com/nasa/` | `instagram.com/NASA?igsh=…` | Duplicado |
| `youtu.be/ID` | `youtube.com/watch?v=ID&si=…` | Duplicado |
| `youtube.com/watch?v=ID` | `youtube.com/watch?v=ID&t=120` | Dudoso |

En **Ajustes → Comprobar dos direcciones** puedes pegar dos URL y ver qué se compara y por qué.

## Modos de detección

| Modo | Para qué |
|---|---|
| **Inequívoco** (por defecto) | Lo evidente: solo lo que es, sin lugar a dudas, la misma página. Nada que configurar. El mismo vídeo de YouTube en otro minuto o abierto desde una lista es duplicado. Los matices (una `#sección`, un Short frente al vídeo normal) aparecen aparte, como dudosos. |
| **Como Duplicate Tabs Closer** | Tus ajustes de la original (ignora mayúsculas, `www` y `#`, y une por título idéntico). Sirve para comparar. |
| **Personalizado** | Búsqueda avanzada: todas las opciones de la original (mayúsculas, www, `#`, parámetros, ruta, título idéntico o parecido, reglas de URL y de títulos) y más (http/https, versión móvil, rastreo, reglas por web, parámetros que no cuentan, reglas propias por dominio, mostrar dudosos), cada una explicada. |

En la lista, **¿Por qué se agrupan?** cuenta los grupos por motivo (pulsa uno para ver solo esos). **Comparar los tres modos** calcula cuántas pestañas sobrarían con cada modo, sobre tus pestañas reales. **Copiar informe** copia todos los grupos con sus direcciones y su motivo.

Las páginas internas de Firefox y las de otras extensiones (grupos de Sidebery o Tree Style Tab, pestañas suspendidas…) solo se consideran duplicadas si su dirección es exactamente la misma, letra por letra. Nunca se agrupan por título. Así lo hace también la original.

**Reglas propias** (Personalizado → Reglas propias por web), una por línea:

```
tienda.com ruta:2            solo cuentan los 2 primeros tramos de la ruta (ruta:0 = todo el sitio)
foro.com sin-parametros      ignora lo que va tras «?»
foro.com parametros:t,page   solo cuentan esos parámetros
tienda.com ignorar:sort,view esos parámetros no cuentan
docs.ejemplo.com sin-ancla   ignora lo que va tras «#»
wiki.ejemplo.com mayusculas  no distingue mayúsculas en esa web
/noticias\.com\/articulo\/(\d+)/  agrupa por lo capturado entre paréntesis
```

## Funciones

- **Aviso al abrir un duplicado:** se abre la ventanita del icono y salta a esa pareja: la resalta y marca la pestaña «nueva». Necesita Firefox 149 o posterior; en versiones anteriores se abre una ventana aparte. En su lugar puedes elegir una notificación del sistema, no avisar, o cerrar la nueva automáticamente (y deshacer).
- **Ventanita del icono, como la original:** una línea por pestaña; la que se conserva, normal, y las que sobran, tachadas; la que estás viendo, destacada; la dirección y el motivo al pasar el ratón; botón para cerrar duplicados y deshacer. Las opciones rápidas (modo de detección y aviso) se despliegan con ⚙. Se estira arrastrando la barra de abajo o la esquina. **Firefox no deja que pase de 800 × 600 px** (es un límite fijo del navegador para todas las extensiones); para más, la ventana grande.
- **Ventana grande** (botón ▭ de la ventanita, clic derecho en el icono, o como acción del icono): la misma lista sencilla en una ventana aparte, de tamaño libre, que recuerda su tamaño y posición. Si Firefox no deja abrir la ventanita al avisar de un duplicado, se abre esta automáticamente con la pareja seleccionada.
- **Página completa en su propia pestaña** (botón ⤢ de la ventanita, o clic derecho en el icono): todos los datos, todos los ajustes y la ayuda. También funciona como **panel lateral** de Firefox.
- **Lista clara:** resalta en cada URL la parte que cambia, explica el motivo, indica qué pestaña se conservará (★) y muestra la ventana, el contenedor, si está fijada, dormida o sonando.
- **Cerrar duplicados** de golpe o por grupo, **conservar solo esta**, **Deshacer** (reabre con su historial).
- **Mantener todas:** deja de avisar de esa página durante la sesión. Desde el clic derecho en una pestaña: «No es duplicada» y «Ver duplicados de esta pestaña».
- **No molesta:** al restaurar la sesión o abrir muchas pestañas a la vez no avisa, y las pestañas abiertas a propósito desde la misma página («Duplicar pestaña») no generan avisos.
- **Respeta las sesiones:** las ventanas privadas y, por defecto, los contenedores distintos nunca se mezclan.
- **Lista de exclusión** de webs, con comodines.
- **Temas:** Automático (claro u oscuro según el sistema), Claro, Oscuro, Catppuccin (Latte, Frappé, Macchiato, Mocha), Dracula, Kanagawa (Wave, Dragon, Lotus), Tokyo Night, Rosé Pine (y Dawn), Gruvbox (oscuro y claro), Nord, Solarized (oscuro y claro), One Dark, Everforest, Monokai, GitHub oscuro, Como Firefox (copia los colores de tu tema) y Personalizado. Además puedes elegir color de acento, densidad, tamaño del texto y redondeo de esquinas.
- **Teclado:** `Alt+Mayús+D` abre la ventanita. Dentro: `/` busca, `↑ ↓` te mueves, `Intro` va a la pestaña, `Supr` la cierra y `K` conserva solo esa.
- **Exportar e importar** los ajustes.

## Instalación y actualizaciones automáticas

1. Descarga **[duplicados.xpi](https://github.com/drugabox/duplicados-firefox/releases/latest/download/duplicados.xpi)** (la última versión firmada por Mozilla).
2. Arrástralo a una ventana de Firefox y acepta los permisos. Queda instalada de forma permanente.
3. Opcional: `about:addons` → Duplicados → *Ejecutar en ventanas privadas* → Permitir.

**Las actualizaciones son automáticas.** Cada cambio en `main` lanza la tarea `.github/workflows/publicar.yml`, que:
- pasa las pruebas y el validador de Mozilla;
- pone la versión sola (`1.1.<número de ejecución>`);
- la firma con tu cuenta de Mozilla como «no listada», con los secretos `AMO_JWT_ISSUER` y `AMO_JWT_SECRET` del repositorio;
- la publica en *Releases* junto a `updates.json`.

Firefox consulta `updates.json` una vez al día y se actualiza solo. Para forzarlo: `about:addons` → ⚙ → *Buscar actualizaciones*.

Para probar sin firmar: `about:debugging#/runtime/this-firefox` → *Cargar complemento temporal* → `manifest.json`.

## Desarrollo

```
manifest.json        Manifiesto (Firefox 115+)
background.js        Vigila pestañas, agrupa, avisa, cierra y deshace
lib/normalize.js     Motor de detección y explicaciones (sin dependencias)
lib/settings.js      Ajustes por defecto y lista de exclusión
lib/theme.css/.js    Temas compartidos por la ventanita y la página
popup/               Ventanita del icono (lo básico)
panel/               Página completa: lista detallada, ajustes y ayuda (pestaña, panel lateral)
test/                Pruebas del motor con casos reales
```

```bash
npm test        # pruebas del motor (Node 18+)
npm run lint    # validador oficial de Mozilla
npm run start   # abre un Firefox de pruebas con la extensión cargada
npm run build   # genera el .zip en dist/
```

**Añadir una regla para una web:** en `lib/normalize.js`, dentro de `RULES`, añade un objeto con `match(host)`. Opcionalmente añade también `classify(param)` (para indicar qué parámetros son de rastreo, `"tracking"`, o un matiz, `"soft"`) y `key(u)` (la huella de la página). Añade el caso a `test/normalize.test.js`.

**Crear un tema:** en `panel/panel.css`, copia un bloque `:root[data-theme="…"]` con tus colores y añádelo a `THEMES` en `panel/panel.js`. También puedes usar «Personalizado» sin tocar código.

### Permisos y para qué se usan

| Permiso | Uso |
|---|---|
| `tabs` | Leer las direcciones de las pestañas, cambiar a una pestaña y cerrarla |
| `storage` | Guardar tus ajustes y el tamaño de la ventana |
| `sessions` | Deshacer: reabrir lo cerrado con su historial |
| `menus` | Opciones del clic derecho en pestañas y en el icono |
| `notifications` | Aviso discreto, si eliges ese modo |
| `contextualIdentities`, `cookies` | Nombre y color de los contenedores, y reabrir en el contenedor correcto |
| `theme` | Copiar los colores del tema de Firefox |

No se envía nada a ningún sitio: todo ocurre dentro de tu Firefox.

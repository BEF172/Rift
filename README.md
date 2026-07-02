# Rift Atlas

Rift Atlas es una app de escritorio para League of Legends orientada a gestionar skins, chromas, forms, mods propios y overlays locales desde una sola interfaz.

La app integra LeagueSkins, Pengu Loader y un flujo estilo Rose para leer Champ Select, resolver la skin seleccionada, preparar overlays y aplicar mods al entrar a partida.

## Funciones principales

- Descarga e indexa LeagueSkins.
- Detecta League of Legends y configura la ruta correcta del juego.
- Instala y administra Pengu Loader con los plugins de Rift Atlas.
- Sincroniza Champ Select: skins, chromas, forms, estado de inventario y finalizacion de loadout.
- Permite agregar mods propios por skin o por categoria.
- Mantiene seleccionados los custom mods aunque se mueva el carrusel de skins.
- Construye y cachea overlays para acelerar la aplicacion de mods.
- Soporta modo Rose y modo LTK.
- Incluye Party Mode para compartir seleccion de skins/mods entre jugadores.
- Tiene paneles de diagnostico, logs, mantenimiento de cache y tutorial inicial.

## Instalacion y uso

1. Instala Rift Atlas y ejecutalo como administrador si Windows lo pide.
2. En la seccion de configuracion, detecta League of Legends.
3. Verifica que la ruta apunte al ejecutable del juego:

```text
C:\Riot Games\League of Legends\Game\League of Legends.exe
```

No uses `LeagueClient.exe` como ruta del juego.

4. Descarga o selecciona una biblioteca de LeagueSkins.
5. Instala o activa Pengu Loader desde Rift Atlas.
6. Entra a Champ Select, bloquea campeon y selecciona la skin/mod que quieras usar.
7. Deja Rift Atlas y Pengu Loader abiertos hasta que termine la partida.

## LeagueSkins

Rift Atlas puede descargar LeagueSkins automaticamente o indexar una carpeta local. Despues de indexar, las skins aparecen en la biblioteca y se pueden seleccionar para preparar overlay.

Si una skin no existe en el inventario del cliente, Rift Atlas intenta resolver el paquete base necesario y aplicar el overlay al momento correcto del flujo de Champ Select.

## Mods propios

Los mods propios se pueden importar como archivos `.fantome`, `.zip`, carpetas o paquetes compatibles. Pueden apuntar a una skin especifica o a categorias como mapa, fuente, announcer u otros mods.

Para skins custom, Rift Atlas usa el ID objetivo del mod como autoridad. Esto evita que el custom mod se pierda si el usuario mueve el carrusel o selecciona otra skin del mismo campeon en el cliente.

## Pengu Loader

Rift Atlas instala un set de plugins `RiftAtlas-*` dentro de Pengu Loader:

- `RiftAtlas-00-Core`: puente principal entre League Client y Rift Atlas.
- `RiftAtlas-ChromaWheel`: panel de chromas reales.
- `RiftAtlas-FormsWheel`: skins con forms especiales.
- `RiftAtlas-HistoricMode`: seleccion historica por campeon.
- `RiftAtlas-Jade`: integraciones visuales/estado.
- `RiftAtlas-PartyMode`: sincronizacion de party.

Si actualizas la app o cambias plugins, reinstala los plugins de Pengu desde Rift Atlas y reinicia League Client.

## Chromas y forms

Rift Atlas distingue entre:

- Chromas reales del cliente/LeagueSkins.
- Forms especiales que no siguen el modelo normal de chromas.
- Skins sin chromas, donde el boton de chroma debe ocultarse.

Cuando el bridge confirma que una skin no tiene chromas, el panel no se abre y cualquier boton residual se oculta.

## Party Mode

Party Mode permite compartir seleccion de skins y estado entre usuarios conectados. Para mods propios, Rift Atlas compara hashes y usa archivos locales equivalentes cuando existen. No transfiere automaticamente mods custom completos como reemplazo permanente de tu biblioteca local.

## Desarrollo

Requisitos habituales:

- Node.js
- npm
- Rust y Tauri CLI si vas a usar el flujo Tauri
- League Client instalado para probar integraciones reales

Instalar dependencias:

```bash
npm install
```

Ejecutar en desarrollo:

```bash
npm run dev
```

Verificar sintaxis de los archivos principales:

```bash
npm run check
```

Compilar release:

```bash
npm run dist
```

Scripts disponibles:

- `npm run dev` / `npm start`: abre la app en modo desarrollo.
- `npm run check`: valida sintaxis de `main.js`, `preload.js`, `src/renderer.js` y plugins Pengu.
- `npm run dist` / `npm run release`: genera build.
- `npm run version:bump`: actualiza version usando el script del proyecto.

## Estructura relevante

```text
main.js                         Proceso principal, descargas, IPC, overlay y Pengu.
preload.js                      API segura expuesta al renderer.
src/renderer.js                 UI principal y logica de seleccion/sincronizacion.
Pengu Loader/plugins/           Plugins instalables en Pengu Loader.
src-tauri/                      Configuracion Tauri.
assets/                         Iconos, DLL y recursos de la app.
scripts/                        Utilidades de mantenimiento/versionado.
```

## Diagnostico

Si algo no aplica:

1. Revisa que League este detectado con `League of Legends.exe`.
2. Confirma que Pengu Loader este activo y con los plugins `RiftAtlas-*` instalados.
3. Reindexa LeagueSkins.
4. Abre los logs de overlay/diagnostico desde la app.
5. Reinicia League Client despues de actualizar plugins Pengu.

## Aviso

Rift Atlas es una herramienta local no oficial para gestionar mods. League of Legends, Riot Games, LeagueSkins y Pengu Loader pertenecen a sus respectivos autores o propietarios. El uso de mods personalizados queda bajo responsabilidad del usuario.

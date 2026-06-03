# Rift Atlas

Aplicacion de escritorio para League of Legends hecha con Electron. Rift Atlas permite descargar herramientas, indexar LeagueSkins, seleccionar skins/mods, aplicar el overlay y sincronizar archivos entre amigos con Party P2P.

## Funciones principales

- Descarga de engine y DLL desde la pantalla Descargas.
- Soporte para DLL incluido con la app en `assets/cslol-dll.dll`.
- Configuracion de `League of Legends.exe`.
- Indexado local de LeagueSkins.
- Carga de mods propios `.fantome`, `.zip`, `.rse`, `.wad` y `.wad.client`.
- Generacion local de `.fantome` para paquetes LeagueSkins con WAD mini.
- Overlay con `ltk-manager.exe`, `mkoverlay` y patcher.
- Cache de overlay para acelerar ejecuciones repetidas.
- Diagnostico de instalacion, engine, DLL, League y prueba basica de DLL.
- Party P2P para compartir mods entre miembros de una sala.
- Carpeta temporal P2P en `AppData\Roaming\Rift Atlas\p2p`, limpiada al salir de party.

## Uso basico

1. Abri Rift Atlas.
2. Entra a **Descargas**.
3. Selecciona la fuente del DLL. Por defecto se usa **Incluido con Rift Atlas**.
4. Descarga **engine + DLL**.
5. Descarga **LeagueSkins** si queres usar la biblioteca automatica.
6. En **Configuracion**, usa **Detectar** o configura manualmente la ruta de League.
7. La ruta correcta debe apuntar a:

```text
C:\Riot Games\League of Legends\Game\League of Legends.exe
```

No uses `LeagueClient.exe`.

8. En **Skins**, selecciona skins/mods.
9. Toca **Aplicar**.
10. Deja Rift Atlas abierto y entra a partida.

## DLL incluido

Si queres que la app venga con un DLL interno, coloca el archivo en:

```text
assets\cslol-dll.dll
```

Ese archivo no esta incluido por defecto en el repositorio. Al compilar, Electron Builder lo deja fuera del `asar` mediante:

```json
"asarUnpack": [
  "node_modules/7z-wasm/**/*",
  "assets/cslol-dll.dll"
]
```

Cuando el usuario descarga el engine usando la fuente **Incluido con Rift Atlas**, la app copia ese DLL hacia:

```text
AppData\Roaming\Rift Atlas\engine\cslol-dll.dll
```

## Party P2P

Party permite crear una sala o entrar con un codigo para compartir mods seleccionados.

- Los archivos recibidos se guardan en `AppData\Roaming\Rift Atlas\p2p`.
- Al salir de party se borran los archivos P2P locales.
- Mientras estas en party, los P2P activos quedan seleccionados automaticamente para el overlay.
- La seccion **Skins > P2P** aparece solo cuando estas conectado.
- El boton **Limpiar no P2P** limpia la seleccion normal, pero conserva los P2P activos.

## Desarrollo

Instalar dependencias:

```bash
npm install
```

Ejecutar en desarrollo:

```bash
npm start
```

Validar sintaxis:

```bash
npm run check
```

Compilar instalador Windows:

```bash
npm run dist
```

El instalador queda en:

```text
dist\Rift Atlas Setup 1.0.0.exe
```

## Git

El repositorio ignora:

```text
node_modules/
dist/
package-lock.json
```

Para publicar una build, subi el instalador a un host externo o a GitHub Releases. No subas `dist` ni `node_modules` al repositorio.

## Fuentes externas

- Hitori Bocchi engine: https://github.com/hitori-rebocchi/hitori-bocchi
- LeagueToolkit cslol-manager: https://github.com/LeagueToolkit/cslol-manager
- LeagueToolkit ltk-manager: https://github.com/LeagueToolkit/ltk-manager
- LeagueSkins: https://github.com/Alban1911/LeagueSkins

## Aviso

Rift Atlas es una herramienta local de escritorio. El uso de mods personalizados queda bajo responsabilidad del usuario.

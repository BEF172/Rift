# Rift Atlas

Aplicacion de escritorio con Electron para explorar campeones de League of Legends usando datos publicos oficiales de Riot Data Dragon.

## Ejecutar

```bash
npm install
npm start
```

En PowerShell de Windows, si `npm` esta bloqueado por la politica de scripts, usa:

```powershell
npm.cmd install
npm.cmd start
```

## Que incluye

- Catalogo de campeones con busqueda y filtro por rol.
- Tier list por linea con winrate, pickrate, banrate y partidas. Carga solo la linea activa.
- Detalle con splash art, lore, dificultad, estadisticas y habilidades.
- Favoritos guardados localmente con `localStorage`.
- Busqueda de jugadores por Riot ID.
- Perfil, clasificatorias, partida activa, ultimas partidas, equipos, CS, build final y tiempos de compra usando Riot API.
- Seccion Skins para configurar rutas, seleccionar paquetes de LeagueSkins e importarlos a cslol.
- Descarga oficial de `cslol-manager-windows.exe` desde GitHub Releases.
- Biblioteca LeagueSkins local con busqueda, filtro por campeon, iconos y toggles de skins gestionadas por Rift Atlas.
- Importacion directa de paquetes `.zip`/`.fantome` hacia la carpeta `installed` de cslol usando `mod-tools.exe`.
- Seleccion de skins estilo bandeja inferior y accion principal **Aplicar seleccion**.
- Vista de referencia para endpoints de Riot ID, Match-V5, Spectator-V5 y Data Dragon.
- Boilerplate legal visible requerido por Riot para productos con su IP.

## Mods y skins

La seccion Mods no inyecta paquetes en League of Legends ni reemplaza a cslol-manager. Puede importar paquetes locales `.zip`/`.fantome` a la biblioteca `installed` de cslol mediante `mod-tools.exe`, y luego cslol-manager sigue siendo quien activa perfiles y ejecuta los mods. Evita contenido que replique skins pagas, contenido limitado o cualquier mod que de ventaja competitiva.

Rift Atlas no copia LeagueSkins dentro de `src/skins`: esa carpeta haria el proyecto enorme y mezclaria assets de terceros con el codigo. En su lugar, selecciona una carpeta local donde tengas LeagueSkins descargado/clonado, y la app indexa esa biblioteca. Las skins marcadas como gestionadas quedan guardadas en `localStorage` como rutas locales.

Para usar Skins:

1. Descarga o selecciona `cslol-manager.exe`.
2. Configura `mod-tools.exe`; normalmente esta en `cslol-tools/mod-tools.exe` al lado de cslol-manager.
3. Configura `League of Legends.exe`; normalmente esta en `C:\Riot Games\League of Legends\Game\League of Legends.exe`. No uses `LeagueClient.exe`.
4. Selecciona tu carpeta LeagueSkins.
5. Pulsa **Seleccionar** en las skins que quieres usar.
6. Pulsa **Aplicar seleccion**. Rift Atlas importa los paquetes y abre cslol-manager para que ejecutes el perfil desde cslol.

Rift Atlas no ejecuta `mkoverlay`, `runoverlay` ni mantiene overlays vivos desde Electron. Esa parte queda dentro de cslol-manager.

- cslol-manager: https://github.com/LeagueToolkit/cslol-manager
- LTK Manager: https://github.com/LeagueToolkit/ltk-manager
- LeagueSkins: https://github.com/Alban1911/LeagueSkins

## Desarrollo

Instalar dependencias:

```bash
npm install
```

Ejecutar en desarrollo:

```bash
npm start
```

## Git

El repositorio ignora:

```text
node_modules/
dist/
package-lock.json
```

Para publicar una build, subi el instalador a un host externo o a GitHub Releases. No subas `dist` ni `node_modules` al repositorio.

## Aviso

Rift Atlas es una herramienta local de escritorio. El uso de mods personalizados queda bajo responsabilidad del usuario.

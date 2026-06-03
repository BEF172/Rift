# Rift Atlas

Aplicacion de escritorio con Electron para explorar campeones de League of Legends usando datos publicos oficiales de Riot Data Dragon.

## Ejecutar

```bash
npm install
npm start
```

En PowerShell de Windows, si `npm` esta bloqueado por la politica de scripts, usa:

```bash
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

## Nota sobre Riot API

No incluyas una API key de Riot dentro del codigo.

La forma mas comoda es abrir la app, ir a **Jugador**, pegar la clave en **API key de sesion** y pulsar **Usar key**. Esa clave queda solo en memoria mientras la app esta abierta; no se guarda en disco ni en `localStorage`.

Tambien puedes iniciar la app con la variable de entorno `RIOT_API_KEY`.

PowerShell:

```powershell
$env:RIOT_API_KEY="RGAPI-tu-clave"
npm.cmd start
```

CMD:

```bat
set RIOT_API_KEY=RGAPI-tu-clave
npm.cmd start
```

La busqueda de jugadores usa Riot ID (`gameName#tagLine`) segun la documentacion oficial:

https://developer.riotgames.com/docs/lol

La tier list no viene de Riot API oficial. Usa U.GG como fuente principal por linea activa y cae al dataset publico `HakimT/lol-champion-ranked-stats` de Hugging Face si U.GG no responde:

https://u.gg/lol/tier-list
https://huggingface.co/datasets/HakimT/lol-champion-ranked-stats

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

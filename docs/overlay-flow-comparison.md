# Rift Atlas overlay/plugin flow comparison

Este documento compara el flujo observado en:

- Original Electron: `C:\Users\BRIAN\Desktop\proyectoLOL`
- Tauri actual: `C:\Users\BRIAN\Desktop\proyectoLOLTauri`
- Referencia Rose: `Alban1911/Rose`, para el modo `mod-tools.exe`

## Mapa General

```mermaid
flowchart LR
  User[Usuario] --> App[Rift Atlas UI]
  App --> Config[Configuracion]
  App --> Mods[Mods / Skins locales]
  App --> Overlay[Overlay runner]
  App --> Pengu[Pengu Loader plugin]

  Config --> Engine[Engine: ltk-manager.exe o mod-tools.exe]
  Config --> Dll[cslol-dll.dll]
  Config --> League[League of Legends.exe]

  Mods --> Queue[Cola de skins/mods]
  Pengu --> Sync[skin-sync / chroma-selection]
  Sync --> Queue
  Queue --> Overlay

  Overlay --> Mkoverlay[mkoverlay]
  Mkoverlay --> OverlayDir[Overlay cache / DATA]
  OverlayDir --> Runner[patcher o runoverlay]
  Runner --> Game[League game process]
```

## Original Electron

```mermaid
flowchart TD
  Start[App Electron inicia] --> Window[BrowserWindow + preload API]
  Start --> AppData[AppData Local: Rift Atlas]
  Start --> Bridge[WebSocket bridge Pengu]
  Start --> AssetServer[Asset server local previews]
  Start --> StartupPengu[Inicializa / limpia Pengu]
  Start --> Watcher[Watcher auto-activate Pengu]

  Window --> UI[src/renderer.js]
  UI --> Config[Configurar rutas]
  Config --> Detect[Detectar engine/DLL/League]
  Detect --> EnginePath[sidecarPath: ltk-manager/mod-tools si existe]
  Detect --> DllPath[cslol-dll.dll]
  Detect --> LeaguePath[Game/League of Legends.exe]

  UI --> AddMods[Agregar mods]
  AddMods --> PickFiles[selectCustomModFiles]
  AddMods --> PickFolder[selectCustomModFolder/index folder]
  PickFiles --> InspectArchive[inspectArchivePackage]
  PickFolder --> ListPackages[listModPackages + metadata]
  InspectArchive --> CustomMods[customMods localStorage]
  ListPackages --> CustomMods
  CustomMods --> Queue[queuedSkins]

  Bridge --> PenguPlugin[Pengu plugin en cliente League]
  PenguPlugin --> SkinSync[skin-sync/chroma-selection]
  SkinSync --> FindSkin[findSkinFromPenguSync]
  FindSkin --> Queue
  Queue --> Apply[applyQueuedSkins/runBocchiOverlay]

  Apply --> StopOld[Detener overlay anterior si existe]
  StopOld --> ResolveEngine[resolveHitoriEngineExecutable]
  ResolveEngine --> EnsureDll[ensureCslolDll]
  EnsureDll --> GameSuspend[createGameSuspensionGuard]

  GameSuspend --> PrepareMods[generateFantomeFromLeagueWad por entrada]
  PrepareMods --> DirectFantome[.fantome directo]
  PrepareMods --> ZipNormalize[.zip / .fantome local con WAD: staging]
  PrepareMods --> WadFantonize[.wad/.wad.client: fantonize si hace falta]

  DirectFantome --> SkinPaths[skinPaths finales]
  ZipNormalize --> SkinPaths
  WadFantonize --> SkinPaths

  SkinPaths --> CacheKey[getOverlayCacheKey]
  CacheKey --> CacheHit{Overlay cache usable?}
  CacheHit -- si --> OverlayPath[overlayPath cache]
  CacheHit -- no --> Mkoverlay[execMkoverlayWithFallback]
  Mkoverlay --> OverlayPath

  OverlayPath --> Patcher[spawnPatcherAndMonitor]
  Patcher --> PatcherArgs["patcher --dll cslol-dll.dll --overlay-root overlayPath --flags 0"]
  PatcherArgs --> Resume[markPatcherActive/reanuda League]
  Resume --> Game[League.exe carga con overlay]
```

### Original: Flujo De Plugin Pengu

```mermaid
sequenceDiagram
  participant LeagueClient as League Client
  participant Pengu as Pengu Plugin
  participant WS as WebSocket Bridge Electron
  participant UI as Renderer
  participant Main as main.js
  participant Game as League Game

  LeagueClient->>Pengu: Usuario selecciona skin/chroma
  Pengu->>WS: skin-sync / chroma-selection
  WS->>UI: evento pengu:message
  UI->>UI: buscar skin en biblioteca/cola
  UI->>Main: runBocchiOverlay(payload)
  Main->>Main: preparar mods + mkoverlay
  Main->>Game: suspender si aparece antes del overlay
  Main->>Main: iniciar patcher
  Main->>Game: reanudar cuando patcher esta activo
```

### Original: Caracteristicas Clave

- Electron mantiene handles directos del proceso `patcherProcess`, stdin/stdout/stderr y eventos `exit/error`.
- El log de overlay se escribe a `last-overlay-log.txt` y el renderer lo usa para diagnostico.
- El watcher de suspension arranca temprano y sigue mirando mientras se prepara el overlay.
- El flujo observado prioriza `patcher --dll --overlay-root`, estilo LTK/cslol DLL.
- La UI original no tenia un selector visual fuerte de modo `LTK` vs `Rose`; era mas implicito por ruta/engine.

## Tauri Actual

```mermaid
flowchart TD
  Start[App Tauri inicia] --> Setup[src-tauri setup]
  Setup --> AppData[LOCALAPPDATA/Rift Atlas]
  Setup --> WS[ws_server.rs: bridge Pengu]
  Setup --> Asset[asset_server.rs: previews HTTP 45732]
  Setup --> StartupPengu[pengu_startup_init]
  Setup --> AutoWatcher[pengu_try_auto_activate cada 2.5s]
  Setup --> Tray[System tray: abrir/salir]
  Setup --> CloseHide[Cerrar ventana = hide]

  UI[src/renderer.js + bridge.js] --> Config[Configuracion]
  Config --> EngineMode{Modo engine}
  EngineMode -- LTK --> Ltk[ltk-manager.exe]
  EngineMode -- Rose --> ModTools[mod-tools.exe]
  Config --> Dll[cslol-dll.dll]
  Config --> League[League of Legends.exe]

  UI --> AddMods[Agregar mods]
  AddMods --> Files[index_custom_mod_files]
  AddMods --> Folder[index_custom_mod_folder]
  Files --> Indexer[index_custom_mod_paths]
  Folder --> List[list_mod_packages]
  List --> Indexer
  Indexer --> ArchiveInfo[overlay::inspect_archive]
  ArchiveInfo --> CustomMods[customMods localStorage]
  CustomMods --> Queue[queuedSkins]

  UI --> Pengu[Pengu WebSocket events]
  Pengu --> Queue
  Queue --> Prebuild[build_base_overlay opcional]
  Queue --> Run[run_bocchi_overlay]

  Run --> Resolve[resolve_hitori_engine]
  Resolve --> SpawnBlocking[run_overlay_blocking]
  SpawnBlocking --> Prepare[generate_fantome_from_league_wad]
  Prepare --> ModPaths[mod_paths finales]
  ModPaths --> BaseMode{Hay baseOverlayPath?}

  BaseMode -- Base sin extras --> DirectBase[Usar overlay base]
  BaseMode -- Base + extras --> ExtraOverlay[mkoverlay extra + merge]
  BaseMode -- Sin base --> FullOverlay[mkoverlay full]

  DirectBase --> Runner
  ExtraOverlay --> Runner
  FullOverlay --> Runner

  Runner{Engine resuelto}
  Runner -- ltk-manager.exe --> LtkFlow[mkoverlay moderno + patcher]
  Runner -- mod-tools.exe --> RoseFlow[mkoverlay Rose + runoverlay]

  LtkFlow --> Game
  RoseFlow --> Game
```

### Tauri Actual: Modo LTK

```mermaid
flowchart TD
  A[run_bocchi_overlay] --> B[resolve_hitori_engine]
  B --> C[prepare mods]
  C --> D[execute_mkoverlay]
  D --> E["ltk-manager.exe mkoverlay --game gameFolder --overlay overlayPath --state statePath --mod mod1 --mod mod2"]
  E --> F[overlay cache DATA]
  F --> G[spawn_patcher_and_monitor]
  G --> H["ltk-manager.exe patcher --dll cslol-dll.dll --overlay-root overlayPath --flags 0"]
  H --> I[League process]
```

### Tauri Actual: Modo Rose / mod-tools

```mermaid
flowchart TD
  A[run_bocchi_overlay] --> B[resolve_hitori_engine]
  B --> C[prepare mods]
  C --> D[prepare_mkoverlay_mods]

  D --> E{Tipo de mod}
  E -- ".zip/.fantome" --> Extract[Extraer a carpeta temporal]
  E -- ".wad/.wad.client" --> WadFolder[Crear carpeta WAD/archivo]
  E -- carpeta --> CopyDir[Copiar carpeta]

  Extract --> ModsDir[.mkoverlay-state/mod-tools-mods]
  WadFolder --> ModsDir
  CopyDir --> ModsDir

  ModsDir --> Mkoverlay["mod-tools.exe mkoverlay modsDir overlayPath --game:gameFolder --mods:nombre1/nombre2 --noTFT --ignoreConflict"]
  Mkoverlay --> OverlayPath[overlay cache DATA + cslol-config.json]
  OverlayPath --> Runoverlay["mod-tools.exe runoverlay overlayPath cslol-config.json --game:gameFolder --opts:configless"]
  Runoverlay --> Game[League process]
```

### Tauri Actual: Plugin Pengu

```mermaid
sequenceDiagram
  participant Client as League Client
  participant Plugin as Pengu Plugin
  participant WS as ws_server.rs
  participant UI as renderer.js
  participant Tauri as commands.rs
  participant Overlay as overlay.rs
  participant Game as League Game

  Client->>Plugin: seleccion / hover / chroma
  Plugin->>WS: JSON skin-sync/chroma-selection
  WS->>UI: pengu:message
  UI->>UI: findSkinFromPenguSync + maybeForceLeagueSkinForOverlay
  UI->>Tauri: run_bocchi_overlay(payload)
  Tauri->>Overlay: generate_fantome_from_league_wad
  Tauri->>Overlay: execute_mkoverlay
  alt LTK
    Overlay->>Overlay: patcher --dll --overlay-root
  else Rose/mod-tools
    Overlay->>Overlay: runoverlay overlay cslol-config.json
  end
  Overlay->>Game: suspender/reanudar durante preparacion
```

## Rose De Referencia

```mermaid
flowchart TD
  RoseStart[Rose inicia en tray] --> Pengu[Pengu Loader plugins]
  RoseStart --> Monitor[Game monitor]
  RoseStart --> Storage[ModStorageService]

  Storage --> Categories[mods/skins, maps, fonts, announcers, ui, others...]
  Pengu --> Selection[Skin/chroma/custom mod state]
  Selection --> Trigger[injection_trigger]

  Trigger --> Clean[limpia mods_dir y overlay]
  Trigger --> StartMonitor[inicia monitor temprano]
  StartMonitor --> Suspend[Suspende League si aparece]

  Trigger --> ResolveBase[Resolver base skin zip si skin no owned]
  Trigger --> ExtractBase[Extraer base a mods_dir]
  Trigger --> ReExtractCustom[Extraer/enlazar custom mod a mods_dir]
  Trigger --> ExtraMods[map/font/announcer/other/party]

  ExtractBase --> ModNames[lista nombres de carpetas]
  ReExtractCustom --> ModNames
  ExtraMods --> ModNames

  ModNames --> Mkoverlay["mod-tools.exe mkoverlay mods_dir overlay_dir --game:game_dir --mods:name/name --noTFT --ignoreConflict"]
  Mkoverlay --> KeepFrozen[No reanuda todavia]
  KeepFrozen --> Runoverlay["mod-tools.exe runoverlay overlay_dir cslol-config.json --game:game_dir --opts:configless"]
  Runoverlay --> Resume[Reanuda League al iniciar runoverlay]
```

## Diferencias Principales

| Area | Original Electron | Tauri actual | Rose |
|---|---|---|---|
| UI engine | Implicito/simple | Conmutador `LTK` / `Rose` | No selector de LTK, usa `mod-tools.exe` interno |
| Plugin League | Pengu + WS bridge | Pengu + `ws_server.rs` | Pengu + backend Python |
| Asset/previews | File URLs / Electron | HTTP local `127.0.0.1:45732` | Archivos internos Rose |
| Mods por archivo | Inspecciona archiveInfo | Inspecciona archiveInfo | Storage por categorias |
| Mods por carpeta | Lista + metadata | Ahora lista + metadata completa | Storage categorizado |
| Engine LTK | `mkoverlay` moderno + `patcher` | Igual | No aplica |
| Engine Rose | No era flujo principal | `mkoverlay` Rose + `runoverlay` | Flujo principal |
| Preparacion mod-tools | No central | Extrae/copia a `mod-tools-mods` | Extrae/enlaza a `mods_dir` |
| Suspension de League | Guard temprano y persistente | Guard temprano/persistente | Monitor dedicado muy agresivo |
| Estado proceso | Electron guarda `ChildProcess` | Tauri guarda PID + atomic exit flag | psutil/process manager |
| Logs | `last-overlay-log.txt` | `last-overlay-log.txt` + memoria UI | logs Python |
| Cerrar app | Ocultar a tray en Electron | Ocultar a tray en Tauri | Tray app |

## Puntos Donde Pueden Aparecer Bugs

```mermaid
flowchart TD
  A[No inyecta] --> B{Llega skin-sync de Pengu?}
  B -- no --> B1[Plugin no instalado/conectado o WS caido]
  B -- si --> C{UI encuentra skin/mod?}
  C -- no --> C1[Indexado incompleto o metadata faltante]
  C -- si --> D{run_bocchi_overlay arranca?}
  D -- no --> D1[Engine/DLL/League path invalidos]
  D -- si --> E{mkoverlay genera DATA?}
  E -- no --> E1[Formato mod no preparado para engine elegido]
  E -- si --> F{Runner correcto?}
  F -- LTK --> G[patcher debe esperar League]
  F -- Rose --> H[runoverlay debe leer cslol-config.json]
  G --> I{League suspendido hasta runner activo?}
  H --> I
  I -- no --> I1[Race: juego cargo antes del hook]
  I -- si --> J{Skin visible in game?}
  J -- no --> J1[Mod apunta a WAD/skin equivocada, DLL vencida, o overlay incorrecto]
```

## Checklist De Diagnostico

1. Confirmar en configuracion si esta seleccionado `LTK` o `Rose`.
2. Confirmar que el binario real coincide:
   - `LTK`: `ltk-manager.exe`
   - `Rose`: `mod-tools.exe` real de cslol-manager, no una copia de LTK.
3. Revisar `C:\Users\BRIAN\AppData\Local\Rift Atlas\last-overlay-log.txt`.
4. Buscar estas lineas:
   - `run_bocchi_overlay: INICIO`
   - `Mods preparados`
   - `mkoverlay timeout`
   - `execute_mkoverlay completado`
   - `Iniciando overlay engine`
   - `[PATCHER] Initialized. Waiting for game...` o salida de `runoverlay`
5. Si falla Rose/mod-tools, revisar que el staging tenga carpetas bajo:
   - `cslol-profiles/.mkoverlay-state/mod-tools-mods`
6. Si falla LTK, revisar que `overlayPath/DATA` exista y tenga `.wad.client`.

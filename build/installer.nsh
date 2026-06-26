Var RiftAtlasDeleteUserData
Var RiftAtlasProcessCheckExit
Var RiftAtlasProcessCheckOutput

!macro RIFT_ATLAS_KILL_PROCESS EXE_NAME
  nsExec::Exec 'taskkill /IM "${EXE_NAME}" /F /T'
!macroend

!macro RIFT_ATLAS_ABORT_IF_PROCESS_RUNNING EXE_NAME
  nsExec::ExecToStack 'cmd /C tasklist /FI "IMAGENAME eq ${EXE_NAME}" /NH | find /I "${EXE_NAME}" >NUL'
  Pop $RiftAtlasProcessCheckExit
  Pop $RiftAtlasProcessCheckOutput
  StrCmp $RiftAtlasProcessCheckExit "0" 0 +3
    MessageBox MB_ICONSTOP|MB_OK "League of Legends esta abierto. Cierra League y vuelve a desinstalar Rift Atlas."
    Abort
!macroend

!macro RIFT_ATLAS_ABORT_IF_LEAGUE_RUNNING
  !insertmacro RIFT_ATLAS_ABORT_IF_PROCESS_RUNNING "LeagueClient.exe"
  !insertmacro RIFT_ATLAS_ABORT_IF_PROCESS_RUNNING "LeagueClientUx.exe"
  !insertmacro RIFT_ATLAS_ABORT_IF_PROCESS_RUNNING "LeagueClientUxRender.exe"
  !insertmacro RIFT_ATLAS_ABORT_IF_PROCESS_RUNNING "League of Legends.exe"
!macroend

!macro RIFT_ATLAS_STOP_RUNTIME
  DetailPrint "Deteniendo Rift Atlas y Pengu Loader..."
  !insertmacro RIFT_ATLAS_KILL_PROCESS "rift-atlas.exe"
  !insertmacro RIFT_ATLAS_KILL_PROCESS "Rift Atlas.exe"
  !insertmacro RIFT_ATLAS_KILL_PROCESS "Pengu Loader.exe"
  !insertmacro RIFT_ATLAS_KILL_PROCESS "PenguLoader.exe"
  !insertmacro RIFT_ATLAS_KILL_PROCESS "pengu-loader.exe"
!macroend

!macro RIFT_ATLAS_REMOVE_LEAGUE_PROXY
  DetailPrint "Desactivando Pengu Loader..."
  ClearErrors

  IfFileExists "$INSTDIR\Pengu Loader\Pengu Loader.exe" 0 +3
    nsExec::Exec '"$INSTDIR\Pengu Loader\Pengu Loader.exe" --uninstall --silent'
    Goto riftAtlasSkipPenguDeactivate

  IfFileExists "$INSTDIR\Pengu Loader\PenguLoader.exe" 0 +3
    nsExec::Exec '"$INSTDIR\Pengu Loader\PenguLoader.exe" --uninstall --silent'
    Goto riftAtlasSkipPenguDeactivate

  IfFileExists "$INSTDIR\Pengu Loader\pengu-loader.exe" 0 +3
    nsExec::Exec '"$INSTDIR\Pengu Loader\pengu-loader.exe" --uninstall --silent'
    Goto riftAtlasSkipPenguDeactivate

  riftAtlasSkipPenguDeactivate:

  DetailPrint "Limpiando d3d9.dll de League..."
  Delete "C:\Riot Games\League of Legends\Game\d3d9.dll"
  Delete "D:\Riot Games\League of Legends\Game\d3d9.dll"
  Delete "$PROGRAMFILES\Riot Games\League of Legends\Game\d3d9.dll"
  Delete "$PROGRAMFILES32\Riot Games\League of Legends\Game\d3d9.dll"

  DeleteRegValue HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\LeagueClientUx.exe" "Debugger"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro RIFT_ATLAS_STOP_RUNTIME
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro RIFT_ATLAS_ABORT_IF_LEAGUE_RUNNING
  !insertmacro RIFT_ATLAS_STOP_RUNTIME
  !insertmacro RIFT_ATLAS_REMOVE_LEAGUE_PROXY

  MessageBox MB_YESNO|MB_ICONQUESTION "Rift Atlas guarda skins, engine, cache y configuracion en:$\r$\n$LOCALAPPDATA\Rift Atlas$\r$\n$\r$\nDeseas eliminar todos esos datos?" IDYES riftAtlasDeleteData IDNO riftAtlasSkipDelete

  riftAtlasDeleteData:
    StrCpy $RiftAtlasDeleteUserData "1"
    ; Nuke directories NOW — BEFORE NSIS's default file-by-file loop runs.
    ; This turns each subsequent NSIS Delete into a fast no-op (file already gone).
    DetailPrint "Eliminando directorios rapidamente..."
    RMDir /r "$LOCALAPPDATA\Rift Atlas"
    RMDir /r "$INSTDIR"
    Goto riftAtlasDone

  riftAtlasSkipDelete:
    StrCpy $RiftAtlasDeleteUserData "0"
    DetailPrint "Se conservaran los datos de Rift Atlas."
    ; Even if user says no, clean up engine/overlays/logs inside INSTDIR
    ; but keep skins/downloads
    RMDir /r "$INSTDIR\overlays"
    RMDir /r "$INSTDIR\engine"
    Delete "$INSTDIR\*.log"

  riftAtlasDone:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Cleanup is already done in PREUNINSTALL via RMDir /r.
  ; This hook is a safety net in case any残留 dirs remain.
  ${If} $RiftAtlasDeleteUserData == "1"
    RMDir /r "$LOCALAPPDATA\Rift Atlas"
    ${If} "$INSTDIR" != "$LOCALAPPDATA\Rift Atlas"
      RMDir /r "$INSTDIR"
    ${EndIf}
  ${EndIf}
!macroend

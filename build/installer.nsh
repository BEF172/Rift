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

!macro RIFT_ATLAS_DELETE_LEGACY_INSTALL_DATA
  RMDir /r "$INSTDIR\cache"
  RMDir /r "$INSTDIR\crash-dumps"
  RMDir /r "$INSTDIR\cslol-overlay-cache"
  RMDir /r "$INSTDIR\cslol-profiles"
  RMDir /r "$INSTDIR\downloaded-libraries"
  RMDir /r "$INSTDIR\engine"
  RMDir /r "$INSTDIR\hashtable"
  RMDir /r "$INSTDIR\logs"
  RMDir /r "$INSTDIR\ltk-manager"
  RMDir /r "$INSTDIR\mod-files"
  RMDir /r "$INSTDIR\mod-staging-cache"
  RMDir /r "$INSTDIR\mods"
  RMDir /r "$INSTDIR\overlay"
  RMDir /r "$INSTDIR\overlays"
  RMDir /r "$INSTDIR\p2p"
  RMDir /r "$INSTDIR\Pengu Loader"
  RMDir /r "$INSTDIR\pengu-loader"
  RMDir /r "$INSTDIR\pengu-plugins-backup"
  RMDir /r "$INSTDIR\pending"
  RMDir /r "$INSTDIR\Rose"
  RMDir /r "$INSTDIR\updates"
  RMDir /r "$INSTDIR\webview-data"
  Delete "$INSTDIR\.first-run-complete"
  Delete "$INSTDIR\.pengu-active"
  Delete "$INSTDIR\engine-version.txt"
  Delete "$INSTDIR\last-overlay-log.txt"
  Delete "$INSTDIR\last-overlay-log.previous.txt"
  Delete "$INSTDIR\*.log"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro RIFT_ATLAS_STOP_RUNTIME
!macroend

!macro NSIS_HOOK_POSTINSTALL
  SetShellVarContext all
  CreateShortCut "$DESKTOP\Rift Atlas.lnk" "$INSTDIR\Rift Atlas.exe"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro RIFT_ATLAS_ABORT_IF_LEAGUE_RUNNING
  !insertmacro RIFT_ATLAS_STOP_RUNTIME
  !insertmacro RIFT_ATLAS_REMOVE_LEAGUE_PROXY

  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    DetailPrint "Eliminando datos de Rift Atlas..."
    RMDir /r "$LOCALAPPDATA\Rift Atlas"
    RMDir /r "$APPDATA\Rift Atlas"
    !insertmacro RIFT_ATLAS_DELETE_LEGACY_INSTALL_DATA
  ${Else}
    DetailPrint "Se conservaran los datos de Rift Atlas."
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  SetShellVarContext all
  Delete "$DESKTOP\Rift Atlas.lnk"

  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$LOCALAPPDATA\Rift Atlas"
    RMDir /r "$APPDATA\Rift Atlas"
    RMDir /r "$INSTDIR"
  ${EndIf}
!macroend

!macro customUnInstall
  IfSilent done
  MessageBox MB_YESNO|MB_ICONQUESTION "Tambien queres borrar la configuracion, skins descargadas, engine y cache de Rift Atlas en AppData?" IDNO done
  RMDir /r "$APPDATA\Rift Atlas"
  RMDir /r "$LOCALAPPDATA\Rift Atlas"
  done:
!macroend

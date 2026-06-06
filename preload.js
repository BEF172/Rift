const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("riftAtlas", {
  appName: "Rift Atlas",
  hasRiotApiKey: () => ipcRenderer.invoke("riot:has-api-key"),
  setRiotApiKey: (apiKey) => ipcRenderer.invoke("riot:set-api-key", apiKey),
  clearRiotApiKey: () => ipcRenderer.invoke("riot:clear-api-key"),
  lookupPlayer: (payload) => ipcRenderer.invoke("riot:lookup-player", payload),
  getChampionData: () => ipcRenderer.invoke("data:get-champions"),
  getTierLane: (payload) => ipcRenderer.invoke("tiers:get-lane", payload),
  getChampionBuild: (payload) => ipcRenderer.invoke("builds:get-champion", payload),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  checkUpdates: () => ipcRenderer.invoke("app:check-updates"),
  downloadUpdate: (payload) => ipcRenderer.invoke("app:download-update", payload),
  getUserDataPath: () => ipcRenderer.invoke("app:get-user-data-path"),
  getAppVersion: () => ipcRenderer.invoke("app:get-version"),
  getStartupFlags: () => ipcRenderer.invoke("app:get-startup-flags"),
  markFirstRunComplete: () => ipcRenderer.invoke("app:mark-first-run-complete"),
  tutorialLog: (payload) => ipcRenderer.send("app:tutorial-log", payload),
  onStartTutorial: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("app:start-tutorial", listener);
    return () => ipcRenderer.removeListener("app:start-tutorial", listener);
  },
  onPenguBridgeStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("pengu:bridge-status", listener);
    return () => ipcRenderer.removeListener("pengu:bridge-status", listener);
  },
  onPenguLobbyState: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("pengu:lobby-state", listener);
    return () => ipcRenderer.removeListener("pengu:lobby-state", listener);
  },
  onPenguMessage: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("pengu:message", listener);
    return () => ipcRenderer.removeListener("pengu:message", listener);
  },
  sendPenguMessage: (payload) => ipcRenderer.invoke("pengu:send-message", payload),
  openUserDataPath: () => ipcRenderer.invoke("app:open-user-data-path"),
  factoryReset: () => ipcRenderer.invoke("app:factory-reset"),
  getEngineDllStatus: () => ipcRenderer.invoke("app:get-engine-dll-status"),
  openEngineFolder: () => ipcRenderer.invoke("app:open-engine-folder"),
  selectModFolder: () => ipcRenderer.invoke("mods:select-folder"),
  selectCustomModFiles: () => ipcRenderer.invoke("mods:select-custom-mod-files"),
  selectCustomModFolder: () => ipcRenderer.invoke("mods:select-custom-mod-folder"),
  revealModPath: (filePath) => ipcRenderer.invoke("mods:reveal-path", filePath),
  selectLeagueGame: () => ipcRenderer.invoke("mods:select-league-game"),
  selectSkinLibrary: () => ipcRenderer.invoke("mods:select-skin-library"),
  indexSkinLibrary: (folderPath) => ipcRenderer.invoke("mods:index-skin-library", folderPath),
  downloadLeagueSkins: () => ipcRenderer.invoke("mods:download-league-skins"),
  getDownloadedLeagueSkinsPath: () => ipcRenderer.invoke("mods:get-downloaded-league-skins-path"),
  indexDownloadedLeagueSkins: () => ipcRenderer.invoke("mods:index-downloaded-league-skins"),
  selectLtk: () => ipcRenderer.invoke("mods:select-ltk"),
  openLtk: (executablePath) => ipcRenderer.invoke("mods:open-ltk", executablePath),
  stopOverlay: () => ipcRenderer.invoke("mods:stop-overlay"),
  overlayStatus: () => ipcRenderer.invoke("mods:overlay-status"),
  diagnoseOverlay: (payload) => ipcRenderer.invoke("mods:diagnose-overlay", payload),
  getLtkStatus: (payload) => ipcRenderer.invoke("ltk:get-status", payload),
  importLtkMods: (payload) => ipcRenderer.invoke("ltk:import-mods", payload),
  detectLtk: () => ipcRenderer.invoke("ltk:detect"),
  downloadAndInstallLtk: () => ipcRenderer.invoke("ltk:download-and-install"),
  selectBocchiSidecar: () => ipcRenderer.invoke("mods:select-bocchi-sidecar"),
  selectBocchiDll: () => ipcRenderer.invoke("mods:select-bocchi-dll"),
  autoConfigureOverlay: (payload) => ipcRenderer.invoke("mods:auto-configure-overlay", payload),
  downloadCslolTools: (payload) => ipcRenderer.invoke("mods:download-cslol-tools", payload),
  checkLeagueInstall: (payload) => ipcRenderer.invoke("mods:check-league-install", payload),
  onDownloadProgress: (handler) => ipcRenderer.on("download-progress", (_event, payload) => handler(payload)),
  getPartyFileInfo: (filePath) => ipcRenderer.invoke("party:get-file-info", filePath),
  readPartyFileChunk: (payload) => ipcRenderer.invoke("party:read-file-chunk", payload),
  writePartyFile: (payload) => ipcRenderer.invoke("party:write-file", payload),
  deletePartyFile: (filePath) => ipcRenderer.invoke("party:delete-file", filePath),
  clearPartyP2PFiles: () => ipcRenderer.invoke("party:clear-p2p-files"),
  downloadPenguLoader: () => ipcRenderer.invoke("pengu:download-loader"),
  openPenguLoaderFolder: () => ipcRenderer.invoke("pengu:open-loader-folder"),
  getPenguLoaderStatus: () => ipcRenderer.invoke("pengu:get-loader-status"),
  launchPenguLoader: () => ipcRenderer.invoke("pengu:launch-loader"),
  deactivatePenguLoader: () => ipcRenderer.invoke("pengu:deactivate-loader"),
  closePenguLoaderUi: () => ipcRenderer.invoke("pengu:close-loader-ui"),
  installRiftAtlasPenguPlugin: () => ipcRenderer.invoke("pengu:install-rift-plugin"),
  runBocchiOverlay: (payload) => ipcRenderer.invoke("mods:run-bocchi-overlay", payload)
});

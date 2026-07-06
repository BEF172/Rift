// Compatibility bridge: maps old window.riftAtlas Electron API to Tauri invoke() calls
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// ── Debug console: pipe console.log/warn/error to CMD window ──
// Override early so everything is captured. Only pipes when -debug mode is active.
(() => {
  const _origLog = console.log.bind(console);
  const _origWarn = console.warn.bind(console);
  const _origError = console.error.bind(console);
  const _origInfo = console.info.bind(console);

  function pipeToConsole(prefix, args) {
    if (!window.__riftAtlasDebug) return;
    try {
      const text = args.map(a => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" ");
      invoke("debug_print", { message: prefix + text + "\n" }).catch(() => {});
    } catch (_) {}
  }

  console.log = (...args) => { _origLog(...args); pipeToConsole("", args); };
  console.warn = (...args) => { _origWarn(...args); pipeToConsole("[WARN] ", args); };
  console.error = (...args) => { _origError(...args); pipeToConsole("[ERROR] ", args); };
  console.info = (...args) => { _origInfo(...args); pipeToConsole("[INFO] ", args); };
})();

let lastDroppedFilePaths = [];

listen("tauri://drag-drop", (event) => {
  const paths = event?.payload?.paths || event?.payload || [];
  lastDroppedFilePaths = Array.isArray(paths) ? paths.filter(Boolean) : [];
  if (lastDroppedFilePaths.length) {
    window.dispatchEvent(new CustomEvent("rift-atlas:file-drop", {
      detail: { paths: [...lastDroppedFilePaths] },
    }));
  }
}).catch(() => {});

// Helper: wraps invoke to handle missing commands gracefully
function safeInvoke(cmd, args = {}) {
  return invoke(cmd, args).catch((err) => {
    console.warn(`[bridge] ${cmd} fallo:`, err);
    // Para comandos de tipo "return value", devolvemos valor por defecto
    return null;
  });
}

// Helper: wraps invoke para comandos que devuelven booleano/flag
function safeInvokeOrDefault(cmd, args = {}, defaultVal = null) {
  return invoke(cmd, args).catch(() => defaultVal);
}

const RIFT_ATLAS_API = {
  // App
  appName: "Rift Atlas",
  windowStartDragging: () => invoke("window_start_dragging"),
  windowMinimize: () => invoke("window_minimize"),
  windowToggleMaximize: () => invoke("window_toggle_maximize"),
  windowIsMaximized: () => invoke("window_is_maximized"),
  windowHide: () => invoke("window_hide"),
  getAppVersion: () => invoke("get_app_version"),
  getUserDataPath: () => invoke("get_user_data_path"),
  openExternal: (url) => invoke("open_external", { url }),
  factoryReset: () => safeInvoke("app_factory_reset"),
  getEngineDllStatus: () => invoke("get_engine_dll_status"),
  openEngineFolder: () => invoke("open_engine_folder"),
  openUserDataPath: () => invoke("open_user_data_path"),
  getStartupFlags: () => safeInvokeOrDefault("app_get_startup_flags", {}, { firstRun: true }),
  markFirstRunComplete: () => safeInvoke("app_mark_first_run_complete"),
  bootstrapFirstRun: () => invoke("app_bootstrap_first_run"),
  getDroppedFilePaths: (files) => {
    const fromFiles = Array.from(files || [])
      .map((file) => file?.path || file?.webkitRelativePath || "")
      .filter(Boolean);
    return fromFiles.length ? fromFiles : [...lastDroppedFilePaths];
  },
  tutorialLog: (payload) => safeInvoke("app_tutorial_log", { payload: JSON.stringify(payload) }),
  onStartTutorial: (handler) => {
    const unlisten = listen("app:start-tutorial", (event) => handler(event.payload));
    return () => unlisten.then((fn) => fn());
  },
  onDebugMode: (handler) => {
    const unlisten = listen("app:debug-mode", (event) => handler(event.payload));
    return () => unlisten.then((fn) => fn());
  },

  // Data Dragon
  getChampionData: () => invoke("get_champion_data"),
  getTierLane: (payload) => invoke("get_tier_lane", { payload }),
  getChampionBuild: (champion) => invoke("get_champion_build", { champion }),
  getLcuChampionSkins: (championId) => invoke("get_lcu_champion_skins", { championId: Number(championId) || 0 }),
  getLcuOwnedSkins: () => invoke("get_lcu_owned_skins"),
  forceLcuSkinSelection: (championId, selectedSkinId) => invoke("force_lcu_skin_selection", {
    championId: Number(championId) || 0,
    selectedSkinId: Number(selectedSkinId) || 0,
  }),
  waitForLcuFinalizationThreshold: (thresholdMs) => invoke("wait_for_lcu_finalization_threshold", {
    thresholdMs: Number.isFinite(Number(thresholdMs)) ? Number(thresholdMs) : 300,
  }),
  checkChampionLock: () => invoke("check_champion_lock"),
  resolveLeagueSkinPackage: (championId, skinId, baseSkinId) => invoke("resolve_league_skin_package", {
    championId: Number(championId) || 0,
    skinId: Number(skinId) || 0,
    baseSkinId: Number(baseSkinId) || null,
  }),
  prepareSkinMod: (skinKey) => invoke("prepare_skin_mod", {
    skinKey,
  }),

  // Updates
  checkUpdates: () => invoke("check_updates"),
  downloadUpdate: (payload) => invoke("download_update", { payload }),
  onDownloadProgress: (handler) => {
    const unlisten = listen("download-progress", (event) => handler(event.payload));
    return () => unlisten.then((fn) => fn());
  },

  // Library
  readLibraryIndex: () => invoke("read_library_index"),
  writeLibraryIndex: (data) => invoke("write_library_index", { data }),
  selectPreviewImage: () => invoke("select_library_preview_image"),
  cachePreview: (payload) => safeInvoke("library_cache_preview", { payload }),

  // Maintenance
  maintenanceStatus: () => invoke("maintenance_status"),
  cleanupMaintenance: (payload = {}) =>
    invoke("cleanup_maintenance_target", { targets: payload.targets || [] }),
  exportDiagnostics: (payload = {}) => invoke("export_diagnostics", { payload }),
  openLogsFolder: () => invoke("open_logs_folder"),

  // Mods / Skins
  selectModFolder: () => invoke("select_mod_folder"),
  selectCustomModFiles: () => invoke("select_custom_mod_files"),
  selectCustomModFolder: () => invoke("select_custom_mod_folder"),
  indexCustomModFolder: (folderPath) => invoke("index_custom_mod_folder", { folderPath }),
  openUserModsFolder: () => invoke("open_user_mods_folder"),
  importModsToFolder: (files) => invoke("import_mods_to_folder", { files: files || [] }),
  indexUserModsFolder: () => invoke("index_user_mods_folder"),
  openCustomSkinModFolder: (skinId) => invoke("open_custom_skin_mod_folder", { skinId }),
  openCustomModCategoryFolder: (category) => invoke("open_custom_mod_category_folder", { category }),
  deleteUserModFile: (filePath) => invoke("delete_user_mod_file", { filePath }),
  importCustomModsToSkin: (skinId, files) =>
    invoke("import_custom_mods_to_skin", { skinId, files: files || [] }),
  importCustomModsToCategory: (category, files) =>
    invoke("import_custom_mods_to_category", { category, files: files || [] }),
  indexCustomModFiles: (files) =>
    safeInvoke("index_custom_mod_files", { files: files || [] }),
  revealModPath: (filePath) => invoke("reveal_path", { filePath }),
  selectLeagueGame: () => invoke("select_league_game"),
  detectLeaguePath: () => invoke("detect_league_path"),
  checkLeagueInstall: (payload) => invoke("check_league_install", { payload }),
  selectLtk: () => safeInvoke("mods_select_ltk"),
  openLtk: (executablePath) => safeInvoke("mods_open_ltk", { executablePath }),
  detectLtk: () => safeInvokeOrDefault("ltk_detect", {}, { installed: false }),
  getLtkStatus: (payload) => safeInvokeOrDefault("ltk_get_status", { payload }, { running: false }),
  importLtkMods: (payload) => invoke("ltk_import_mods", { payload }),
  selectBocchiSidecar: () => invoke("select_bocchi_sidecar"),
  selectBocchiDll: () => invoke("select_bocchi_dll"),
  autoConfigureOverlay: (payload) =>
    safeInvoke("mods_auto_configure_overlay", { payload }),
  downloadCslolTools: (payload) =>
    invoke("mods_download_cslol_tools", { payload }),
  downloadAndInstallLtk: () => invoke("ltk_download_and_install"),
  selectSkinLibrary: () => invoke("select_skin_library"),
  indexSkinLibrary: (folderPath) => invoke("index_skin_library", { folderPath }),
  downloadLeagueSkins: () => invoke("download_league_skins"),
  getDownloadedLeagueSkinsPath: () =>
    safeInvokeOrDefault("get_downloaded_league_skins_path", {}, ""),
  indexDownloadedLeagueSkins: () => invoke("index_downloaded_league_skins"),

  // Overlay
  stopOverlay: () => invoke("stop_overlay"),
  overlayStatus: () => invoke("overlay_status"),
  isLeagueGameRunning: (gamePath) => invoke("is_league_game_running", { gamePath: gamePath || "" }),
  diagnoseOverlay: (payload) => invoke("diagnose_overlay", { payload: payload || {} }),
  runBocchiOverlay: (payload) => invoke("run_bocchi_overlay", { payload: payload || {} }),
  runRoseOverlay: (payload) => invoke("run_rose_overlay_v2", { payload: payload || {} }),
  buildBaseOverlay: (payload) => invoke("build_base_overlay", { payload: payload || {} }),
  startEarlyMonitor: (gamePath) => invoke("start_early_monitor", { gamePath: gamePath || "" }),
  stopEarlyMonitor: () => invoke("stop_early_monitor"),
  suspendLeagueGame: (gamePath) => invoke("suspend_league_game", { gamePath: gamePath || "" }),
  resumeLeagueGame: () => invoke("resume_league_game"),
  appendOverlayLog: (message) => { console.log(String(message)); return invoke("append_overlay_log", { message: String(message) }); },

  // Party
  getPartyFileInfo: (filePath) => safeInvoke("party_get_file_info", { filePath }),
  readPartyFileChunk: (payload) => safeInvoke("party_read_file_chunk", { payload }),
  writePartyFile: (payload) => safeInvoke("party_write_file", { payload }),
  deletePartyFile: (filePath) => safeInvoke("party_delete_file", { filePath }),
  clearPartyP2PFiles: () => safeInvoke("party_clear_p2p_files"),

  // Pengu Loader
  downloadPenguLoader: () => invoke("pengu_download_loader"),
  openPenguLoaderFolder: () => invoke("pengu_open_loader_folder"),
  getPenguLoaderStatus: () =>
    safeInvokeOrDefault("pengu_get_loader_status", {}, { installed: false }),
  launchPenguLoader: () => invoke("pengu_launch_loader"),
  deactivatePenguLoader: () => invoke("pengu_deactivate_loader"),
  uninstallPenguLoader: () => invoke("pengu_uninstall_loader"),
  closePenguLoaderUi: () => safeInvoke("pengu_close_loader_ui"),
  installRiftAtlasPenguPlugin: () => invoke("pengu_install_rift_plugin"),
  sendPenguMessage: (payload) => invoke("send_pengu_message", { payload: payload || {} }),

  // Events
  onPenguBridgeStatus: (handler) => {
    const unlisten = listen("pengu:bridge-status", (event) => handler(event.payload));
    return () => unlisten.then((fn) => fn());
  },
  onPenguLobbyState: (handler) => {
    const unlisten = listen("pengu:lobby-state", (event) => handler(event.payload));
    return () => unlisten.then((fn) => fn());
  },
  onPenguMessage: (handler) => {
    const unlisten = listen("pengu:message", (event) => handler(event.payload));
    return () => unlisten.then((fn) => fn());
  },
  onUiCommand: (handler) => {
    const unlisten = listen("ui:command", (event) => handler(event.payload));
    return () => unlisten.then((fn) => fn());
  },
  onPatcherDied: (handler) => {
    const unlisten = listen("patcher-died", (event) => handler(event.payload));
    return () => unlisten.then((fn) => fn());
  },

  // Window maximize state
  onWindowMaximizeChange: (handler) => {
    const unlisten = listen("app:window-maximize-changed", (event) => handler(event.payload));
    return () => unlisten.then((fn) => fn());
  },
  onLeagueDetected: (handler) => {
    const unlisten = listen("app:league-detected", (event) => handler(event.payload));
    return () => unlisten.then((fn) => fn());
  },

  // Skin index store
  readSkinIndexStore: () => invoke("read_library_index"),
  writeSkinIndexStore: (data) => invoke("write_library_index", { data }),

  // Multi-mod storage
  modStorageListCategories: () => safeInvokeOrDefault("mod_storage_list_categories", {}, { categories: [] }),
  modStorageListMods: (category) => safeInvokeOrDefault("mod_storage_list_mods", { category }, { mods: [] }),
  modStorageImportMod: (sourcePath, category) => invoke("mod_storage_import_mod", { sourcePath, category }),
  modStorageRemoveMod: (category, modId) => invoke("mod_storage_remove_mod", { category, modId }),
  modStorageSelectMod: (category, modId, modPath, modName) => invoke("mod_storage_select_mod", { category, modId, modPath, modName }),
  modStorageDeselectMod: (category) => invoke("mod_storage_deselect_mod", { category }),
  modStorageGetSelectedMods: () => safeInvokeOrDefault("mod_storage_get_selected_mods", {}, { selectedMods: {} }),
  selectModFile: () => invoke("select_mod_file"),

  // ThresholdManager — configurable injection cooldown
  loadInjectionThreshold: () => invoke("load_injection_threshold"),
  saveInjectionThreshold: (value) => invoke("save_injection_threshold", {
    value: Number.isFinite(Number(value)) ? Number(value) : 0.3,
  }),

  // BaseSkinTracker — PATCH→confirmation latency tracking
  startBaseSkinTracking: (skinId) => invoke("start_base_skin_tracking", { skinId: Number(skinId) || 0 }),
  onBaseSkinConfirmed: (skinId) => invoke("on_base_skin_confirmed", { skinId: Number(skinId) || 0 }),
  onChampSelectExit: () => invoke("on_champ_select_exit"),
  getBaseSkinTrackerStats: () => invoke("get_base_skin_tracker_stats"),
  clearBaseSkinTrackerSamples: () => invoke("clear_base_skin_tracker_samples"),
};

// Expose as global API (same name as old preload)
window.riftAtlas = RIFT_ATLAS_API;

const state = {
  version: "",
  champions: [],
  selectedId: "",
  role: "all",
  lane: "top",
  query: "",
  buildChampionId: localStorage.getItem("riftAtlas:buildChampionId") || "",
  buildSource: localStorage.getItem("riftAtlas:buildSource") || "metasrc",
  buildRegion: localStorage.getItem("riftAtlas:buildRegion") || "",
  buildUrl: "",
  tiersByLane: {},
  skinLibrary: [],
  customMods: JSON.parse(localStorage.getItem("riftAtlas:customMods") || "[]"),
  skinQuery: "",
  skinChampion: "all",
  skinType: "all",
  skinState: "all",
  skinVisibleCount: 15,
  groupSkinsByChampion: localStorage.getItem("riftAtlas:groupSkinsByChampion") === "1",
  libraryIndex: { skins: [], profiles: [], metadata: {}, indexPath: "" },
  skinMetadata: JSON.parse(localStorage.getItem("riftAtlas:skinMetadata") || "{}"),
  selectedSkinKey: "",
  favoriteSkins: new Set(JSON.parse(localStorage.getItem("riftAtlas:favoriteSkins") || "[]")),
  overlayHistory: JSON.parse(localStorage.getItem("riftAtlas:overlayHistory") || "[]"),
  managedSkins: new Set(JSON.parse(localStorage.getItem("riftAtlas:managedSkins") || "[]")),
  queuedSkins: new Set(JSON.parse(localStorage.getItem("riftAtlas:queuedSkins") || "[]")),
  presets: JSON.parse(localStorage.getItem("riftAtlas:presets") || "[]"),
  activePresetId: localStorage.getItem("riftAtlas:activePresetId") || "",
  leagueGamePath: localStorage.getItem("riftAtlas:leagueGamePath") || "",
  ltkPath: localStorage.getItem("riftAtlas:ltkPath") || "",
  skinLibraryPath: localStorage.getItem("riftAtlas:skinLibraryPath") || "",
  importingSkinPath: "",
  importingQueue: false,
  activeDownloadType: "",
  availableUpdate: null,
  overlayRunning: false,
  overlayProfilePath: "",
  overlayActiveMessage: "",
  partyRoom: null,
  partyLink: "",
  partyStatus: "disconnected",
  selectedPartyFile: null,
  penguBridgeConnected: false,
  penguLobby: null,
  penguGameflowPhase: "",
  penguHadInGamePhase: false,
  penguSessionActive: false,
  penguChampionLocked: false,
  penguSessionQueuedSkins: new Set(),
  penguOwnedSkinIds: new Set(),
  penguOwnedSkinsReady: false,
  penguAutoParty: localStorage.getItem("riftAtlas:penguAutoParty") !== "0",
  penguAutoPartyRoom: "",
  favorites: new Set(JSON.parse(localStorage.getItem("riftAtlas:favorites") || "[]")),
  ltkOverlaySidecarPath: localStorage.getItem("riftAtlas:ltkOverlaySidecarPath") || "",
  ltkOverlayDllPath: localStorage.getItem("riftAtlas:ltkOverlayDllPath") || "",
  engineBinaryName: localStorage.getItem("riftAtlas:engineBinaryName") || "mod-tools.exe",
  customOverlayPath: "",
  customOverlayKeys: [],
  customOverlayTimer: null,
  autoRunCustomOverlaySignature: "",
  preflightAcceptedOnce: false,
  roseEarlyMonitorStarted: false,
  roseFinalizationTimer: null,
  roseFinalizationDeadline: 0,
  roseFinalizationSignature: "",
  roseFinalizationApplyStarted: false,
  roseFinalizationCommitted: false,
  loadoutCountdownActive: false,
  loadoutT0: 0,
  loadoutLeft0Ms: 0,
  lastRemainMs: 0,
  lastHoverWritten: false,
  tickerSeq: 0,
  currentTicker: 0,
  skinWriteMs: 500,
  penguApplyLockedKey: "",
  penguApplyLockedAt: 0,
  lastRoseInjectionTime: 0,
  injectionInProgress: false,
  penguProcessingLocked: false,
  selectedCustomMod: null,
  lastLockedChampionId: 0,
};

const lcuChampionSkinCache = new Map(); // championId -> Map(full skin/chroma ID -> localized name)
const PENGU_CATALOG_FORCE_REASONS = new Set([
  "bridge-connected",
  "client-request",
  "library-updated",
  "custom-mods-updated",
  "metadata-updated",
  "champions-loaded",
  "skin-selected-in-client",
  "skin-applied"
]);
let lastPenguCatalogSignature = "";
let lastOverlayStatusSignature = "";
let lastPenguOwnedSkinCount = -1;
let lastPenguSkinStateSignature = "";
let lastPenguSkinStateAt = 0;
let lastPenguChromaRequestSignature = "";
let lastPenguSyncLogSignature = "";
let lastPenguSyncLogAt = 0;

const els = {
  mainContent: document.querySelector(".main-content"),
  sidebar: document.querySelector(".sidebar"),
  titlebar: document.querySelector(".app-titlebar"),
  windowMinimizeButton: document.querySelector("#windowMinimizeButton"),
  windowMaximizeButton: document.querySelector("#windowMaximizeButton"),
  windowCloseButton: document.querySelector("#windowCloseButton"),
  championToolbar: document.querySelector("#championToolbar"),
  patchLabel: document.querySelector("#patchLabel"),
  championGrid: document.querySelector("#championGrid"),
  championDetail: document.querySelector("#championDetail"),
  tierGrid: document.querySelector("#tierGrid"),
  tierMeta: document.querySelector("#tierMeta"),
  refreshTiersButton: document.querySelector("#refreshTiersButton"),
  searchInput: document.querySelector("#searchInput"),
  countLabel: document.querySelector("#countLabel"),
  buildSearchForm: document.querySelector("#buildSearchForm"),
  buildChampionInput: document.querySelector("#buildChampionInput"),
  buildChampionList: document.querySelector("#buildChampionList"),
  buildSourceSelect: document.querySelector("#buildSourceSelect"),
  buildRegionSelect: document.querySelector("#buildRegionSelect"),
  buildStatusLabel: document.querySelector("#buildStatusLabel"),
  buildSelectedSource: document.querySelector("#buildSelectedSource"),
  buildSelectedTitle: document.querySelector("#buildSelectedTitle"),
  buildSelectedDescription: document.querySelector("#buildSelectedDescription"),
  buildSelectedUrl: document.querySelector("#buildSelectedUrl"),
  openBuildExternalButton: document.querySelector("#openBuildExternalButton"),
  openBuildExternalButtonInline: document.querySelector("#openBuildExternalButtonInline"),
  selectModsFolderButton: document.querySelector("#selectModsFolderButton"),
  modsFolderLabel: document.querySelector("#modsFolderLabel"),
  modsPackageList: document.querySelector("#modsPackageList"),
  leagueGamePathLabel: document.querySelector("#leagueGamePathLabel"),
  detectLeaguePathButton: document.querySelector("#detectLeaguePathButton"),
  selectLeagueGameButton: document.querySelector("#selectLeagueGameButton"),
  importStatusLabel: document.querySelector("#importStatusLabel"),
  configStatusLabel: document.querySelector("#configStatusLabel"),
  downloadCslolButton: document.querySelector("#downloadCslolButton"),
  autoConfigureButton: document.querySelector("#autoConfigureButton"),
  runDiagnosticsButton: document.querySelector("#runDiagnosticsButton"),
  diagnosticSummary: document.querySelector("#diagnosticSummary"),
  diagnosticsList: document.querySelector("#diagnosticsList"),
  checkLeagueInstallButton: document.querySelector("#checkLeagueInstallButton"),
  leagueCheckSummary: document.querySelector("#leagueCheckSummary"),
  leagueCheckDetails: document.querySelector("#leagueCheckDetails"),
  leagueCheckList: document.querySelector("#leagueCheckList"),
  updatePanel: document.querySelector("#updatePanel"),
  updateStatusLabel: document.querySelector("#updateStatusLabel"),
  updateDetailsLabel: document.querySelector("#updateDetailsLabel"),
  updateHideLabel: document.querySelector("#updateHideLabel"),
  updateHideCheckbox: document.querySelector("#updateHideCheckbox"),
  updateDownloadButton: document.querySelector("#updateDownloadButton"),
  updateDismissButton: document.querySelector("#updateDismissButton"),
  checkUpdatesButton: document.querySelector("#checkUpdatesButton"),
  ltkOverlaySidecarLabel: document.querySelector("#ltkOverlaySidecarLabel"),
  engineBinarySelector: document.querySelector("#engineBinarySelector"),
  engineModeButtons: [...document.querySelectorAll(".engine-mode-option")],
  ltkOverlayDllLabel: document.querySelector("#ltkOverlayDllLabel"),
  appDataPathLabel: document.querySelector("#appDataPathLabel"),
  openAppDataFolderButton: document.querySelector("#openAppDataFolderButton"),
  factoryResetButton: document.querySelector("#factoryResetButton"),
  injectionThresholdSlider: document.querySelector("#injectionThresholdSlider"),
  injectionThresholdLabel: document.querySelector("#injectionThresholdLabel"),
  injectionThresholdHint: document.querySelector("#injectionThresholdHint"),
  saveThresholdButton: document.querySelector("#saveThresholdButton"),
  baseSkinStatsLabel: document.querySelector("#baseSkinStatsLabel"),
  baseSkinStatsHint: document.querySelector("#baseSkinStatsHint"),
  baseSkinStatsDetails: document.querySelector("#baseSkinStatsDetails"),
  statTotalSamples: document.querySelector("#statTotalSamples"),
  statConfirmed: document.querySelector("#statConfirmed"),
  statTimeouts: document.querySelector("#statTimeouts"),
  statAvg: document.querySelector("#statAvg"),
  statP90: document.querySelector("#statP90"),
  statMax: document.querySelector("#statMax"),
  statRecommended: document.querySelector("#statRecommended"),
  refreshStatsButton: document.querySelector("#refreshStatsButton"),
  clearStatsButton: document.querySelector("#clearStatsButton"),
  selectLtkOverlaySidecarButton: document.querySelector("#selectLtkOverlaySidecarButton"),
  selectLtkOverlayDllButton: document.querySelector("#selectLtkOverlayDllButton"),
  overlayStatusIndicator: document.querySelector("#overlayStatusIndicator"),
  overlayStatusLabel: document.querySelector("#overlayStatusLabel"),
  skinsOverlayStatusIndicator: document.querySelector("#skinsOverlayStatusIndicator"),
  skinsOverlayStatusLabel: document.querySelector("#skinsOverlayStatusLabel"),
  skinsOverlayStatusMessage: document.querySelector("#skinsOverlayStatusMessage"),
  stopOverlayButton: document.querySelector("#stopOverlayButton"),
  overlayLaunchPenguButton: document.querySelector("#overlayLaunchPenguButton"),
  overlayDeactivatePenguButton: document.querySelector("#overlayDeactivatePenguButton"),
  overlayPenguStatusLabel: document.querySelector("#overlayPenguStatusLabel"),
  partyStatusPill: document.querySelector("#partyStatusPill"),
  partyNameInput: document.querySelector("#partyNameInput"),
  partyLinkInput: document.querySelector("#partyLinkInput"),
  createPartyButton: document.querySelector("#createPartyButton"),
  joinPartyButton: document.querySelector("#joinPartyButton"),
  leavePartyButton: document.querySelector("#leavePartyButton"),
  partyConnectionLabel: document.querySelector("#partyConnectionLabel"),
  partyFilesLabel: document.querySelector("#partyFilesLabel"),
  partyReadySummary: document.querySelector("#partyReadySummary"),
  partyReadyDetails: document.querySelector("#partyReadyDetails"),
  partyTransferList: document.querySelector("#partyTransferList"),
  penguBridgeLabel: document.querySelector("#penguBridgeLabel"),
  penguLobbyLabel: document.querySelector("#penguLobbyLabel"),
  penguAutoPartyCheckbox: document.querySelector("#penguAutoPartyCheckbox"),
  partyShareLinkLabel: document.querySelector("#partyShareLinkLabel"),
  copyPartyLinkButton: document.querySelector("#copyPartyLinkButton"),
  partyMembersList: document.querySelector("#partyMembersList"),
  partyFileProfile: document.querySelector("#partyFileProfile"),
  presetNameInput: document.querySelector("#presetNameInput"),
  presetIconInput: document.querySelector("#presetIconInput"),
  presetColorInput: document.querySelector("#presetColorInput"),
  createPresetButton: document.querySelector("#createPresetButton"),
  presetSelect: document.querySelector("#presetSelect"),
  presetStatusLabel: document.querySelector("#presetStatusLabel"),
  saveQueuePresetButton: document.querySelector("#saveQueuePresetButton"),
  loadPresetQueueButton: document.querySelector("#loadPresetQueueButton"),
  togglePresetAutoApplyButton: document.querySelector("#togglePresetAutoApplyButton"),
  deletePresetButton: document.querySelector("#deletePresetButton"),
  presetList: document.querySelector("#presetList"),
  downloadEngineButton: document.querySelector("#downloadEngineButton"),
  downloadLeagueSkinsButtonDownload: document.querySelector("#downloadLeagueSkinsButtonDownload"),
  downloadPenguLoaderButton: document.querySelector("#downloadPenguLoaderButton"),
  launchPenguLoaderButton: document.querySelector("#launchPenguLoaderButton"),
  uninstallPenguLoaderButton: document.querySelector("#uninstallPenguLoaderButton"),
  openEngineFolderButton: document.querySelector("#openEngineFolderButton"),
  openDllFolderButton: document.querySelector("#openDllFolderButton"),
  openLeagueSkinsFolderButton: document.querySelector("#openLeagueSkinsFolderButton"),
  openPenguLoaderFolderButton: document.querySelector("#openPenguLoaderFolderButton"),
  downloadProgressLabel: document.querySelector("#downloadProgressLabel"),
  downloadEnginePathLabel: document.querySelector("#downloadEnginePathLabel"),
  downloadLeaguePathLabel: document.querySelector("#downloadLeaguePathLabel"),
  downloadSkinLibraryLabel: document.querySelector("#downloadSkinLibraryLabel"),
  downloadPenguLoaderLabel: document.querySelector("#downloadPenguLoaderLabel"),
  firstDllModal: document.querySelector("#firstDllModal"),
  firstDllPathLabel: document.querySelector("#firstDllPathLabel"),
  firstDllOpenFolderButton: document.querySelector("#firstDllOpenFolderButton"),
  firstDllDoneButton: document.querySelector("#firstDllDoneButton"),
  firstDllLaterButton: document.querySelector("#firstDllLaterButton"),
  engineChoiceModal: document.querySelector("#engineChoiceModal"),
  chooseLtkManagerButton: document.querySelector("#chooseLtkManagerButton"),
  chooseModToolsButton: document.querySelector("#chooseModToolsButton"),
  cancelEngineChoiceButton: document.querySelector("#cancelEngineChoiceButton"),
  selectSkinLibraryButton: document.querySelector("#selectSkinLibraryButton"),
  openModsFolderButton: document.querySelector("#openModsFolderButton"),
  modDropZone: document.querySelector("#modDropZone"),
  libraryIndexStatus: document.querySelector("#libraryIndexStatus"),
  groupSkinsCheckbox: document.querySelector("#groupSkinsCheckbox"),
  customModsLabel: document.querySelector("#customModsLabel"),
  customModsList: document.querySelector("#customModsList"),
  skinsP2PSection: document.querySelector("#skinsP2PSection"),
  skinsP2PLabel: document.querySelector("#skinsP2PLabel"),
  skinsP2PList: document.querySelector("#skinsP2PList"),
  skinsP2PSyncButton: document.querySelector("#skinsP2PSyncButton"),
  managedSkinsCount: document.querySelector("#managedSkinsCount"),
  queuedSkinsCount: document.querySelector("#queuedSkinsCount"),
  clearQueueButton: document.querySelector("#clearQueueButton"),
  selectionTraySummary: document.querySelector("#selectionTraySummary"),
  selectionTrayList: document.querySelector("#selectionTrayList"),
  selectionActionBar: document.querySelector("#selectionActionBar"),
  bottomSelectedCount: document.querySelector("#bottomSelectedCount"),
  bottomSelectedHint: document.querySelector("#bottomSelectedHint"),
  bottomSelectionList: document.querySelector("#bottomSelectionList"),
  bottomClearButton: document.querySelector("#bottomClearButton"),
  bottomSavePresetButton: document.querySelector("#bottomSavePresetButton"),
  bottomStopOverlayButton: document.querySelector("#bottomStopOverlayButton"),
  overlayHistoryList: document.querySelector("#overlayHistoryList"),
  clearOverlayHistoryButton: document.querySelector("#clearOverlayHistoryButton"),
  bottomApplyButton: document.querySelector("#bottomApplyButton"),
  baseOverlayStatusLabel: document.querySelector("#baseOverlayStatusLabel"),
  rebuildBaseOverlayButton: document.querySelector("#rebuildBaseOverlayButton"),
  skinMetadataModal: document.querySelector("#skinMetadataModal"),
  skinMetadataForm: document.querySelector("#skinMetadataForm"),
  metadataSkinKeyInput: document.querySelector("#metadataSkinKeyInput"),
  metadataNameInput: document.querySelector("#metadataNameInput"),
  metadataChampionInput: document.querySelector("#metadataChampionInput"),
  metadataBaseInput: document.querySelector("#metadataBaseInput"),
  metadataAuthorInput: document.querySelector("#metadataAuthorInput"),
  metadataVersionInput: document.querySelector("#metadataVersionInput"),
  metadataPreviewInput: document.querySelector("#metadataPreviewInput"),
  chooseMetadataPreviewButton: document.querySelector("#chooseMetadataPreviewButton"),
  regenerateMetadataPreviewButton: document.querySelector("#regenerateMetadataPreviewButton"),
  cancelMetadataButton: document.querySelector("#cancelMetadataButton"),
  preflightModal: document.querySelector("#preflightModal"),
  preflightSummary: document.querySelector("#preflightSummary"),
  preflightList: document.querySelector("#preflightList"),
  cancelPreflightButton: document.querySelector("#cancelPreflightButton"),
  confirmPreflightButton: document.querySelector("#confirmPreflightButton"),
  maintenanceList: document.querySelector("#maintenanceList"),
  refreshMaintenanceButton: document.querySelector("#refreshMaintenanceButton"),
  cleanupOverlayCacheButton: document.querySelector("#cleanupOverlayCacheButton"),
  cleanupPreviewCacheButton: document.querySelector("#cleanupPreviewCacheButton"),
  cleanupPartyCacheButton: document.querySelector("#cleanupPartyCacheButton"),
  cleanupDownloadsButton: document.querySelector("#cleanupDownloadsButton"),
  openLogsFolderButton: document.querySelector("#openLogsFolderButton"),
  exportDiagnosticsButton: document.querySelector("#exportDiagnosticsButton")
};

const template = document.querySelector("#championCardTemplate");
const CDN = "https://ddragon.leagueoflegends.com";
const SKIN_PAGE_SIZE = 15;
const skinArtFallbackCache = new Map();
const ROLE_LABELS = {
  top: "Top",
  jungle: "Jungla",
  middle: "Mid",
  bottom: "ADC",
  support: "Support"
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const stopButtonEvent = (event) => {
  event.preventDefault();
  event.stopPropagation();
};

const sendPenguDebugMode = (enabled = false, source = "startup") => {
  window.riftAtlas.sendPenguMessage?.({
    type: "debug-mode",
    enabled: Boolean(enabled),
    source
  }).catch(() => null);
};

const setAppDebugMode = (enabled = false, source = "startup") => {
  const active = Boolean(enabled);
  window.__riftAtlasDebug = active;
  localStorage.setItem("riftAtlas:debugMode", active ? "1" : "0");
  sendPenguDebugMode(active, source);
  if (active) {
    window.riftAtlas.appendOverlayLog?.("[Debug] Modo debug activo por parametro -debug.").catch(() => { });
  }
};

const cleanText = (value = "") =>
  value
    .replace(/<[^>]+>/g, "")
    .replace(/{{.*?}}/g, "")
    .replace(/\s+/g, " ")
    .trim();

const fetchJsonWithTimeout = async (url, options = {}, timeoutMs = 20000) => {
  if (typeof options === "number") {
    timeoutMs = options;
    options = {};
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const getChampionByNumericId = (championId) => state.champions.find((champion) => Number(champion.key) === Number(championId));

const formatDate = (timestamp) =>
  new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(timestamp));

const normalizeChampionName = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const getChampionByDatasetName = (name) => {
  const normalizedName = normalizeChampionName(name);
  return state.champions.find((champion) => normalizeChampionName(champion.name) === normalizedName || normalizeChampionName(champion.id) === normalizedName);
};

const getChampionByTextHint = (...parts) => {
  const rawText = parts.filter(Boolean).map((part) => String(part)).join(" ");
  if (!rawText.trim()) return null;

  const compactText = normalizeChampionName(rawText);
  const tokens = new Set(
    rawText
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map(normalizeChampionName)
      .filter(Boolean)
  );

  return state.champions
    .slice()
    .sort((left, right) => normalizeChampionName(right.name).length - normalizeChampionName(left.name).length)
    .find((champion) => {
      const aliases = [champion.name, champion.id].map(normalizeChampionName).filter(Boolean);
      return aliases.some((alias) => {
        if (alias.length <= 2) return tokens.has(alias);
        return tokens.has(alias) || compactText.includes(alias);
      });
    }) || null;
};

const getChampionByTargetWads = (skin = {}) => {
  const targetWads = [
    ...(Array.isArray(skin.targetWads) ? skin.targetWads : []),
    ...(Array.isArray(skin.archiveInfo?.targetWads) ? skin.archiveInfo.targetWads : [])
  ];
  for (const wadName of targetWads) {
    const baseName = String(wadName || "")
      .replace(/\.wad(?:\.client)?$/i, "")
      .trim();
    if (!baseName) continue;
    const champion = getChampionByNumericId(baseName) || getChampionByDatasetName(baseName) || getChampionByTextHint(baseName);
    if (champion) return champion;
  }
  return null;
};

const getSkinChampionFromHints = (skin = {}) =>
  getChampionByNumericId(skin.rawChampion) ||
  getChampionByTargetWads(skin) ||
  getChampionByDatasetName(skin.champion) ||
  getChampionByTextHint(
    skin.champion,
    skin.rawChampion,
    skin.name,
    skin.skin,
    skin.metaName,
    skin.variant,
    skin.relativePath,
    skin.path
  );

const METASRC_SLUG_OVERRIDES = {
  MonkeyKing: "wukong"
};

const getMetaSrcSlug = (champion) => METASRC_SLUG_OVERRIDES[champion.id] || normalizeChampionName(champion.name);

const getOpGgSlug = (champion) => normalizeChampionName(champion.id);

const getBuildChampion = () =>
  state.champions.find((champion) => champion.id === state.buildChampionId) ||
  getChampionByDatasetName(state.buildChampionId) ||
  state.champions[0];

const getBuildUrl = (champion = getBuildChampion()) => {
  if (!champion) return state.buildSource === "opgg" ? "https://op.gg/lol/champions" : "https://www.metasrc.com/lol/build";
  if (state.buildSource === "opgg") {
    return `https://op.gg/lol/champions/${getOpGgSlug(champion)}/build`;
  }
  const regionPart = state.buildRegion ? `/${state.buildRegion}` : "";
  return `https://www.metasrc.com/lol${regionPart}/build/${getMetaSrcSlug(champion)}`;
};

const getBuildSourceLabel = () => (state.buildSource === "opgg" ? "OP.GG" : "MetaSRC");

const renderBuildChampionOptions = () => {
  if (!els.buildChampionList) return;
  els.buildChampionList.innerHTML = state.champions
    .map((champion) => `<option value="${escapeHtml(champion.name)}"></option>`)
    .join("");
};

const updateBuildView = () => {
  if (!els.buildChampionInput) return;
  const champion = getBuildChampion();
  if (!champion) return;

  state.buildChampionId = champion.id;
  localStorage.setItem("riftAtlas:buildChampionId", state.buildChampionId);
  localStorage.setItem("riftAtlas:buildSource", state.buildSource);
  localStorage.setItem("riftAtlas:buildRegion", state.buildRegion);
  state.buildUrl = getBuildUrl(champion);

  if (els.buildChampionInput) els.buildChampionInput.value = champion.name;
  if (els.buildSourceSelect) els.buildSourceSelect.value = state.buildSource;
  if (els.buildRegionSelect) {
    els.buildRegionSelect.value = state.buildRegion;
    els.buildRegionSelect.disabled = state.buildSource === "opgg";
  }
  if (els.buildStatusLabel) {
    els.buildStatusLabel.textContent = `Build de ${champion.name} lista para abrir en ${getBuildSourceLabel()}.`;
  }
  if (els.buildSelectedSource) {
    els.buildSelectedSource.textContent = getBuildSourceLabel();
  }
  if (els.buildSelectedTitle) {
    const scope = state.buildSource === "opgg" ? "OP.GG" : state.buildRegion ? state.buildRegion.toUpperCase() : "Global";
    els.buildSelectedTitle.textContent = `${champion.name} ${scope}`;
  }
  if (els.buildSelectedDescription) {
    els.buildSelectedDescription.textContent =
      state.buildSource === "opgg"
        ? "OP.GG se abre en tu navegador con builds, runas, counters y objetos del campeon elegido."
        : "MetaSRC se abre en tu navegador con builds, runas, items y orden de habilidades del campeon elegido.";
  }
  if (els.buildSelectedUrl) {
    els.buildSelectedUrl.textContent = state.buildUrl;
  }
};

const getChampionByTierRow = (row) => {
  if (row.championId) {
    const champion = getChampionByNumericId(row.championId);
    if (champion) return champion;
  }
  return getChampionByDatasetName(row.champion);
};

const getTierClass = (tier = "") => `tier-${String(tier).toLowerCase().replace("+", "plus").replace(/[^a-z0-9]/g, "")}`;

const getChampionIconByKey = (championKey, fallbackName) => {
  const champion = getChampionByNumericId(championKey) || getChampionByDatasetName(fallbackName);
  return champion ? `${CDN}/cdn/${state.version}/img/champion/${champion.image.full}` : "";
};

const getSkinChampionId = (skin) => {
  if (skin.championKey && !/^\d+$/.test(String(skin.championKey))) return skin.championKey;
  return getSkinChampionFromHints(skin)?.id || "";
};

const getSkinLoadingImage = (skin) => {
  if (skin.previewUrl) return skin.previewUrl;
  if (skin.imageUrl) return skin.imageUrl;
  if (Object.prototype.hasOwnProperty.call(skin || {}, "localPreviewPath")) return "";
  const championId = getSkinChampionId(skin);
  if (!championId) return "";
  const artNum = skin.imageSkinNum ?? skin.skinNum;
  if (artNum === null || artNum === undefined || artNum === "") return "";
  const skinNum = Number(artNum);
  if (!Number.isFinite(skinNum)) return "";
  return `${CDN}/cdn/img/champion/loading/${championId}_${skinNum}.jpg`;
};

const getSkinDefaultLoadingImage = (skin) => {
  const championId = getSkinChampionId(skin);
  return championId ? `${CDN}/cdn/img/champion/loading/${championId}_0.jpg` : "";
};

const getSkinDefaultSplashImage = (skin) => {
  const championId = getSkinChampionId(skin);
  return championId ? `${CDN}/cdn/img/champion/splash/${championId}_0.jpg` : "";
};

const getSkinBaseLoadingImage = (skin) => {
  if (Object.prototype.hasOwnProperty.call(skin || {}, "localPreviewPath")) return "";
  const championId = getSkinChampionId(skin);
  const baseNum = skin.baseImageSkinNum ?? skin.imageSkinNum;
  if (!championId || baseNum === null || baseNum === undefined || baseNum === "") return "";
  const skinNum = Number(baseNum);
  return Number.isFinite(skinNum) ? `${CDN}/cdn/img/champion/loading/${championId}_${skinNum}.jpg` : "";
};

const formatBytes = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDownloadProgress = (payload = {}) => {
  const downloaded = Number(payload.downloaded) || 0;
  const total = Number(payload.total) || 0;
  const percent = payload.percent ?? (total ? Math.round((downloaded / total) * 100) : null);

  if (downloaded && !total) {
    return ` ${formatBytes(downloaded)} descargados`;
  }
  if (percent != null && total) {
    return ` ${percent}% (${formatBytes(downloaded)} / ${formatBytes(total)})`;
  }
  if (percent != null) {
    return ` ${percent}%`;
  }
  if (downloaded) {
    return ` ${formatBytes(downloaded)} descargados`;
  }
  return "";
};

const saveFavorites = () => {
  localStorage.setItem("riftAtlas:favorites", JSON.stringify([...state.favorites]));
  renderFavorites();
};

const saveManagedSkins = () => {
  localStorage.setItem("riftAtlas:managedSkins", JSON.stringify([...state.managedSkins]));
  persistLibraryIndex();
  renderSkinLibrary();
};

const saveQueuedSkins = () => {
  const normalizedKeys = normalizeQueuedSkinKeys([...state.queuedSkins]);
  const currentKeys = [...state.queuedSkins];
  const queueChanged = normalizedKeys.length !== currentKeys.length ||
    normalizedKeys.some((key, index) => key !== currentKeys[index]);
  if (queueChanged) {
    state.queuedSkins = new Set(normalizedKeys);
  }
  state.autoRunCustomOverlaySignature = "";
  state.customOverlayPath = "";
  state.customOverlayKeys = [];
  localStorage.setItem("riftAtlas:queuedSkins", JSON.stringify([...state.queuedSkins]));
  // Update only the queue counters and status, not the entire library
  if (els.queuedSkinsCount) els.queuedSkinsCount.textContent = `${state.queuedSkins.size} seleccionadas`;
  if (els.clearQueueButton) {
    const hasActiveP2P = [...state.queuedSkins].some(isActivePartyP2PPath);
    els.clearQueueButton.textContent = hasActiveP2P ? "Limpiar no P2P" : "Limpiar todo";
    els.clearQueueButton.disabled = state.queuedSkins.size === 0 || state.importingQueue;
  }
  // Update queued styling on skin rows
  els.skinLibraryList?.querySelectorAll(".skin-row").forEach((row) => {
    const key = row.dataset.path;
    const queued = state.queuedSkins.has(key);
    row.classList.toggle("queued", queued);
    const queueButton = row.querySelector(".skin-queue");
    if (queueButton) {
      queueButton.classList.toggle("secondary-button", queued);
      queueButton.classList.toggle("docs-link", !queued);
      queueButton.textContent = queued ? "Quitar" : "Seleccionar";
    }
  });
  updateCustomModsQueueState();
  renderPresets();
  renderCompactLauncher();
  renderSelectionTray();
  renderBaseOverlayStatus();
  persistLibraryIndex();
  if (state.partyStatus === "connected") renderParty();
  schedulePartySync();
  sendPenguSkinCatalog("queue-updated");
};

const saveFavoriteSkins = () => {
  localStorage.setItem("riftAtlas:favoriteSkins", JSON.stringify([...state.favoriteSkins]));
  persistLibraryIndex();
  renderSkinLibrary();
};

const saveOverlayHistory = () => {
  localStorage.setItem("riftAtlas:overlayHistory", JSON.stringify(state.overlayHistory.slice(0, 12)));
  persistLibraryIndex();
  renderOverlayHistory();
};

const setConfigStatus = (message) => {
  if (els.configStatusLabel) {
    els.configStatusLabel.textContent = message;
  }
};

const formatSkinCount = (count = 0) => `${count} ${count === 1 ? "skin" : "skins"}`;

const setOverlayPanelStatus = ({ label, message, active = false, error = false } = {}) => {
  const statusLabel = label || (error ? "Error" : active ? "Overlay activo" : "Sin overlay");
  const statusMessage = message || (active ? "Overlay activo. Entra a partida para ver las skins." : "Listo para seleccionar skins.");
  if (active && statusMessage) state.overlayActiveMessage = statusMessage;
  if (!active && !error) state.overlayActiveMessage = "";

  if (els.overlayStatusLabel) els.overlayStatusLabel.textContent = statusLabel;
  if (els.skinsOverlayStatusLabel) els.skinsOverlayStatusLabel.textContent = statusLabel;
  if (els.importStatusLabel) els.importStatusLabel.textContent = statusMessage;
  if (els.skinsOverlayStatusMessage) els.skinsOverlayStatusMessage.textContent = statusMessage;
  els.overlayStatusIndicator?.classList.toggle("active", Boolean(active && !error));
  els.skinsOverlayStatusIndicator?.classList.toggle("active", Boolean(active && !error));
};

const resolveSkinLibraryNames = () => {
  const champions = state.champions || [];
  state.skinLibrary = state.skinLibrary.map((entry) => {
    const championKey = String(entry.championKey || entry.champion || "");
    let champion = championKey ? champions.find((c) => String(c.key) === championKey) : null;
    if (!champion && entry.champion) {
      const nameLookup = entry.champion.trim().toLowerCase();
      champion = champions.find((c) => c.name.trim().toLowerCase() === nameLookup || c.id.trim().toLowerCase() === nameLookup);
    }
    if (champion) {
      entry.champion = champion.name;
      entry.championKey = champion.key;
      entry.championId = champion.key;
    }
    const skinIds = [
      entry.fileBaseId,
      entry.rawSkin,
      entry.rawVariant,
    ].filter(Boolean).map((id) => {
      const trimmed = String(id).trim();
      return trimmed.match(/^\d+$/) ? trimmed : null;
    }).filter(Boolean);
    let resolvedFromCatalog = false;
    if (skinIds.length) {
      const numericId = Number(skinIds[0]);
      entry.skinNum = numericId;
      entry.imageSkinNum = numericId;
      entry.baseImageSkinNum = numericId;
      if (champion) {
        const skinMap = lcuChampionSkinCache.get(String(champion.key)) || new Map();
        for (const skinId of skinIds) {
          const skinName = skinMap.get(skinId);
          if (skinName) {
            entry.skin = skinName;
            resolvedFromCatalog = true;
            break;
          }
        }
      }
    }
    if (!entry.skin) {
      entry.skin = entry.rawSkin || entry.fileBaseId || entry.skin || "desconocido";
    }
    // LeagueSkins is numeric. Keep entries pending until the running client's
    // LCU catalog resolves the localized name (Rose-style source of truth).
    entry.resolved = skinIds.length === 0 || resolvedFromCatalog;
    return entry;
  });
};

const cleanupStaleQueueKeys = () => {
  const staleKeys = [...state.queuedSkins].filter((key) =>
    !isUserCustomModKey(key) && isDownloadedLeagueSkinsPath(key)
  );
  if (staleKeys.length) {
    staleKeys.forEach((key) => state.queuedSkins.delete(key));
    saveQueuedSkins();
  }
};

const setSkinLibrary = (result) => {
  if (!result) return;
  state.skinLibrary = result.skins || [];
  resolveSkinLibraryNames();
  state.skinChampion = "all";
  resetSkinView({ clearProfile: true });
  state.skinLibraryPath = result.folderPath || "";
  if (state.skinLibraryPath) {
    localStorage.setItem("riftAtlas:skinLibraryPath", state.skinLibraryPath);
  }
  if (els.skinLibraryLabel) {
    els.skinLibraryLabel.textContent = `${state.skinLibraryPath} - ${state.skinLibrary.length} skin/package(s)`;
  }
  if (els.downloadSkinLibraryLabel) els.downloadSkinLibraryLabel.textContent = state.skinLibraryPath || "No configurado";
  if (els.leagueSkinsLocalPanel) els.leagueSkinsLocalPanel.hidden = false;
  renderSkinChampionOptions();
  renderSkinLibrary();
  persistLibraryIndex();
  sendPenguSkinCatalog("library-updated");
  syncUserModsFolder("library-updated", { silent: true }).catch(() => null);
  cleanupStaleQueueKeys();
};

const clearSkinSelection = () => {
  state.queuedSkins.clear();
  state.penguSessionQueuedSkins.clear();
  state.managedSkins.clear();
  localStorage.setItem("riftAtlas:managedSkins", JSON.stringify([]));
  saveQueuedSkins();
};

const isUserCustomModKey = (key = "") => {
  const mod = state.customMods.find((item) => getSkinKey(item) === key);
  return Boolean(mod && mod.source !== "p2p");
};

const clearPenguSessionQueuedSkins = (reason = "game-ended") => {
  const keys = [...state.penguSessionQueuedSkins]
    .filter((key) => state.queuedSkins.has(key) && !isUserCustomModKey(key));
  const preservedUserMods = [...state.penguSessionQueuedSkins]
    .filter((key) => state.queuedSkins.has(key) && isUserCustomModKey(key));
  if (!keys.length) {
    preservedUserMods.forEach((key) => state.penguSessionQueuedSkins.delete(key));
    state.penguSessionQueuedSkins.clear();
    lastPenguSkinSyncPayload = null;
    clearRoseAuthoritativeSelection();
    lastPenguLcuSelection = null;
    lastPenguSkinSyncKey = "";
    lastPenguSkinSyncAt = 0;
    lastPenguChromaSelection = null;
    lastPenguChromaPanel = null;
    lastRosePreforceSignature = "";
    lastRosePreforceAt = 0;
    state.roseFinalizationCommitted = false;
    state.roseFinalizationApplyStarted = false;
    state.lastHoverWritten = false;
    // Rose-style: incluso si penguSessionQueuedSkins esta vacio, barrer
    // queuedSkins en busca de LeagueSkins packages y limpiarlos.
    // Esto evita que skins compradas queden "pegadas" en la cola cuando
    // penguSessionQueuedSkins ya fue limpiado previamente.
    const staleLeagueSkins = [...state.queuedSkins].filter((queuedKey) => {
      const skin = getSkinByKey(queuedKey);
      return skin && isDownloadedLeagueSkinsPath(queuedKey) && !isUserCustomModKey(queuedKey);
    });
    if (staleLeagueSkins.length) {
      staleLeagueSkins.forEach((key) => removeQueuedSkinKey(key));
      saveQueuedSkins();
      renderSkinLibrary();
      renderSelectionTray();
    }
    return false;
  }

  keys.forEach((key) => removeQueuedSkinKey(key));
  preservedUserMods.forEach((key) => state.penguSessionQueuedSkins.delete(key));
  state.penguSessionQueuedSkins.clear();
  lastPenguSkinSyncPayload = null;
  clearRoseAuthoritativeSelection();
  lastPenguLcuSelection = null;
  lastPenguSkinSyncKey = "";
  lastPenguSkinSyncAt = 0;
  lastPenguChromaSelection = null;
  lastPenguChromaPanel = null;
  lastRosePreforceSignature = "";
  lastRosePreforceAt = 0;
  state.customOverlayPath = "";
  state.customOverlayKeys = [];
  // Rose-style: reset FINALIZATION guards between games so the next
  // ChampSelect can trigger a fresh injection cycle.
  state.roseFinalizationCommitted = false;
  state.roseFinalizationApplyStarted = false;
  state.lastHoverWritten = false;
  saveQueuedSkins();
  renderSkinLibrary();
  renderSelectionTray();
  renderBaseOverlayStatus();
  window.riftAtlas.appendOverlayLog(`[Diagnostico] Limpieza Pengu post-partida (${reason}): ${keys.length} seleccion(es) removidas.`).catch(() => { });
  return true;
};

const GAMEFLOW_CLEAR_PHASES = new Set([
  "EndOfGame",
  "PreEndOfGame",
  "WaitingForStats",
  "None",
  "Lobby",
  "Matchmaking",
  "ReadyCheck"
]);

const GAMEFLOW_ACTIVE_PHASES = new Set([
  "GameStart",
  "InProgress",
  "Reconnect"
]);

const ROSE_SUSPEND_PHASES = new Set([
  "ChampSelect",
  "FINALIZATION",
  "SWIFTPLAY_SEARCHING",
  "GameStart"
]);

const shouldKeepRoseEarlyMonitor = () =>
  ROSE_SUSPEND_PHASES.has(String(state.penguGameflowPhase || ""));

let roseLocalTickerGeneration = 0;
let roseLocalTickerRunning = false;

const clearRoseFinalizationTimer = () => {
  if (state.roseFinalizationTimer) {
    clearInterval(state.roseFinalizationTimer);
    state.roseFinalizationTimer = null;
  }
  state.roseFinalizationDeadline = 0;
  state.loadoutCountdownActive = false;
  state.loadoutLeft0Ms = 0;
  state.loadoutT0 = 0;
  state.lastRemainMs = 0;
};

const clearPenguApplyLock = () => {
  state.penguApplyLockedKey = "";
  state.penguApplyLockedAt = 0;
};

const startRoseEarlyMonitor = async (reason = "rose") => {
  if (!window.riftAtlas.startEarlyMonitor || !state.leagueGamePath) return false;
  if (["InProgress", "Reconnect"].includes(state.penguGameflowPhase)) return false;
  if (state.roseEarlyMonitorStarted) return true;
  try {
    const result = await window.riftAtlas.startEarlyMonitor(state.leagueGamePath);
    state.roseEarlyMonitorStarted = Boolean(result?.started);
    window.riftAtlas.appendOverlayLog(`[RoseSuspend] monitor temprano iniciado (${reason}).`).catch(() => { });
    return state.roseEarlyMonitorStarted;
  } catch (error) {
    window.riftAtlas.appendOverlayLog(`[RoseSuspend] no pude iniciar monitor temprano (${reason}): ${error.message || error}`).catch(() => { });
    return false;
  }
};

const stopRoseEarlyMonitor = async (reason = "release") => {
  if (!window.riftAtlas.stopEarlyMonitor || !state.roseEarlyMonitorStarted) return false;
  const forcedRelease = String(reason).includes("no-apply");
  if (shouldKeepRoseEarlyMonitor() && !forcedRelease) {
    return false;
  }
  try {
    const result = await window.riftAtlas.stopEarlyMonitor();
    window.riftAtlas.appendOverlayLog(`[RoseSuspend] monitor temprano liberado (${reason}) suspended=${Boolean(result?.hadSuspended)}.`).catch(() => { });
    return true;
  } catch (error) {
    window.riftAtlas.appendOverlayLog(`[RoseSuspend] no pude liberar monitor temprano (${reason}): ${error.message || error}`).catch(() => { });
    return false;
  } finally {
    state.roseEarlyMonitorStarted = false;
  }
};

const triggerRoseFinalizationApply = async (reason = "finalization") => {
  if (state.lastHoverWritten || state.roseFinalizationCommitted || state.roseFinalizationApplyStarted || state.importingQueue) {
    window.riftAtlas.appendOverlayLog(`[TrackerDiag] triggerRoseFinalizationApply early skip: lastHoverWritten=${state.lastHoverWritten} committed=${state.roseFinalizationCommitted} applyStarted=${state.roseFinalizationApplyStarted} importing=${state.importingQueue}`).catch(() => {});
    return false;
  }
  const injectPhase = String(state.penguGameflowPhase || "");
  if (injectPhase && !["ChampSelect", "FINALIZATION", "GameStart"].includes(injectPhase)) {
    window.riftAtlas.appendOverlayLog(`[Rose] FINALIZATION apply saltado: fase=${injectPhase} (${reason}).`).catch(() => { });
    return false;
  }
  const now = Date.now();
  const elapsed = now - state.lastRoseInjectionTime;
  if (state.lastRoseInjectionTime && elapsed < state.skinWriteMs) {
    window.riftAtlas.appendOverlayLog(`[Rose] Cooldown activo (${state.skinWriteMs - elapsed}ms restantes); saltando inyeccion.`).catch(() => { });
    return false;
  }
  // Rose 1:1: si last_hovered_skin_id es None, saltar.
  // Rose: target_skin_id = selected_custom_mod.get("skin_id", ui_skin_id)
  // Primero usar la skin resuelta del hover (effectiveSkinId), luego
  // selectedCustomMod SOLO si su target coincide con el hover.
  let skinToInject = null;
  // 1. Usar la skin resuelta via hover (effectiveSkinId) — como Rose usa ui_skin_id
  if (roseAuthoritativeSelection.effectiveSkinId > 0) {
    skinToInject = roseAuthoritativeSelection.skinKey ? getSkinByKey(roseAuthoritativeSelection.skinKey) : null;
  }
  // 2. selectedCustomMod SOLO si su target coincide con effectiveSkinId (Rose: custom_mod gana)
  if (skinToInject && state.selectedCustomMod?.skinKey) {
    const modSkin = getSkinByKey(state.selectedCustomMod.skinKey);
    if (modSkin && state.queuedSkins.has(getSkinKey(modSkin))) {
      const modTarget = getOverlayTargetSkinId(modSkin, getSkinSyncChampionNumber(modSkin) || 0);
      if (modTarget && modTarget === roseAuthoritativeSelection.effectiveSkinId) {
        skinToInject = modSkin;
      }
    }
  }
  // Fallback: si no hay hover pero hay selectedCustomMod, usarlo
  if (!skinToInject && state.selectedCustomMod?.skinKey) {
    const modSkin = getSkinByKey(state.selectedCustomMod.skinKey);
    if (modSkin && state.queuedSkins.has(getSkinKey(modSkin))) {
      skinToInject = modSkin;
    }
  }
  // Rose 1:1: si no hay skin resuelta, saltar
  if (!skinToInject) {
    window.riftAtlas.appendOverlayLog("[Rose] FINALIZATION: no hay skin resuelta; saltando inyeccion (Rose: last_hovered_skin_id is None).").catch(() => { });
    return false;
  }
  state.lastHoverWritten = true;
  state.roseFinalizationCommitted = true;
  state.roseFinalizationApplyStarted = true;
  let applied = false;
  try {
    // Rose 1:1: usar la skin ya resuelta. NO re-resolver.
    const skin = skinToInject;
    if (!skin) {
      window.riftAtlas.appendOverlayLog("[Rose] FINALIZATION: skin resuelta no encontrada en libreria.").catch(() => { });
      return false;
    }
    const payload = roseAuthoritativeSelection.payload || lastPenguSkinSyncPayload || {};
    lastPenguSkinSyncPayload = { ...payload };
    await maybeForceLeagueSkinForOverlay(skin, payload);
    applied = Boolean(await handlePenguSkinApply({ ...payload, key: getSkinKey(skin), type: payload.type || "loadout-finalization" }));
    if (applied) state.lastRoseInjectionTime = now;
    return applied;
  } finally {
    if (!applied) {
      window.riftAtlas.appendOverlayLog("[Rose] FINALIZATION: inyeccion no aplicada (Rose: no resetea estado en fallo).").catch(() => { });
    }
    state.roseFinalizationApplyStarted = false;
  }
};

const cancelRoseLocalFinalizationTicker = () => {
  roseLocalTickerGeneration += 1;
  roseLocalTickerRunning = false;
};

const startRoseLocalFinalizationTicker = () => {
  if (!window.riftAtlas.waitForLcuFinalizationThreshold || roseLocalTickerRunning) {
    return roseLocalTickerRunning;
  }
  const generation = ++roseLocalTickerGeneration;
  roseLocalTickerRunning = true;
  window.riftAtlas.appendOverlayLog(
    `[RoseTicker] local Rust/LCU monotonic iniciado; threshold=${state.skinWriteMs}ms.`
  ).catch(() => { });
  window.riftAtlas.waitForLcuFinalizationThreshold(state.skinWriteMs)
    .then(async (result) => {
      if (generation !== roseLocalTickerGeneration || !result?.ready) return;
      const tickerPhase = String(state.penguGameflowPhase || "");
      if (tickerPhase && !["ChampSelect", "FINALIZATION", "GameStart"].includes(tickerPhase)) {
        window.riftAtlas.appendOverlayLog(`[RoseTicker] ticker resuelto DEMASIADO TARDE; fase=${tickerPhase}. Abortando.`).catch(() => { });
        return;
      }
      state.penguGameflowPhase = "FINALIZATION";
      state.lastRemainMs = Math.max(0, Number(result.remainingMs || 0));
      clearRoseFinalizationTimer();
      // Rose-style: populate from fresh LCU read at ticker time so we never
      // rely on a stale lastPenguLcuSelection between games.
      if (Number(result.championId || 0) > 0) {
        lastPenguLcuSelection = {
          championId: Number(result.championId),
          selectedSkinId: Number(result.actualLcuSkinId || 0),
          at: Date.now(),
        };
      }
      window.riftAtlas.appendOverlayLog(
        `[RoseTicker] threshold local alcanzado: remaining=${result.remainingMs}ms source=${result.source}.`
      ).catch(() => { });
      // Rose-style (sync Python): yield so any in-flight queuePenguSelectionForFinalization
      // (which yields at resolveRoseAuthoritativeSkinEntry) completes before apply.
      await Promise.resolve();
      triggerRoseFinalizationApply("Rust LCU monotonic threshold").catch((error) => {
        window.riftAtlas.appendOverlayLog(`[RoseTicker] apply local fallo: ${error.message || error}`).catch(() => { });
      });
    })
    .catch((error) => {
      if (generation !== roseLocalTickerGeneration) return;
      window.riftAtlas.appendOverlayLog(`[RoseTicker] ticker local termino: ${error.message || error}`).catch(() => { });
    })
    .finally(() => {
      if (generation === roseLocalTickerGeneration) roseLocalTickerRunning = false;
    });
  return true;
};

const handlePenguLoadoutFinalization = (payload = {}) => {
  if (String(payload.phase || "").toUpperCase() === "SWIFTPLAY_SEARCHING") {
    state.penguGameflowPhase = "SWIFTPLAY_SEARCHING";
    const champions = Array.isArray(payload.champions) ? payload.champions : [];
    const signature = champions
      .map((entry) => `${Number(entry?.championId || 0)}:${Number(entry?.skinId || 0)}`)
      .filter((entry) => !entry.startsWith("0:"))
      .sort()
      .join("|");
    if (!signature || signature === state.roseFinalizationSignature) return;
    state.roseFinalizationSignature = signature;
    triggerRoseSwiftplayApply(champions).catch((error) => {
      window.riftAtlas.appendOverlayLog(`[Rose/Swiftplay] apply fallo: ${error.message || error}`).catch(() => { });
    });
    return true;
  }
  state.penguGameflowPhase = "FINALIZATION";
  const leftMs = Math.max(0, Number(payload.adjustedTimeLeftInPhase || payload.leftMs || 0));
  if (!state.loadoutCountdownActive && leftMs > 0) {
    state.loadoutLeft0Ms = leftMs;
    state.loadoutT0 = performance.now();
    state.tickerSeq = (state.tickerSeq || 0) + 1;
    state.currentTicker = state.tickerSeq;
    state.loadoutCountdownActive = true;
  }
  if (startRoseLocalFinalizationTicker()) return true;
  const signature = `${payload.phase || "FINALIZATION"}:${Math.floor(leftMs / 250)}`;
  if (signature === state.roseFinalizationSignature) return;
  state.roseFinalizationSignature = signature;
  const candidateDeadline = performance.now() + leftMs;
  if (!state.roseFinalizationDeadline || candidateDeadline < state.roseFinalizationDeadline) {
    state.roseFinalizationDeadline = candidateDeadline;
  }
  if (!state.roseFinalizationTimer) {
    const tickerId = state.currentTicker;
    state.roseFinalizationTimer = setInterval(() => {
      if (!state.loadoutCountdownActive || state.currentTicker !== tickerId) {
        clearRoseFinalizationTimer();
        return;
      }
      const remainingMs = Math.max(0, state.roseFinalizationDeadline - performance.now());
      state.lastRemainMs = Math.min(state.lastRemainMs || remainingMs, remainingMs);
      if (remainingMs > state.skinWriteMs) return;
      clearRoseFinalizationTimer();
      triggerRoseFinalizationApply(`FINALIZATION threshold ${state.skinWriteMs}ms`).catch((error) => {
        window.riftAtlas.appendOverlayLog(`[RoseSuspend] finalization apply fallo: ${error.message || error}`).catch(() => { });
      });
    }, 25);
  }
};

const handlePenguPhaseChange = (payload = {}) => {
  const phase = String(payload.phase || "").trim();
  if (!phase) return;

  const currentPhaseBeforeEvent = state.penguGameflowPhase;
  const previousPhase = String(payload.previousPhase || "").trim() || currentPhaseBeforeEvent;
  // Riot reports the outer gameflow phase as ChampSelect while the session
  // timer is already in FINALIZATION. A late/stale ChampSelect event must not
  // downgrade that subphase or make it look like a brand-new session.
  const preservesFinalization = phase === "ChampSelect" && currentPhaseBeforeEvent === "FINALIZATION";
  state.penguGameflowPhase = preservesFinalization ? "FINALIZATION" : phase;
  const wasInGame = state.penguHadInGamePhase || GAMEFLOW_ACTIVE_PHASES.has(previousPhase);
  if (phase === "ChampSelect") {
    state.penguSessionActive = true;
    if (!preservesFinalization && !["ChampSelect", "FINALIZATION"].includes(previousPhase)) {
      state.penguChampionLocked = false;
      state.penguOwnedSkinIds = new Set();
      state.penguOwnedSkinsReady = false;
      lastPenguLcuSelection = null;
      lastPenguSkinSyncPayload = null;
      clearRoseAuthoritativeSelection();
      state.selectedCustomMod = null;
      lastPenguChromaSelection = null;
      lastPenguChromaPanel = null;
      cleanupStaleQueueKeys();
      lastPenguSkinSyncKey = "";
      lastPenguSkinSyncAt = 0;
      state.roseFinalizationApplyStarted = false;
      state.roseFinalizationCommitted = false;
      state.roseFinalizationSignature = "";
      state.lastHoverWritten = false;
      state.lastRoseInjectionTime = 0;
      state.loadoutCountdownActive = false;
      state.loadoutT0 = 0;
      state.loadoutLeft0Ms = 0;
      state.lastRemainMs = 0;
      state.currentTicker = 0;
      clearPenguApplyLock();
      startRoseLocalFinalizationTicker();
      // Rose: start the early suspend monitor as soon as we enter ChampSelect so
      // the game is already frozen when FINALIZATION begins. This prevents the
      // race where League starts loading before we can suspend it.
      startRoseEarlyMonitor("ChampSelect");
      // Rose: dual detection for champion lock (polling LCU + WS). Poll the LCU
      // session every 2s until either champion-locked arrives or lock confirmed.
      if (!state.penguChampionLocked && window.riftAtlas.checkChampionLock) {
        const pollLock = async () => {
          if (state.penguChampionLocked) return;
          try {
            const result = await window.riftAtlas.checkChampionLock();
            const champId = Number(result?.championId || 0);
            const skinId = Number(result?.selectedSkinId || 0);
            if (champId && skinId) {
              state.penguChampionLocked = true;
              state.lastLockedChampionId = champId;
              window.riftAtlas.appendOverlayLog(`[Rose] Lock detectado via polling LCU: champion ${champId} skin ${skinId} (Rose: dual detection).`).catch(() => { });
              if (lastPenguSkinSyncPayload) {
                handlePenguSkinSync(lastPenguSkinSyncPayload).catch(() => {});
              }
              return;
            }
          } catch (error) {
            window.riftAtlas.appendOverlayLog(`[Rose] Polling lock fallo: ${error.message || error}`).catch(() => { });
          }
          // Retry in 2s
          setTimeout(pollLock, 2000);
        };
        setTimeout(pollLock, 2000);
      }
    }
  }
  if (GAMEFLOW_ACTIVE_PHASES.has(phase)) {
    if (["ChampSelect", "FINALIZATION"].includes(previousPhase) && !["ChampSelect", "FINALIZATION"].includes(phase)) {
      if (window.riftAtlas.onChampSelectExit) {
        window.riftAtlas.appendOverlayLog(`[TrackerDiag] onChampSelectExit from phase transition ${previousPhase}->${phase}`).catch(() => {});
        window.riftAtlas.onChampSelectExit().catch(() => {});
      }
    }
    state.penguSessionActive = true;
    state.penguHadInGamePhase = true;
    if (phase === "InProgress") {
      pausePartyTransfersForGame();
    }
    clearRoseFinalizationTimer();
    cancelRoseLocalFinalizationTicker();
    if (phase === "GameStart" && !state.roseFinalizationCommitted) {
      triggerRoseFinalizationApply("GameStart fallback").catch((error) => {
        window.riftAtlas.appendOverlayLog(`[Rose] fallback GameStart fallo: ${error.message || error}`).catch(() => { });
      });
    }
    return;
  }
  const explicitGameEnd = ["PreEndOfGame", "EndOfGame", "WaitingForStats"].includes(phase);
  const returningFromSession = GAMEFLOW_CLEAR_PHASES.has(phase) && (
    state.penguSessionActive || wasInGame ||
    ["ChampSelect", "FINALIZATION", "GameStart", "Reconnect"].includes(previousPhase)
  );
  if (explicitGameEnd || returningFromSession) {
    if (["ChampSelect", "FINALIZATION"].includes(previousPhase)) {
      if (window.riftAtlas.onChampSelectExit) {
        window.riftAtlas.appendOverlayLog(`[TrackerDiag] onChampSelectExit from session end ${previousPhase}->${phase}`).catch(() => {});
        window.riftAtlas.onChampSelectExit().catch(() => {});
      }
    }
    clearRoseFinalizationTimer();
    cancelRoseLocalFinalizationTicker();
    clearPenguApplyLock();
    stopRoseEarlyMonitor(`${previousPhase || "?"}->${phase}`).catch(() => { });
    clearPenguSessionQueuedSkins(`${previousPhase || "?"}->${phase}`);
    state.penguHadInGamePhase = false;
    state.penguSessionActive = false;
    state.importingQueue = false;
    state.roseEarlyMonitorStarted = false;
    state.autoRunCustomOverlaySignature = "";
    penguBackgroundApplyKey = "";
    penguBackgroundApplyAt = 0;
    penguBackgroundApplyPromise = Promise.resolve();
    penguBackgroundApplyInFlightKey = "";
    resumePartyTransfersAfterGame();
    state.overlayRunning = false;
    refreshOverlayStatus().catch(() => { });
  }
};

const handlePenguCarouselStatus = (payload = {}) => {
  if (!els.overlayPenguStatusLabel) return;
  const stage = payload.stage || "carousel";
  const injected = Number(payload.injected || 0);
  const championId = Number(payload.championId || 0);
  const catalogCount = Number(payload.catalogCount || 0);
  const suffix = championId ? ` champ=${championId}` : "";
  const injectedText = injected ? ` inyectadas=${injected}` : "";
  els.overlayPenguStatusLabel.textContent = `Pengu Loader: carousel ${stage}${suffix}${injectedText} catalogo=${catalogCount}`;
};

const savePresets = () => {
  localStorage.setItem("riftAtlas:presets", JSON.stringify(state.presets));
  localStorage.setItem("riftAtlas:activePresetId", state.activePresetId || "");
  persistLibraryIndex();
  renderPresets();
  renderCompactLauncher();
};

const sanitizeImportName = (value = "") =>
  String(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Imported Mod";

const getSkinSource = (skin = {}) =>
  skin.source === "p2p" ? "party" :
    skin.generated ? "generado" :
      skin.custom ? "custom" :
        isDownloadedLeagueSkinsPath(skin.path) ? "LeagueSkins" :
          "LeagueSkins";

const applySkinMetadata = (skin = {}) => {
  const key = getSkinKey(skin);
  const meta = key ? state.skinMetadata[key] || {} : {};
  if (!meta || !Object.keys(meta).length) return skin;
  return {
    ...skin,
    metadataEdited: true,
    displayName: meta.name || skin.displayName,
    name: meta.name || skin.name,
    skin: meta.name || skin.skin,
    champion: meta.champion || skin.champion,
    targetBaseSkin: meta.baseSkin || skin.targetBaseSkin,
    author: meta.author || skin.author,
    version: meta.version || skin.version,
    previewUrl: meta.preview || skin.previewUrl,
    previewPath: meta.previewPath || skin.previewPath,
    previewInferred: meta.previewInferred ?? skin.previewInferred
  };
};

const getSkinDisplayName = (skin) => {
  const resolved = applySkinMetadata(skin);
  return `${resolved.champion} - ${resolved.skin || resolved.name}${resolved.variant ? ` - ${resolved.variant}` : ""}`;
};

const getSkinVisibleName = (skin) => {
  const resolved = applySkinMetadata(skin);
  return resolved.skin || resolved.name || resolved.displayName || "Skin";
};

const getSkinImportName = (skin) => sanitizeImportName(getSkinDisplayName(skin));

const normalizeSkinKey = (key = "") =>
  String(key || "").replace(/\//g, "\\").replace(/\\+/g, "\\").toLowerCase();

const getSkinByKey = (key) => {
  const directSkin = state.customMods.find((mod) => getSkinKey(mod) === key) ||
    state.skinLibrary.find((item) => getSkinKey(item) === key);
  if (directSkin) return applySkinMetadata(directSkin);

  const normalizedKey = normalizeSkinKey(key);
  if (!normalizedKey) return null;
  const normalizedSkin = state.customMods.find((mod) => normalizeSkinKey(getSkinKey(mod)) === normalizedKey) ||
    state.skinLibrary.find((item) => normalizeSkinKey(getSkinKey(item)) === normalizedKey);
  return normalizedSkin ? applySkinMetadata(normalizedSkin) : null;
};

const saveSkinMetadata = () => {
  localStorage.setItem("riftAtlas:skinMetadata", JSON.stringify(state.skinMetadata));
  persistLibraryIndex();
};

const getUnifiedLibrarySkins = () =>
  [...state.customMods, ...state.skinLibrary]
    .filter((skin) => getSkinKey(skin))
    .map((skin) => {
      const resolved = applySkinMetadata(skin);
      const key = getSkinKey(resolved);
      return {
        id: key,
        path: resolved.path,
        name: resolved.skin || resolved.name || getNameFromPath(resolved.path),
        champion: resolved.champion || "Mod propio",
        author: resolved.author || "",
        version: resolved.version || "",
        source: getSkinSource(resolved),
        enabled: state.managedSkins.has(key),
        favorite: state.favoriteSkins.has(key),
        queued: state.queuedSkins.has(key),
        lastUsedAt: state.overlayHistory.find((entry) => (entry.skinKeys || []).includes(key))?.createdAt || "",
        preview: resolved.previewUrl || resolved.imageUrl || getSkinLoadingImage(resolved) || getSkinDefaultLoadingImage(resolved),
        previewPath: resolved.previewPath || resolved.localPreviewPath || "",
        previewInferred: Boolean(resolved.previewInferred || (!resolved.previewUrl && !resolved.imageUrl)),
        extension: resolved.extension || getLocalModExtensionFromPath(resolved.path),
        size: resolved.size || 0,
        metadataEdited: Boolean(resolved.metadataEdited)
      };
    });

let libraryIndexSaveTimer = null;
const persistLibraryIndex = () => {
  clearTimeout(libraryIndexSaveTimer);
  libraryIndexSaveTimer = setTimeout(async () => {
    const payload = {
      skins: getUnifiedLibrarySkins(),
      profiles: state.presets,
      metadata: state.skinMetadata
    };
    state.libraryIndex = { ...state.libraryIndex, ...payload, updatedAt: new Date().toISOString() };
    if (els.libraryIndexStatus) {
      els.libraryIndexStatus.textContent = `${payload.skins.length} entrada(s), guardando indice...`;
    }
    try {
      const result = await window.riftAtlas.writeLibraryIndex?.(payload);
      if (result?.indexPath && els.libraryIndexStatus) {
        els.libraryIndexStatus.textContent = `${payload.skins.length} entrada(s). Indice: ${result.indexPath}`;
      }
    } catch (error) {
      if (els.libraryIndexStatus) els.libraryIndexStatus.textContent = `No pude guardar indice: ${error.message}`;
    }
  }, 300);
};

const loadLibraryIndex = async () => {
  try {
    const payload = await window.riftAtlas.readLibraryIndex?.();
    if (!payload) return;
    state.libraryIndex = payload;
    if (payload.metadata && typeof payload.metadata === "object") {
      state.skinMetadata = { ...payload.metadata, ...state.skinMetadata };
      localStorage.setItem("riftAtlas:skinMetadata", JSON.stringify(state.skinMetadata));
    }
    if (Array.isArray(payload.profiles) && payload.profiles.length && !state.presets.length) {
      state.presets = payload.profiles;
    }
    if (els.libraryIndexStatus) {
      els.libraryIndexStatus.textContent = payload.indexPath
        ? `${payload.skins?.length || 0} entrada(s). Indice: ${payload.indexPath}`
        : "Indice local listo.";
    }
  } catch (error) {
    if (els.libraryIndexStatus) els.libraryIndexStatus.textContent = `No pude leer indice: ${error.message}`;
  }
};

const isRiftAtlasP2PMod = (mod = {}) => {
  if (mod.source !== "p2p") return false;
  const normalizedPath = String(mod.path || "").replace(/\//g, "\\").toLowerCase();
  return normalizedPath.includes("\\rift atlas\\p2p\\") ||
    normalizedPath.includes("\\rift atlas\\party-transfers\\");
};

const isDownloadedLeagueSkinsPath = (filePath = "") => {
  const normalizedPath = String(filePath || "").replace(/\//g, "\\").toLowerCase();
  return normalizedPath.includes("\\rift atlas\\downloaded-libraries\\leagueskins\\");
};

const getQueueChampionKey = (skin = {}) => {
  const inferred = getSkinChampionFromHints(skin);
  if (inferred?.key) return String(inferred.key);
  if (inferred?.id) return String(inferred.id).toLowerCase();
  const champion = String(skin.champion || skin.rawChampion || "").trim().toLowerCase();
  if (!champion || champion === "mod propio" || champion === "party") return "";
  return champion;
};

const removeQueuedSkinsForChampion = (championKey, exceptKey = "", options = {}) => {
  if (!championKey) return 0;
  const normalizedExceptKey = normalizeSkinKey(exceptKey);
  let removed = 0;
  [...state.queuedSkins].forEach((queuedKey) => {
    if (queuedKey === exceptKey || normalizeSkinKey(queuedKey) === normalizedExceptKey) return;
    const queuedSkin = getSkinByKey(queuedKey);
    if (options.preserveUserCustomMods && isUserCustomSkin(queuedSkin)) return;
    if (queuedSkin && getQueueChampionKey(queuedSkin) === championKey) {
      state.queuedSkins.delete(queuedKey);
      state.penguSessionQueuedSkins.delete(queuedKey);
      setTimeout(() => removeP2PFileIfUnused(queuedKey), 0);
      removed += 1;
    }
  });
  return removed;
};

const queueSkinKey = (key, options = {}) => {
  const skin = getSkinByKey(key);
  if (!skin) return { queued: false, replaced: 0 };
  const canonicalKey = getSkinKey(skin);
  const replaced = options.preserveExistingChampion
    ? 0
    : removeQueuedSkinsForChampion(getQueueChampionKey(skin), canonicalKey, {
      preserveUserCustomMods: options.sessionSource === "pengu"
    });
  [...state.queuedSkins].forEach((queuedKey) => {
    if (normalizeSkinKey(queuedKey) === normalizeSkinKey(canonicalKey) && queuedKey !== canonicalKey) {
      state.queuedSkins.delete(queuedKey);
      state.penguSessionQueuedSkins.delete(queuedKey);
    }
  });
  state.queuedSkins.add(canonicalKey);
  if (options.sessionSource === "pengu") {
    state.penguSessionQueuedSkins.add(canonicalKey);
  } else {
    state.penguSessionQueuedSkins.delete(canonicalKey);
  }
  // Rose-style: selected_custom_mod solo se actualiza desde seleccion explicita
  // del usuario en la UI, no desde skin-syncs automaticos de Pugu.
  if (!isDownloadedLeagueSkinsPath(canonicalKey) && options.sessionSource !== "pengu") {
    const championId = getSkinSyncChampionNumber(skin);
    if (championId) {
      state.selectedCustomMod = { championId, skinKey: canonicalKey };
    }
    // Rose-style: preparar mod para inyeccion mas rapida (extraer al seleccionar, no al inyectar)
    if (window.riftAtlas.prepareSkinMod) {
      window.riftAtlas.prepareSkinMod(canonicalKey).catch(() => {});
    }
  }
  // Rose-style: si la skin fue seleccionada desde la app UI (no Pugu),
  // actualizar roseAuthoritativeSelection para que triggerRoseFinalizationApply
  // la encuentre (Rose: selected_custom_mod gana sobre ui_skin_id).
  if (options.sessionSource !== "pengu") {
    const champId = getSkinSyncChampionNumber(skin);
    if (champId) {
      const targetSkinId = getOverlayTargetSkinId(skin, champId);
      if (targetSkinId) {
        const uiPayload = {
          championId: champId,
          selectedSkinId: targetSkinId,
          resolvedSkinId: targetSkinId,
          skin: skin.skin || skin.name || String(targetSkinId),
        };
        commitRoseAuthoritativeSelection(uiPayload, skin);
      }
    }
  }
  return { queued: true, replaced, key: canonicalKey };
};

const removeP2PFileIfUnused = async (key = "") => {
  const mod = state.customMods.find((item) => item.source === "p2p" && getSkinKey(item) === key);
  if (!mod?.path || state.queuedSkins.has(key)) return false;
  partySyncedQueuedSkins.forEach((localKey, remoteKey) => {
    if (localKey === key) partySyncedQueuedSkins.delete(remoteKey);
  });
  partyReceivedFiles.forEach((localKey, remoteKey) => {
    if (localKey === key) partyReceivedFiles.delete(remoteKey);
  });
  if (!isRiftAtlasP2PMod(mod)) return false;
  state.customMods = state.customMods.filter((item) => getSkinKey(item) !== key);
  await window.riftAtlas.deletePartyFile?.(mod.path).catch(() => null);
  saveCustomMods();
  return true;
};

const removeQueuedSkinKey = (key = "") => {
  if (!key || !state.queuedSkins.delete(key)) return false;
  state.penguSessionQueuedSkins.delete(key);
  if (state.selectedCustomMod?.skinKey === key) {
    state.selectedCustomMod = null;
  }
  removeP2PFileIfUnused(key);
  return true;
};

const normalizeQueuedSkinKeys = (skinKeys = []) => {
  const normalized = [];
  const championIndexes = new Map();

  skinKeys.forEach((key) => {
    const skin = getSkinByKey(key);
    if (!skin) {
      normalized.push(key);
      return;
    }
    const championKey = getQueueChampionKey(skin);
    if (championKey && championIndexes.has(championKey)) {
      normalized[championIndexes.get(championKey)] = key;
      return;
    }
    if (championKey) championIndexes.set(championKey, normalized.length);
    normalized.push(key);
  });

  return normalized;
};

const getActivePreset = () => state.presets.find((preset) => preset.id === state.activePresetId);

const createProfilePreset = (name, skinKeys = [...state.queuedSkins]) => ({
  id: `preset-${Date.now()}`,
  name,
  icon: (els.presetIconInput?.value.trim() || "RA").slice(0, 8),
  color: els.presetColorInput?.value || "#c89b3c",
  skinKeys,
  enginePath: state.ltkOverlaySidecarPath,
  dllPath: state.ltkOverlayDllPath,
  leagueGamePath: state.leagueGamePath,
  penguAutoParty: state.penguAutoParty,
  autoApply: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

const renderSelectedMiniCard = (skin) => {
  const art = getSkinLoadingImage(skin) || getSkinBaseLoadingImage(skin) || getSkinDefaultLoadingImage(skin);
  const icon = art || getChampionIconByKey(skin.rawChampion, skin.champion);
  return `
    <button class="selected-mini-card" type="button" data-path="${escapeHtml(getSkinKey(skin))}">
      ${icon ? `<img src="${icon}" alt="${escapeHtml(skin.champion)}" />` : `<span>${escapeHtml(getDisplayExtension(skin))}</span>`}
      <strong>${escapeHtml(getSkinVisibleName(skin))}</strong>
      <small>${escapeHtml(skin.champion)}</small>
    </button>
  `;
};

const normalizeCustomMod = (item) => ({
  ...item,
  extension: item.extension || getLocalModExtensionFromPath(item.path || item.name || "") || ".fantome",
  name: item.name || getNameFromPath(item.path || item.relativePath || "") || "Mod local",
  relativePath: item.relativePath || item.path || item.name || "",
  champion: item.champion || "Mod propio",
  skin: item.skin || item.name || "Mod local",
  variant: item.variant || item.relativePath || "",
  custom: true
});

const enrichCustomMod = (item = {}) => {
  const normalized = normalizeCustomMod(item);
  const inferredChampion = getSkinChampionFromHints(normalized);
  const fullSkinId = Number(normalized.skinId || normalized.rawSkin || normalized.fileBaseId || 0);
  const skinNum = Number.isFinite(fullSkinId) && fullSkinId >= 1000 ? fullSkinId % 1000 : Number(normalized.skinNum ?? NaN);
  const knownSkinName = inferredChampion && Number.isFinite(skinNum)
    ? lcuChampionSkinCache.get(String(inferredChampion.key))?.get(String((Number(inferredChampion.key) * 1000) + skinNum)) ||
      lcuChampionSkinCache.get(String(inferredChampion.key))?.get(String(skinNum))
    : "";
  if (!inferredChampion) return normalized;
  return {
    ...normalized,
    champion: inferredChampion.name,
    rawChampion: inferredChampion.key,
    championKey: inferredChampion.id,
    championId: inferredChampion.key,
    skin: knownSkinName || normalized.skin,
    skinNum: Number.isFinite(skinNum) ? skinNum : normalized.skinNum,
    skinId: fullSkinId || normalized.skinId
  };
};

const saveCustomMods = () => {
  state.customMods = state.customMods
    .filter((mod) => !isDownloadedLeagueSkinsPath(mod.path))
    .map(enrichCustomMod);
  localStorage.setItem("riftAtlas:customMods", JSON.stringify(state.customMods));
  persistLibraryIndex();
  renderCustomMods();
  renderSelectionTray();
  renderPresets();
  renderCompactLauncher();
  sendPenguSkinCatalog("custom-mods-updated");
};

const LOCAL_MOD_EXTENSIONS = new Set([".fantome", ".zip", ".rse", ".wad", ".wad.client"]);

const getLocalModExtensionFromPath = (filePath = "") => {
  const lower = String(filePath).toLowerCase();
  if (lower.endsWith(".wad.client")) return ".wad.client";
  const match = lower.match(/\.[^.\\/]+$/);
  return match ? match[0] : "";
};

const getNameFromPath = (filePath = "") =>
  String(filePath).split(/[\\/]/).pop() || String(filePath);

const getDisplayExtension = (item = {}, fallback = "MOD") =>
  String(item.extension || getLocalModExtensionFromPath(item.path || item.name || "") || fallback)
    .replace(".", "")
    .toUpperCase();

const isRestorableLocalModPath = (filePath = "") => {
  const extension = getLocalModExtensionFromPath(filePath);
  if (!LOCAL_MOD_EXTENSIONS.has(extension)) return false;
  if (isDownloadedLeagueSkinsPath(filePath)) return false;
  const normalizedPath = String(filePath || "").replace(/\//g, "\\").toLowerCase();
  return !normalizedPath.includes("\\rift atlas\\p2p\\") &&
    !normalizedPath.includes("\\rift atlas\\party-transfers\\");
};

const restoreKnownLocalMods = () => {
  const knownKeys = new Set([
    ...state.queuedSkins,
    ...state.presets.flatMap((preset) => preset.skinKeys || []),
    ...state.overlayHistory.flatMap((entry) => entry.skinKeys || [])
  ]);
  const existingKeys = new Set(state.customMods.map(getSkinKey));
  const restored = [...knownKeys]
    .filter((key) => key && !existingKeys.has(key) && isRestorableLocalModPath(key))
    .map((key) => {
      const name = getNameFromPath(key);
      return enrichCustomMod({
        path: key,
        relativePath: key,
        name,
        skin: name,
        champion: "Mod propio",
        variant: "",
        extension: getLocalModExtensionFromPath(key),
        source: "local-restored",
        size: 0
      });
    });
  if (!restored.length) return;
  state.customMods = [...state.customMods, ...restored]
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
  localStorage.setItem("riftAtlas:customMods", JSON.stringify(state.customMods));
};

const addCustomMods = (items = []) => {
  const nextByPath = new Map(state.customMods.map((item) => [item.path, item]));
  items
    .filter((item) => !isDownloadedLeagueSkinsPath(item.path))
    .map(enrichCustomMod)
    .forEach((item) => {
      if (item.path) nextByPath.set(item.path, item);
    });
  state.customMods = [...nextByPath.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
  saveCustomMods();
};

const getFullSkinIdForStorage = (skin = {}) => {
  const championId = Number(skin.championId || skin.championKey || skin.rawChampion || 0);
  const directSkinId = Number(skin.skinId || skin.rawSkin || skin.fileBaseId || 0);
  if (directSkinId >= 1000) return directSkinId;
  const skinNum = Number(skin.skinNum ?? skin.imageSkinNum ?? directSkinId);
  if (!championId || !Number.isFinite(skinNum) || skinNum < 0) return 0;
  return (championId * 1000) + skinNum;
};

const getSelectedModTargetSkin = () => {
  const selected = getSkinByKey(state.selectedSkinKey);
  const selectedId = selected ? getFullSkinIdForStorage(selected) : 0;
  if (selectedId) return { skin: selected, skinId: selectedId };

  const queuedLeagueSkin = [...state.queuedSkins]
    .map(getSkinByKey)
    .find((skin) => skin && getFullSkinIdForStorage(skin));
  const queuedId = queuedLeagueSkin ? getFullSkinIdForStorage(queuedLeagueSkin) : 0;
  if (queuedId) return { skin: queuedLeagueSkin, skinId: queuedId };

  return { skin: null, skinId: 0 };
};

const getSkinTargetOptions = async (championKey) => {
  const champion = state.champions.find((entry) => String(entry.key) === String(championKey));
  if (!champion) return [];
  const skinMap = await fetchLcuChampionSkinData(champion.key);
  return [...skinMap.entries()]
    .map(([id, name]) => ({ id: Number(id), name }))
    .filter((entry) => Number.isFinite(entry.id) && entry.id >= Number(champion.key) * 1000)
    .sort((a, b) => a.id - b.id)
    .filter((entry, index, list) => list.findIndex((item) => item.id === entry.id) === index);
};

const CUSTOM_MOD_TARGET_CATEGORIES = [
  { value: "others", label: "Otros" },
  { value: "maps", label: "Mapas" },
  { value: "ui", label: "UI" },
  { value: "ux", label: "UX" },
  { value: "fonts", label: "Fonts" },
  { value: "announcers", label: "Announcers" },
  { value: "voiceover", label: "Voiceover" },
  { value: "loading_screen", label: "Loading screen" },
  { value: "vfx", label: "VFX" },
  { value: "sfx", label: "SFX" }
];

const getCustomModCategoryLabel = (category = "others") =>
  CUSTOM_MOD_TARGET_CATEGORIES.find((item) => item.value === category)?.label || "Otros";

const chooseCustomModTarget = async (suggestedSkinTarget = null) => {
  await ensureChampionsLoaded().catch(() => {});
  const hasChampions = state.champions.length > 0;

  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const defaultMode = suggestedSkinTarget?.skinId && hasChampions ? "skin" : "category";
    backdrop.innerHTML = `
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true">
        <span class="modal-kicker">Mods propios</span>
        <h2>Elegir destino</h2>
        <p>Para skins elegi una base de campeon. Para mapas, UX, fonts u otros, guardalo como mod general al estilo Rose.</p>
        <div class="mod-target-mode" role="group" aria-label="Tipo de mod">
          <label><input type="radio" name="mod-target-type" value="category" ${defaultMode === "category" ? "checked" : ""} /> General</label>
          <label><input type="radio" name="mod-target-type" value="skin" ${defaultMode === "skin" ? "checked" : ""} ${hasChampions ? "" : "disabled"} /> Skin</label>
        </div>
        <div class="metadata-form">
          <label class="mod-target-category-wrap">Categoria
            <select class="mod-target-category">
              ${CUSTOM_MOD_TARGET_CATEGORIES.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("")}
            </select>
          </label>
          <label class="mod-target-search-wrap">Campeon
            <input class="mod-target-search" type="search" placeholder="Buscar campeon" autocomplete="off" />
          </label>
          <label class="mod-target-champion-wrap">Campeon base
            <select class="mod-target-champion"></select>
          </label>
          <label class="mod-target-skin-wrap">Skin base
            <select class="mod-target-skin"></select>
          </label>
        </div>
        <div class="modal-actions">
          <button class="secondary-button mod-target-cancel" type="button">Cancelar</button>
          <button class="docs-link mod-target-confirm" type="button">Usar destino</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const championSelect = backdrop.querySelector(".mod-target-champion");
    const skinSelect = backdrop.querySelector(".mod-target-skin");
    const searchInput = backdrop.querySelector(".mod-target-search");
    const categorySelect = backdrop.querySelector(".mod-target-category");
    const confirmButton = backdrop.querySelector(".mod-target-confirm");
    const cancelButton = backdrop.querySelector(".mod-target-cancel");
    const typeInputs = [...backdrop.querySelectorAll('input[name="mod-target-type"]')];
    const categoryWrap = backdrop.querySelector(".mod-target-category-wrap");
    const skinWraps = [
      backdrop.querySelector(".mod-target-search-wrap"),
      backdrop.querySelector(".mod-target-champion-wrap"),
      backdrop.querySelector(".mod-target-skin-wrap")
    ];

    const close = (value) => {
      backdrop.remove();
      resolve(value);
    };

    const getMode = () => typeInputs.find((input) => input.checked)?.value || "category";

    const updateMode = () => {
      const mode = getMode();
      categoryWrap.hidden = mode !== "category";
      skinWraps.forEach((wrap) => {
        if (wrap) wrap.hidden = mode !== "skin";
      });
      if (mode === "category") {
        confirmButton.disabled = false;
      } else {
        confirmButton.disabled = !skinSelect.value;
      }
    };

    const renderChampions = (query = "") => {
      const normalizedQuery = normalizeSkinSyncText(query);
      const champions = state.champions
        .filter((champion) => !normalizedQuery || normalizeSkinSyncText(`${champion.name} ${champion.id}`).includes(normalizedQuery))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
      championSelect.innerHTML = champions
        .map((champion) => `<option value="${escapeHtml(champion.key)}">${escapeHtml(champion.name)}</option>`)
        .join("");
      if (suggestedSkinTarget?.skin?.championId) {
        championSelect.value = String(suggestedSkinTarget.skin.championId);
      }
    };

    const renderSkins = async () => {
      const championKey = championSelect.value;
      skinSelect.innerHTML = '<option value="">Cargando skins...</option>';
      const skins = await getSkinTargetOptions(championKey).catch(() => []);
      skinSelect.innerHTML = skins.length
        ? skins.map((skin) => `<option value="${skin.id}">${escapeHtml(skin.name)} (${skin.id})</option>`).join("")
        : '<option value="">Sin skins disponibles</option>';
      if (suggestedSkinTarget?.skinId && skins.some((skin) => skin.id === suggestedSkinTarget.skinId)) {
        skinSelect.value = String(suggestedSkinTarget.skinId);
      }
      updateMode();
    };

    searchInput.addEventListener("input", () => {
      renderChampions(searchInput.value);
      renderSkins();
    });
    championSelect.addEventListener("change", renderSkins);
    typeInputs.forEach((input) => input.addEventListener("change", updateMode));
    cancelButton.addEventListener("click", () => close(null));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close(null);
    });
    confirmButton.addEventListener("click", () => {
      if (getMode() === "category") {
        close({
          targetType: "category",
          category: categorySelect.value || "others",
          label: getCustomModCategoryLabel(categorySelect.value)
        });
        return;
      }
      const skinId = Number(skinSelect.value || 0);
      if (!skinId) return;
      const champion = state.champions.find((entry) => String(entry.key) === String(championSelect.value));
      const skinName = skinSelect.options[skinSelect.selectedIndex]?.textContent?.replace(/\s+\(\d+\)$/, "") || `Skin ${skinId}`;
      close({
        targetType: "skin",
        skinId,
        skin: {
          champion: champion?.name || championSelect.value,
          championId: champion?.key || championSelect.value,
          championKey: champion?.id || "",
          skin: skinName,
          skinId,
          skinNum: skinId % 1000
        }
      });
    });

    if (hasChampions) {
      renderChampions();
      renderSkins();
    } else {
      updateMode();
    }
    (defaultMode === "category" ? categorySelect : searchInput).focus();
  });
};

const importCustomModPathsToSelectedSkin = async (paths = [], reason = "manual") => {
  const cleanPaths = [...new Set(paths.filter(Boolean))];
  if (!cleanPaths.length) {
    if (els.customModsLabel) els.customModsLabel.textContent = "No encontre archivos compatibles para importar.";
    return null;
  }

  const chosen = await chooseCustomModTarget(getSelectedModTargetSkin());
  if (!chosen) {
    if (els.customModsLabel) els.customModsLabel.textContent = "Importacion cancelada.";
    return null;
  }

  if (els.customModsLabel) {
    els.customModsLabel.textContent = chosen.targetType === "skin"
      ? `Copiando ${cleanPaths.length} mod(s) a ${chosen.skin?.champion || "champion"} - ${chosen.skin?.skin || chosen.skinId}...`
      : `Copiando ${cleanPaths.length} mod(s) a ${chosen.label || "Otros"}...`;
  }
  const result = chosen.targetType === "skin"
    ? await window.riftAtlas.importCustomModsToSkin?.(chosen.skinId, cleanPaths)
    : await window.riftAtlas.importCustomModsToCategory?.(chosen.category || "others", cleanPaths);
  await syncUserModsFolder(reason, { silent: true });
  (result?.packages || []).forEach((item) => {
    if (item?.path) queueSkinKey(item.path, { preserveExistingChampion: chosen.targetType === "skin" });
  });
  if (result?.packages?.length) saveQueuedSkins();
  if (els.customModsLabel) {
    els.customModsLabel.textContent = `${result?.copied || 0} mod(s) guardados en ${result?.folderPath || "mods"}.`;
  }
  return result;
};

const openCustomModDestinationFolder = async () => {
  const chosen = await chooseCustomModTarget(getSelectedModTargetSkin());
  if (!chosen) {
    if (els.customModsLabel) els.customModsLabel.textContent = "Seleccion cancelada.";
    return null;
  }

  if (els.customModsLabel) {
    els.customModsLabel.textContent = chosen.targetType === "skin"
      ? `Abriendo carpeta para ${chosen.skin?.champion || "champion"} - ${chosen.skin?.skin || chosen.skinId}...`
      : `Abriendo carpeta de ${chosen.label || "Otros"}...`;
  }

  const result = chosen.targetType === "skin"
    ? await window.riftAtlas.openCustomSkinModFolder?.(chosen.skinId)
    : await window.riftAtlas.openCustomModCategoryFolder?.(chosen.category || "others");

  if (els.customModsLabel) {
    els.customModsLabel.textContent = `Carpeta lista: ${result?.folderPath || "mods"}.`;
  }
  await syncUserModsFolder("folder-opened", { silent: true }).catch(() => null);
  return result;
};

const syncUserModsFolder = async (reason = "manual", options = {}) => {
  if (!window.riftAtlas.indexUserModsFolder) return;
  if (!options.silent && els.customModsLabel) els.customModsLabel.textContent = "Sincronizando mods propios...";
  const result = await window.riftAtlas.indexUserModsFolder();
  const syncedPackages = result?.packages || [];
  const syncedPaths = new Set(syncedPackages.map((item) => item.path));
  state.customMods = state.customMods.filter((item) => item.source === "p2p" || syncedPaths.has(item.path));
  addCustomMods(syncedPackages);
  if (!options.silent && els.customModsLabel) {
    els.customModsLabel.textContent = `${result?.packages?.length || 0} mod(s) sincronizados desde ${result?.folderPath || "mods"}.`;
  }
  sendPenguSkinCatalog(`user-mods-${reason}`);
  return result;
};

const importModsDirectByPath = async (paths = []) => {
  const cleanPaths = [...new Set(paths.filter(Boolean))];
  if (!cleanPaths.length) return;
  if (els.customModsLabel) els.customModsLabel.textContent = `Copiando ${cleanPaths.length} mod(s) a la carpeta de mods...`;
  try {
    const result = await window.riftAtlas.importModsToFolder?.(cleanPaths);
    const count = result?.copied || 0;
    if (els.customModsLabel) els.customModsLabel.textContent = count > 0
      ? `${count} mod(s) agregado(s). Se detectara automaticamente.`
      : "No se pudieron copiar los archivos.";
    await syncUserModsFolder("drop", { silent: true }).catch(() => null);
  } catch (error) {
    if (els.customModsLabel) els.customModsLabel.textContent = `Error copiando: ${error.message || error}`;
  }
};

const importModsDirect = async (files = []) => {
  const paths = window.riftAtlas.getDroppedFilePaths?.(files) || [];
  await importModsDirectByPath(paths);
};

function buildPenguSkinCatalog() {
  const customKeys = new Set(state.customMods.map(getSkinKey));
  return [...state.customMods, ...state.skinLibrary]
    .filter((skin) => getSkinKey(skin) && skin.path)
    .map((skin) => {
      skin = applySkinMetadata(skin);
      const key = getSkinKey(skin);
      const inferredChampion = getSkinChampionFromHints(skin);
      return {
        key,
        path: skin.path,
        name: getSkinDisplayName(skin),
        champion: inferredChampion?.name || skin.champion || "Mod propio",
        championId: getSkinCatalogChampionNumber(skin),
        championKey: getSkinChampionId(skin),
        rawChampion: skin.rawChampion,

        skin: getSkinVisibleName(skin),
        rawSkin: skin.rawSkin,
        rawVariant: skin.rawVariant,

        skinNum: skin.skinNum,
        imageSkinNum: skin.imageSkinNum,
        baseImageSkinNum: skin.baseImageSkinNum,

        variant: skin.variant || "",
        metaName: skin.metaName || "",
        numericSource: Boolean(skin.numericSource),
        extension: skin.extension || "",

        image: getSkinLoadingImage(skin) || getSkinDefaultSplashImage(skin) || getSkinBaseLoadingImage(skin),

        custom: Boolean(skin.custom || customKeys.has(key)),
        queued: state.queuedSkins.has(key)
      };
    });
}

function sendPenguSkinCatalog(reason = "catalog") {
  if (!window.riftAtlas.sendPenguMessage) return;
  const queued = [...state.queuedSkins];
  const signature = [
    state.skinLibrary.length,
    state.customMods.length,
    state.champions.length,
    queued.slice().sort().join("|")
  ].join("::");
  if (!PENGU_CATALOG_FORCE_REASONS.has(reason) && signature === lastPenguCatalogSignature) return;
  lastPenguCatalogSignature = signature;
  window.riftAtlas.sendPenguMessage({
    type: "skin-catalog",
    reason,
    skins: buildPenguSkinCatalog(),
    queued,
    libraryReady: state.skinLibrary.length > 0,
    customCount: state.customMods.length,
    libraryCount: state.skinLibrary.length
  }).catch(() => null);
}

let penguBackgroundApplyKey = "";
let penguBackgroundApplyAt = 0;
let penguBackgroundApplyPromise = Promise.resolve();
let penguBackgroundApplyInFlightKey = "";
let penguSkinSyncQueue = Promise.resolve();
let penguApplyGeneration = 0;
let penguSkinSyncGeneration = 0;
const pendingPenguForceSkinRequests = new Map();

const waitForPrebuildOverlay = async (timeoutMs = 90000) => {
  const startedAt = Date.now();
  while (state.prebuildingOverlay && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

const getOverlayTargetSkinId = (skin = {}, championId = 0) => {
  const numericChampionId = Number(championId || getSkinSyncChampionNumber(skin) || 0);
  const toFullSkinId = (rawValue) => {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) return 0;
    if (value >= 1000) return value;
    return numericChampionId ? (numericChampionId * 1000) + value : 0;
  };
  const isCustomSkin = Boolean(skin.custom && !isDownloadedLeagueSkinsPath(getSkinKey(skin)));
  // Rose treats mods/skins/{skinId} as authoritative. A numeric custom
  // filename must not override the target encoded by its storage folder.
  const rawValues = isCustomSkin
    ? [
      skin.skinId,
      skin.rawSkin,
      ...(Array.isArray(skin.targetSkinNums) ? skin.targetSkinNums : []),
      skin.rawVariant,
      skin.fileBaseId,
      skin.skinNum,
      skin.imageSkinNum,
      skin.baseImageSkinNum,
      skin.id
    ]
    : [
      skin.rawVariant,
      skin.rawSkin,
      skin.fileBaseId,
      skin.skinNum,
      skin.imageSkinNum,
      skin.baseImageSkinNum,
      skin.skinId,
      skin.id,
      ...(Array.isArray(skin.targetSkinNums) ? skin.targetSkinNums : [])
    ];
  for (const rawValue of rawValues) {
    const fullSkinId = toFullSkinId(rawValue);
    if (fullSkinId) return fullSkinId;
  }
  return 0;
};

const triggerRoseSwiftplayApply = async (champions = []) => {
  if (state.roseFinalizationCommitted || state.roseFinalizationApplyStarted) return false;
  // A Swiftplay hover can first produce an ordinary one-skin apply. Rose's
  // Searching event is authoritative and must replace it with both tracked
  // selections, so wait for that build instead of treating overlayRunning as
  // a reason to skip the multi-skin overlay.
  const waitStartedAt = Date.now();
  while (state.importingQueue && Date.now() - waitStartedAt < 120000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (state.importingQueue || state.roseFinalizationCommitted || state.roseFinalizationApplyStarted) {
    state.roseFinalizationSignature = "";
    return false;
  }
  state.roseFinalizationCommitted = true;
  state.roseFinalizationApplyStarted = true;
  await startRoseEarlyMonitor("Swiftplay Searching");
  let applied = false;
  try {
    await ensureSkinLibraryLoaded();
    const resolvedKeys = [];
    for (const selection of champions) {
      const championId = Number(selection?.championId || 0);
      const skinId = Number(selection?.skinId || 0);
      if (!championId || !skinId || skinId === championId * 1000) continue;

      let baseSkinId = skinId;
      try {
        const catalog = await fetchLcuChampionSkinData(championId);
        baseSkinId = Number(catalog?.baseSkinByChroma?.get(skinId) || skinId);
      } catch (error) {
        window.riftAtlas.appendOverlayLog(`[Rose/Swiftplay] LCU no resolvio base de ${skinId}; busco el paquete numerico exacto. ${error.message || error}`).catch(() => { });
      }

      const skin = await getOrRegisterLeagueSkinPackage(championId, skinId, baseSkinId, String(skinId));
      if (!skin) {
        window.riftAtlas.appendOverlayLog(`[Rose/Swiftplay] Falta LeagueSkins para champion=${championId} skin=${skinId} base=${baseSkinId}.`).catch(() => { });
        continue;
      }
      const key = getSkinKey(skin);
      queueSkinKey(key, { sessionSource: "pengu", preserveExistingChampion: true });
      resolvedKeys.push(key);
    }

    if (!resolvedKeys.length) {
      throw new Error("No se resolvio ninguna skin no-base de Swiftplay en LeagueSkins.");
    }
    saveQueuedSkins();
    renderSkinLibrary();
    renderSelectionTray();
    window.riftAtlas.appendOverlayLog(`[Rose/Swiftplay] Compilando ${resolvedKeys.length} seleccion(es) antes de encontrar partida.`).catch(() => { });
    applied = Boolean(await applyQueuedSkins(resolvedKeys, {
      skipPreflight: true,
      source: "swiftplay-searching"
    }));
    return applied;
  } finally {
    if (!applied) {
      state.roseFinalizationCommitted = false;
      state.roseFinalizationSignature = "";
      await stopRoseEarlyMonitor("swiftplay-no-apply");
    }
    state.roseFinalizationApplyStarted = false;
  }
};

const getOverlayBaseSkinId = (skin = {}, championId = 0) => {
  const numericChampionId = Number(championId || getSkinSyncChampionNumber(skin) || 0);
  const rawSkinId = Number(skin.rawSkin || skin.skinId || 0);
  if (rawSkinId >= 1000) return rawSkinId;
  if (Number.isFinite(rawSkinId) && rawSkinId >= 0 && numericChampionId) {
    return (numericChampionId * 1000) + rawSkinId;
  }
  return getOverlayTargetSkinId(skin, numericChampionId);
};

const isRoseOwnedSkinId = (skinId = 0) => {
  const id = Number(skinId || 0);
  if (!Number.isFinite(id) || id <= 0) return false;
  // Rose's is_owned(): champion default/base skin is always owned, even if the
  // inventory endpoint does not include it.
  return id % 1000 === 0 || state.penguOwnedSkinIds.has(id);
};

// =============================================================================
// Form/Chroma Special Cases (Rose-style)
// Maps form skin IDs to their base skin IDs for proper injection.
// Forms are special chromas that don't follow the normal chroma model.
// =============================================================================
const FORM_SKIN_MAP = {
  // Elementalist Lux — 9 forms
  99991: 99007, 99992: 99007, 99993: 99007, 99994: 99007, 99995: 99007,
  99996: 99007, 99997: 99007, 99998: 99007, 99999: 99007,
  // Sahn Uzal Mordekaiser — 2 forms
  82998: 82054, 82999: 82054,
  // Spirit Blossom Morgana — 1 form
  25999: 25080,
  // Radiant Sett — 2 forms
  875998: 875066, 875999: 875066,
  // KDA Seraphine — 2 forms
  147002: 147001, 147003: 147001,
  // Viego — 6 forms
  234994: 234043, 234995: 234043, 234996: 234043,
  234997: 234043, 234998: 234043, 234999: 234043,
  // Gun Goddess Miss Fortune — 3 forms
  21997: 21016, 21998: 21016, 21999: 21016,
  // Risen Legend Kai'Sa — 1 HOL chroma
  145071: 145070,
  // Risen Legend Ahri — 2 HOL chromas
  103086: 103085, 103087: 103085,
};

/**
 * Check if a skin ID is a form skin. If so, return its base skin ID.
 * Returns null if not a form skin.
 */
const getFormBaseSkinId = (skinId) => {
  const id = Number(skinId || 0);
  if (!id) return null;
  return FORM_SKIN_MAP[id] || null;
};

/**
 * Check if a skin ID is a form skin.
 */
const isFormSkin = (skinId) => {
  return getFormBaseSkinId(skinId) !== null;
};

const getOverlayForceSkinId = (skin = {}, payload = {}, championId = 0) => {
  const numericChampionId = Number(championId || getSkinSyncChampionNumber(skin) || 0);
  const championBaseId = numericChampionId ? numericChampionId * 1000 : 0;
  const targetSkinId = getOverlayTargetSkinId(skin, numericChampionId);
  const payloadChromaId = Number(payload.chromaId || payload.selectedChromaId || 0);
  const baseSkinId = Number(payload.resolvedBaseSkinId || getOverlayBaseSkinId(skin, numericChampionId) || 0);
  const payloadBaseSkinId = Number(payload.baseSkinId || 0);
  const isChromaPayload = payload.type === "chroma-selection" || (
    payloadChromaId > 0 &&
    payloadChromaId !== championBaseId &&
    payloadChromaId !== targetSkinId
  );

  // Form/Chroma special cases: if the payload chroma is a form, resolve to base
  const formBaseId = getFormBaseSkinId(payloadChromaId);
  if (formBaseId) {
    return formBaseId;
  }

  if (isChromaPayload && payloadChromaId > 0) {
    if (isRoseOwnedSkinId(payloadChromaId) || isRoseOwnedSkinId(baseSkinId)) {
      return payloadChromaId;
    }
    return championBaseId;
  }

  if (targetSkinId > 0 && isRoseOwnedSkinId(targetSkinId)) {
    return targetSkinId;
  }

  // Rose: unowned skins inject over the champion base WAD in client.
  if (targetSkinId > 0 && !isRoseOwnedSkinId(targetSkinId)) {
    return championBaseId;
  }

  if (payloadBaseSkinId > championBaseId && !isRoseOwnedSkinId(payloadBaseSkinId)) {
    return championBaseId;
  }

  return targetSkinId || championBaseId;
};

const maybeForceLeagueSkinForOverlay = async (skin = {}, payload = {}) => {
  const payloadChampionId = Number(payload.championId || payload.champion?.id || 0);
  const skinChampionId = Number(getSkinSyncChampionNumber(skin) || 0);
  if (payloadChampionId && skinChampionId && payloadChampionId !== skinChampionId) {
    window.riftAtlas.appendOverlayLog(`[Diagnostico] skip force-skin overlay: payloadChampionId=${payloadChampionId} skinChampionId=${skinChampionId} mod=${skin.name || skin.skin || skin.path || "desconocido"}`).catch(() => { });
    return;
  }
  const championId = Number(payloadChampionId || skinChampionId || 0);
  // Rose-style: verificar stale de lastPenguLcuSelection (>60s o champion mismatch)
  const lcuSelectionStale = !lastPenguLcuSelection ||
    lastPenguLcuSelection.championId !== championId ||
    (Date.now() - lastPenguLcuSelection.at) > 60000;
  const actualSelection = lcuSelectionStale
    ? 0
    : Number(lastPenguLcuSelection.selectedSkinId || 0);
  const selectedSkinId = Number(actualSelection || payload.actualLcuSkinId || 0);
  if (!championId) return true;

  const targetSkinId = getOverlayTargetSkinId(skin, championId);
  const desiredSkinId = getOverlayForceSkinId(skin, payload, championId);
  const ownedTarget = targetSkinId > 0 && isRoseOwnedSkinId(targetSkinId);

  window.riftAtlas.appendOverlayLog(`[TrackerDiag] maybeForce: championId=${championId} selectedSkinId=${selectedSkinId} desiredSkinId=${desiredSkinId} targetSkinId=${targetSkinId} hasTracker=${Boolean(window.riftAtlas.startBaseSkinTracking)}`).catch(() => {});
  if (!desiredSkinId || selectedSkinId === desiredSkinId) return true;
  window.riftAtlas.appendOverlayLog(`[Diagnostico] force-skin estilo Rose: championId=${championId} selected=${selectedSkinId || "?"} target=${targetSkinId || "?"} owned=${ownedTarget ? "si" : "no"} ownedReady=${state.penguOwnedSkinsReady ? "si" : "no"} desired=${desiredSkinId}`).catch(() => { });
  const forcingUnownedBase = !ownedTarget && desiredSkinId !== targetSkinId;
  if (forcingUnownedBase) {
    // Exact Rose ordering: skip the forced base echo immediately before the
    // direct LCU write, not when the user merely selects the unowned skin.
    window.riftAtlas.sendPenguMessage?.({
      type: "skip-base-skin",
      championId,
      baseSkinId: desiredSkinId,
      targetSkinId,
      skinName: payload.resolvedSkinName || payload.skin || payload.originalName || "",
      durationMs: 15000,
    }).catch(() => null);
  }
  let result;
  if (window.riftAtlas.forceLcuSkinSelection) {
    // BaseSkinTracker: start tracking PATCH→confirmation latency
    if (window.riftAtlas.startBaseSkinTracking) {
      window.riftAtlas.appendOverlayLog(`[TrackerDiag] calling startBaseSkinTracking(${desiredSkinId})`).catch(() => {});
      window.riftAtlas.startBaseSkinTracking(desiredSkinId);
    }
    result = await window.riftAtlas.forceLcuSkinSelection(championId, desiredSkinId)
      .catch((error) => ({
        forceOk: false,
        requestAccepted: false,
        verifiedSkinId: 0,
        forceError: error?.message || String(error),
      }));
    // Rose-style: si el comando Rust falla, reintentar via Pengu WebSocket
    if (!result?.forceOk && window.riftAtlas.sendPenguMessage) {
      window.riftAtlas.appendOverlayLog(`[Rose] force Rust fallo; reintento via Pengu WebSocket (estilo Rose dos intentos).`).catch(() => { });
      const forceRequestId = `force-${championId}-${desiredSkinId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const confirmation = new Promise((resolve) => {
        const timeout = setTimeout(() => {
          pendingPenguForceSkinRequests.delete(forceRequestId);
          resolve({ forceOk: false, forceError: `Timeout esperando confirmacion LCU para ${desiredSkinId}.` });
        }, 12000);
        pendingPenguForceSkinRequests.set(forceRequestId, {
          resolve: (confirmationResult) => {
            clearTimeout(timeout);
            resolve(confirmationResult);
          }
        });
      });
      const sendResult = await window.riftAtlas.sendPenguMessage?.({
        type: "force-skin",
        championId,
        selectedSkinId: desiredSkinId,
        targetSkinId,
        owned: ownedTarget,
        forceRequestId,
        reason: ownedTarget ? "owned-skin-overlay" : "unowned-overlay-base-skin"
      }).catch((error) => ({ sent: false, error: error?.message || String(error) }));
      const messageSent = sendResult?.sent === true || Number(sendResult?.sent || 0) > 0;
      if (!messageSent) {
        pendingPenguForceSkinRequests.get(forceRequestId)?.resolve?.({
          forceOk: false,
          forceError: sendResult?.error || "Pengu no esta conectado; no se pudo enviar el cambio de skin."
        });
      }
      result = await confirmation;
      pendingPenguForceSkinRequests.delete(forceRequestId);
    }
    // BaseSkinTracker: record confirmation
    window.riftAtlas.appendOverlayLog(`[TrackerDiag] forceLcuSkinSelection result: forceOk=${result?.forceOk} verifiedSkinId=${result?.verifiedSkinId} desiredSkinId=${desiredSkinId}`).catch(() => {});
    if (result?.forceOk && result?.verifiedSkinId === desiredSkinId) {
      if (window.riftAtlas.onBaseSkinConfirmed) {
        window.riftAtlas.appendOverlayLog(`[TrackerDiag] calling onBaseSkinConfirmed(${desiredSkinId})`).catch(() => {});
        window.riftAtlas.onBaseSkinConfirmed(desiredSkinId);
      }
    } else {
      if (window.riftAtlas.onChampSelectExit) {
        window.riftAtlas.appendOverlayLog(`[TrackerDiag] calling onChampSelectExit (force failed/verified mismatch)`).catch(() => {});
        window.riftAtlas.onChampSelectExit().catch(() => {});
      }
    }
  } else {
    // Legacy Electron fallback. Tauri uses the authenticated Rust command above
    // and does not depend on the Pengu websocket for LCU writes.
    const forceRequestId = `force-${championId}-${desiredSkinId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const confirmation = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingPenguForceSkinRequests.delete(forceRequestId);
        resolve({ forceOk: false, forceError: `Timeout esperando confirmacion LCU para ${desiredSkinId}.` });
      }, 12000);
      pendingPenguForceSkinRequests.set(forceRequestId, {
        resolve: (confirmationResult) => {
          clearTimeout(timeout);
          resolve(confirmationResult);
        }
      });
    });
    const sendResult = await window.riftAtlas.sendPenguMessage?.({
      type: "force-skin",
      championId,
      selectedSkinId: desiredSkinId,
      targetSkinId,
      owned: ownedTarget,
      forceRequestId,
      reason: ownedTarget ? "owned-skin-overlay" : "unowned-overlay-base-skin"
    }).catch((error) => ({ sent: false, error: error?.message || String(error) }));
    const messageSent = sendResult?.sent === true || Number(sendResult?.sent || 0) > 0;
    if (!messageSent) {
      pendingPenguForceSkinRequests.get(forceRequestId)?.resolve?.({
        forceOk: false,
        forceError: sendResult?.error || "Pengu no esta conectado; no se pudo enviar el cambio de skin."
      });
    }
    result = await confirmation;
    pendingPenguForceSkinRequests.delete(forceRequestId);
  }
  if (!result?.forceOk || Number(result.verifiedSkinId || 0) !== desiredSkinId) {
    const requestAccepted = result?.requestAccepted === true;
    if (forcingUnownedBase && !requestAccepted) {
      window.riftAtlas.sendPenguMessage?.({ type: "skip-base-skin-clear" }).catch(() => null);
    }
    const actual = Number(result?.verifiedSkinId || 0) || "?";
    const detail = result?.forceError || `LCU conserva ${actual}`;
    window.riftAtlas.appendOverlayLog(`[Rose] force-skin NO confirmado: desired=${desiredSkinId} actual=${actual} accepted=${result?.requestAccepted === true ? "si" : "no"} error=${detail}`).catch(() => { });
    if (requestAccepted) {
      lastPenguLcuSelection = { championId, selectedSkinId: desiredSkinId, at: Date.now() };
      window.riftAtlas.appendOverlayLog(`[Rose] LCU acepto ${desiredSkinId}; mantengo skip-base y continuo como Rose aunque la verificacion tarde.`).catch(() => { });
    }
    // Rose treats an LCU force failure as a warning. The overlay injection still
    // runs with League's current selection instead of being cancelled here.
    window.riftAtlas.appendOverlayLog("[Rose] Se continua la inyeccion pese al fallo al forzar la skin (comportamiento Rose).").catch(() => { });
    return false;
  }
  lastPenguLcuSelection = { championId, selectedSkinId: desiredSkinId, at: Date.now() };
  window.riftAtlas.appendOverlayLog(`[Rose] force-skin confirmado por LCU: ${desiredSkinId} via ${result.forceMethod || "desconocido"}.`).catch(() => { });
  return true;
};

const shouldPreforceUnownedBaseForFinalization = (skin = {}, payload = {}) => {
  if (String(state.penguGameflowPhase || "") !== "FINALIZATION") return false;
  const championId = Number(
    payload.championId ||
    payload.champion?.id ||
    getSkinSyncChampionNumber(skin) ||
    0
  );
  if (!championId) return false;
  const targetSkinId = getOverlayTargetSkinId(skin, championId);
  const desiredSkinId = getOverlayForceSkinId(skin, payload, championId);
  return targetSkinId > 0 &&
    desiredSkinId === championId * 1000 &&
    targetSkinId !== desiredSkinId &&
    !isRoseOwnedSkinId(targetSkinId);
};

const preforceUnownedBaseForFinalization = async (skin = {}, payload = {}, reason = "selection") => {
  if (!shouldPreforceUnownedBaseForFinalization(skin, payload)) return false;
  const championId = Number(payload.championId || payload.champion?.id || getSkinSyncChampionNumber(skin) || 0);
  const targetSkinId = getOverlayTargetSkinId(skin, championId);
  const desiredSkinId = getOverlayForceSkinId(skin, payload, championId);
  const signature = `${championId}:${targetSkinId}:${desiredSkinId}`;
  const now = Date.now();
  if (signature === lastRosePreforceSignature && now - lastRosePreforceAt < 5000) return false;
  lastRosePreforceSignature = signature;
  lastRosePreforceAt = now;
  window.riftAtlas.appendOverlayLog(
    `[RosePreforce] FINALIZATION preforce ${desiredSkinId} para target no owned ${targetSkinId} (${reason}).`
  ).catch(() => { });
  await startRoseEarlyMonitor(`preforce-${reason}`);
  await maybeForceLeagueSkinForOverlay(skin, payload);
  return true;
};

const getPenguSupportModKeys = (selectedKey = "", activeChampionId = 0) =>
  [...state.queuedSkins].filter((queuedKey) => {
    if (queuedKey === selectedKey) return false;
    const queuedSkin = getSkinByKey(queuedKey);
    if (!queuedSkin) return true;
    if (queuedSkin.custom && !isDownloadedLeagueSkinsPath(queuedKey)) {
      const modChampionId = getSkinSyncChampionNumber(queuedSkin);
      // Una sola skin por campeon, como Rose. Los mods sin campeon y las
      // skins de otros jugadores/party pueden acompanar la seleccion.
      return !modChampionId || !activeChampionId || modChampionId !== activeChampionId;
    }
    return !getQueueChampionKey(queuedSkin);
  });

const getSelectedRoseExtraMods = async () => {
  try {
    const selectedResult = await window.riftAtlas.modStorageGetSelectedMods?.();
    const selectedMods = selectedResult?.selectedMods || {};
    return Object.entries(selectedMods)
      .filter(([category, modInfo]) => category !== "skins" && modInfo?.mod_path)
      .map(([category, modInfo]) => ({
        path: modInfo.mod_path,
        name: modInfo.mod_name || modInfo.mod_id || "",
        category
      }));
  } catch (error) {
    window.riftAtlas.appendOverlayLog(`[Rose] No pude cargar mods extra seleccionados: ${error.message || error}`).catch(() => { });
    return [];
  }
};

const applyPenguSelectedSkin = async (key = "") => {
  if (!key) return false;
  // Rose: si hay una inyeccion en curso para una skin DIFERENTE, cancelarla
  // y arrancar la nueva inmediatamente. Esto evita que la skin vieja se vea
  // por segundos mientras la nueva se construye.
  if (state.injectionInProgress && key !== penguBackgroundApplyInFlightKey) {
    if (penguBackgroundApplyInFlightKey) {
      window.riftAtlas.appendOverlayLog(`[Rose] Cancelando inyeccion anterior (${penguBackgroundApplyInFlightKey}) para ${key}.`).catch(() => { });
      if (window.riftAtlas.stopOverlay) {
        window.riftAtlas.stopOverlay().catch(() => {});
      }
      state.overlayRunning = false;
    }
  } else if (state.injectionInProgress) {
    window.riftAtlas.appendOverlayLog(`[Rose] Inyeccion en progreso; espero hasta 2s por la anterior para ${key}.`).catch(() => { });
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (!state.injectionInProgress) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => { clearInterval(check); resolve(); }, 2000);
    });
  }
  state.injectionInProgress = true;
  const now = Date.now();
  const applyGen = penguApplyGeneration;
  state.penguApplyLockedKey = key;
  state.penguApplyLockedAt = now;
  if (key === penguBackgroundApplyInFlightKey) {
    window.riftAtlas.appendOverlayLog(`[Diagnostico] applyPenguSelectedSkin: reutilizo apply en vuelo para ${key}`).catch(() => { });
    return penguBackgroundApplyPromise;
  }
  if (key === penguBackgroundApplyKey && now - penguBackgroundApplyAt < 12000) {
    return penguBackgroundApplyPromise;
  }

  penguBackgroundApplyKey = key;
  penguBackgroundApplyAt = now;
  // Rose-style force_disconnect: pausa procesamiento de payloads durante inyeccion
  state.penguProcessingLocked = true;
  penguBackgroundApplyPromise = penguBackgroundApplyPromise
    .catch(() => null)
    .then(async () => {
      if (applyGen !== penguApplyGeneration) {
        window.riftAtlas.appendOverlayLog(`[Diagnostico] applyPenguSelectedSkin: abandonado por champion exchange (gen ${applyGen} != ${penguApplyGeneration})`).catch(() => { });
        return false;
      }
      if (key !== penguBackgroundApplyKey) return false;
      penguBackgroundApplyInFlightKey = key;

      const skin = getSkinByKey(key);
      if (!skin?.path) {
        window.riftAtlas.appendOverlayLog(`[Diagnostico] applyPenguSelectedSkin: skin sin path. key=${key} skin=`, skin).catch(() => { });
        throw new Error("La skin seleccionada no tiene archivo local.");
      }
      // Rose-style base skin guard: reject injection for base skins (champion * 1000)
      const skinChampion = getSkinSyncChampionNumber(skin);
      if (skinChampion > 0) {
        const rawSkinId = Number(skin.skinId || skin.fileBaseId || 0);
        if (!isUserCustomSkin(skin) && rawSkinId === skinChampion * 1000) {
          window.riftAtlas.appendOverlayLog("[Rose] Base skin detectada; no se inyecta overlay (Rose: ui_skin_id==0 skip).").catch(() => { });
          return false;
        }
      }

      window.riftAtlas.appendOverlayLog(`[Diagnostico] applyPenguSelectedSkin: overlayRunning=${state.overlayRunning} customOverlayPath=${!!state.customOverlayPath} ltkSidecar=${!!state.ltkOverlaySidecarPath} ltkDll=${!!state.ltkOverlayDllPath}`).catch(() => { });

      if (state.overlayRunning) {
        window.riftAtlas.appendOverlayLog(`[Diagnostico] Reemplazando overlay activo sin detener monitor temprano (estilo Rose/chroma).`).catch(() => { });
      }

      // Re-verificar por si llegaron mas peticiones mientras preparabamos la inyeccion
      if (key !== penguBackgroundApplyKey) return false;

      const earlySkin = getSkinByKey(key);
      const authoritativePayload = roseAuthoritativeSelection.payload || lastPenguSkinSyncPayload || {};
      const lateResolved = await resolveRoseAuthoritativeSkinEntry(authoritativePayload, earlySkin);
      const penguSkin = lateResolved.skin || earlySkin;
      const lateAuthoritativePayload = lateResolved.payload || authoritativePayload;
      if (!penguSkin?.path) {
        throw new Error("No pude resolver la skin autoritativa para inyectar.");
      }
      if (getSkinKey(penguSkin) !== key) {
        window.riftAtlas.appendOverlayLog(
          `[RoseResolver] sustituyo key temprano=${key} por key final=${getSkinKey(penguSkin)}.`
        ).catch(() => { });
      }
      const activeChampionId = Number(roseAuthoritativeSelection.championId || 0) ||
        getChampionIdFromSkinSyncPayload(lateAuthoritativePayload) ||
        getSkinSyncChampionNumber(penguSkin);
      const finalSkinKey = getSkinKey(penguSkin);
      const supportKeys = getPenguSupportModKeys(finalSkinKey, activeChampionId);
      const supportEntries = supportKeys.map(getSkinByKey).filter(Boolean);
      const selectedIsCustomSkin = Boolean(penguSkin.custom && !isDownloadedLeagueSkinsPath(getSkinKey(penguSkin)));
      const customTargetSkinId = getOverlayTargetSkinId(penguSkin, activeChampionId);
      const customTargetOwned = customTargetSkinId > 0 && isRoseOwnedSkinId(customTargetSkinId);
      let customBasePackage = null;
      if (selectedIsCustomSkin && customTargetSkinId > 0 && !customTargetOwned) {
        const customBaseSkinId = getOverlayBaseSkinId(penguSkin, activeChampionId) || customTargetSkinId;
        customBasePackage = await getOrRegisterLeagueSkinPackage(
          activeChampionId,
          customBaseSkinId,
          customBaseSkinId,
          penguSkin.skin || penguSkin.name || ""
        ).catch((error) => {
          window.riftAtlas.appendOverlayLog(`[Rose] No pude resolver la skin base para el mod propio: ${error.message || error}`).catch(() => { });
          return null;
        });
        if (!customBasePackage) {
          throw new Error(`El mod propio apunta a la skin no owned ${customTargetSkinId}, pero falta su paquete base en LeagueSkins.`);
        }
        window.riftAtlas.appendOverlayLog(`[Rose] Mod propio para skin no owned ${customTargetSkinId}: se incluye paquete base ${getSkinKey(customBasePackage)}.`).catch(() => { });
      }
      for (const supportEntry of supportEntries) {
        await maybeForceLeagueSkinForOverlay(supportEntry, lateAuthoritativePayload);
      }
      // Rose Branch 1: When a custom mod targets an owned skin, Rose does NOT
      // force the LCU selection — it injects only the custom mod overlay and
      // returns immediately. The user's LCU selection stays untouched.
      if (selectedIsCustomSkin && customTargetOwned) {
        window.riftAtlas.appendOverlayLog(
          `[Rose] Mod propio para skin owned (target=${customTargetSkinId}); salto force frontend, backend confirmara el target antes de mkoverlay.`
        ).catch(() => { });
      } else {
        await maybeForceLeagueSkinForOverlay(penguSkin, lateAuthoritativePayload);
      }
      if (key !== penguBackgroundApplyKey) {
        window.riftAtlas.appendOverlayLog(`[Diagnostico] applyPenguSelectedSkin: cancelado por seleccion mas nueva ${penguBackgroundApplyKey}`).catch(() => { });
        return false;
      }

      // Rose forces the owned target/base skin before starting its persistent
      // game monitor. This keeps the PATCH inside ChampSelect instead of racing
      // the transition to InProgress.
      await startRoseEarlyMonitor(`apply-${key}`);

      // Rose always includes the selected LeagueSkins package. Ownership only
      // determines whether LCU keeps the target skin/chroma or is forced to base.
      const championIdForOwnedCheck = getSkinSyncChampionNumber(penguSkin) || activeChampionId;
      const targetSkinId = getOverlayTargetSkinId(penguSkin, championIdForOwnedCheck);
      const isOwned = targetSkinId > 0 && isRoseOwnedSkinId(targetSkinId);
      const isChromaSelection = lastPenguChromaSelection &&
        lastPenguChromaSelection.championId === championIdForOwnedCheck &&
        (Date.now() - lastPenguChromaSelection.at) < 120000;
      if (isOwned) {
        window.riftAtlas.appendOverlayLog(`[Rose] Skin owned (id=${targetSkinId}); LCU fuerza el target y LeagueSkins permanece en el overlay.`).catch(() => { });
      }
      if (isOwned && isChromaSelection) {
        window.riftAtlas.appendOverlayLog(`[Rose] Chroma selected (id=${lastPenguChromaSelection.chromaId}) for owned base skin (id=${targetSkinId}) — running overlay for chroma texture.`).catch(() => { });
      }

      const selectedEntries = [customBasePackage, penguSkin, ...supportEntries].filter(Boolean);
      const extraMods = await getSelectedRoseExtraMods();
      window.riftAtlas.appendOverlayLog(`[Diagnostico] Modo Rose: mkoverlay fresco y unico para ${selectedEntries.length} mod(s).`).catch(() => { });
      if (!window.riftAtlas.runRoseOverlay) throw new Error("Runner RoseV2 no disponible; reinicia la aplicacion.");
      const result = await window.riftAtlas.runRoseOverlay({
        sidecarPath: state.ltkOverlaySidecarPath,
        dllPath: state.ltkOverlayDllPath,
        gamePath: state.leagueGamePath,
        skinEntries: selectedEntries,
        extraMods,
        roseMode: true,
        // Rose-style: enviamos el ID objetivo al backend para que fuerce la
        // seleccion LCU ANTES de mkoverlay. Esto evita que una skin previa
        // (ej. Callejera) quede "pegada" cuando cambiamos a otra (Embrujada).
        championId: championIdForOwnedCheck,
        selectedSkinId: targetSkinId
      });
      if (result?.success) {
        state.lastHoverWritten = true;
        state.lastRoseInjectionTime = Date.now();
      }
      return Boolean(result?.success);
    })
    .finally(async () => {
      state.injectionInProgress = false;
      state.penguProcessingLocked = false;
      if (penguBackgroundApplyInFlightKey === key) {
        penguBackgroundApplyInFlightKey = "";
      }
      if (!shouldKeepRoseEarlyMonitor()) {
        await stopRoseEarlyMonitor("pengu-apply-finally");
      }
    });

  return penguBackgroundApplyPromise;
};

const extractChampionIdFromSkinKey = (key = "") => {
  const match = String(key).match(/[/\\]skins?[/\\](\d+)[/\\]/i);
  return match ? Number(match[1]) : 0;
};

const shouldIgnorePenguSwitchDuringApply = (nextKey = "", payload = {}) => {
  const lockedKey = penguBackgroundApplyInFlightKey || state.penguApplyLockedKey;
  if (!nextKey || !lockedKey || nextKey === lockedKey) return false;
  const lockedChampId = extractChampionIdFromSkinKey(lockedKey);
  const nextChampId = extractChampionIdFromSkinKey(nextKey) || Number(payload.championId || 0);
  if (lockedChampId && nextChampId && lockedChampId === nextChampId) return false;
  if (lockedChampId && nextChampId && lockedChampId !== nextChampId) {
    window.riftAtlas.appendOverlayLog(`[Diagnostico] skin-sync champion cambio ${lockedChampId}->${nextChampId}; limpiando apply stale (estilo Rose exchange).`).catch(() => { });
    penguBackgroundApplyKey = "";
    penguBackgroundApplyInFlightKey = "";
    clearPenguApplyLock();
    return false;
  }
  const lockAge = Date.now() - Number(state.penguApplyLockedAt || 0);
  const applyIsHot = Boolean(
    penguBackgroundApplyInFlightKey ||
    state.roseFinalizationApplyStarted ||
    ["FINALIZATION", "GameStart", "InProgress", "Reconnect"].includes(String(state.penguGameflowPhase || ""))
  );
  if (!applyIsHot && lockAge > 45000) return false;
  window.riftAtlas.appendOverlayLog(`[Diagnostico] skin-sync ignorado durante apply estilo Rose: locked=${lockedKey} next=${nextKey} lockedChamp=${lockedChampId} nextChamp=${nextChampId} skin=${payload.skin || ""} selectedSkinId=${payload.selectedSkinId || payload.skinId || ""}`).catch(() => { });
  return true;
};

async function handlePenguSkinApply(payload = {}) {
  const key = payload.key || payload.path;
  window.riftAtlas.appendOverlayLog(`[Diagnostico] handlePenguSkinApply: key=${key}`).catch(() => { });
  const skin = getSkinByKey(key);
  if (!skin) {
    window.riftAtlas.appendOverlayLog(`[Diagnostico] handlePenguSkinApply: skin NO encontrada en customMods/skinLibrary`).catch(() => { });
    await window.riftAtlas.sendPenguMessage?.({
      type: "skin-apply-result",
      ok: false,
      key,
      message: "La skin ya no esta en la biblioteca de Rift Atlas."
    }).catch(() => null);
    return;
  }

  const isPenguAutoApply = payload.type === "skin-sync" ||
    payload.type === "chroma-selection" ||
    payload.source === "rift-atlas-party" ||
    payload.source === "LU-ChromaWheel";
  const queueResult = queueSkinKey(getSkinKey(skin), {
    sessionSource: isPenguAutoApply ? "pengu" : ""
  });
  window.riftAtlas.appendOverlayLog(
    `[Diagnostico] cola overlay actualizada: queued=${queueResult.queued} replaced=${queueResult.replaced || 0} total=${state.queuedSkins.size} key=${queueResult.key || getSkinKey(skin)}`
  ).catch(() => { });
  saveQueuedSkins();
  renderSkinLibrary();
  renderSelectionTray();
  sendPenguSkinCatalog("skin-selected-in-client");

  let applied = false;
  let applyMessage = "";
  if (payload.apply !== false) {
    try {
      setOverlayPanelStatus({
        label: "Aplicando",
        message: `Compilando overlay para ${getSkinVisibleName(skin)}...`
      });
      applied = await applyPenguSelectedSkin(getSkinKey(skin));
      if (applied) {
        applyMessage = "Skin aplicada en background desde champ select.";
      } else if (getSkinKey(skin) !== penguBackgroundApplyKey) {
        applyMessage = "Solicitud reemplazada por una skin mas reciente.";
      } else {
        applyMessage = "No se pudo activar el overlay; revisa el panel de overlay para ver el error.";
      }
      window.riftAtlas.appendOverlayLog(`[Diagnostico] applyPenguSelectedSkin resulto: applied=${applied}`).catch(() => { });
      if (applied) {
        setOverlayPanelStatus({
          label: "Overlay activo",
          message: "Overlay activo. Entra a partida para ver las skins.",
          active: true
        });
        await refreshOverlayStatus();
      }
    } catch (error) {
      applyMessage = String(error?.message || error || "No pude aplicar la skin en background.");
      window.riftAtlas.appendOverlayLog(`[Diagnostico] applyPenguSelectedSkin ERROR: ${applyMessage}`).catch(() => { });
    }
  }

  await window.riftAtlas.sendPenguMessage?.({
    type: "skin-apply-result",
    ok: !applyMessage || applied || getSkinKey(skin) !== penguBackgroundApplyKey,
    key: getSkinKey(skin),
    name: getSkinDisplayName(skin),
    queuedOnly: !applied,
    applied,
    message: applyMessage
  }).catch(() => null);
  sendPenguSkinCatalog("skin-applied");
  return applied;
}

let lastPenguSkinSyncKey = "";
let lastPenguSkinSyncAt = 0;
let lastPenguSkinSyncPayload = null;
let lastPenguLcuSelection = null;
let lastPenguChromaSelection = null;
let lastPenguChromaPanel = null;
let lastRosePreforceSignature = "";
let lastRosePreforceAt = 0;
let roseAuthoritativeSelection = {
  revision: 0,
  championId: 0,
  baseSkinId: 0,
  effectiveSkinId: 0,
  chromaId: 0,
  skinKey: "",
  name: "",
  payload: null,
  updatedAt: 0,
};
let lastCustomModStateSignature = "";
let lastCustomModStatePayload = null;

const isUserCustomSkin = (skin = {}) =>
  Boolean(skin?.custom && !isDownloadedLeagueSkinsPath(getSkinKey(skin)));

const sendCustomModStatePayload = (payload = {}) => {
  window.riftAtlas.sendPenguMessage?.({
    ...payload,
    timestamp: Date.now()
  }).catch(() => null);
};

const publishCustomModState = (skin = null, payload = {}, options = {}) => {
  const isActive = Boolean(skin && isUserCustomSkin(skin));
  const championId = Number(payload.championId || getSkinSyncChampionNumber(skin || {}) || 0);
  const skinId = Number(payload.requestedSkinId || payload.resolvedSkinId || getOverlayTargetSkinId(skin || {}, championId) || 0);
  const modName = isActive ? getSkinVisibleName(skin) : "";
  const signature = isActive ? `${getSkinKey(skin)}:${championId}:${skinId}:${modName}` : "inactive";
  const message = {
    type: "custom-mod-state",
    source: "rift-atlas-app",
    active: isActive,
    modName,
    championId: championId || undefined,
    skinId: skinId || undefined,
    modPath: isActive ? skin.path : undefined
  };
  lastCustomModStatePayload = message;
  if (!options.force && signature === lastCustomModStateSignature) return;
  lastCustomModStateSignature = signature;
  sendCustomModStatePayload(message);
};

const replayCustomModState = () => {
  if (!lastCustomModStatePayload) return;
  sendCustomModStatePayload(lastCustomModStatePayload);
};

const clearRoseAuthoritativeSelection = () => {
  roseAuthoritativeSelection = {
    revision: roseAuthoritativeSelection.revision + 1,
    championId: 0,
    baseSkinId: 0,
    effectiveSkinId: 0,
    chromaId: 0,
    skinKey: "",
    name: "",
    payload: null,
    updatedAt: Date.now(),
  };
  publishCustomModState(null);
};
let lastPenguSkinId = 0;

const normalizeSkinSyncText = (value = "") =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const getSkinSyncTokens = (value = "") =>
  normalizeSkinSyncText(value)
    .split(/\s+/)
    .filter((token) => token.length > 1);

const levenshteinSimilarity = (left = "", right = "") => {
  const a = normalizeSkinSyncText(left);
  const b = normalizeSkinSyncText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return 1 - (previous[b.length] / Math.max(a.length, b.length));
};

const getRoseSkinNameCandidates = (value = "") => {
  const original = String(value || "").trim();
  if (!original) return [];
  // League appends localized chroma colours to the base skin name. Rose tests
  // both the original value and a suffix-stripped variant before fuzzy matching.
  const stripped = original
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/\s*[–—]\s*["'‘’]{0,2}[^"'‘’]+["'‘’]{0,2}\s*$/u, "")
    .trim();
  return [...new Set([original, stripped].filter(Boolean))];
};

const getOrRegisterLeagueSkinPackage = async (championId, skinId, baseSkinId = skinId, skinName = "") => {
  if (!championId || !skinId || skinId === championId * 1000 || !window.riftAtlas.resolveLeagueSkinPackage) return null;
  const pkg = await window.riftAtlas.resolveLeagueSkinPackage(championId, skinId, baseSkinId);
  if (!pkg?.path) return null;
  let entry = state.skinLibrary.find((item) => getSkinKey(item) === pkg.path);
  if (!entry) {
    entry = {
      ...pkg,
      name: pkg.path.split(/[/\\]/).pop() || String(skinId),
      champion: getChampionByNumericId(championId)?.name || String(championId),
      championKey: String(championId),
      skin: skinName || String(skinId),
      skinId,
      skinNum: skinId,
      extension: String(pkg.path).toLowerCase().endsWith(".zip") ? ".zip" : ".fantome",
      resolved: true,
      numericSource: true
    };
    state.skinLibrary.push(entry);
  }
  return entry;
};

const resolveSkinSyncPayloadWithLcu = async (payload = {}) => {
  const championId = getChampionIdFromSkinSyncPayload(payload);
  if (!championId) return payload;
  let skinMap;
  try {
    skinMap = await fetchLcuChampionSkinData(championId);
  } catch (error) {
    window.riftAtlas.appendOverlayLog(`[RoseLCU] No pude cargar skins para championId=${championId}: ${error.message || error}`).catch(() => { });
    return payload;
  }
  if (!skinMap?.size) return payload;

  const attachResolvedPackage = async (resolvedPayload) => {
    const skinId = Number(resolvedPayload.resolvedSkinId || 0);
    const baseSkinId = Number(resolvedPayload.resolvedBaseSkinId || skinId || 0);
    if (!skinId) return resolvedPayload;
    try {
      const entry = await getOrRegisterLeagueSkinPackage(
        championId,
        skinId,
        baseSkinId,
        resolvedPayload.resolvedSkinName
      );
      return entry ? { ...resolvedPayload, resolvedPackagePath: getSkinKey(entry) } : resolvedPayload;
    } catch (error) {
      window.riftAtlas.appendOverlayLog(`[RoseResolver] ${error.message || error}`).catch(() => { });
      return resolvedPayload;
    }
  };

  const explicitChromaId = Number(payload.chromaId || payload.selectedChromaId || 0);
  if (explicitChromaId && skinMap.has(String(explicitChromaId))) {
    const resolvedBaseSkinId = Number(skinMap.baseSkinByChroma?.get(explicitChromaId) || payload.baseSkinId || 0);
    return attachResolvedPackage({
      ...payload,
      resolvedSkinId: explicitChromaId,
      resolvedBaseSkinId,
      resolvedSkinName: skinMap.get(String(explicitChromaId)),
      resolvedHasChromas: true,
      resolutionSource: "lcu"
    });
  }

  // Rose-style: para skin-sync, el nombre del DOM es la fuente de verdad.
  // NO usamos selectedSkinId del payload porque puede ser stale (skin no owned,
  // animacion del carrusel, eco del force anterior). Para chroma-selection u
  // otros eventos con ID explicito, si permitimos el atajo por ID.
  const isNameDrivenSync = payload.type === "skin-sync" && !payload.chromaId && !payload.selectedChromaId;
  const syntheticSkin = parseSyntheticSkinSyncText(payload.skin || payload.originalName || "");
  if (
    isNameDrivenSync &&
    syntheticSkin?.skinId &&
    (!syntheticSkin.championId || syntheticSkin.championId === championId) &&
    skinMap.has(String(syntheticSkin.skinId))
  ) {
    const resolvedBaseSkinId = Number(skinMap.baseSkinByChroma?.get(syntheticSkin.skinId) || syntheticSkin.skinId);
    return attachResolvedPackage({
      ...payload,
      resolvedSkinId: syntheticSkin.skinId,
      resolvedBaseSkinId,
      resolvedSkinName: skinMap.get(String(syntheticSkin.skinId)),
      resolutionSource: "lcu-synthetic"
    });
  }
  if (!isNameDrivenSync) {
    const explicitSkinId = Number(payload.selectedSkinId || payload.skinId || 0);
    if (explicitSkinId && skinMap.has(String(explicitSkinId))) {
      const baseSkinId = Number(skinMap.baseSkinByChroma?.get(explicitSkinId) || payload.baseSkinId || 0);
      return attachResolvedPackage({
        ...payload,
        resolvedSkinId: explicitSkinId,
        resolvedBaseSkinId: Number(skinMap.baseSkinByChroma?.get(explicitSkinId) || baseSkinId || 0),
        resolvedSkinName: skinMap.get(String(explicitSkinId)),
        resolutionSource: "lcu-direct"
      });
    }
  }

  const requestedName = String(payload.skin || payload.originalName || "").trim();
  if (!requestedName) return payload;
  const minimumFullId = championId * 1000;
  const candidates = [...skinMap.entries()]
    .map(([id, name]) => ({ id: Number(id), name: String(name || "") }))
    .filter((entry) => entry.id >= minimumFullId && entry.name)
    .filter((entry, index, list) => list.findIndex((other) => other.id === entry.id) === index);
  if (!candidates.length) return payload;

  const requestedCandidates = getRoseSkinNameCandidates(requestedName);
  const normalizedRequestedCandidates = requestedCandidates.map(normalizeSkinSyncText).filter(Boolean);
  const isChromaEvent = payload.type === "chroma-selection";
  const pool = candidates;

  // Exact match always wins, including the suffix-stripped chroma form.
  for (const requestedCandidate of normalizedRequestedCandidates) {
    const exact = pool.find((candidate) =>
      normalizeSkinSyncText(candidate.name) === requestedCandidate
    );
    if (exact) {
      const resolvedBaseSkinId = Number(skinMap.baseSkinByChroma?.get(exact.id) || exact.id);
      const resolvedHasChromas = [...(skinMap.baseSkinByChroma?.values?.() || [])]
        .some((baseId) => Number(baseId) === resolvedBaseSkinId);
      window.riftAtlas.appendOverlayLog(`[RoseLCU] "${requestedName}" -> skinId=${exact.id} name="${exact.name}" score=1.000 exact`).catch(() => { });
      return attachResolvedPackage({
        ...payload,
        resolvedSkinId: exact.id,
        resolvedBaseSkinId,
        resolvedSkinName: exact.name,
        resolvedHasChromas,
        resolutionSource: "lcu-exact"
      });
    }
  }

  let best = null;
  let bestScore = -1;
  for (const candidate of pool) {
    const normalizedCandidate = normalizeSkinSyncText(candidate.name);
    const score = Math.max(
      ...normalizedRequestedCandidates.map((requestedCandidate) =>
        levenshteinSimilarity(requestedCandidate, normalizedCandidate)
      )
    );
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (!best) return payload;
  window.riftAtlas.appendOverlayLog(`[RoseLCU] "${requestedName}" -> skinId=${best.id} name="${best.name}" score=${bestScore.toFixed(3)}`).catch(() => { });
  const resolvedBaseSkinId = Number(skinMap.baseSkinByChroma?.get(best.id) || best.id);
  const resolvedHasChromas = [...(skinMap.baseSkinByChroma?.values?.() || [])]
    .some((baseId) => Number(baseId) === resolvedBaseSkinId);
  return attachResolvedPackage({
    ...payload,
    resolvedSkinId: best.id,
    resolvedBaseSkinId,
    resolvedSkinName: best.name,
    resolvedHasChromas,
    resolutionSource: "lcu"
  });
};

const canonicalizePenguSkinPayload = (payload = {}, skin = null) => {
  const championId = Number(
    getChampionIdFromSkinSyncPayload(payload) ||
    getSkinSyncChampionNumber(skin || {}) ||
    0
  );
  const isNameDrivenSync = payload.type === "skin-sync" && !payload.chromaId && !payload.selectedChromaId;
  const requestedSkinId = Number(
    payload.chromaId ||
    payload.selectedChromaId ||
    (isNameDrivenSync ? payload.resolvedSkinId : payload.selectedSkinId) ||
    (isNameDrivenSync ? payload.selectedSkinId : payload.resolvedSkinId) ||
    payload.skinId ||
    (skin ? getOverlayTargetSkinId(skin, championId) : 0) ||
    0
  );
  const actualLcuSkinId = lastPenguLcuSelection?.championId === championId
    ? Number(lastPenguLcuSelection.selectedSkinId || 0)
    : 0;
  return {
    ...payload,
    championId: championId || payload.championId,
    requestedSkinId: requestedSkinId || undefined,
    selectedSkinId: requestedSkinId || undefined,
    resolvedSkinId: Number(payload.resolvedSkinId || requestedSkinId || 0) || undefined,
    actualLcuSkinId: actualLcuSkinId || undefined,
    canonical: true,
  };
};

const commitRoseAuthoritativeSelection = (payload = {}, skin = null) => {
  const canonical = canonicalizePenguSkinPayload(payload, skin);
  const championId = Number(canonical.championId || 0);
  const effectiveSkinId = Number(canonical.requestedSkinId || canonical.resolvedSkinId || 0);
  const chromaId = Number(canonical.chromaId || canonical.selectedChromaId || 0);
  const baseSkinId = Number(
    canonical.resolvedBaseSkinId ||
    canonical.baseSkinId ||
    (skin ? getOverlayBaseSkinId(skin, championId) : 0) ||
    effectiveSkinId
  );
  roseAuthoritativeSelection = {
    revision: roseAuthoritativeSelection.revision + 1,
    championId,
    baseSkinId,
    effectiveSkinId,
    chromaId,
    skinKey: skin ? getSkinKey(skin) : String(canonical.key || canonical.path || ""),
    name: String(canonical.resolvedSkinName || canonical.chromaName || canonical.skin || canonical.originalName || ""),
    payload: { ...canonical },
    updatedAt: Date.now(),
  };
  lastPenguSkinSyncPayload = { ...canonical };
  publishCustomModState(skin, canonical);
  if (state.partyStatus === "connected") {
    schedulePartySync(120);
  }
  return canonical;
};

const resolveRoseAuthoritativeSkinEntry = async (payload = {}, fallbackSkin = null) => {
  let resolvedPayload = { ...(payload || {}) };
  const originalSkinText = String(
    resolvedPayload.skin ||
    resolvedPayload.originalName ||
    resolvedPayload.resolvedSkinName ||
    ""
  ).trim();

  if (originalSkinText || Number(resolvedPayload.chromaId || resolvedPayload.selectedChromaId || 0)) {
    resolvedPayload = await resolveSkinSyncPayloadWithLcu(resolvedPayload);
  }

  const championId = Number(
    getChampionIdFromSkinSyncPayload(resolvedPayload) ||
    getSkinSyncChampionNumber(fallbackSkin || {}) ||
    0
  );
  const requestedSkinId = Number(
    resolvedPayload.chromaId ||
    resolvedPayload.selectedChromaId ||
    (resolvedPayload.type === "skin-sync" && !resolvedPayload.chromaId && !resolvedPayload.selectedChromaId
      ? resolvedPayload.resolvedSkinId
      : resolvedPayload.selectedSkinId) ||
    (resolvedPayload.type === "skin-sync" && !resolvedPayload.chromaId && !resolvedPayload.selectedChromaId
      ? resolvedPayload.selectedSkinId
      : resolvedPayload.resolvedSkinId) ||
    resolvedPayload.requestedSkinId ||
    resolvedPayload.skinId ||
    0
  );
  const resolvedBaseSkinId = Number(
    resolvedPayload.resolvedBaseSkinId ||
    resolvedPayload.baseSkinId ||
    requestedSkinId ||
    0
  );
  const champion = championId ? getChampionByNumericId(championId) : null;
  const normalizedOriginalSkinText = normalizeSkinSyncText(originalSkinText);
  const championOnlyPayload = Boolean(normalizedOriginalSkinText && champion) && (
    normalizedOriginalSkinText === normalizeSkinSyncText(champion.name || "") ||
    normalizedOriginalSkinText === normalizeSkinSyncText(champion.id || "")
  );
  const baseSkinId = championId ? championId * 1000 : 0;
  const baseOnlyRequest = Boolean(championOnlyPayload && requestedSkinId && requestedSkinId === baseSkinId);

  let skin = null;
  if (resolvedPayload.resolvedPackagePath) {
    skin = getSkinByKey(resolvedPayload.resolvedPackagePath);
  }

  if ((!skin || !isUserCustomSkin(skin)) && championId && requestedSkinId) {
    const queuedCustomTarget = findQueuedCustomSkinForPenguPayload(resolvedPayload);
    if (queuedCustomTarget) {
      skin = queuedCustomTarget;
      window.riftAtlas.appendOverlayLog(
        `[RoseResolver] custom mod seleccionado gana antes que paquete base: ${getSkinKey(skin)}.`
      ).catch(() => { });
    }
  }

  if ((!skin || !isUserCustomSkin(skin)) && baseOnlyRequest) {
    const queuedCustomChampion = findQueuedCustomModForChampionId(championId);
    if (queuedCustomChampion) {
      skin = queuedCustomChampion;
      window.riftAtlas.appendOverlayLog(
        `[RoseResolver] seleccion base/champion-only usa mod propio seleccionado para championId=${championId}: ${getSkinKey(skin)}.`
      ).catch(() => { });
    }
  }

  if (!skin && championId && requestedSkinId) {
    skin = await getOrRegisterLeagueSkinPackage(
      championId,
      requestedSkinId,
      resolvedBaseSkinId || requestedSkinId,
      resolvedPayload.resolvedSkinName || originalSkinText
    ).catch((error) => {
      window.riftAtlas.appendOverlayLog(`[RoseResolver] paquete late-bound no disponible: ${error.message || error}`).catch(() => { });
      return null;
    });
  }

  if (!skin && baseOnlyRequest) {
    const queuedCustomBaseMod = findQueuedCustomSkinForPenguPayload(resolvedPayload);
    if (queuedCustomBaseMod) {
      skin = queuedCustomBaseMod;
      window.riftAtlas.appendOverlayLog(
        `[RoseResolver] seleccion base/champion-only usa mod propio seleccionado para skinId=${requestedSkinId}: ${getSkinKey(skin)}.`
      ).catch(() => { });
    }
  }
  if (!skin && baseOnlyRequest) {
    window.riftAtlas.appendOverlayLog(
      `[RoseResolver] seleccion base/champion-only detectada; no reutilizo fallback anterior para championId=${championId}.`
    ).catch(() => { });
    return { skin: null, payload: resolvedPayload };
  }

  if (!skin) {
    skin = findQueuedCustomSkinForPenguPayload(resolvedPayload) ||
      findSkinFromPenguSync(resolvedPayload) ||
      null;
    // Rose does NOT fall back to a previously selected skin. Only reuse
    // the fallback when its target matches the exact requested skin ID.
    // This prevents stale selections (e.g. cosplay 518022) from winning
    // when the user selects a different skin (e.g. Coven Neeko 518040).
    if (!skin && fallbackSkin) {
      const fallbackTarget = getOverlayTargetSkinId(fallbackSkin, championId);
      const fallbackChampion = getSkinSyncChampionNumber(fallbackSkin);
      if (fallbackTarget && requestedSkinId && fallbackTarget === requestedSkinId) {
        skin = fallbackSkin;
        window.riftAtlas.appendOverlayLog(
          `[RoseResolver] fallback aceptado: fallbackTarget=${fallbackTarget} === requestedSkinId=${requestedSkinId}`
        ).catch(() => { });
      } else if (fallbackChampion && championId && fallbackChampion === championId && !requestedSkinId) {
        skin = fallbackSkin;
        window.riftAtlas.appendOverlayLog(
          `[RoseResolver] fallback aceptado (sin requestedSkinId): championId=${championId} fallbackTarget=${fallbackTarget}`
        ).catch(() => { });
      } else {
        window.riftAtlas.appendOverlayLog(
          `[RoseResolver] fallback descartado: fallbackTarget=${fallbackTarget} requestedSkinId=${requestedSkinId} fallbackChampion=${fallbackChampion} championId=${championId}`
        ).catch(() => { });
      }
    }
  }

  if (skin) {
    resolvedPayload = canonicalizePenguSkinPayload(resolvedPayload, skin);
    window.riftAtlas.appendOverlayLog(
      `[RoseResolver] late-bound injection: championId=${resolvedPayload.championId || "?"} requested=${resolvedPayload.requestedSkinId || requestedSkinId || "?"} actualLcu=${resolvedPayload.actualLcuSkinId || lastPenguLcuSelection?.selectedSkinId || "?"} key=${getSkinKey(skin)}`
    ).catch(() => { });
  }

  return { skin, payload: resolvedPayload };
};

const publishCanonicalPenguSkinState = (payload = {}) => {
  const championId = Number(payload.championId || 0);
  const isChromaSelection = payload.type === "chroma-selection" ||
    Number(payload.chromaId || payload.selectedChromaId || 0) > 0;
  // Rose keeps skin-state authoritative for the carousel/base skin and publishes
  // the selected chroma separately via chroma-state. If we publish the chroma id
  // here, FormsWheel/ChromaWheel replace their base context with that chroma and
  // the next open shows a "stuck" one-item/current chroma state.
  const skinId = Number(
    (isChromaSelection ? (payload.resolvedBaseSkinId || payload.baseSkinId) : 0) ||
    payload.requestedSkinId ||
    payload.resolvedSkinId ||
    payload.chromaId ||
    0
  );
  if (!championId || !skinId) return;
  window.riftAtlas.sendPenguMessage?.({
    type: "skin-state",
    source: "rift-atlas-app",
    canonical: true,
    championId,
    skinId,
    selectedChromaId: isChromaSelection
      ? Number(payload.chromaId || payload.selectedChromaId || payload.requestedSkinId || 0) || null
      : null,
    name: payload.resolvedSkinName || payload.chromaName || payload.skin || payload.originalName || null,
    hasChromas: payload.resolvedHasChromas === true,
    owned: isRoseOwnedSkinId(skinId),
  }).catch(() => null);
};

const getSkinSyncChampionNumber = (skin = {}) => {
  const raw = Number(skin.rawChampion);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const champion = getSkinChampionFromHints(skin);
  const key = Number(champion?.key);
  return Number.isFinite(key) ? key : 0;
};

const getSkinCatalogChampionNumber = (skin = {}) => getSkinSyncChampionNumber(skin);

const getSkinSyncIdCandidates = (skin = {}, championIdOverride = 0) => {
  const championId = Number(championIdOverride || getSkinSyncChampionNumber(skin) || 0);
  const values = [
    skin.rawSkin,
    skin.rawVariant,
    skin.fileBaseId,
    skin.skinNum,
    skin.imageSkinNum,
    skin.baseImageSkinNum,
    skin.skinId,
    skin.id,
    skin.metaName
  ].map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0);

  const ids = new Set();
  values.forEach((value) => {
    ids.add(value);
    if (championId && value < 1000) {
      ids.add((championId * 1000) + value);
      ids.add((championId * 100) + value);
    }
  });
  return ids;
};

const getSelectedSkinNumCandidates = (selectedSkinId = 0, championId = 0) => {
  const skinIdText = String(Number(selectedSkinId) || "");
  const championText = String(Number(championId) || "");
  if (!skinIdText || !championText || !skinIdText.startsWith(championText)) return [];
  const suffix = skinIdText.slice(championText.length);
  if (!suffix) return [];
  const num = Number(suffix);
  return Number.isFinite(num) ? [num] : [];
};

const parseSyntheticSkinSyncText = (value = "") => {
  const raw = String(value || "");
  const direct = raw.match(/champion\D+(\d+)\D+skin\D+(\d+)/i);
  if (direct?.[1] && direct?.[2]) {
    return { championId: Number(direct[1]), skinId: Number(direct[2]) };
  }
  const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const compactMatch = compact.match(/champion(\d+)skin(\d+)/);
  if (compactMatch?.[1] && compactMatch?.[2]) {
    return { championId: Number(compactMatch[1]), skinId: Number(compactMatch[2]) };
  }
  return null;
};

const getChampionIdFromSkinSyncPayload = (payload = {}) => {
  const explicitChampionId = Number(payload.championId || payload.champion?.id || 0);
  if (Number.isFinite(explicitChampionId) && explicitChampionId > 0) return explicitChampionId;
  const selectedSkinId = Number(payload.selectedSkinId || payload.skinId || payload.baseSkinId || 0);
  if (Number.isFinite(selectedSkinId) && selectedSkinId > 0) return Math.floor(selectedSkinId / 1000);
  const synthetic = parseSyntheticSkinSyncText(payload.skin || payload.originalName || "");
  if (synthetic?.championId) return synthetic.championId;
  const skinText = normalizeSkinSyncText(payload.skin || payload.originalName || "");
  if (!skinText) return 0;
  const champion = state.champions.find((entry) =>
    skinText === normalizeSkinSyncText(entry.name) ||
    skinText === normalizeSkinSyncText(entry.id)
  );
  const key = Number(champion?.key);
  return Number.isFinite(key) ? key : 0;
};

const isBaseSkinSyncPayload = (payload = {}) => {
  const championId = getChampionIdFromSkinSyncPayload(payload);
  const selectedSkinId = Number(payload.selectedSkinId || payload.skinId || payload.baseSkinId || 0);
  return championId > 0 && selectedSkinId === championId * 1000;
};

const findQueuedCustomModForChampionId = (championId = 0) => {
  const numericChampionId = Number(championId || 0);
  if (!numericChampionId) return null;
  return state.customMods.find((skin) => {
      const key = getSkinKey(skin);
      if (!state.queuedSkins.has(key)) return false;
      if (isDownloadedLeagueSkinsPath(key)) return false;
      const skinChampionId = getSkinSyncChampionNumber(skin);
      return skinChampionId && skinChampionId === numericChampionId;
    }) || null;
};

const findQueuedCustomSkinForPenguPayload = (payload = {}) => {
  const championId = getChampionIdFromSkinSyncPayload(payload);
  const targetSkinId = Number(
    payload.resolvedSkinId ||
    payload.chromaId ||
    payload.selectedChromaId ||
    payload.selectedSkinId ||
    payload.skinId ||
    payload.baseSkinId ||
    0
  );
  if (!championId || !targetSkinId) return null;
  // Rose-style: match exacto por targetSkinId entre custom mods encolados
  const exactMatch = state.customMods.find((skin) => {
    const key = getSkinKey(skin);
    if (!state.queuedSkins.has(key) || isDownloadedLeagueSkinsPath(key)) return false;
    if (getSkinSyncChampionNumber(skin) !== championId) return false;
    return getOverlayTargetSkinId(skin, championId) === targetSkinId;
  }) || null;
  if (exactMatch) {
    state.selectedCustomMod = { championId, skinKey: getSkinKey(exactMatch) };
    return exactMatch;
  }
  // Rose-style: si el singleton selectedCustomMod existe para este champion
  // y EXACTAMENTE coincide con el targetSkinId, usarlo.
  if (state.selectedCustomMod?.championId === championId) {
    const singletonSkin = getSkinByKey(state.selectedCustomMod.skinKey);
    if (singletonSkin && state.queuedSkins.has(getSkinKey(singletonSkin)) &&
        getSkinSyncChampionNumber(singletonSkin) === championId &&
        !isDownloadedLeagueSkinsPath(getSkinKey(singletonSkin)) &&
        getOverlayTargetSkinId(singletonSkin, championId) === targetSkinId) {
      return singletonSkin;
    }
    // Singleton stale, limpiar
    state.selectedCustomMod = null;
  }
  return null;
};

const findSkinFromPenguSync = (payload = {}) => {
  const selectedSkinId = Number(payload.selectedSkinId || payload.skinId || payload.baseSkinId || 0);
  const chromaId = Number(payload.chromaId || payload.selectedChromaId || 0);
  const baseSkinId = Number(payload.baseSkinId || 0);
  const championId = getChampionIdFromSkinSyncPayload(payload);

  const queuedCustomMods = state.customMods.filter((skin) => state.queuedSkins.has(getSkinKey(skin)));
  const nonQueuedCustomMods = state.customMods.filter((skin) => !state.queuedSkins.has(getSkinKey(skin)));
  const candidates = [...queuedCustomMods, ...nonQueuedCustomMods, ...state.skinLibrary]
    .filter((skin) => getSkinKey(skin) && skin.path)
    .filter((skin, index, array) => array.findIndex((entry) => getSkinKey(entry) === getSkinKey(skin)) === index);
  if (payload.resolvedPackagePath) {
    const directPackage = candidates.find((entry) => getSkinKey(entry) === payload.resolvedPackagePath);
    if (directPackage) return directPackage;
  }
  const resolvedSkinId = Number(payload.resolvedSkinId || 0);
  // Rose-style: para skin-sync, no confiamos en selectedSkinId del payload
  // porque puede ser stale. Solo usamos IDs que vengan de chroma-selection o
  // de la resolucion por nombre (resolvedSkinId).
  const isNameDrivenSync = payload.type === "skin-sync" && !payload.chromaId && !payload.selectedChromaId;
  const trustedSelectedSkinId = isNameDrivenSync ? 0 : selectedSkinId;
  const selectedIds = [...new Set([resolvedSkinId, chromaId, trustedSelectedSkinId, baseSkinId].filter((value) => Number.isFinite(value) && value > 0))];
  const skinText = payload.skin || payload.originalName || "";
  const normalizedSkinText = normalizeSkinSyncText(skinText);
  // DOM-only payloads often omit selectedSkinId. Once LCU resolved the name,
  // use that ID to recognize the champion base skin; otherwise a queued paid
  // skin of the same champion can win by name/queue bias (for example "Briar"
  // incorrectly resolving to 233020).
  const effectiveSelectedSkinId = trustedSelectedSkinId || resolvedSkinId;
  const isDefaultSelection = effectiveSelectedSkinId > 0 &&
    effectiveSelectedSkinId % 1000 === 0 &&
    chromaId === 0 &&
    resolvedSkinId <= effectiveSelectedSkinId;
  const champion = championId ? getChampionByNumericId(championId) : null;
  const textChampion = normalizedSkinText
    ? state.champions.find((entry) =>
      normalizedSkinText === normalizeSkinSyncText(entry.name) ||
      normalizedSkinText === normalizeSkinSyncText(entry.id)
    )
    : null;
  const championOnlyText = Boolean(normalizedSkinText) && (
    normalizedSkinText === normalizeSkinSyncText((champion || textChampion)?.name || "") ||
    normalizedSkinText === normalizeSkinSyncText((champion || textChampion)?.id || "")
  );

  if (!championId && championOnlyText && textChampion) {
    const queuedTextChampionMatch = findQueuedCustomSkinForPenguPayload({
      ...payload,
      championId: Number(textChampion.key)
    });
    if (queuedTextChampionMatch) return queuedTextChampionMatch;
    return null;
  }

  if (championOnlyText && (isDefaultSelection || selectedSkinId === 0)) {
    const baseChampionId = championId || Number(textChampion?.key || 0);
    const baseSkinIdValue = baseChampionId * 1000;
    // Rose-style: a queued custom mod that targets the champion's base skin
    // should still be injected. Only skip when no custom base mod is selected.
    const baseCustomMatch = findQueuedCustomSkinForPenguPayload({
      ...payload,
      championId: baseChampionId,
      resolvedSkinId: baseSkinIdValue,
      selectedSkinId: baseSkinIdValue,
      baseSkinId: baseSkinIdValue
    }) || findQueuedCustomModForChampionId(baseChampionId);
    if (baseCustomMatch) {
      window.riftAtlas.appendOverlayLog(`[RoseResolver] mod propio para skin base encontrado: ${getSkinKey(baseCustomMatch)}`).catch(() => { });
      return baseCustomMatch;
    }
    window.riftAtlas.appendOverlayLog(`[Rose] skin base detectada (championId=${baseChampionId}); sin inyeccion (estilo Rose).`).catch(() => { });
    return null;
  }

  // A custom mod behaves like Rose's selected_custom_mod: it wins only while
  // the exact skin it targets is the live/resolved selection.
  const queuedCustomTargetMatch = findQueuedCustomSkinForPenguPayload(payload);
  if (queuedCustomTargetMatch) return queuedCustomTargetMatch;

  const payloadNameScore = (entry) => {
    if (!normalizedSkinText) return 1;
    const names = [
      entry.skin,
      entry.name,
      getSkinDisplayName(entry),
      entry.variant ? `${entry.skin} ${entry.variant}` : "",
      entry.variant ? `${entry.name} ${entry.variant}` : ""
    ];
    return Math.max(...names.map((name) => {
      const normalizedName = normalizeSkinSyncText(name);
      if (!normalizedName) return 0;
      if (normalizedName === normalizedSkinText) return 1;
      return levenshteinSimilarity(normalizedSkinText, normalizedName);
    }));
  };

  if (selectedIds.length && !isDefaultSelection) {
    const idMatches = candidates.filter((skin) => {
      const skinChampionId = getSkinSyncChampionNumber(skin);
      if (championId && skinChampionId && skinChampionId !== championId) return false;
      const idCandidates = getSkinSyncIdCandidates(skin, championId || skinChampionId);
      return selectedIds.some((selectedId) => {
        if (idCandidates.has(selectedId)) return true;
        return getSelectedSkinNumCandidates(selectedId, championId || skinChampionId)
          .some((num) => idCandidates.has(num));
      });
    });
    if (idMatches.length > 1) {
      idMatches.sort((a, b) => {
        const aPackageId = Number(a.fileBaseId || 0);
        const bPackageId = Number(b.fileBaseId || 0);
        const preferredId = resolvedSkinId || chromaId || selectedSkinId;
        const aExactPackage = aPackageId === preferredId ? 1 : 0;
        const bExactPackage = bPackageId === preferredId ? 1 : 0;
        if (aExactPackage !== bExactPackage) return bExactPackage - aExactPackage;
        const aVariant = Number(a.rawVariant || 0);
        const bVariant = Number(b.rawVariant || 0);
        const aIsChroma = chromaId && aVariant === chromaId ? 1 : 0;
        const bIsChroma = chromaId && bVariant === chromaId ? 1 : 0;
        return bIsChroma - aIsChroma;
      });
    }
    const byId = idMatches.find((skin) => !state.queuedSkins.has(getSkinKey(skin))) || idMatches[0];
    if (byId) return byId;
    // Rose-style: cuando tenemos un ID explicito (selectedSkinId o resolvedSkinId)
    // y NO hay ningun match por ID, NO caemos en busqueda por nombre.
    if (effectiveSelectedSkinId > 0) {
      window.riftAtlas.appendOverlayLog(
        `[RoseResolver] No ID match para effectiveSelectedSkinId=${effectiveSelectedSkinId}; descarto busqueda por nombre para evitar skin equivocada.`
      ).catch(() => { });
      return null;
    }
  }

  if (!normalizedSkinText) {
    // Rose: no hay nombre de skin, no se puede resolver.
    return null;
  }

  let best = null;
  let bestScore = 0;

  const matchAgainst = (entry) => {
    const skinChampionId = getSkinSyncChampionNumber(entry);
    if (championId && skinChampionId && skinChampionId !== championId) return;
    const names = [
      entry.skin,
      entry.name,
      getSkinDisplayName(entry),
      entry.variant ? `${entry.skin} ${entry.variant}` : "",
      entry.variant ? `${entry.name} ${entry.variant}` : ""
    ];
    const score = Math.max(...names.map((name) => {
      const normalizedName = normalizeSkinSyncText(name);
      if (!normalizedName) return 0;
      if (normalizedName === normalizedSkinText) return 1;
      return levenshteinSimilarity(normalizedSkinText, normalizedName);
    }));
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  };

  candidates.forEach(matchAgainst);

  if (bestScore < 0.4) {
  }

  return bestScore >= 0.4 ? best : null;
};

const hasContradictoryChampionOnlyPayload = (payload = {}) => {
  const championId = Number(payload.championId || payload.champion?.id || 0);
  const skinText = normalizeSkinSyncText(payload.skin || payload.originalName || "");
  if (!championId || !skinText) return false;
  const payloadChampion = getChampionByNumericId(championId);
  if (payloadChampion && (
    skinText === normalizeSkinSyncText(payloadChampion.name) ||
    skinText === normalizeSkinSyncText(payloadChampion.id)
  )) {
    return false;
  }
  const namedChampion = state.champions.find((champion) =>
    skinText === normalizeSkinSyncText(champion.name) ||
    skinText === normalizeSkinSyncText(champion.id)
  );
  return Boolean(namedChampion && Number(namedChampion.key) !== championId);
};

let autoApplyQueuedFromPenguTimer = null;
const scheduleAutoApplyQueuedFromPengu = (reason = "queue-selected") => {
  clearTimeout(autoApplyQueuedFromPenguTimer);
  autoApplyQueuedFromPenguTimer = setTimeout(async () => {
    autoApplyQueuedFromPenguTimer = null;
    if (!lastPenguSkinSyncPayload || state.importingQueue) return;
    const skin = findQueuedCustomSkinForPenguPayload(lastPenguSkinSyncPayload);
    if (!skin) return;
    window.riftAtlas.appendOverlayLog(`[Rose] Mod actualizado (${reason}); queda preparado para la unica inyeccion de FINALIZATION.`).catch(() => { });
  }, 150);
};

const shouldDeferPenguApplyToFinalization = () => {
  // Rose-style: durante ChampSelect/FINALIZATION no inyectar inmediatamente.
  // Esperar al threshold de FINALIZATION para evitar inyectar skins de hover
  // o frames intermedios del carrusel. Las aplicaciones manuales desde la UI
  // usan applyQueuedSkins, no este camino.
  const phase = String(state.penguGameflowPhase || "");
  return phase === "ChampSelect" || phase === "FINALIZATION";
};

const queuePenguSelectionForFinalization = async (payload, key) => {
  const deferred = shouldDeferPenguApplyToFinalization();
  const earlySkin = getSkinByKey(key);
  const resolved = await resolveRoseAuthoritativeSkinEntry(payload, earlySkin);
  const skin = resolved.skin || earlySkin;
  const finalKey = skin ? getSkinKey(skin) : key;
  const preparedPayload = commitRoseAuthoritativeSelection(resolved.payload || payload, skin);
  publishCanonicalPenguSkinState(preparedPayload);
  window.riftAtlas.appendOverlayLog(
    `[Rose] estado canonico: championId=${preparedPayload.championId || "?"} requestedSkinId=${preparedPayload.requestedSkinId || "?"} actualLcuSkinId=${preparedPayload.actualLcuSkinId || lastPenguLcuSelection?.selectedSkinId || "?"} name=${preparedPayload.resolvedSkinName || preparedPayload.skin || "?"}.`
  ).catch(() => { });
  // Rose-style: do NOT force LCU skin here. The PATCH happens at FINALIZATION
  // threshold inside triggerRoseFinalizationApply, same as Rose's _force_owned_skin
  // which is called synchronously inside inject_skin (after extraction, before mkoverlay).
  // Rose-style: inyeccion inmediata durante ChampSelect (como Rose trigger_injection).
  // Solo diferir a FINALIZATION para que el ticker maneje el threshold.
  if (deferred) {
    window.riftAtlas.appendOverlayLog(
      `[Rose] Seleccion actualizada durante FINALIZATION; inyeccion diferida al ticker local monotonic de ${state.skinWriteMs}ms.`
    ).catch(() => { });
  }
  return handlePenguSkinApply({ ...preparedPayload, key: finalKey, apply: !deferred });
};

async function handlePenguSkinSync(payload = {}) {
  const syncLogSignature = `${payload.type || ""}:${payload.championId || ""}:${payload.selectedSkinId || payload.skinId || ""}:${payload.skin || ""}:${payload.chromaId || payload.selectedChromaId || ""}`;
  const syncLogNow = Date.now();
  const syncGen = penguSkinSyncGeneration;
  if (syncLogSignature !== lastPenguSyncLogSignature || syncLogNow - lastPenguSyncLogAt > 5000) {
    lastPenguSyncLogSignature = syncLogSignature;
    lastPenguSyncLogAt = syncLogNow;
    window.riftAtlas.appendOverlayLog(`[Diagnostico] handlePenguSkinSync recibio payload: championId=${payload.championId} selectedSkinId=${payload.selectedSkinId || payload.skinId} skin=${payload.skin} type=${payload.type}`).catch(() => { });
  }

  const previousSkinSyncPayload = lastPenguSkinSyncPayload;
  if (payload.skin || payload.championId || payload.selectedSkinId || payload.skinId) {
    lastPenguSkinSyncPayload = { ...payload };
  }
  // Rose-style gate: si champion no esta locked y no es FINALIZATION, bloquear.
  // Pero en ChampSelect, permitir si el payload tiene datos de champion (fallback
  // para cuando el mensaje champion-locked se pierde — Rose gate #4).
  if (payload.type === "skin-sync" && !state.penguChampionLocked) {
    // Rose gate #4: ChampSelect con locked_champ_id seteado (reconnect window)
    if (state.penguGameflowPhase === "ChampSelect" && state.lastLockedChampionId > 0) {
      const payloadChampion = getChampionIdFromSkinSyncPayload(payload);
      if (!payloadChampion || payloadChampion !== state.lastLockedChampionId) return;
    } else if (state.penguGameflowPhase !== "FINALIZATION") {
      // Rose: si el gate bloquea, revertir al payload anterior para no
      // almacenar un skin-sync stale de antes del lock que luego seria
      // replayeado por champion-locked.
      lastPenguSkinSyncPayload = previousSkinSyncPayload;
      return;
    }
  }
  if (syncGen !== penguSkinSyncGeneration) {
    window.riftAtlas.appendOverlayLog(`[Diagnostico] skin-sync descartado por champion exchange (gen ${syncGen} != ${penguSkinSyncGeneration})`).catch(() => { });
    return;
  }
  // Rose-style injection disconnect: pausa procesamiento de payloads durante inyeccion.
  // Si el payload entrante es una seleccion DIFERENTE a la que esta inyectando,
  // cancelamos la anterior para no quedar pegados con la skin equivocada.
  if (state.penguProcessingLocked && state.penguGameflowPhase !== "FINALIZATION") {
    const incomingName = normalizeSkinSyncText(payload.skin || payload.originalName || "");
    const currentName = normalizeSkinSyncText(
      previousSkinSyncPayload?.resolvedSkinName ||
      previousSkinSyncPayload?.skin ||
      previousSkinSyncPayload?.originalName ||
      ""
    );
    const incomingSkinId = Number(payload.selectedSkinId || payload.skinId || payload.resolvedSkinId || 0);
    const previousSkinId = Number(previousSkinSyncPayload?.selectedSkinId || previousSkinSyncPayload?.skinId || previousSkinSyncPayload?.resolvedSkinId || 0);
    const sameSelection = incomingName && currentName && incomingName === currentName &&
      (!incomingSkinId || !previousSkinId || incomingSkinId === previousSkinId);
    if (sameSelection) {
      window.riftAtlas.appendOverlayLog(`[Diagnostico] skin-sync descartado por processingLocked (misma seleccion en curso)`).catch(() => { });
      return;
    }
    window.riftAtlas.appendOverlayLog(`[Diagnostico] skin-sync diferente durante apply; limpiando locks para permitir cambio a ${payload.skin || incomingSkinId || "?"}`).catch(() => { });
    penguBackgroundApplyKey = "";
    penguBackgroundApplyInFlightKey = "";
    clearPenguApplyLock();
    state.injectionInProgress = false;
    state.penguProcessingLocked = false;
    state.lastHoverWritten = false;
  }

  // Si la seleccion cambio respecto a la anterior, limpiar lastHoverWritten
  // para que FINALIZATION pueda re-inyectar la nueva skin.
  if (payload.type === "skin-sync" && previousSkinSyncPayload) {
    const incomingName = normalizeSkinSyncText(payload.skin || payload.originalName || "");
    const previousName = normalizeSkinSyncText(
      previousSkinSyncPayload.resolvedSkinName ||
      previousSkinSyncPayload.skin ||
      previousSkinSyncPayload.originalName ||
      ""
    );
    const incomingSkinId = Number(payload.selectedSkinId || payload.skinId || payload.resolvedSkinId || 0);
    const previousSkinId = Number(previousSkinSyncPayload.selectedSkinId || previousSkinSyncPayload.skinId || previousSkinSyncPayload.resolvedSkinId || 0);
    if ((incomingName && previousName && incomingName !== previousName) ||
        (incomingSkinId && previousSkinId && incomingSkinId !== previousSkinId)) {
      state.lastHoverWritten = false;
      window.riftAtlas.appendOverlayLog(`[Diagnostico] seleccion cambiada; limpiando lastHoverWritten para permitir re-inyeccion en FINALIZATION`).catch(() => { });
    }
  }

  if (
    payload.type === "skin-sync" &&
    payload.skin &&
    !state.roseFinalizationApplyStarted &&
    !state.roseFinalizationCommitted
  ) {
    const incomingChampionId = getChampionIdFromSkinSyncPayload(payload);
    const currentChampionId = getChampionIdFromSkinSyncPayload(previousSkinSyncPayload || {});
    const incomingName = normalizeSkinSyncText(payload.skin || payload.originalName || "");
    const currentName = normalizeSkinSyncText(
      previousSkinSyncPayload?.resolvedSkinName ||
      previousSkinSyncPayload?.skin ||
      previousSkinSyncPayload?.originalName ||
      ""
    );
    // Rose: si el selectedSkinId cambio, no es una repeticion canonica.
    // El nombre puede ser el mismo pero el ID de sesion LCU cambio.
    const incomingSelectedSkinId = Number(payload.selectedSkinId || 0);
    const previousSelectedSkinId = Number(previousSkinSyncPayload?.selectedSkinId || 0);
    const selectedSkinIdChanged = incomingSelectedSkinId > 0 && incomingSelectedSkinId !== previousSelectedSkinId;
    const repeatsCanonicalSelection = Boolean(
      previousSkinSyncPayload?.canonical &&
      incomingName &&
      currentName &&
      incomingName === currentName &&
      (!incomingChampionId || !currentChampionId || incomingChampionId === currentChampionId) &&
      !selectedSkinIdChanged
    );
    if (repeatsCanonicalSelection) {
      // Keep the richer canonical snapshot. Critically, never clear the latest
      // raw payload here: FINALIZATION may fire while LCU resolution is still in
      // flight and Rose always retains its latest ui_last_text equivalent.
      lastPenguSkinSyncPayload = previousSkinSyncPayload;
      // Core can repeat the same DOM name every few seconds. Rose treats this as
      // the same cached selection; resolving it through LCU again only delays
      // the threshold and can make the force happen after ChampSelect closes.
      return;
    }
  }

  // Rose: si la skin entrante NO es un chroma de la skin actual, limpiar
  // el chroma sticky y el panel (Rose: selected_chroma_id = None cuando
  // se selecciona una skin base diferente).
  if (lastPenguChromaSelection && payload.type !== "chroma-selection") {
    const newSkinId = Number(payload.selectedSkinId || payload.skinId || 0);
    const oldChromaId = lastPenguChromaSelection.chromaId;
    const oldBaseId = lastPenguChromaSelection.baseSkinId;
    if (newSkinId && oldChromaId && oldBaseId) {
      const isChromaOfOldSkin = newSkinId > oldBaseId && newSkinId < oldBaseId + 100;
      const isOldChromaOfNewSkin = oldChromaId > newSkinId && oldChromaId < newSkinId + 100;
      if (!isChromaOfOldSkin && !isOldChromaOfNewSkin) {
        lastPenguChromaSelection = null;
        window.riftAtlas.appendOverlayLog(`[Diagnostico] chroma limpiado: nueva skin ${newSkinId} no es chroma de la anterior (base=${oldBaseId} chroma=${oldChromaId})`).catch(() => { });
      }
    }
  }
  // Rose: limpiar chroma panel si la skin cambio
  if (lastPenguChromaPanel && payload.type !== "chroma-selection") {
    const newSkinId = Number(payload.selectedSkinId || payload.skinId || 0);
    if (newSkinId && lastPenguChromaPanel.skinId && newSkinId !== lastPenguChromaPanel.skinId) {
      lastPenguChromaPanel = null;
    }
  }

  // Core already stabilizes DOM changes. Resolving immediately avoids carrying
  // an unresolved name into FINALIZATION and removes the old ID/name race.
  if (payload.type === "chroma-selection") {
    const championId = getChampionIdFromSkinSyncPayload(payload);
    const chromaId = Number(payload.chromaId || payload.selectedChromaId || payload.selectedSkinId || payload.skinId || 0);
    if (championId && chromaId) {
      lastPenguChromaSelection = {
        championId,
        chromaId,
        baseSkinId: Number(payload.baseSkinId || 0),
        at: Date.now()
      };
      window.riftAtlas.appendOverlayLog(`[Diagnostico] chroma sticky activo: championId=${championId} chromaId=${chromaId}`).catch(() => { });
    }
  } else if (isBaseSkinSyncPayload(payload)) {
    const baseChampionId = getChampionIdFromSkinSyncPayload(payload);
    const baseSkinId = Number(payload.selectedSkinId || payload.skinId || payload.baseSkinId || 0);
    const baseCustomMatch = findQueuedCustomSkinForPenguPayload({
      ...payload,
      championId: baseChampionId,
      resolvedSkinId: baseSkinId,
      selectedSkinId: baseSkinId,
      baseSkinId
    }) || findQueuedCustomModForChampionId(baseChampionId);
    if (!baseCustomMatch) {
      // Rose: ignorar base skin echos (skin=champion name). Suelen ser ecos
      // stale de la sesion LCU que llegan tarde y sobreescriben la seleccion actual.
      window.riftAtlas.appendOverlayLog(`[Rose] Base skin echo ignorado: selectedSkinId=${payload.selectedSkinId || "?"} skin=${payload.skin || "?"} (Rose: no procesa ecos base).`).catch(() => { });
      return;
    }
    window.riftAtlas.appendOverlayLog(`[RoseResolver] skin base con mod propio detectada: ${getSkinKey(baseCustomMatch)}.`).catch(() => { });
  }
  if (hasContradictoryChampionOnlyPayload(payload)) {
    window.riftAtlas.appendOverlayLog(`[Diagnostico] skin-sync ignorado por championId/nombre contradictorios: championId=${payload.championId} skin=${payload.skin}`).catch(() => { });
    return;
  }
  const directKey = payload.key || payload.path;
  if (directKey && getSkinByKey(directKey)) {
    const directSignature = `${directKey}:${payload.chromaId || ""}:${payload.selectedSkinId || ""}`;
    const directNow = Date.now();
    if (directSignature === lastPenguSkinSyncKey && directNow - lastPenguSkinSyncAt < 30000) {
      window.riftAtlas.appendOverlayLog(`[Diagnostico] handlePenguSkinSync: directKey deduped key=${directKey}`).catch(() => { });
      return;
    }
    lastPenguSkinSyncKey = directSignature;
    lastPenguSkinSyncAt = directNow;
    window.riftAtlas.appendOverlayLog(`[Diagnostico] handlePenguSkinSync: usando directKey=${directKey}`).catch(() => { });
    await queuePenguSelectionForFinalization(payload, directKey);
    return;
  }

  if (!payload.skin && !Number(payload.chromaId || payload.selectedChromaId || payload.selectedSkinId || payload.skinId || 0)) return;
  if (!state.skinLibrary.length) {
    await ensureSkinLibraryLoaded().catch((error) => {
      window.riftAtlas.appendOverlayLog(`[Diagnostico] LeagueSkins no listo durante skin-sync: ${error.message}`).catch(() => { });
    });
  }
  payload = await resolveSkinSyncPayloadWithLcu(payload);
  if (payload.resolvedSkinId) {
    lastPenguSkinSyncPayload = { ...payload };
  }
  let skin = findSkinFromPenguSync(payload);
  window.riftAtlas.appendOverlayLog(`[Diagnostico] findSkinFromPenguSync resultado: ${skin ? "encontrada: " + getSkinKey(skin) : "null"}`).catch(() => { });
  if (!skin && payload.skin) {
    const payloadText = normalizeSkinSyncText(payload.skin);
    for (const path of state.queuedSkins) {
      const queuedSkin = getSkinByKey(path);
      if (queuedSkin && !queuedSkin.custom && !state.queuedSkins.has(getSkinKey(queuedSkin))) continue;
      const fn = path.split(/[/\\]/).pop().toLowerCase().replace(/\.(fantome|zip|wad|rse)$/, "");
      const normalizedFn = normalizeSkinSyncText(fn);
      if (normalizedFn.includes(payloadText) || payloadText.includes(normalizedFn)) {
        skin = queuedSkin;
        if (!skin) {
          skin = { path, name: fn, skin: payload.skin, champion: "Custom" };
          if (!state.customMods.some((m) => m.path === path)) {
            state.customMods = [...state.customMods, skin];
          }
        }
        break;
      }
    }
  }
  if (!skin) {
    const pendingChampionId = Number(payload.championId || payload.champion?.id || 0);
    const pendingChampion = pendingChampionId ? getChampionByNumericId(pendingChampionId) : null;
    const pendingSkinText = normalizeSkinSyncText(payload.skin || payload.originalName || "");
    const pendingSelectedSkinId = Number(payload.selectedSkinId || payload.skinId || payload.baseSkinId || 0);
    const pendingIsDefaultSelection = pendingSelectedSkinId > 0 && pendingSelectedSkinId % 1000 === 0 && !Number(payload.chromaId || payload.selectedChromaId || 0);
    const pendingChampionOnly = pendingSkinText && (
      pendingSkinText === normalizeSkinSyncText(pendingChampion?.name || "") ||
      pendingSkinText === normalizeSkinSyncText(pendingChampion?.id || "")
    );
    if (pendingChampionOnly && pendingIsDefaultSelection) {
      window.riftAtlas.appendOverlayLog(`[Rose] skin base detectada para championId=${pendingChampionId}; sin inyeccion (Rose: ui_skin_id==0 skip).`).catch(() => { });
      clearRoseAuthoritativeSelection();
      return;
    }
    window.riftAtlas.appendOverlayLog(`[Diagnostico] NO se encontro skin para: ${payload.skin || payload.selectedSkinId || payload.chromaId || "desconocida"}`).catch(() => { });
    clearRoseAuthoritativeSelection();
    window.riftAtlas.appendOverlayLog(
      `[RoseResolver] skin no encontrada: selectedSkinId=${payload.selectedSkinId || "?"} skin=${payload.skin || "?"}; mantengo overlay anterior (estilo Rose: no se limpia estado cuando la skin no se resuelve).`
    ).catch(() => { });
    window.riftAtlas.appendOverlayLog(
      `[RoseResolver] skin no encontrada: selectedSkinId=${payload.selectedSkinId || "?"} skin=${payload.skin || "?"}; NO se reutiliza la seleccion anterior para evitar aplicar una skin equivocada.`
    ).catch(() => { });
    await window.riftAtlas.sendPenguMessage?.({
      type: "skin-apply-result",
      ok: false,
      stage: "match",
      message: `No encontre en Rift Atlas la skin seleccionada: ${payload.skin || payload.chromaId || payload.selectedSkinId || "desconocida"}`
    }).catch(() => null);
    return;
  }

  const key = getSkinKey(skin);
  if (payload.type === "chroma-selection" && lastPenguChromaSelection) {
    lastPenguChromaSelection.skinKey = key;
  }
  if (shouldIgnorePenguSwitchDuringApply(key, payload)) return;
  const signature = `${key}:${payload.chromaId || ""}:${payload.selectedSkinId || ""}`;
  const now = Date.now();
  if (signature === lastPenguSkinSyncKey && now - lastPenguSkinSyncAt < 30000) return;
  lastPenguSkinSyncKey = signature;
  lastPenguSkinSyncAt = now;
  await queuePenguSelectionForFinalization(payload, key);
}

const updateCustomModsQueueState = () => {
  if (!els.customModsList) return;
  const selectedMods = state.customMods.filter((item) => state.queuedSkins.has(getSkinKey(item)));
  const selectedCount = selectedMods.length;
  if (els.customModsLabel) {
    els.customModsLabel.textContent = state.customMods.length
      ? selectedCount
        ? `${state.customMods.length} mod(s) propios cargados. En seleccion: ${selectedMods.slice(0, 3).map(getSkinVisibleName).join(", ")}${selectedCount > 3 ? ` +${selectedCount - 3}` : ""}.`
        : `${state.customMods.length} mod(s) propios cargados. Ningun mod propio seleccionado.`
      : "Agrega .fantome, .zip, .rse, .wad o .wad.client tuyos. Sirve para skins, fonts, mapas y otros mods locales.";
  }
  els.customModsList.querySelectorAll(".custom-mod-row").forEach((row) => {
    const queued = state.queuedSkins.has(row.dataset.path);
    row.classList.toggle("queued", queued);
    const badge = row.querySelector(".custom-mod-selection-badge");
    if (badge) badge.hidden = !queued;
    const queueButton = row.querySelector(".custom-mod-queue");
    if (queueButton) {
      queueButton.classList.toggle("secondary-button", queued);
      queueButton.classList.toggle("docs-link", !queued);
      queueButton.textContent = queued ? "Quitar" : "Seleccionar";
    }
  });
};

const renderCustomMods = () => {
  if (!els.customModsList) return;
  const selectedMods = state.customMods.filter((item) => state.queuedSkins.has(getSkinKey(item)));
  const selectedCount = selectedMods.length;
  if (els.customModsLabel) {
    els.customModsLabel.textContent = state.customMods.length
      ? selectedCount
        ? `${state.customMods.length} mod(s) propios cargados. En seleccion: ${selectedMods.slice(0, 3).map(getSkinVisibleName).join(", ")}${selectedCount > 3 ? ` +${selectedCount - 3}` : ""}.`
        : `${state.customMods.length} mod(s) propios cargados. Ningun mod propio seleccionado.`
      : "Agrega .fantome, .zip, .rse, .wad o .wad.client tuyos. Sirve para skins, fonts, mapas y otros mods locales.";
  }

  if (!state.customMods.length) {
    els.customModsList.innerHTML = `
      <div class="empty-state compact">
        <h2>Sin mods propios</h2>
        <p>Agrega paquetes locales para activarlos desde Rift Atlas y Pengu.</p>
      </div>
    `;
    return;
  }

  els.customModsList.innerHTML = state.customMods
    .map((item) => {
      const resolved = applySkinMetadata(item);
      const key = getSkinKey(resolved);
      const queued = state.queuedSkins.has(key);
      const favorite = state.favoriteSkins.has(key);
      const preview = getSkinLoadingImage(resolved) || getSkinDefaultLoadingImage(resolved);
      return `
        <article class="custom-mod-row ${queued ? "queued" : ""}" data-path="${escapeHtml(key)}">
          <span class="mod-extension">${escapeHtml(getDisplayExtension(resolved))}</span>
          <span class="custom-mod-thumb ${preview ? "" : "missing-art"}">${preview ? `<img src="${escapeHtml(preview)}" alt="${escapeHtml(getSkinDisplayName(resolved))}" loading="lazy" />` : escapeHtml(getDisplayExtension(resolved))}</span>
          <div>
            <strong>${escapeHtml(getSkinVisibleName(resolved))}</strong>
            <small>${escapeHtml(resolved.champion || "Mod propio")} - ${escapeHtml(getSkinSource(resolved))}${resolved.metadataEdited ? " - editado" : ""}${resolved.previewInferred ? " - preview inferida" : ""}</small>
            <small>${escapeHtml(resolved.relativePath || resolved.path)}</small>
          </div>
          <span class="custom-mod-selection-badge" ${queued ? "" : "hidden"}>En seleccion</span>
          <span>${formatBytes(resolved.size)}</span>
          <button class="${queued ? "secondary-button" : "docs-link"} custom-mod-queue" type="button" data-path="${escapeHtml(key)}">${queued ? "Quitar" : "Seleccionar"}</button>
          <button class="secondary-button custom-mod-favorite" type="button" data-path="${escapeHtml(key)}">${favorite ? "Favorita" : "Fav"}</button>
          <button class="secondary-button custom-mod-edit" type="button" data-path="${escapeHtml(key)}">Editar</button>
          <button class="secondary-button custom-mod-reveal" type="button" data-path="${escapeHtml(resolved.path)}">Abrir</button>
          <button class="secondary-button custom-mod-remove" type="button" data-path="${escapeHtml(key)}">Eliminar</button>
        </article>
      `;
    })
    .join("");

  els.customModsList.querySelectorAll(".custom-mod-queue").forEach((button) => {
    button.addEventListener("click", (event) => {
      stopButtonEvent(event);
      if (state.queuedSkins.has(button.dataset.path)) {
        removeQueuedSkinKey(button.dataset.path);
      } else {
        queueSkinKey(button.dataset.path);
      }
      saveQueuedSkins();
      scheduleAutoApplyQueuedFromPengu("custom-mod-selected");
      renderCustomMods();
    });
  });

  els.customModsList.querySelectorAll(".custom-mod-row").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      state.selectedSkinKey = row.dataset.path;
      renderSkinProfile();
    });
  });

  els.customModsList.querySelectorAll(".custom-mod-reveal").forEach((button) => {
    button.addEventListener("click", (event) => {
      stopButtonEvent(event);
      window.riftAtlas.revealModPath(button.dataset.path);
    });
  });

  els.customModsList.querySelectorAll(".custom-mod-favorite").forEach((button) => {
    button.addEventListener("click", (event) => {
      stopButtonEvent(event);
      if (state.favoriteSkins.has(button.dataset.path)) state.favoriteSkins.delete(button.dataset.path);
      else state.favoriteSkins.add(button.dataset.path);
      state.selectedSkinKey = button.dataset.path;
      saveFavoriteSkins();
      renderCustomMods();
      renderSkinProfile();
      sendPenguSkinCatalog("favorite-updated");
    });
  });

  els.customModsList.querySelectorAll(".custom-mod-edit").forEach((button) => {
    button.addEventListener("click", (event) => {
      stopButtonEvent(event);
      state.selectedSkinKey = button.dataset.path;
      openSkinMetadataModal(button.dataset.path);
    });
  });

  els.customModsList.querySelectorAll(".custom-mod-remove").forEach((button) => {
    button.addEventListener("click", async (event) => {
      stopButtonEvent(event);
      const key = button.dataset.path;
      button.disabled = true;
      button.textContent = "Eliminando...";
      let deletedOnDisk = false;
      try {
        const result = await window.riftAtlas.deleteUserModFile?.(key);
        deletedOnDisk = Boolean(result?.deleted);
      } catch (error) {
        if (els.customModsLabel) {
          els.customModsLabel.textContent = error.message || "No pude borrar el archivo; lo quite de Rift Atlas.";
        }
      }
      state.customMods = state.customMods.filter((item) => getSkinKey(item) !== key);
      state.favoriteSkins.delete(key);
      delete state.skinMetadata[key];
      if (state.selectedSkinKey === key) state.selectedSkinKey = "";
      removeQueuedSkinKey(key);
      localStorage.setItem("riftAtlas:favoriteSkins", JSON.stringify([...state.favoriteSkins]));
      localStorage.setItem("riftAtlas:skinMetadata", JSON.stringify(state.skinMetadata));
      saveCustomMods();
      saveQueuedSkins();
      renderSkinProfile();
      if (els.customModsLabel && deletedOnDisk) {
        els.customModsLabel.textContent = "Mod eliminado de la carpeta de Rift Atlas.";
      }
      sendPenguSkinCatalog("custom-mod-removed");
    });
  });
};

const renderSkinProfile = () => {
  if (!els.skinProfilePanel) return;
  const skin = getSkinByKey(state.selectedSkinKey);
  if (!skin) {
    els.skinProfilePanel.innerHTML = `
      <div class="empty-state compact">
        <h2>Sin skin seleccionada</h2>
        <p>Toca una card para ver su perfil y acciones rapidas.</p>
      </div>
    `;
    return;
  }

  const key = getSkinKey(skin);
  const queued = state.queuedSkins.has(key);
  const favorite = state.favoriteSkins.has(key);
  const art = getSkinLoadingImage(skin) || getSkinDefaultLoadingImage(skin);
  const fallbackArt = getSkinBaseLoadingImage(skin) || getSkinDefaultLoadingImage(skin);
  const source = getSkinSource(skin);
  els.skinProfilePanel.innerHTML = `
    <article class="skin-profile-card">
      <div class="skin-profile-art ${art ? "" : "missing-art"}">
        ${art ? `<img src="${art}" data-fallback="${escapeHtml(fallbackArt)}" alt="${escapeHtml(getSkinDisplayName(skin))}" />` : ""}
        <span>${escapeHtml(skin.extension?.replace(".", "") || "MOD")}</span>
      </div>
      <div class="skin-profile-copy">
        <span>${escapeHtml(source)}${skin.metadataEdited ? " - metadata editada" : ""}</span>
        <h3>${escapeHtml(getSkinVisibleName(skin))}</h3>
        <p>${escapeHtml(skin.champion || "Mod propio")}</p>
        <dl>
          <div><dt>Tipo</dt><dd>${escapeHtml(skin.extension || "-")}</dd></div>
          <div><dt>Tamano</dt><dd>${formatBytes(skin.size)}</dd></div>
          <div><dt>Autor</dt><dd>${escapeHtml(skin.author || "-")}</dd></div>
          <div><dt>Version</dt><dd>${escapeHtml(skin.version || "-")}</dd></div>
          <div><dt>Skin base</dt><dd>${escapeHtml(skin.targetBaseSkin || "-")}</dd></div>
          <div><dt>Preview</dt><dd>${skin.previewInferred ? "Inferida" : art ? "Disponible" : "-"}</dd></div>
          <div><dt>Ruta</dt><dd title="${escapeHtml(skin.path)}">${escapeHtml(skin.relativePath || skin.path)}</dd></div>
        </dl>
      </div>
      <div class="skin-profile-actions">
        <button class="${queued ? "secondary-button" : "docs-link"} profile-queue" type="button">${queued ? "Quitar" : "Seleccionar"}</button>
        <button class="secondary-button profile-favorite" type="button">${favorite ? "Quitar favorita" : "Favorita"}</button>
        <button class="secondary-button profile-open-mod-folder" type="button">Carpeta mod</button>
        <button class="secondary-button profile-edit" type="button">Editar metadata</button>
        <button class="secondary-button profile-reveal" type="button">Abrir</button>
      </div>
    </article>
  `;

  els.skinProfilePanel.querySelector(".skin-profile-art img")?.addEventListener("error", (event) => {
    const image = event.currentTarget;
    if (image.dataset.fallback && image.src !== image.dataset.fallback) {
      image.src = image.dataset.fallback;
      return;
    }
    image.closest(".skin-profile-art")?.classList.add("missing-art");
    image.remove();
  });
  els.skinProfilePanel.querySelector(".profile-queue")?.addEventListener("click", () => {
    if (state.queuedSkins.has(key)) removeQueuedSkinKey(key);
    else queueSkinKey(key);
    saveQueuedSkins();
    renderCustomMods();
    renderSkinProfile();
  });
  els.skinProfilePanel.querySelector(".profile-favorite")?.addEventListener("click", () => {
    if (state.favoriteSkins.has(key)) state.favoriteSkins.delete(key);
    else state.favoriteSkins.add(key);
    saveFavoriteSkins();
    renderCustomMods();
    renderSkinProfile();
    sendPenguSkinCatalog("favorite-updated");
  });
  els.skinProfilePanel.querySelector(".profile-edit")?.addEventListener("click", () => {
    state.selectedSkinKey = key;
    openSkinMetadataModal(key);
  });
  els.skinProfilePanel.querySelector(".profile-reveal")?.addEventListener("click", () => window.riftAtlas.revealModPath(skin.path));
  els.skinProfilePanel.querySelector(".profile-open-mod-folder")?.addEventListener("click", async () => {
    const skinId = getFullSkinIdForStorage(skin);
    if (!skinId) {
      if (els.customModsLabel) els.customModsLabel.textContent = "No pude resolver el ID de skin para crear la carpeta.";
      return;
    }
    const result = await window.riftAtlas.openCustomSkinModFolder?.(skinId);
    if (els.customModsLabel) {
      els.customModsLabel.textContent = `Carpeta lista: ${result?.folderPath || `mods/skins/${skinId}`}`;
    }
  });
};

const closeSkinMetadataModal = () => {
  if (els.skinMetadataModal) els.skinMetadataModal.hidden = true;
};

const openSkinMetadataModal = (key = "") => {
  const skin = getSkinByKey(key);
  if (!skin || !els.skinMetadataModal) return;
  const meta = state.skinMetadata[key] || {};
  els.metadataSkinKeyInput.value = key;
  els.metadataNameInput.value = meta.name || skin.skin || skin.name || "";
  els.metadataChampionInput.value = meta.champion || skin.champion || "";
  els.metadataBaseInput.value = meta.baseSkin || skin.targetBaseSkin || "";
  els.metadataAuthorInput.value = meta.author || skin.author || "";
  els.metadataVersionInput.value = meta.version || skin.version || "";
  els.metadataPreviewInput.value = meta.preview || skin.previewUrl || skin.imageUrl || "";
  els.skinMetadataModal.hidden = false;
};

const inferPreviewForSkin = async (skin = {}) => {
  const inferred = getSkinLoadingImage({ ...skin, previewUrl: "", imageUrl: "" }) ||
    getSkinDefaultLoadingImage(skin) ||
    getSkinDefaultSplashImage(skin);
  if (!inferred) return "";
  try {
    const cached = await window.riftAtlas.cachePreview?.({ key: getSkinKey(skin), source: inferred });
    return cached?.previewUrl || inferred;
  } catch {
    return inferred;
  }
};

const saveMetadataForm = async () => {
  const key = els.metadataSkinKeyInput?.value || "";
  const skin = getSkinByKey(key);
  if (!key || !skin) return;
  const preview = els.metadataPreviewInput.value.trim();
  state.skinMetadata[key] = {
    name: els.metadataNameInput.value.trim(),
    champion: els.metadataChampionInput.value.trim(),
    baseSkin: els.metadataBaseInput.value.trim(),
    author: els.metadataAuthorInput.value.trim(),
    version: els.metadataVersionInput.value.trim(),
    preview,
    previewInferred: !preview,
    updatedAt: new Date().toISOString()
  };
  saveSkinMetadata();
  closeSkinMetadataModal();
  renderSkinChampionOptions();
  renderSkinLibrary();
  renderCustomMods();
  renderSkinProfile();
  sendPenguSkinCatalog("metadata-updated");
  if (roseAuthoritativeSelection.skinKey === key) {
    publishCustomModState(getSkinByKey(key), roseAuthoritativeSelection.payload || {}, { force: true });
  }
};

const getSelectionName = (items = []) => {
  if (!items.length) return "Seleccion vacia";
  const first = items[0];
  if (items.length === 1) return getSkinVisibleName(first) || "1 mod";
  return `${getSkinVisibleName(first) || "Mod"} + ${items.length - 1} mas`;
};

let partyPeer = null;
let partyConnections = new Map();
let partyIsHost = false;
let partyTransferSeq = 0;
const PARTY_CHUNK_SIZE = 64 * 1024;
const PARTY_CHUNK_ACK_TIMEOUT_MS = 15000;
const PARTY_CHUNK_MAX_ATTEMPTS = 3;
const PARTY_AUTO_REQUEST_DELAY_MS = 450;
const PARTY_UPLOAD_BYTES_PER_SECOND = 96 * 1024;
const PARTY_UPLOAD_GAP_MS = 120;
const partyIncomingTransfers = new Map();
const partyTransferControls = new Map();
const partyRequestedHashes = new Set();
const partyChunkAckWaiters = new Map();
const partyFileInfoCache = new Map();
const partyTransferStatus = new Map();
const partySyncedQueuedSkins = new Map();
const partyReceivedFiles = new Map();
let partyAutoApplyTriggered = false;
let partySyncTimer = null;
let penguAutoConnectInFlight = false;
let penguAutoConnectTimer = null;
let penguLastAutoConnectKey = "";
let partyOwnToken = "";
let partyOwnRoomId = "";
let partyOwnKey = "";
let partyOwnSummonerId = 0;

const isPartyConnected = () => state.partyStatus === "connected";

const getPartyDisplayName = () => els.partyNameInput?.value.trim() || localStorage.getItem("riftAtlas:partyName") || "Rift Atlas";

const PARTY_TOKEN_PREFIX = "ROSE:";
const PARTY_TOKEN_VERSION = 2;
const PARTY_TOKEN_EXPIRY_SECONDS = 60 * 60;
const partyTextEncoder = new TextEncoder();
const partyTextDecoder = new TextDecoder();

const partyBase64UrlEncode = (value) => {
  const bytes = value instanceof Uint8Array ? value : partyTextEncoder.encode(String(value));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const partyBase64UrlDecodeToBytes = (value = "") => {
  const text = String(value || "");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const partyBase64UrlDecodeText = (value = "") => partyTextDecoder.decode(partyBase64UrlDecodeToBytes(value));

const bytesToHex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const randomPartyKeyBytes = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
};

const partyDeflateBytes = async (bytes) => {
  if (typeof CompressionStream === "undefined") throw new Error("Este WebView no soporta compresion de tokens Rose.");
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const partyInflateBytes = async (bytes) => {
  if (typeof DecompressionStream === "undefined") throw new Error("Este WebView no soporta tokens Rose comprimidos.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const setUint64BigEndian = (view, offset, value) => {
  if (typeof view.setBigUint64 === "function") {
    view.setBigUint64(offset, BigInt(value));
    return;
  }
  const high = Math.floor(value / 0x100000000);
  const low = value >>> 0;
  view.setUint32(offset, high);
  view.setUint32(offset + 4, low);
};

const getUint64BigEndian = (view, offset) => {
  if (typeof view.getBigUint64 === "function") return Number(view.getBigUint64(offset));
  return view.getUint32(offset) * 0x100000000 + view.getUint32(offset + 4);
};

const getStablePartySummonerId = () => {
  const saved = Number(localStorage.getItem("riftAtlas:partySummonerId") || 0);
  if (Number.isSafeInteger(saved) && saved > 0) return saved;
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  const generated = Number((BigInt(bytes[0]) << 21n) ^ BigInt(bytes[1] & 0x1fffff));
  const id = Math.max(1, generated);
  localStorage.setItem("riftAtlas:partySummonerId", String(id));
  return id;
};

const getLocalPartyId = () => partyPeer?.id || String(partyOwnSummonerId || getStablePartySummonerId());

const computeRosePartyRoomKey = async (summonerId, key) => {
  const keyBytes = key instanceof Uint8Array ? key : partyBase64UrlDecodeToBytes(key);
  const idBytes = partyTextEncoder.encode(String(summonerId));
  const raw = new Uint8Array(idBytes.length + keyBytes.length);
  raw.set(idBytes, 0);
  raw.set(keyBytes, idBytes.length);
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return bytesToHex(new Uint8Array(digest)).slice(0, 32);
};

const createRosePartyToken = async () => {
  const summonerId = getStablePartySummonerId();
  const keyBytes = randomPartyKeyBytes();
  const timestamp = Math.floor(Date.now() / 1000);
  const tokenData = new Uint8Array(45);
  const view = new DataView(tokenData.buffer);
  view.setUint8(0, PARTY_TOKEN_VERSION);
  view.setUint32(1, timestamp);
  setUint64BigEndian(view, 5, summonerId);
  tokenData.set(keyBytes, 13);
  const token = `${PARTY_TOKEN_PREFIX}${partyBase64UrlEncode(await partyDeflateBytes(tokenData))}`;
  const key = partyBase64UrlEncode(keyBytes);
  const roomId = await computeRosePartyRoomKey(summonerId, keyBytes);
  return { token, roomId, summonerId, key };
};

const decodeRosePartyToken = async (token = "") => {
  const rawToken = String(token || "").trim().replace(/\s+/g, "");
  if (!rawToken.toUpperCase().startsWith(PARTY_TOKEN_PREFIX)) return null;
  const encodedPayload = rawToken.slice(PARTY_TOKEN_PREFIX.length);
  try {
    const data = await partyInflateBytes(partyBase64UrlDecodeToBytes(encodedPayload));
    if (data.length < 45) throw new Error("Token data too short");
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const version = view.getUint8(0);
    let timestamp = 0;
    let summonerId = 0;
    let keyBytes = null;
    if (version === 1) {
      if (data.length < 57) throw new Error("Token data too short");
      timestamp = view.getUint32(1);
      summonerId = getUint64BigEndian(view, 5);
      keyBytes = data.slice(25, 57);
    } else if (version === PARTY_TOKEN_VERSION) {
      timestamp = view.getUint32(1);
      summonerId = getUint64BigEndian(view, 5);
      keyBytes = data.slice(13, 45);
    } else {
      throw new Error("Version no soportada.");
    }
    if ((Date.now() / 1000) > timestamp + PARTY_TOKEN_EXPIRY_SECONDS) {
      throw new Error("Token expirado. Pedi uno nuevo.");
    }
    const key = partyBase64UrlEncode(keyBytes);
    return {
      token: rawToken,
      roomId: await computeRosePartyRoomKey(summonerId, keyBytes),
      summonerId,
      key
    };
  } catch (binaryError) {
    if (binaryError?.message === "Token expirado. Pedi uno nuevo.") throw binaryError;
  }
  let data;
  try {
    data = JSON.parse(partyBase64UrlDecodeText(encodedPayload));
  } catch {
    throw new Error("Token invalido.");
  }
  const version = Number(data.v || 0);
  const timestamp = Number(data.t || 0);
  const summonerId = Number(data.s || 0);
  const key = String(data.k || "");
  if (version !== PARTY_TOKEN_VERSION || !timestamp || !summonerId || !key) {
    throw new Error("Token invalido.");
  }
  if ((Date.now() / 1000) > timestamp + PARTY_TOKEN_EXPIRY_SECONDS) {
    throw new Error("Token expirado. Pedi uno nuevo.");
  }
  return {
    token: rawToken,
    roomId: await computeRosePartyRoomKey(summonerId, key),
    summonerId,
    key
  };
};

const generatePartyRoomId = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};

const normalizePartyCode = (value = "") =>
  String(value)
    .trim()
    .replace(/^rift-atlas-party:/i, "")
    .replace(/^https?:\/\/[^#?]+[#?]party=/i, "")
    .replace(/[^a-z0-9_-]/gi, "")
    .toUpperCase();

const hashPenguPartyRoom = (value = "") => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, "0");
};

const getPenguPartyNumericId = (value = "") => {
  let hash = 2166136261;
  const text = String(value || "local");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

let penguPartyStateBroadcastTimer = null;

const getPenguPartySkinSelection = (member = {}) => {
  const firstSkin = (member.activeSkins || [])[0];
  if (!firstSkin) return null;
  return {
    champion_id: Number(firstSkin.championId || firstSkin.rawChampion || 0),
    skin_id: Number(firstSkin.skinId || firstSkin.id || 0),
    chroma_id: Number(firstSkin.chromaId || 0) || null,
    skin_name: firstSkin.name || firstSkin.fileName || firstSkin.skin || ""
  };
};

const getPenguPartyStatePayload = () => {
  const connected = ["connected", "connecting"].includes(state.partyStatus);
  const localId = getLocalPartyId();
  const localMemberId = partyOwnSummonerId || getStablePartySummonerId();
  return {
    source: "rift-atlas-app",
    type: "party-state",
    enabled: connected,
    my_token: partyOwnToken || state.partyLink || "",
    my_summoner_id: localMemberId,
    my_summoner_name: getPartyDisplayName(),
    peers: getAllPartyMembers()
      .filter((member) => member.id && member.id !== localId)
      .map((member) => ({
        summoner_id: getPenguPartyNumericId(member.id),
        summoner_name: member.name || "Jugador",
        connected: Boolean(member.connected),
        connection_state: member.connected ? "connected" : "disconnected",
        in_lobby: true,
        skin_selection: getPenguPartySkinSelection(member)
      }))
  };
};

const broadcastPenguPartyState = () => {
  window.riftAtlas.sendPenguMessage?.(getPenguPartyStatePayload()).catch(() => null);
};

const schedulePenguPartyStateBroadcast = (delay = 100) => {
  clearTimeout(penguPartyStateBroadcastTimer);
  penguPartyStateBroadcastTimer = setTimeout(() => {
    penguPartyStateBroadcastTimer = null;
    broadcastPenguPartyState();
  }, delay);
};

const getPenguLobbyMembers = (payload = state.penguLobby || {}) =>
  (payload.members || [])
    .map((member) => ({
      puuid: String(member.puuid || member.id || "").trim(),
      name: String(member.displayName || member.summonerName || member.gameName || "Jugador").trim(),
      isLocal: Boolean(member.isLocal)
    }))
    .filter((member) => member.puuid);

const getPenguPartyPlan = (payload = state.penguLobby || {}) => {
  const members = getPenguLobbyMembers(payload);
  if (members.length < 2) return null;
  const sortedPuuids = [...new Set(members.map((member) => member.puuid))].sort();
  const localPuuid = String(payload.localPuuid || members.find((member) => member.isLocal)?.puuid || "").trim();
  if (!localPuuid || !sortedPuuids.includes(localPuuid)) return null;
  const localMember = members.find((member) => member.puuid === localPuuid) || members.find((member) => member.isLocal);
  return {
    roomId: `PENGU-${hashPenguPartyRoom(sortedPuuids.join("|"))}`,
    isHost: sortedPuuids[0] === localPuuid,
    displayName: localMember?.name || getPartyDisplayName(),
    members
  };
};

const renderPenguBridgeStatus = () => {
  if (els.penguBridgeLabel) {
    els.penguBridgeLabel.textContent = state.penguBridgeConnected
      ? "Pengu Loader conectado a Rift Atlas."
      : "Pengu Loader: esperando plugin.";
  }
  if (els.penguLobbyLabel) {
    const plan = getPenguPartyPlan();
    if (!state.penguLobby) {
      els.penguLobbyLabel.textContent = "Lobby de League no detectado.";
    } else if (!plan) {
      const count = getPenguLobbyMembers().length;
      els.penguLobbyLabel.textContent = count
        ? `Lobby detectado con ${count} miembro(s). Esperando party de 2 o mas.`
        : "Lobby de League sin miembros sincronizables.";
    } else {
      els.penguLobbyLabel.textContent = `Lobby detectado: sala ${plan.roomId}, ${plan.members.length} miembro(s).`;
    }
  }
  if (els.penguAutoPartyCheckbox) {
    els.penguAutoPartyCheckbox.checked = state.penguAutoParty;
  }
};

const schedulePenguAutoParty = (delay = 700) => {
  clearTimeout(penguAutoConnectTimer);
  penguAutoConnectTimer = setTimeout(() => {
    penguAutoConnectTimer = null;
    handlePenguAutoParty().catch((error) => {
      if (els.penguLobbyLabel) els.penguLobbyLabel.textContent = `Pengu auto-party: ${error.message}`;
    });
  }, delay);
};

function getMissingRemotePartyFiles() {
  if (state.partyStatus !== "connected" || !state.partyRoom) return [];
  const localId = getLocalPartyId();
  const missingByKey = new Map();
  getAllPartyMembers()
    .filter((member) => member.id !== localId)
    .flatMap((member) => (member.activeSkins || []).map((file) => ({ ...file, ownerId: member.id, ownerName: member.name || "Jugador" })))
    .forEach((file) => {
      const key = getPartyTransferKey(file);
      const current = partyTransferStatus.get(key);
      if (["sin-local", "error", "cancelado"].includes(current?.status)) return;
      if (!key || getLocalPartyFile(file)) return;
      missingByKey.set(key, file);
    });
  return [...missingByKey.values()];
}

const getPartySkinFiles = () => {
  const syncedLocalKeys = new Set(partySyncedQueuedSkins.values());
  const canonicalKey = roseAuthoritativeSelection.skinKey && getSkinByKey(roseAuthoritativeSelection.skinKey)
    ? roseAuthoritativeSelection.skinKey
    : "";
  const keys = [
    canonicalKey,
    ...state.queuedSkins
  ].filter(Boolean);
  return [...new Set(keys)]
    .filter((key) => !syncedLocalKeys.has(key))
    .map(getSkinByKey)
    .filter(Boolean)
    .map((skin) => {
      const championId = getSkinSyncChampionNumber(skin);
      const skinId = getOverlayTargetSkinId(skin, championId);
      const isCustom = Boolean(skin.custom && !isDownloadedLeagueSkinsPath(getSkinKey(skin)));
      return {
        key: getSkinKey(skin),
        name: getSkinVisibleName(skin),
        champion: skin.champion || "Mod propio",
        championId,
        skinId,
        champion_id: championId,
        skin_id: skinId,
        isCustom,
        is_custom: isCustom,
        fileName: String(skin.relativePath || skin.path || skin.name || "archivo").split(/[\\/]/).pop(),
        size: skin.size || 0,
        source: isCustom ? "Custom local" : "LeagueSkins",
        localPath: skin.path || "",
        extension: skin.extension || "",
        mtimeMs: skin.mtimeMs || 0
      };
    });
};

const getPartySharedKeys = () => {
  const syncedLocalKeys = new Set(partySyncedQueuedSkins.values());
  const canonicalKey = roseAuthoritativeSelection.skinKey && getSkinByKey(roseAuthoritativeSelection.skinKey)
    ? roseAuthoritativeSelection.skinKey
    : "";
  return [...new Set([canonicalKey, ...state.queuedSkins])]
    .filter((key) => key && !syncedLocalKeys.has(key) && Boolean(getSkinByKey(key)));
};

const getPartyApplyKeys = () => {
  const keys = new Set(getPartySharedKeys());
  const activeRemoteKeys = getRemotePartyTransferKeys();
  partyReceivedFiles.forEach((localKey, remoteKey) => {
    if (activeRemoteKeys.has(remoteKey) && getSkinByKey(localKey)) keys.add(localKey);
  });
  getAllPartyFiles()
    .filter((file) => file.ownerId !== getLocalPartyId())
    .forEach((file) => {
      const localFile = getLocalPartyFile(file);
      if (localFile?.path) keys.add(localFile.path);
  });
  return [...keys];
};

const getPartyPeerExtraMods = () => {
  if (state.partyStatus !== "connected") return [];
  const localId = getLocalPartyId();
  const seen = new Set();
  return getAllPartyFiles()
    .filter((file) => file.ownerId !== localId)
    .map((file) => {
      const localFile = getLocalPartyFile(file);
      const localPath = localFile?.path || "";
      if (!localPath) return null;
      const normalized = localPath.replace(/\//g, "\\").toLowerCase();
      if (seen.has(normalized)) return null;
      seen.add(normalized);
      return {
        path: localPath,
        name: `${file.ownerName || "Party"} - ${file.name || file.fileName || localFile.skin || localFile.name || "skin"}`,
        category: "party",
        champion: file.champion || localFile.champion || "",
        skin: file.name || file.fileName || localFile.skin || localFile.name || ""
      };
    })
    .filter(Boolean);
};

const getShortPartyHash = (hash = "") => String(hash || "").slice(0, 16);

const getPartySkinFilesWithInfo = async () =>
  Promise.all(getPartySkinFiles().map(async (skin) => {
    if (!skin.isCustom) {
      return {
        ...skin,
        key: `league:${skin.championId || 0}:${skin.skinId || 0}`,
        hash: "",
        custom_mod_hash: "",
        is_custom: false,
        isCustom: false
      };
    }

    try {
      const cacheKey = `${skin.localPath}|${skin.size || 0}|${skin.mtimeMs || 0}`;
      const cached = partyFileInfoCache.get(cacheKey);
      if (cached) {
        const shortHash = getShortPartyHash(cached.hash);
        return { ...skin, fileName: cached.fileName, size: cached.size, hash: shortHash, custom_mod_hash: shortHash, mimeType: cached.mimeType };
      }
      const info = await window.riftAtlas.getPartyFileInfo(skin.localPath);
      partyFileInfoCache.set(cacheKey, info);
      const shortHash = getShortPartyHash(info.hash);
      return { ...skin, fileName: info.fileName, size: info.size, hash: shortHash, custom_mod_hash: shortHash, mimeType: info.mimeType };
    } catch (error) {
      setPartyTransferStatus(getPartyTransferKey(skin), {
        fileName: skin.fileName || skin.name,
        champion: skin.champion || "",
        status: "error",
        error: `No pude leer el archivo local: ${error.message}`
      });
      return { ...skin, unavailable: true, error: error.message };
    }
  }))
    .then((skins) => skins.filter((skin) => !skin.unavailable && (!skin.isCustom || skin.hash)));

const getPartyTransferKey = (skin = {}, fallback = "") =>
  skin.hash ||
  skin.custom_mod_hash ||
  (skin.skinId || skin.skin_id ? `league:${skin.championId || skin.champion_id || 0}:${skin.skinId || skin.skin_id || 0}` : "") ||
  skin.key ||
  skin.fileName ||
  fallback;

const findLocalLeagueSkinForParty = (remoteSkin = {}) => {
  const remoteChampionId = Number(remoteSkin.championId || remoteSkin.champion_id || 0);
  const remoteSkinId = Number(remoteSkin.skinId || remoteSkin.skin_id || 0);
  if (!remoteSkinId) return null;
  const championMatches = state.skinLibrary.filter((skin) => {
    const championId = getSkinSyncChampionNumber(skin);
    return !remoteChampionId || !championId || championId === remoteChampionId;
  });
  // Party shares the full numeric League skin/chroma ID. Prefer the actual
  // package target; broad candidate matching can otherwise select a sibling
  // chroma because every entry also carries its common base ID.
  const local = championMatches.find((skin) =>
    getOverlayTargetSkinId(skin, remoteChampionId || getSkinSyncChampionNumber(skin)) === remoteSkinId
  ) || championMatches.find((skin) =>
    Number(skin.fileBaseId || skin.skinId || 0) === remoteSkinId
  );
  return local ? applySkinMetadata(local) : null;
};

const getLocalPartyFile = (remoteSkin = {}) => {
  const remoteHash = getShortPartyHash(remoteSkin.hash || remoteSkin.custom_mod_hash);
  if (!remoteSkin.isCustom && !remoteSkin.is_custom) {
    const localLeagueSkin = findLocalLeagueSkinForParty(remoteSkin);
    if (localLeagueSkin) return localLeagueSkin;
  }

  return state.customMods.find((skin) => {
    const sameHash = remoteHash && skin.partyHash === remoteHash;
    const sameKey = remoteSkin.key && getSkinKey(skin) === remoteSkin.key;
    return sameHash || sameKey;
  });
};

const findLocalPartyFileByHash = async (remoteSkin = {}) => {
  if (!remoteSkin.isCustom && !remoteSkin.is_custom) return findLocalLeagueSkinForParty(remoteSkin);

  const remoteHash = getShortPartyHash(remoteSkin.hash || remoteSkin.custom_mod_hash);
  if (!remoteHash) return getLocalPartyFile(remoteSkin);
  const localByKnownHash = getLocalPartyFile(remoteSkin);
  if (localByKnownHash?.partyHash === remoteHash) return localByKnownHash;

  const candidates = state.customMods.filter((skin) => skin.path);

  for (const candidate of candidates) {
    try {
      const info = await window.riftAtlas.getPartyFileInfo(candidate.path);
      if (getShortPartyHash(info.hash) === remoteHash) {
        candidate.partyHash = remoteHash;
        return candidate;
      }
    } catch {
      // Ignore unreadable candidates; the transfer request can still fetch the file.
    }
  }

  return null;
};

const queueLocalPartyFile = (localFile, remoteSkin = {}) => {
  const key = getSkinKey(localFile);
  if (!key) return false;
  const remoteHash = getShortPartyHash(remoteSkin.hash || remoteSkin.custom_mod_hash);
  if (remoteHash) localFile.partyHash = remoteHash;
  const alreadyQueued = state.queuedSkins.has(key);
  if (alreadyQueued) return true;
  trackPartySyncedQueue(remoteSkin, key);
  queueSkinKey(key);
  saveQueuedSkins();
  return true;
};

const ensurePartySkinSelectedLocally = async (remoteSkin = {}) => {
  const localFile = await findLocalPartyFileByHash(remoteSkin);
  if (!localFile) return false;
  const queued = queueLocalPartyFile(localFile, remoteSkin);
  if (queued) {
    setPartyTransferStatus(getPartyTransferKey(remoteSkin), {
      fileName: remoteSkin.fileName || remoteSkin.name || localFile.name,
      champion: remoteSkin.champion || localFile.champion || "",
      owner: remoteSkin.ownerName || "",
      status: "local",
      progress: 100,
      localPath: localFile.path
    });
  }
  return queued;
};

const enforcePartyP2PSelection = () => {
  // No force selection of local party P2P files.
  // Users should be able to add/remove their own local P2P skins manually.
  return false;
};

const isActivePartyP2PPath = (filePath = "") =>
  state.partyStatus === "connected" &&
  state.customMods.some((mod) => mod.source === "p2p" && mod.path === filePath);

const getLocalPartyReadyState = () => {
  if (state.partyStatus !== "connected") {
    return { ready: false, pending: 0, label: "Desconectado" };
  }
  const activeTransfers = [...partyTransferStatus.values()].filter((item) =>
    ["solicitando", "descargando", "recibiendo", "enviando"].includes(item.status)
  );
  const activeTransferKeys = new Set(activeTransfers.map((item) => item.key).filter(Boolean));
  const missingRemoteFiles = getMissingRemotePartyFiles()
    .filter((file) => !activeTransferKeys.has(getPartyTransferKey(file)));
  const pending = activeTransfers.length + missingRemoteFiles.length;
  return {
    ready: pending === 0,
    pending,
    label: pending ? `${pending} archivo(s) pendientes` : "Listo"
  };
};

const getLocalPartyMember = () => ({
  id: getLocalPartyId(),
  name: getPartyDisplayName(),
  activeSkins: getPartySkinFiles(),
  isHost: partyIsHost,
  connected: state.partyStatus === "connected",
  ready: getLocalPartyReadyState().ready,
  pendingTransfers: getLocalPartyReadyState().pending
});

const schedulePartySync = (delay = 350) => {
  clearTimeout(partySyncTimer);
  partySyncTimer = setTimeout(() => {
    partySyncTimer = null;
    syncPartySkins();
  }, delay);
};

const getAllPartyMembers = () => {
  if (!state.partyRoom) return [];
  return [state.partyRoom.host, ...(state.partyRoom.members || [])].filter(Boolean);
};

const getRemotePartyTransferKeys = () =>
  new Set(
    getAllPartyMembers()
      .filter((member) => member.id !== getLocalPartyId())
      .flatMap((member) => member.activeSkins || [])
      .map((file) => getPartyTransferKey(file))
      .filter(Boolean)
  );

const trackPartySyncedQueue = (remoteSkin = {}, localKey = "") => {
  const remoteKey = getPartyTransferKey(remoteSkin);
  if (remoteKey && localKey) partySyncedQueuedSkins.set(remoteKey, localKey);
};

const prunePartySyncedQueue = ({ removeAll = false } = {}) => {
  const activeRemoteKeys = removeAll ? new Set() : getRemotePartyTransferKeys();
  let changed = false;

  partySyncedQueuedSkins.forEach((localKey, remoteKey) => {
    if (activeRemoteKeys.has(remoteKey)) return;
    partySyncedQueuedSkins.delete(remoteKey);
    if (removeQueuedSkinKey(localKey)) changed = true;
  });
  partyReceivedFiles.forEach((localKey, remoteKey) => {
    if (activeRemoteKeys.has(remoteKey)) return;
    partyReceivedFiles.delete(remoteKey);
    removeP2PFileIfUnused(localKey);
  });

  if (changed) saveQueuedSkins();
};

const updatePartyMemberSkins = (peerId, skins = []) => {
  if (!state.partyRoom) return;
  if (state.partyRoom.host?.id === peerId) {
    state.partyRoom = {
      ...state.partyRoom,
      host: { ...state.partyRoom.host, activeSkins: skins }
    };
    return;
  }
  state.partyRoom = {
    ...state.partyRoom,
    members: (state.partyRoom.members || []).map((member) =>
      member.id === peerId ? { ...member, activeSkins: skins } : member
    )
  };
};

const updatePartyMemberReady = (peerId, readyState = {}) => {
  if (!state.partyRoom) return;
  const patch = {
    ready: Boolean(readyState.ready),
    pendingTransfers: Number(readyState.pending || 0),
    readyLabel: readyState.label || ""
  };
  if (state.partyRoom.host?.id === peerId) {
    state.partyRoom = { ...state.partyRoom, host: { ...state.partyRoom.host, ...patch } };
    return;
  }
  state.partyRoom = {
    ...state.partyRoom,
    members: (state.partyRoom.members || []).map((member) =>
      member.id === peerId ? { ...member, ...patch } : member
    )
  };
};

const broadcastPartyRoom = () => {
  if (!partyIsHost || !state.partyRoom) return;
  partyConnections.forEach((connection) => {
    if (connection.open) {
      connection.send({ type: "room-update", data: state.partyRoom });
    }
  });
};

const hasLocalPartyFile = (remoteSkin = {}) => {
  return Boolean(getLocalPartyFile(remoteSkin));
};

const sendPartyReadyUpdate = () => {
  if (state.partyStatus !== "connected") return;
  const readyState = getLocalPartyReadyState();
  updatePartyMemberReady(getLocalPartyId(), readyState);
  partyConnections.forEach((connection) => {
    if (connection.open) {
      connection.send({ type: "ready-update", data: readyState });
    }
  });
  if (partyIsHost) broadcastPartyRoom();
};

const setPartyTransferStatus = (key, patch = {}) => {
  if (!key) return;
  const current = partyTransferStatus.get(key) || {};
  partyTransferStatus.set(key, {
    key,
    updatedAt: Date.now(),
    progress: 0,
    ...current,
    ...patch
  });
  sendPartyReadyUpdate();
  renderParty();
};

const rejectPartyAckWaitersForConnection = (peerId, error) => {
  partyChunkAckWaiters.forEach((waiter, key) => {
    if (waiter.peerId !== peerId) return;
    partyChunkAckWaiters.delete(key);
    waiter.reject(error);
  });
};

const rejectPartyAckWaitersForTransfer = (peerId, transferId, error) => {
  const prefix = `${peerId}:${transferId}:`;
  partyChunkAckWaiters.forEach((waiter, key) => {
    if (!key.startsWith(prefix)) return;
    partyChunkAckWaiters.delete(key);
    waiter.reject(error);
  });
};

const getPartyTransferControl = (transferId) => {
  if (!transferId) return null;
  if (!partyTransferControls.has(transferId)) {
    partyTransferControls.set(transferId, { paused: false, canceled: false });
  }
  return partyTransferControls.get(transferId);
};

const isLeagueInProgress = () => state.penguGameflowPhase === "InProgress";

const pausePartyTransfersForGame = () => {
  partyTransferControls.forEach((control) => {
    control.paused = true;
  });
  partyTransferStatus.forEach((transfer, key) => {
    if (!["solicitando", "recibiendo", "descargando", "enviando", "pendiente"].includes(transfer.status)) return;
    setPartyTransferStatus(key, {
      status: "pausado",
      error: "Pausado mientras estas en partida para no subir el ping."
    });
  });
};

const resumePartyTransfersAfterGame = () => {
  partyTransferControls.forEach((control) => {
    control.paused = false;
  });
  if (state.partyStatus === "connected") {
    schedulePartySync(750);
    setTimeout(() => requestMissingRoomFiles(), 1000);
  }
};

const waitForPartyNetworkWindow = async (transferId) => {
  const control = getPartyTransferControl(transferId);
  while (!control?.canceled && (control?.paused || isLeagueInProgress())) {
    await new Promise((resolve) => setTimeout(resolve, isLeagueInProgress() ? 1000 : 250));
  }
  if (control?.canceled) throw new Error("Transferencia cancelada.");
};

const throttlePartyUpload = async (bytesSent, startedAt) => {
  const minElapsed = (bytesSent / PARTY_UPLOAD_BYTES_PER_SECOND) * 1000;
  const elapsed = Date.now() - startedAt;
  const waitMs = Math.max(PARTY_UPLOAD_GAP_MS, minElapsed - elapsed);
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
};

const waitForPartyTransferResume = async (transferId) => {
  await waitForPartyNetworkWindow(transferId);
};

const sendPartyTransferControlMessage = (transfer = {}, type) => {
  if (!transfer?.peerId || !transfer?.transferId) return false;
  const connection = partyConnections.get(transfer.peerId) ||
    [...partyConnections.values()].find((candidate) => candidate.open);
  if (!connection?.open) return false;
  connection.send({
    type,
    id: transfer.transferId,
    skin: transfer.skin || findPartyFileByKey(transfer.key) || {},
    relayPeerId: transfer.relayPeerId || ""
  });
  return true;
};

const pausePartyTransfer = (key) => {
  const transfer = partyTransferStatus.get(key);
  if (!transfer?.transferId) return;
  const control = getPartyTransferControl(transfer.transferId);
  control.paused = true;
  sendPartyTransferControlMessage(transfer, "file-pause");
  setPartyTransferStatus(key, { status: "pausado", error: "Pausado" });
};

const resumePartyTransfer = (key) => {
  const transfer = partyTransferStatus.get(key);
  if (!transfer?.transferId) return;
  const control = getPartyTransferControl(transfer.transferId);
  control.paused = false;
  sendPartyTransferControlMessage(transfer, "file-resume");
  setPartyTransferStatus(key, { status: transfer.direction === "upload" ? "enviando" : "recibiendo", error: "" });
};

const cancelPartyTransfer = (key) => {
  const transfer = partyTransferStatus.get(key);
  if (!transfer?.transferId) return;
  const control = getPartyTransferControl(transfer.transferId);
  control.canceled = true;
  control.paused = false;
  sendPartyTransferControlMessage(transfer, "file-cancel");
  rejectPartyAckWaitersForTransfer(transfer.peerId, transfer.transferId, new Error("Transferencia cancelada."));
  partyIncomingTransfers.delete(transfer.transferId);
  if (transfer.hash) partyRequestedHashes.delete(transfer.hash);
  setPartyTransferStatus(key, { status: "cancelado", error: "Cancelado", progress: 0 });
};

const getAllPartyFiles = () =>
  getAllPartyMembers().flatMap((member) =>
    (member.activeSkins || []).map((file) => ({ ...file, ownerId: member.id, ownerName: member.name || "Jugador" }))
  );

const findPartyFileByKey = (key = "") =>
  getAllPartyFiles().find((file) => getPartyTransferKey(file) === key || file.key === key || file.fileName === key);

const relayPartyFileMessage = (targetPeerId, sourcePeerId, message = {}) => {
  if (!partyIsHost || !targetPeerId || targetPeerId === getLocalPartyId()) return false;
  const targetConnection = partyConnections.get(targetPeerId);
  if (!targetConnection?.open) return false;
  const { targetPeerId: _targetPeerId, ...forwarded } = message;
  targetConnection.send({ ...forwarded, relayPeerId: sourcePeerId });
  return true;
};

const sendPartyFile = async (connection, transferId, skin = {}, relayPeerId = "") => {
  const transferKey = getPartyTransferKey(skin, transferId);
  const control = getPartyTransferControl(transferId);
  control.canceled = false;
  control.paused = false;
  try {
    const localSkin = getLocalPartyFile(skin) || skin;
    const localPath = localSkin.path || localSkin.localPath || skin.localPath;
    if (!localPath) {
      throw new Error("Archivo local no disponible para reenviar.");
    }
    const info = await window.riftAtlas.getPartyFileInfo(localPath);
    setPartyTransferStatus(transferKey, {
      fileName: info.fileName || skin.fileName || skin.name,
      champion: skin.champion || "",
      owner: getPartyDisplayName(),
      status: "enviando",
      progress: 0,
      transferId,
      peerId: connection.peer,
      relayPeerId,
      direction: "upload",
      skin
    });
    connection.send({ type: "file-accept", id: transferId, metadata: info, skin, relayPeerId });
    const totalChunks = Math.ceil(info.size / PARTY_CHUNK_SIZE);
    const uploadStartedAt = Date.now();
    let uploadedBytes = 0;
    for (let sequence = 0; sequence < totalChunks; sequence += 1) {
      if (isLeagueInProgress()) {
        setPartyTransferStatus(transferKey, {
          status: "pausado",
          error: "Pausado mientras estas en partida para no subir el ping."
        });
      }
      await waitForPartyNetworkWindow(transferId);
      const data = await window.riftAtlas.readPartyFileChunk({
        filePath: localPath,
        offset: sequence * PARTY_CHUNK_SIZE,
        length: PARTY_CHUNK_SIZE
      });
      for (let attempt = 1; attempt <= PARTY_CHUNK_MAX_ATTEMPTS; attempt += 1) {
        await waitForPartyNetworkWindow(transferId);
        const ackPromise = waitForPartyChunkAck(connection.peer, transferId, sequence);
        connection.send({ type: "file-chunk", id: transferId, sequence, totalChunks, data, relayPeerId });
        uploadedBytes += data?.byteLength || data?.length || PARTY_CHUNK_SIZE;
        setPartyTransferStatus(transferKey, {
          status: "enviando",
          progress: Math.round(((sequence + 1) / Math.max(totalChunks, 1)) * 100),
          error: attempt > 1 ? `Reintentando chunk ${sequence + 1}/${totalChunks}` : ""
        });
        try {
          await ackPromise;
          break;
        } catch (ackError) {
          if (attempt >= PARTY_CHUNK_MAX_ATTEMPTS) throw ackError;
          await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
        }
      }
      await throttlePartyUpload(uploadedBytes, uploadStartedAt);
    }
    connection.send({ type: "file-complete", id: transferId, relayPeerId });
    setPartyTransferStatus(transferKey, { status: "enviado", progress: 100 });
  } catch (error) {
    const canceled = getPartyTransferControl(transferId)?.canceled;
    connection.send({ type: canceled ? "file-cancel" : "file-error", id: transferId, error: error.message, skin, relayPeerId });
    setPartyTransferStatus(transferKey, { status: canceled ? "cancelado" : "error", error: error.message });
  } finally {
    partyTransferControls.delete(transferId);
  }
};

const requestPartyFile = async (peerId, skin = {}) => {
  const transferKey = getPartyTransferKey(skin);
  if (await ensurePartySkinSelectedLocally(skin) || hasLocalPartyFile(skin)) {
    setPartyTransferStatus(transferKey, {
      fileName: skin.fileName || skin.name,
      champion: skin.champion || "",
      owner: skin.ownerName || peerId,
      status: "local",
      progress: 100
    });
    return;
  }

  setPartyTransferStatus(transferKey, {
    fileName: skin.fileName || skin.name,
    champion: skin.champion || "",
    owner: skin.ownerName || peerId,
    status: "sin-local",
    progress: 0,
    hash: getShortPartyHash(skin.hash || skin.custom_mod_hash),
    skin,
    error: skin.isCustom || skin.is_custom
      ? "Custom mod no encontrado localmente. Rift Atlas no transfiere archivos por PartyMode."
      : "Skin de LeagueSkins no encontrada localmente. Sincroniza LeagueSkins."
  });
  if (els.partyConnectionLabel) {
    els.partyConnectionLabel.textContent = `Party: ${skin.fileName || skin.name} no esta disponible localmente.`;
  }
};

const waitForPartyChunkAck = (peerId, transferId, sequence) => {
  const key = `${peerId}:${transferId}:${sequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      partyChunkAckWaiters.delete(key);
      reject(new Error(`Timeout esperando ACK del chunk ${sequence + 1}`));
    }, PARTY_CHUNK_ACK_TIMEOUT_MS);
    partyChunkAckWaiters.set(key, {
      peerId,
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      }
    });
  });
};

const requestMissingPartyFiles = (peerId, skins = []) => {
  skins.forEach((skin, index) => {
    const transferKey = getPartyTransferKey(skin);
    const current = partyTransferStatus.get(transferKey);
    if (["pendiente", "local", "sin-local", "cancelado", "error"].includes(current?.status)) return;
    setPartyTransferStatus(transferKey, {
      fileName: skin.fileName || skin.name,
      champion: skin.champion || "",
      owner: skin.ownerName || peerId,
      status: "pendiente",
      progress: 0
    });
    setTimeout(() => {
      const latest = partyTransferStatus.get(transferKey);
      if (latest?.status && latest.status !== "pendiente") return;
      requestPartyFile(peerId, skin).catch((error) => {
        setPartyTransferStatus(transferKey, { status: "error", error: error.message });
      });
    }, index * PARTY_AUTO_REQUEST_DELAY_MS);
  });
};

const requestMissingRoomFiles = () => {
  if (!state.partyRoom) return;
  const localId = getLocalPartyId();
  getAllPartyMembers()
    .filter((member) => member.id !== localId)
    .forEach((member) => requestMissingPartyFiles(member.id, member.activeSkins || []));
};

const handlePartyFileMessage = async (peerId, message = {}) => {
  const connection = partyConnections.get(peerId);
  if (!connection) return true;
  if (message.type === "file-request") {
    connection.send({
      type: "file-error",
      id: message.id,
      skin: message.skin,
      error: "Rift Atlas PartyMode no transfiere archivos; usa LeagueSkins local o el mismo custom mod instalado."
    });
    return true;
  }
  if (message.relayPeerId && partyIsHost) {
    if (relayPartyFileMessage(message.relayPeerId, peerId, message)) return true;
    connection.send({
      type: "file-error",
      id: message.id,
      error: "No pude reenviar el archivo P2P: el otro miembro no esta conectado.",
      skin: message.skin
    });
    return true;
  }
  if (message.type === "file-request") {
    if (message.targetPeerId && relayPartyFileMessage(message.targetPeerId, peerId, message)) {
      return true;
    }
    if (message.targetPeerId && message.targetPeerId !== getLocalPartyId()) {
      connection.send({
        type: "file-error",
        id: message.id,
        error: "No pude conectar con el dueno de esa skin en la party.",
        skin: message.skin
      });
      return true;
    }
    await sendPartyFile(connection, message.id, message.skin, message.relayPeerId || "");
    return true;
  }
  if (message.type === "file-accept") {
    const transferKey = getPartyTransferKey(message.skin, message.metadata?.hash || message.id);
    partyIncomingTransfers.set(message.id, {
      metadata: message.metadata,
      skin: message.skin,
      key: transferKey,
      peerId,
      relayPeerId: message.relayPeerId || "",
      chunks: new Map(),
      totalChunks: Math.ceil((message.metadata?.size || 0) / PARTY_CHUNK_SIZE)
    });
    setPartyTransferStatus(transferKey, {
      fileName: message.metadata?.fileName || message.skin?.fileName || message.skin?.name,
      champion: message.skin?.champion || "",
      owner: message.skin?.ownerName || peerId,
      status: "recibiendo",
      progress: 0,
      transferId: message.id,
      peerId,
      relayPeerId: message.relayPeerId || "",
      direction: "download",
      hash: message.metadata?.hash || message.skin?.hash || "",
      skin: message.skin
    });
    return true;
  }
  if (message.type === "file-chunk") {
    const transfer = partyIncomingTransfers.get(message.id);
    if (!transfer) return true;
    transfer.chunks.set(message.sequence, message.data);
    connection.send({ type: "file-ack", id: message.id, sequence: message.sequence, relayPeerId: message.relayPeerId || "" });
    setPartyTransferStatus(transfer.key, {
      status: "recibiendo",
      progress: Math.round((transfer.chunks.size / Math.max(message.totalChunks || transfer.totalChunks, 1)) * 100)
    });
    if (els.partyConnectionLabel) {
      els.partyConnectionLabel.textContent = `conectado, recibiendo ${transfer.metadata.fileName}: ${transfer.chunks.size}/${message.totalChunks}`;
    }
    return true;
  }
  if (message.type === "file-ack") {
    const waiterKey = `${peerId}:${message.id}:${message.sequence}`;
    const waiter = partyChunkAckWaiters.get(waiterKey);
    if (waiter) {
      partyChunkAckWaiters.delete(waiterKey);
      waiter.resolve();
    }
    return true;
  }
  if (message.type === "file-pause" || message.type === "file-resume" || message.type === "file-cancel") {
    const control = getPartyTransferControl(message.id);
    const transfer = partyIncomingTransfers.get(message.id);
    const transferKey = transfer?.key || getPartyTransferKey(message.skin, message.id);
    const current = partyTransferStatus.get(transferKey) || {};
    if (message.type === "file-pause") {
      control.paused = true;
      setPartyTransferStatus(transferKey, { status: "pausado", error: "Pausado", transferId: message.id, peerId, direction: current.direction || "download" });
    } else if (message.type === "file-resume") {
      control.paused = false;
      setPartyTransferStatus(transferKey, { status: current.direction === "upload" ? "enviando" : "recibiendo", error: "", transferId: message.id, peerId, direction: current.direction || "download" });
    } else {
      control.canceled = true;
      control.paused = false;
      rejectPartyAckWaitersForTransfer(peerId, message.id, new Error("Transferencia cancelada."));
      if (transfer?.metadata?.hash) partyRequestedHashes.delete(transfer.metadata.hash);
      if (message.skin?.hash) partyRequestedHashes.delete(message.skin.hash);
      partyIncomingTransfers.delete(message.id);
      setPartyTransferStatus(transferKey, { status: "cancelado", error: "Cancelado", progress: 0, transferId: message.id, peerId, direction: current.direction || "download" });
    }
    return true;
  }
  if (message.type === "file-complete") {
    const transfer = partyIncomingTransfers.get(message.id);
    if (!transfer) return true;
    try {
      const expectedChunks = Number(transfer.totalChunks || 0);
      if (expectedChunks && transfer.chunks.size !== expectedChunks) {
        throw new Error(`Transferencia incompleta: ${transfer.chunks.size}/${expectedChunks} chunks.`);
      }
      const chunks = [...transfer.chunks.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, chunk]) => chunk);
      const mod = await window.riftAtlas.writePartyFile({
        fileName: transfer.metadata.fileName,
        hash: transfer.metadata.hash,
        chunks,
        skin: transfer.skin
      });
      mod.partyHash = transfer.metadata.hash;
      addCustomMods([mod]);
      trackPartySyncedQueue(transfer.skin, mod.path);
      partyReceivedFiles.set(transfer.key, mod.path);
      enforcePartyP2PSelection();
      saveQueuedSkins();
      partyIncomingTransfers.delete(message.id);
      if (transfer.metadata?.hash) partyRequestedHashes.delete(transfer.metadata.hash);
      setPartyTransferStatus(transfer.key, {
        fileName: mod.name,
        champion: mod.champion || transfer.skin?.champion || "",
        status: "recibido",
        progress: 100,
        localPath: mod.path
      });
      if (els.partyConnectionLabel) {
        els.partyConnectionLabel.textContent = `conectado, archivo P2P recibido: ${mod.name}`;
      }
      maybeAutoApplyParty();
    } catch (error) {
      if (transfer.metadata?.hash) partyRequestedHashes.delete(transfer.metadata.hash);
      setPartyTransferStatus(transfer.key, { status: "error", error: error.message });
      if (els.partyConnectionLabel) {
        els.partyConnectionLabel.textContent = `Error P2P: ${error.message}`;
      }
    }
    return true;
  }
  if (message.type === "file-error") {
    if (els.partyConnectionLabel) els.partyConnectionLabel.textContent = `Error P2P: ${message.error}`;
    const transfer = partyIncomingTransfers.get(message.id);
    rejectPartyAckWaitersForTransfer(peerId, message.id, new Error(message.error || "Error P2P."));
    const transferKey = transfer?.key || getPartyTransferKey(message.skin, message.id);
    setPartyTransferStatus(transferKey, { status: "error", error: message.error });
    if (transfer?.metadata?.hash) partyRequestedHashes.delete(transfer.metadata.hash);
    if (message.skin?.hash) partyRequestedHashes.delete(message.skin.hash);
    partyIncomingTransfers.delete(message.id);
    return true;
  }
  return false;
};

const getPartyReadiness = () => {
  const connected = state.partyStatus === "connected";
  const members = getAllPartyMembers();
  const localReady = getLocalPartyReadyState();
  const readyMembers = members.filter((member) => member.ready).length;
  const allReady = connected && !state.overlayRunning && members.length > 0 && readyMembers === members.length && localReady.ready;
  return { connected, members, localReady, readyMembers, allReady };
};

const maybeAutoApplyParty = () => {
  const readiness = getPartyReadiness();
  if (partyAutoApplyTriggered || !readiness.allReady || state.importingQueue || getPartyApplyKeys().length === 0) return;
  partyAutoApplyTriggered = true;
  applyPartyQueue();
};

const renderPartyFileProfile = () => {
  if (!els.partyFileProfile) return;
  const selected = state.selectedPartyFile ? findPartyFileByKey(state.selectedPartyFile.key || state.selectedPartyFile.hash || state.selectedPartyFile.fileName) || state.selectedPartyFile : null;
  if (!selected) {
    els.partyFileProfile.innerHTML = `
      <div class="empty-state compact">
        <h2>Sin archivo P2P</h2>
        <p>Toca un archivo anunciado para ver su perfil.</p>
      </div>
    `;
    return;
  }
  const localFile = getLocalPartyFile(selected);
  const transfer = partyTransferStatus.get(getPartyTransferKey(selected));
  const status = localFile ? "Disponible local" : transfer?.status || "Pendiente";
  const isOwnPartyFile = selected.ownerId === getLocalPartyId();
  const selectableKey = isOwnPartyFile ? (localFile?.path || selected.key || "") : "";
  const canSelect = Boolean(isOwnPartyFile && selectableKey);
  const isSelected = Boolean(selectableKey && state.queuedSkins.has(selectableKey));
  const toggleLabel = isOwnPartyFile
    ? (isSelected ? "Quitar de seleccion" : "Seleccionar")
    : (localFile ? "Incluido en party" : "Esperando");
  els.partyFileProfile.innerHTML = `
    <div class="party-profile-cover">
      ${selected.preview || selected.image ? `<img src="${escapeHtml(selected.preview || selected.image)}" alt="${escapeHtml(selected.name || selected.fileName)}" />` : `<span>${escapeHtml((selected.extension || selected.fileName || "P2P").replace(".", "").toUpperCase())}</span>`}
    </div>
    <span class="party-profile-kicker">${escapeHtml(selected.source || "P2P")}</span>
    <h3>${escapeHtml(selected.name || selected.fileName || "Archivo")}</h3>
    <p>${escapeHtml(selected.champion || "Mod")}</p>
    <dl class="party-profile-meta">
      <div><dt>Dueno</dt><dd>${escapeHtml(selected.ownerName || "Party")}</dd></div>
      <div><dt>Estado</dt><dd>${escapeHtml(status)}</dd></div>
      <div><dt>Tipo</dt><dd>${escapeHtml(selected.extension || "-")}</dd></div>
      <div><dt>Tamano</dt><dd>${formatBytes(selected.size || 0)}</dd></div>
      <div><dt>Hash</dt><dd>${escapeHtml(selected.hash ? selected.hash.slice(0, 16) : "sin hash")}</dd></div>
    </dl>
    <button class="docs-link party-profile-toggle" type="button" data-key="${escapeHtml(selectableKey)}" ${canSelect && selectableKey ? "" : "disabled"}>${escapeHtml(toggleLabel)}</button>
    <button class="secondary-button party-profile-open" type="button" ${localFile?.path ? "" : "disabled"}>Abrir archivo</button>
  `;
  els.partyFileProfile.querySelector(".party-profile-toggle")?.addEventListener("click", () => {
    const key = selectableKey;
    if (!key) return;
    if (state.queuedSkins.has(key)) {
      removeQueuedSkinKey(key);
    } else {
      queueSkinKey(key);
    }
    saveQueuedSkins();
    renderParty();
  });
  els.partyFileProfile.querySelector(".party-profile-open")?.addEventListener("click", () => {
    if (localFile?.path) window.riftAtlas.revealModPath(localFile.path);
  });
};

const renderSkinsP2PSection = () => {
  if (!els.skinsP2PSection || !els.skinsP2PList) return;
  const connected = state.partyStatus === "connected";
  els.skinsP2PSection.hidden = !connected;
  if (!connected) return;

  const files = getAllPartyFiles();
  const uniqueFiles = [...new Map(files.map((file) => [getPartyTransferKey(file), file])).values()];
  const localCount = uniqueFiles.filter((file) => Boolean(getLocalPartyFile(file))).length;
  const pendingCount = Math.max(0, uniqueFiles.length - localCount);
  if (els.skinsP2PLabel) {
    els.skinsP2PLabel.textContent = `${uniqueFiles.length} archivo(s) anunciados. ${localCount} local(es), ${pendingCount} pendiente(s).`;
  }

  if (!uniqueFiles.length) {
    els.skinsP2PList.innerHTML = `
      <div class="empty-state compact">
        <h2>Sin archivos P2P</h2>
        <p>Selecciona skins en cualquier miembro de la party para sincronizarlas.</p>
      </div>
    `;
    return;
  }

  const renderTransferControlButtons = (key, transfer = null, localFile = null) => {
    const status = transfer?.status || "";
    if (localFile) return "";
    if (["recibiendo", "enviando", "solicitando"].includes(status)) {
      return `
        <button class="secondary-button skins-p2p-pause" type="button" data-key="${escapeHtml(key)}" ${transfer?.transferId ? "" : "disabled"}>Pausar</button>
        <button class="secondary-button skins-p2p-cancel" type="button" data-key="${escapeHtml(key)}" ${transfer?.transferId ? "" : "disabled"}>Cancelar</button>
      `;
    }
    if (status === "pausado") {
      return `
        <button class="docs-link skins-p2p-resume" type="button" data-key="${escapeHtml(key)}">Reanudar</button>
        <button class="secondary-button skins-p2p-cancel" type="button" data-key="${escapeHtml(key)}">Cancelar</button>
      `;
    }
    return `<button class="secondary-button skins-p2p-request" type="button" data-key="${escapeHtml(key)}">Buscar local</button>`;
  };

  els.skinsP2PList.innerHTML = uniqueFiles
    .map((file) => {
      const key = getPartyTransferKey(file);
      const localFile = getLocalPartyFile(file);
      const transfer = partyTransferStatus.get(key);
      const selectableKey = localFile?.path || "";
      const status = localFile ? "Local" : transfer?.status || "Pendiente";
      return `
        <article class="skins-p2p-row ${localFile ? "ready" : "pending"} ${transfer?.status === "error" ? "error" : ""}" data-key="${escapeHtml(key)}">
          <div>
            <span>${escapeHtml(file.ownerName || "Party")}</span>
            <strong>${escapeHtml(file.fileName || file.name || "Archivo P2P")}</strong>
            <small>${escapeHtml(file.champion || "Mod")} - ${escapeHtml(status)}${transfer?.error ? ` - ${escapeHtml(transfer.error)}` : ""}</small>
          </div>
          <div class="skins-p2p-meta">
            <span>${formatBytes(file.size || localFile?.size || 0)}</span>
            <span>${escapeHtml(file.hash ? file.hash.slice(0, 10) : "sin hash")}</span>
          </div>
          ${renderTransferControlButtons(key, transfer, localFile)}
          <button class="docs-link skins-p2p-select" type="button" data-path="${escapeHtml(selectableKey)}" disabled>${localFile ? "Seleccionado" : "No local"}</button>
        </article>
      `;
    })
    .join("");

  els.skinsP2PList.querySelectorAll(".skins-p2p-request").forEach((button) => {
    button.addEventListener("click", async () => {
      const file = findPartyFileByKey(button.dataset.key);
      if (!file) return;
      button.disabled = true;
      try {
        await requestPartyFile(file.ownerId, file);
      } catch (error) {
        setPartyTransferStatus(getPartyTransferKey(file), {
          fileName: file.fileName || file.name,
          champion: file.champion || "",
          owner: file.ownerName || file.ownerId || "",
          status: "error",
          error: error.message
        });
      } finally {
        renderParty();
      }
    });
  });
  els.skinsP2PList.querySelectorAll(".skins-p2p-pause").forEach((button) => {
    button.addEventListener("click", () => pausePartyTransfer(button.dataset.key));
  });
  els.skinsP2PList.querySelectorAll(".skins-p2p-resume").forEach((button) => {
    button.addEventListener("click", () => resumePartyTransfer(button.dataset.key));
  });
  els.skinsP2PList.querySelectorAll(".skins-p2p-cancel").forEach((button) => {
    button.addEventListener("click", () => cancelPartyTransfer(button.dataset.key));
  });
};

const renderParty = () => {
  if (!els.partyStatusPill) return;
  renderPenguBridgeStatus();
  schedulePenguPartyStateBroadcast();
  const { connected, members, localReady, readyMembers, allReady } = getPartyReadiness();
  const files = getAllPartyFiles();
  els.partyStatusPill.textContent = connected ? (allReady ? "Todos listos" : "Sincronizando") : "Desconectado";
  els.partyStatusPill.classList.toggle("active", connected);
  if (els.partyConnectionLabel) {
    els.partyConnectionLabel.textContent = connected
      ? `Conectado${state.partyRoom?.id ? ` a ${state.partyRoom.id}` : ""}. ${members.length} miembro(s), ${readyMembers}/${members.length} listo(s).`
      : "Desconectado.";
  }
  if (els.partyFilesLabel) {
    els.partyFilesLabel.textContent = `skins party: ${files.length ? files.map((file) => file.fileName || file.name).join(", ") : "ninguna"}`;
  }
  if (els.partyReadySummary) {
    els.partyReadySummary.textContent = connected
      ? state.overlayRunning
        ? "Overlay activo"
        : (allReady ? "Todos listos" : localReady.label)
      : "Desconectado";
  }
  if (els.partyReadyDetails) {
    els.partyReadyDetails.textContent = connected
      ? state.overlayRunning
        ? "Deten el overlay activo para que Party pueda aplicar la siguiente sincronizacion."
        : `${readyMembers}/${members.length} miembro(s) listos. Party se ejecuta automaticamente al terminar sync.`
      : "Enable Party Mode para generar tu token.";
  }
  if (els.partyShareLinkLabel) {
    const tokenText = state.partyLink || "Enable Party Mode para generar tu token.";
    if ("value" in els.partyShareLinkLabel) {
      els.partyShareLinkLabel.value = tokenText;
    } else {
      els.partyShareLinkLabel.textContent = tokenText;
    }
  }
  if (els.createPartyButton) {
    els.createPartyButton.disabled = state.partyStatus === "connecting";
    els.createPartyButton.textContent = connected ? "Disable Party Mode" : "Enable Party Mode";
    els.createPartyButton.classList.toggle("disable", connected);
  }
  if (els.joinPartyButton) els.joinPartyButton.disabled = !connected || state.partyStatus === "connecting";
  if (els.leavePartyButton) els.leavePartyButton.disabled = !connected;
  if (els.copyPartyLinkButton) els.copyPartyLinkButton.disabled = !state.partyLink;
  if (els.partyTransferList) {
    const transfers = [...partyTransferStatus.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
    els.partyTransferList.innerHTML = transfers.length
      ? transfers.map((item) => `
          <div class="party-transfer-row ${item.status === "error" ? "error" : ""}">
            <div>
              <strong>${escapeHtml(item.fileName || "Archivo P2P")}</strong>
              <small>${escapeHtml(item.status || "pendiente")}${item.error ? ` - ${escapeHtml(item.error)}` : ""}</small>
            </div>
            <span>${Math.round(item.progress || 0)}%</span>
            ${["recibiendo", "enviando", "solicitando"].includes(item.status) ? `<button class="secondary-button party-transfer-pause" type="button" data-key="${escapeHtml(item.key)}" ${item.transferId ? "" : "disabled"}>Pausar</button><button class="secondary-button party-transfer-cancel" type="button" data-key="${escapeHtml(item.key)}" ${item.transferId ? "" : "disabled"}>Cancelar</button>` : ""}
            ${item.status === "pausado" ? `<button class="docs-link party-transfer-resume" type="button" data-key="${escapeHtml(item.key)}">Reanudar</button><button class="secondary-button party-transfer-cancel" type="button" data-key="${escapeHtml(item.key)}">Cancelar</button>` : ""}
          </div>
        `).join("")
      : "";
    els.partyTransferList.querySelectorAll(".party-transfer-pause").forEach((button) => {
      button.addEventListener("click", () => pausePartyTransfer(button.dataset.key));
    });
    els.partyTransferList.querySelectorAll(".party-transfer-resume").forEach((button) => {
      button.addEventListener("click", () => resumePartyTransfer(button.dataset.key));
    });
    els.partyTransferList.querySelectorAll(".party-transfer-cancel").forEach((button) => {
      button.addEventListener("click", () => cancelPartyTransfer(button.dataset.key));
    });
  }
  renderPartyFileProfile();
  renderSkinsP2PSection();
  maybeAutoApplyParty();
  if (!els.partyMembersList) return;
  if (!members.length) {
    els.partyMembersList.innerHTML = `
      <div class="empty-state compact">
        <h2>No friends connected yet</h2>
        <p>Enable Party Mode y agrega un token para empezar.</p>
      </div>
    `;
    return;
  }
  els.partyMembersList.innerHTML = members
    .map((member) => {
      const filesHtml = (member.activeSkins || []).length
        ? member.activeSkins
          .map((file) => {
            const transferKey = getPartyTransferKey(file);
            const localFile = getLocalPartyFile(file);
            const transfer = partyTransferStatus.get(transferKey);
            const status = localFile ? "local" : transfer?.status || "pendiente";
            return `<button class="party-file-chip ${state.selectedPartyFile?.key === transferKey ? "active" : ""}" type="button" data-key="${escapeHtml(transferKey)}">${escapeHtml(file.fileName || file.name)}<small>${escapeHtml(file.champion || "")} - ${escapeHtml(status)}</small></button>`;
          })
          .join("")
        : '<span class="muted-text">Sin archivos seleccionados</span>';
      return `
        <article class="party-member-card">
          <div>
            <strong>${escapeHtml(member.name || "Jugador")}</strong>
            <small>${member.isHost ? "Host" : "Miembro"} - ${member.connected ? "conectado" : "desconectado"} - ${member.ready ? "listo" : "sync"}</small>
          </div>
          <div class="party-file-list">${filesHtml}</div>
        </article>
      `;
    })
    .join("");
  els.partyMembersList.querySelectorAll(".party-file-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const file = findPartyFileByKey(button.dataset.key);
      state.selectedPartyFile = file ? { ...file, key: getPartyTransferKey(file) } : null;
      renderParty();
    });
  });
};

const handlePartyMessage = (peerId, message = {}) => {
  if (!message.type) return;
  if (message.type.startsWith("file-")) {
    handlePartyFileMessage(peerId, message);
    return;
  }
  if (message.type === "member-info" && partyIsHost && state.partyRoom) {
    const exists = state.partyRoom.members.some((member) => member.id === peerId);
    state.partyRoom = {
      ...state.partyRoom,
      members: exists
        ? state.partyRoom.members.map((member) =>
          member.id === peerId ? { ...member, ...message.data, id: peerId, isHost: false, connected: true } : member
        )
        : [...state.partyRoom.members, { ...message.data, id: peerId, isHost: false, connected: true }]
    };
    prunePartySyncedQueue();
    requestMissingPartyFiles(peerId, message.data?.activeSkins || []);
    broadcastPartyRoom();
    renderParty();
    return;
  }
  if (message.type === "ready-update") {
    updatePartyMemberReady(peerId, message.data || {});
    if (partyIsHost) broadcastPartyRoom();
    renderParty();
    return;
  }
  if (message.type === "room-info" || message.type === "room-update") {
    state.partyRoom = message.data;
    state.partyStatus = "connected";
    prunePartySyncedQueue();
    requestMissingRoomFiles();
    sendPartyReadyUpdate();
    renderParty();
    return;
  }
  if (message.type === "skins-update") {
    partyAutoApplyTriggered = false;
    updatePartyMemberSkins(peerId, message.data || []);
    prunePartySyncedQueue();
    requestMissingPartyFiles(peerId, message.data || []);
    sendPartyReadyUpdate();
    if (partyIsHost) broadcastPartyRoom();
    renderParty();
  }
};

const attachPartyConnection = (connection) => {
  partyConnections.set(connection.peer, connection);
  connection.on("data", (message) => handlePartyMessage(connection.peer, message));
  connection.on("close", () => {
    rejectPartyAckWaitersForConnection(connection.peer, new Error("Conexion P2P cerrada."));
    partyConnections.delete(connection.peer);
    if (partyIsHost && state.partyRoom) {
      state.partyRoom = {
        ...state.partyRoom,
        members: state.partyRoom.members.filter((member) => member.id !== connection.peer)
      };
      prunePartySyncedQueue();
      broadcastPartyRoom();
    }
    sendPartyReadyUpdate();
    renderParty();
  });
  connection.on("error", (error) => {
    rejectPartyAckWaitersForConnection(connection.peer, error instanceof Error ? error : new Error("Error en conexion P2P."));
    renderParty();
  });
};

const syncPartySkins = async () => {
  if (state.partyStatus !== "connected") return;
  partyAutoApplyTriggered = false;
  const skins = await getPartySkinFilesWithInfo();
  if (state.partyRoom) {
    updatePartyMemberSkins(getLocalPartyId(), skins);
    if (partyIsHost) {
      state.partyRoom.host = { ...state.partyRoom.host, activeSkins: skins };
      broadcastPartyRoom();
    }
  }
  partyConnections.forEach((connection) => {
    if (connection.open) {
      connection.send({ type: "skins-update", data: skins });
    }
  });
  sendPartyReadyUpdate();
  broadcastPenguPartyState();
  renderParty();
};

const clearLocalP2PState = async () => {
  const p2pPaths = new Set(
    state.customMods
      .filter(isRiftAtlasP2PMod)
      .map((mod) => mod.path)
      .filter(Boolean)
  );
  if (p2pPaths.size) {
    state.customMods = state.customMods.filter((mod) => !isRiftAtlasP2PMod(mod));
    p2pPaths.forEach((modPath) => state.queuedSkins.delete(modPath));
    saveCustomMods();
    saveQueuedSkins();
  }
  await window.riftAtlas.clearPartyP2PFiles?.().catch(() => null);
};

const leaveParty = async (options = {}) => {
  const keepRoseToken = Boolean(options.keepRoseToken);
  clearTimeout(partySyncTimer);
  partySyncTimer = null;
  partyConnections.forEach((connection) => connection.close());
  partyConnections.clear();
  if (partyPeer) {
    partyPeer.destroy();
  }
  partyPeer = null;
  partyIsHost = false;
  state.partyRoom = null;
  if (!keepRoseToken) {
    partyOwnToken = "";
    partyOwnRoomId = "";
    partyOwnKey = "";
    partyOwnSummonerId = 0;
  }
  state.partyLink = keepRoseToken ? partyOwnToken : "";
  state.partyStatus = "disconnected";
  state.selectedPartyFile = null;
  partyTransferStatus.clear();
  prunePartySyncedQueue({ removeAll: true });
  partySyncedQueuedSkins.clear();
  partyReceivedFiles.clear();
  partyIncomingTransfers.clear();
  partyRequestedHashes.clear();
  partyChunkAckWaiters.forEach((waiter) => waiter.reject(new Error("Party cerrada.")));
  partyChunkAckWaiters.clear();
  partyAutoApplyTriggered = false;
  await clearLocalP2PState();
  renderParty();
};

const createParty = async (options = {}) => {
  if (!window.Peer) {
    throw new Error("PeerJS no esta cargado.");
  }
  const isManualRoseParty = !options.roomId;
  if (isManualRoseParty) {
    state.penguAutoPartyRoom = "";
    penguLastAutoConnectKey = "";
  }
  await leaveParty();
  let roomId = normalizePartyCode(options.roomId || generatePartyRoomId());
  if (isManualRoseParty) {
    const roseParty = await createRosePartyToken();
    partyOwnToken = roseParty.token;
    partyOwnRoomId = roseParty.roomId;
    partyOwnKey = roseParty.key;
    partyOwnSummonerId = roseParty.summonerId;
    roomId = roseParty.roomId;
  }
  const displayName = options.displayName || getPartyDisplayName();
  if (els.partyNameInput && options.displayName) els.partyNameInput.value = options.displayName;
  localStorage.setItem("riftAtlas:partyName", displayName);
  partyIsHost = true;
  state.partyStatus = "connecting";
  renderParty();
  partyPeer = new window.Peer(roomId, { debug: 1 });
  let resolveOpen = () => {};
  let rejectOpen = () => {};
  const openPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout conectando Party Mode.")), 15000);
    resolveOpen = (value) => {
      clearTimeout(timeout);
      resolve(value);
    };
    rejectOpen = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
  });
  partyPeer.on("open", (id) => {
    state.partyRoom = {
      id,
      createdAt: new Date().toISOString(),
      host: { ...getLocalPartyMember(), id, isHost: true, connected: true },
      members: []
    };
    state.partyLink = partyOwnToken || `rift-atlas-party:${id}`;
    state.partyStatus = "connected";
    renderParty();
    syncPartySkins();
    sendPartyReadyUpdate();
    resolveOpen(id);
  });
  partyPeer.on("connection", (connection) => {
    attachPartyConnection(connection);
    connection.on("open", () => {
      const member = {
        id: connection.peer,
        name: connection.metadata?.displayName || "Jugador",
        activeSkins: [],
        isHost: false,
        connected: true
      };
      if (state.partyRoom && !state.partyRoom.members.some((item) => item.id === member.id)) {
        state.partyRoom = { ...state.partyRoom, members: [...state.partyRoom.members, member] };
      }
      connection.send({ type: "room-info", data: state.partyRoom });
      sendPartyReadyUpdate();
      syncPartySkins();
      broadcastPartyRoom();
      renderParty();
    });
  });
  partyPeer.on("error", (error) => {
    state.partyStatus = "disconnected";
    if (els.partyConnectionLabel) els.partyConnectionLabel.textContent = `Error party: ${error.message || error}`;
    renderParty();
    rejectOpen(error instanceof Error ? error : new Error(String(error)));
  });
  await openPromise;
};

const joinParty = async (options = {}) => {
  if (!window.Peer) {
    throw new Error("PeerJS no esta cargado.");
  }
  const rawToken = String(options.roomId || els.partyLinkInput?.value || "").trim();
  const roseTarget = await decodeRosePartyToken(rawToken);
  const isRoseTarget = Boolean(roseTarget);
  if (isRoseTarget && partyOwnSummonerId && roseTarget.summonerId === partyOwnSummonerId) {
    throw new Error("No podes agregar tu propio token.");
  }
  if (!options.roomId) {
    state.penguAutoPartyRoom = "";
    penguLastAutoConnectKey = "";
  }
  const roomId = isRoseTarget ? roseTarget.roomId : normalizePartyCode(rawToken);
  if (!roomId) throw new Error("Pega un party token.");
  await leaveParty({ keepRoseToken: isRoseTarget && Boolean(partyOwnToken) });
  const displayName = options.displayName || getPartyDisplayName();
  if (els.partyNameInput && options.displayName) els.partyNameInput.value = options.displayName;
  if (els.partyLinkInput && options.roomId) els.partyLinkInput.value = isRoseTarget ? rawToken : `rift-atlas-party:${roomId}`;
  localStorage.setItem("riftAtlas:partyName", displayName);
  partyIsHost = false;
  state.partyLink = partyOwnToken || (isRoseTarget ? rawToken : `rift-atlas-party:${roomId}`);
  state.partyStatus = "connecting";
  renderParty();
  const peerId = `${roomId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  partyPeer = new window.Peer(peerId, { debug: 1 });
  let resolveConnection = () => {};
  let rejectConnection = () => {};
  const connectionPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout conectando con el token.")), 15000);
    resolveConnection = (value) => {
      clearTimeout(timeout);
      resolve(value);
    };
    rejectConnection = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
  });
  partyPeer.on("open", () => {
    const connection = partyPeer.connect(roomId, {
      reliable: true,
      metadata: { displayName, type: "join" }
    });
    attachPartyConnection(connection);
    connection.on("open", () => {
      state.partyStatus = "connected";
      getPartySkinFilesWithInfo().then((activeSkins) => {
        connection.send({ type: "member-info", data: { ...getLocalPartyMember(), activeSkins } });
        syncPartySkins();
        sendPartyReadyUpdate();
      });
      renderParty();
      resolveConnection(connection);
    });
    connection.on("error", (error) => {
      rejectConnection(error instanceof Error ? error : new Error("Error conectando con el token."));
    });
  });
  partyPeer.on("connection", attachPartyConnection);
  partyPeer.on("error", (error) => {
    state.partyStatus = "disconnected";
    if (els.partyConnectionLabel) els.partyConnectionLabel.textContent = `Error party: ${error.message || error}`;
    renderParty();
    rejectConnection(error instanceof Error ? error : new Error(String(error)));
  });
  await connectionPromise;
};

const handlePenguPartyModeMessage = async (payload = {}) => {
  if (!payload?.type || !payload.type.startsWith("party-")) return false;

  const respond = (message = {}) =>
    window.riftAtlas.sendPenguMessage?.({ source: "rift-atlas-app", ...message }).catch(() => null);

  if (payload.type === "party-get-state") {
    broadcastPenguPartyState();
    return true;
  }

  if (payload.type === "party-enable") {
    try {
      if (!["connected", "connecting"].includes(state.partyStatus)) {
        await createParty();
      }
      await respond({ type: "party-enabled", success: true, token: state.partyLink || "" });
      broadcastPenguPartyState();
    } catch (error) {
      await respond({ type: "party-enabled", success: false, error: error.message || "No pude activar Party Mode." });
    }
    return true;
  }

  if (payload.type === "party-disable") {
    await leaveParty();
    await respond({ type: "party-disabled", success: true });
    broadcastPenguPartyState();
    return true;
  }

  if (payload.type === "party-add-peer") {
    try {
      const token = String(payload.token || "").trim();
      if (!token) throw new Error("Token vacio.");
      if (!isPartyConnected() || !partyOwnToken) throw new Error("Party mode not enabled");
      await joinParty({ roomId: token });
      await respond({ type: "party-peer-added", success: true });
      broadcastPenguPartyState();
    } catch (error) {
      await respond({ type: "party-peer-added", success: false, error: error.message || "No pude conectar la party." });
    }
    return true;
  }

  if (payload.type === "party-remove-peer") {
    await respond({ type: "party-peer-removed", success: true });
    broadcastPenguPartyState();
    return true;
  }

  return false;
};

const handlePenguAutoParty = async () => {
  if (!state.penguAutoParty || penguAutoConnectInFlight) return;
  const plan = getPenguPartyPlan();
  if (!plan) {
    if (state.penguAutoPartyRoom && state.partyStatus === "connected" && state.partyRoom?.id === state.penguAutoPartyRoom) {
      state.penguAutoPartyRoom = "";
      await leaveParty();
    }
    renderPenguBridgeStatus();
    return;
  }

  if (state.partyStatus === "connected") {
    if (state.partyRoom?.id === plan.roomId) {
      state.penguAutoPartyRoom = plan.roomId;
      renderPenguBridgeStatus();
      return;
    }
    if (state.penguAutoPartyRoom && state.partyRoom?.id !== state.penguAutoPartyRoom) {
      state.penguAutoPartyRoom = "";
    }
    if (!state.penguAutoPartyRoom) {
      if (els.penguLobbyLabel) {
        els.penguLobbyLabel.textContent = `Lobby detectado: ${plan.roomId}. Ya hay una party manual activa.`;
      }
      return;
    }
  }

  const connectKey = `${plan.roomId}:${plan.isHost ? "host" : "member"}`;
  if (penguLastAutoConnectKey === connectKey && ["connecting", "connected"].includes(state.partyStatus)) return;
  penguLastAutoConnectKey = connectKey;
  penguAutoConnectInFlight = true;
  try {
    if (plan.isHost) {
      await createParty({ roomId: plan.roomId, displayName: plan.displayName });
    } else {
      await joinParty({ roomId: plan.roomId, displayName: plan.displayName });
    }
    state.penguAutoPartyRoom = plan.roomId;
    if (els.penguLobbyLabel) {
      els.penguLobbyLabel.textContent = `Auto-party Pengu activa: ${plan.roomId}.`;
    }
  } catch (error) {
    penguLastAutoConnectKey = "";
    if (els.penguLobbyLabel) {
      els.penguLobbyLabel.textContent = `No pude conectar la auto-party Pengu: ${error.message}`;
    }
    schedulePenguAutoParty(2000);
  } finally {
    penguAutoConnectInFlight = false;
    renderPenguBridgeStatus();
  }
};

const addOverlayHistoryEntry = (items = []) => {
  const skinKeys = items.map(getSkinKey).filter(Boolean);
  if (!skinKeys.length) return;
  const entry = {
    id: `history-${Date.now()}`,
    name: getSelectionName(items),
    skinKeys,
    createdAt: new Date().toISOString()
  };
  state.overlayHistory = [entry, ...state.overlayHistory.filter((item) => item.skinKeys.join("|") !== skinKeys.join("|"))].slice(0, 12);
  saveOverlayHistory();
};

const renderOverlayHistory = () => {
  if (!els.overlayHistoryList) return;
  if (!state.overlayHistory.length) {
    els.overlayHistoryList.innerHTML = `
      <div class="empty-state compact">
        <h2>Sin historial</h2>
        <p>Ejecuta una seleccion para guardarla como acceso rapido.</p>
      </div>
    `;
    return;
  }
  els.overlayHistoryList.innerHTML = state.overlayHistory
    .map((entry) => `
      <article class="history-row">
        <div>
          <strong>${escapeHtml(entry.name)}</strong>
          <small>${entry.skinKeys.length} mod(s) · ${formatDate(entry.createdAt)}</small>
        </div>
        <button class="secondary-button history-load" type="button" data-id="${escapeHtml(entry.id)}">Cargar</button>
      </article>
    `)
    .join("");
  els.overlayHistoryList.querySelectorAll(".history-load").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = state.overlayHistory.find((item) => item.id === button.dataset.id);
      if (!entry) return;
      state.queuedSkins = new Set(normalizeQueuedSkinKeys(entry.skinKeys));
      restoreKnownLocalMods();
      saveQueuedSkins();
      els.importStatusLabel.textContent = `Historial "${entry.name}" cargado.`;
      renderSkinLibrary();
    });
  });
};

const renderCompactLauncher = () => {
  if (!els.compactPresetSelect) return;
  const selectedCount = state.queuedSkins.size;
  const partyConnected = isPartyConnected();
  els.compactPresetSelect.innerHTML =
    '<option value="">Cola actual</option>' +
    state.presets.map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)} (${preset.skinKeys.length})</option>`).join("");
  if (els.compactStatusLabel) {
    els.compactStatusLabel.textContent = partyConnected
      ? "Party activa: se ejecuta automaticamente cuando todos terminan de sincronizar."
      : `${selectedCount} mod(s) en cola${state.activePresetId ? " - preset activo disponible" : ""}.`;
  }
  if (els.compactOverlayPill) {
    els.compactOverlayPill.textContent = state.overlayRunning ? "Overlay activo" : "Sin overlay";
    els.compactOverlayPill.classList.toggle("active", state.overlayRunning);
  }
  if (els.compactRunButton) {
    els.compactRunButton.disabled = partyConnected || selectedCount === 0 || state.importingQueue || state.overlayRunning;
    els.compactRunButton.title = partyConnected ? "Party activa: aplicacion automatica al terminar sync." : "";
  }
};

const renderSelectionTray = () => {
  if (!els.selectionTraySummary || !els.selectionTrayList) return;
  const queuedKeys = [...state.queuedSkins];
  const selected = queuedKeys.map(getSkinByKey).filter(Boolean);
  const selectedCount = queuedKeys.length;
  const partyConnected = isPartyConnected();
  const activeP2PCount = queuedKeys.filter(isActivePartyP2PPath).length;
  const hasMissingSkins = selectedCount > selected.length;
  const hasAnythingToClear = selectedCount > 0 || state.managedSkins.size > 0;
  els.selectionTraySummary.textContent = partyConnected
    ? "Party activa: la seleccion se sincroniza con tu grupo."
    : selectedCount
      ? `${selectedCount} skin(s) listas para aparecer en LoL via Pengu.`
      : "No hay skins seleccionadas.";
  document.querySelectorAll(".selection-action-bar").forEach((bar) => {
    bar.classList.toggle("has-selection", selectedCount > 0);
    bar.querySelector(".selection-selected-count").textContent = `${selectedCount} skin${selectedCount === 1 ? "" : "s"} seleccionada${selectedCount === 1 ? "" : "s"}`;
    bar.querySelector(".selection-selected-hint").textContent = selectedCount
      ? hasMissingSkins
        ? "Algunas skins no se cargaron en la biblioteca."
        : activeP2PCount
          ? "Las skins P2P locales se pueden quitar de la cola manualmente."
          : "Aparecen en champ select cuando Pengu detecta el campeon."
      : "No hay skins en cola. Agregalas desde Mods propios o Descargas.";

    const applyButton = bar.querySelector(".selection-apply-button");
    const clearButton = bar.querySelector(".selection-clear-button");
    const saveButton = bar.querySelector(".selection-save-button");
    const stopButton = bar.querySelector(".selection-stop-button");
    const miniList = bar.querySelector(".selection-mini-list");

    applyButton.textContent = partyConnected
      ? "Party auto"
      : selectedCount
        ? state.overlayRunning
          ? "Overlay activo"
          : `Ejecutar ${selectedCount}`
        : "Sin skins";
    applyButton.disabled = partyConnected || selectedCount === 0 || state.importingQueue || state.overlayRunning;
    applyButton.title = partyConnected
      ? "Party activa: se aplica automaticamente cuando todos estan listos."
      : state.overlayRunning
        ? "Deten el overlay antes de ejecutar otra vez."
        : "";
    clearButton.textContent = activeP2PCount ? "Limpiar no P2P" : "Limpiar todo";
    clearButton.disabled = !hasAnythingToClear || state.importingQueue;
    saveButton.disabled = selectedCount === 0 || state.importingQueue;
    stopButton.disabled = !state.importingQueue && !state.overlayRunning;

    const queuedItems = queuedKeys.map((key) => getSkinByKey(key) || {
      path: key,
      champion: "Desconocida",
      skin: key.split(/[/\\]/).pop() || "Skin en cola",
      rawChampion: "",
      rawSkin: ""
    });
    miniList.innerHTML = queuedItems.map(renderSelectedMiniCard).join("");
    miniList.querySelectorAll(".selected-mini-card").forEach((button) => {
      button.addEventListener("click", () => {
        removeQueuedSkinKey(button.dataset.path);
        saveQueuedSkins();
      });
    });
  });

  if (!selectedCount) {
    els.selectionTrayList.innerHTML = "";
    return;
  }

  els.selectionTrayList.innerHTML = queuedKeys
    .slice(0, 12)
    .map((key) => {
      const skin = getSkinByKey(key);
      const icon = skin ? getChampionIconByKey(skin.rawChampion, skin.champion) : "";
      const champion = skin ? skin.champion : "Desconocida";
      const name = skin ? getSkinVisibleName(skin) : key.split(/[/\\]/).pop() || "Skin en cola";
      return `
        <button class="selection-chip" type="button" data-path="${escapeHtml(key)}">
          ${icon ? `<img src="${icon}" alt="${escapeHtml(champion)}" />` : ""}
          <span>${escapeHtml(champion)} - ${escapeHtml(name)}</span>
        </button>
      `;
    })
    .join("");

  els.selectionTrayList.querySelectorAll(".selection-chip").forEach((button) => {
    button.addEventListener("click", () => {
      removeQueuedSkinKey(button.dataset.path);
      saveQueuedSkins();
    });
  });
};

const renderBaseOverlayStatus = () => {
  const ready = Boolean(state.customOverlayPath);
  const customKeys = state.customOverlayKeys || [];
  const queuedCount = state.queuedSkins.size;
  const outdated = ready && customKeys.length > 0 && (
    customKeys.length !== queuedCount ||
    !customKeys.every((k) => state.queuedSkins.has(k))
  );
  let label;
  if (outdated) {
    label = "Deseactualizado (reconstruir)";
  } else if (ready) {
    label = `Listo (${customKeys.length} mods)`;
  } else if (queuedCount > 0) {
    label = "Pendiente (se construye automaticamente)";
  } else {
    label = "No construido";
  }
  if (els.baseOverlayStatusLabel) els.baseOverlayStatusLabel.textContent = label;
  if (els.baseOverlayStatusLabelAlt) els.baseOverlayStatusLabelAlt.textContent = label;
};

const renderPresets = () => {
  if (!els.presetSelect || !els.presetList) return;
  const activePreset = getActivePreset();
  const hasPreset = Boolean(activePreset);

  els.presetSelect.innerHTML = state.presets.length
    ? state.presets.map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)} (${preset.skinKeys.length})</option>`).join("")
    : '<option value="">Sin presets</option>';
  els.presetSelect.value = activePreset ? activePreset.id : "";
  els.saveQueuePresetButton.disabled = !hasPreset || state.queuedSkins.size === 0;
  els.loadPresetQueueButton.disabled = !hasPreset || activePreset.skinKeys.length === 0;
  els.deletePresetButton.disabled = !hasPreset;

  if (!state.presets.length) {
    els.presetList.innerHTML = `
      <div class="empty-state compact">
        <h2>Sin presets</h2>
        <p>Agrega skins a la cola desde Mods y guarda esa cola como preset.</p>
      </div>
    `;
    return;
  }

  els.presetList.innerHTML = state.presets
    .map((preset) => {
      const missing = preset.skinKeys.filter((key) => !getSkinByKey(key)).length;
      return `
        <article class="preset-row ${preset.id === state.activePresetId ? "active" : ""}" data-id="${escapeHtml(preset.id)}" style="--preset-color:${escapeHtml(preset.color || "#c89b3c")}">
          <span class="preset-icon">${escapeHtml(preset.icon || "RA")}</span>
          <div>
            <strong>${escapeHtml(preset.name)}</strong>
            <small>${preset.skinKeys.length} skin(s)${missing ? ` - ${missing} no cargadas ahora` : ""}${preset.autoApply ? " - autoaplicar" : ""}</small>
            <small>${escapeHtml(preset.enginePath || "Engine actual al ejecutar")}</small>
          </div>
          <button class="secondary-button preset-select-button" type="button" data-id="${escapeHtml(preset.id)}">Usar</button>
        </article>
      `;
    })
    .join("");

  els.presetList.querySelectorAll(".preset-select-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.activePresetId = button.dataset.id;
      savePresets();
      if (els.presetStatusLabel) {
        const preset = getActivePreset();
        els.presetStatusLabel.textContent = preset?.autoApply ? `Perfil "${preset.name}" activo con autoaplicar.` : `Perfil "${preset?.name || ""}" activo.`;
      }
    });
  });
};

const setLtkOverlaySidecarPath = (p) => {
  const value = p && /(^|[\\/])(ltk-manager|mod-tools)\.exe$/i.test(p) && !/ltk manager/i.test(p) ? p : "";
  state.ltkOverlaySidecarPath = value;
  localStorage.setItem("riftAtlas:ltkOverlaySidecarPath", state.ltkOverlaySidecarPath);
  if (els.ltkOverlaySidecarLabel) els.ltkOverlaySidecarLabel.textContent = state.ltkOverlaySidecarPath || "No configurado";
  if (els.downloadEnginePathLabel) els.downloadEnginePathLabel.textContent = state.ltkOverlaySidecarPath || "No configurado";
};

const setLtkOverlayDllPath = (p) => {
  const value = p && !/ltk manager/i.test(p) ? p : "";
  state.ltkOverlayDllPath = value;
  localStorage.setItem("riftAtlas:ltkOverlayDllPath", state.ltkOverlayDllPath);
  if (els.ltkOverlayDllLabel) els.ltkOverlayDllLabel.textContent = state.ltkOverlayDllPath || "No encontrada";
  if (els.downloadEnginePathLabel && !state.ltkOverlaySidecarPath) {
    els.downloadEnginePathLabel.textContent = state.ltkOverlaySidecarPath || "No configurado";
  }
};

const getEngineBinaryFromPath = (filePath = "") => {
  const name = getNameFromPath(filePath).toLowerCase();
  if (name === "mod-tools.exe") return "mod-tools.exe";
  if (name === "ltk-manager.exe") return "ltk-manager.exe";
  return "";
};

const enginePathMatchesMode = (filePath = "", mode = state.engineBinaryName) =>
  getEngineBinaryFromPath(filePath) === (mode === "mod-tools.exe" ? "mod-tools.exe" : "ltk-manager.exe");

const setEngineBinaryName = (value, { detect = false } = {}) => {
  const next = value === "mod-tools.exe" ? "mod-tools.exe" : "ltk-manager.exe";
  state.engineBinaryName = next;
  localStorage.setItem("riftAtlas:engineBinaryName", next);
  if (els.engineBinarySelector) els.engineBinarySelector.value = next;
  els.engineModeButtons?.forEach((button) => {
    const active = button.dataset.engineBinary === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  if (state.ltkOverlaySidecarPath && !enginePathMatchesMode(state.ltkOverlaySidecarPath, next)) {
    setLtkOverlaySidecarPath("");
  }
  if (detect) autoConfigureOverlay({ silent: true });
};

const loadLtkOverlayPaths = () => {
  setLtkOverlaySidecarPath(state.ltkOverlaySidecarPath);
  setLtkOverlayDllPath(state.ltkOverlayDllPath);
  if (els.downloadLeaguePathLabel) els.downloadLeaguePathLabel.textContent = state.leagueGamePath || "No configurado";
  setEngineBinaryName(state.engineBinaryName);
};



const detectLtkFromSystem = async () => {
  try {
    const found = await window.riftAtlas.detectLtk();
    if (found) {
      setConfigStatus(`LTK Manager detectado: ${found}`);
    }
    return found;
  } catch {
    return null;
  }
};

const setLtkPath = (executablePath) => {
  state.ltkPath = executablePath || "";
  if (state.ltkPath) {
    localStorage.setItem("riftAtlas:ltkPath", state.ltkPath);
  } else {
    localStorage.removeItem("riftAtlas:ltkPath");
  }
  if (els.ltkPathLabel) els.ltkPathLabel.textContent = state.ltkPath || "No configurado";
};

const setLeagueGamePath = (executablePath) => {
  state.leagueGamePath = executablePath || "";
  if (state.leagueGamePath) {
    localStorage.setItem("riftAtlas:leagueGamePath", state.leagueGamePath);
  } else {
    localStorage.removeItem("riftAtlas:leagueGamePath");
  }
  if (els.leagueGamePathLabel) els.leagueGamePathLabel.textContent = state.leagueGamePath || "No configurado";
  if (els.downloadLeaguePathLabel) els.downloadLeaguePathLabel.textContent = state.leagueGamePath || "No configurado";
};

const detectLeaguePathFromSystem = async ({ silent = false } = {}) => {
  if (!window.riftAtlas.detectLeaguePath) return null;
  if (!silent) setConfigStatus("Detectando League...");

  try {
    const result = await window.riftAtlas.detectLeaguePath();
    if (result?.detected && result.leagueGamePath) {
      setLeagueGamePath(result.leagueGamePath);
      if (!silent) setConfigStatus("League detectado y guardado.");
    } else if (!silent) {
      setConfigStatus("No se encontro League. Asegurate de que este instalado o selecciona la ruta manualmente.");
    }
    return result;
  } catch (err) {
    if (!silent) setConfigStatus("Error detectando League: " + (err.message || err));
    return null;
  }
};

const revealPath = async (filePath) => {
  if (!filePath) {
    setConfigStatus("Ruta no disponible.");
    return;
  }

  try {
    await window.riftAtlas.revealModPath(filePath);
  } catch (error) {
    setConfigStatus(error.message || "No se pudo abrir la ruta.");
  }
};

const setDownloadButtonsState = () => {
  const busy = Boolean(state.activeDownloadType);
  const engineBusy = state.activeDownloadType === "engine";
  const leagueSkinsBusy = state.activeDownloadType === "league-skins";
  const penguBusy = state.activeDownloadType === "pengu-loader";
  const penguUninstallBusy = state.activeDownloadType === "pengu-uninstall";

  if (els.downloadCslolButton) {
    els.downloadCslolButton.disabled = busy;
    els.downloadCslolButton.textContent = engineBusy ? "Descargando..." : "Descargar engine";
  }
  if (els.downloadEngineButton) {
    els.downloadEngineButton.disabled = busy;
    els.downloadEngineButton.textContent = engineBusy ? "Descargando..." : "Descargar engine";
  }
  if (els.downloadLeagueSkinsButton) {
    els.downloadLeagueSkinsButton.disabled = busy;
    els.downloadLeagueSkinsButton.textContent = leagueSkinsBusy ? "Descargando..." : "Descargar LeagueSkins";
  }
  if (els.downloadLeagueSkinsButtonDownload) {
    els.downloadLeagueSkinsButtonDownload.disabled = busy;
    els.downloadLeagueSkinsButtonDownload.textContent = leagueSkinsBusy ? "Descargando..." : "Descargar LeagueSkins";
  }
  if (els.downloadPenguLoaderButton) {
    els.downloadPenguLoaderButton.disabled = busy;
    els.downloadPenguLoaderButton.textContent = penguBusy ? "Descargando..." : "Instalar Pengu Loader";
  }
  if (els.launchPenguLoaderButton) {
    els.launchPenguLoaderButton.disabled = busy;
    els.launchPenguLoaderButton.textContent = "Activar Pengu Loader";
  }
  if (els.uninstallPenguLoaderButton) {
    els.uninstallPenguLoaderButton.disabled = busy;
    els.uninstallPenguLoaderButton.textContent = penguUninstallBusy ? "Desinstalando..." : "Desinstalar Pengu";
  }
};

const beginDownload = (type) => {
  if (state.activeDownloadType) {
    const labels = {
      engine: "engine",
      "league-skins": "LeagueSkins",
      "pengu-loader": "Pengu Loader",
      "pengu-uninstall": "desinstalacion de Pengu"
    };
    const label = labels[state.activeDownloadType] || state.activeDownloadType;
    const message = `Ya hay una descarga activa (${label}). Espera a que termine.`;
    if (els.downloadProgressLabel) els.downloadProgressLabel.textContent = message;
    setConfigStatus(message);
    return false;
  }

  state.activeDownloadType = type;
  setDownloadButtonsState();
  return true;
};

const finishDownload = () => {
  state.activeDownloadType = "";
  setDownloadButtonsState();
};

const loadAppDataPath = async () => {
  if (!els.appDataPathLabel) return;
  if (!window.riftAtlas.getUserDataPath) {
    els.appDataPathLabel.textContent = "No disponible";
    return;
  }
  try {
    els.appDataPathLabel.textContent = await window.riftAtlas.getUserDataPath();
  } catch (error) {
    els.appDataPathLabel.textContent = error.message || "No disponible";
  }
};

const loadAppVersion = async () => {
  if (!els.updateStatusLabel || !els.updateDetailsLabel) return;
  try {
    const version = await window.riftAtlas.getAppVersion?.();
    if (!version) return;
    els.updateStatusLabel.textContent = `Version actual ${version}`;
    els.updateDetailsLabel.textContent = "Usa Buscar para comprobar si hay una version nueva.";
  } catch {
    els.updateStatusLabel.textContent = "Version actual";
    els.updateDetailsLabel.textContent = "Usa Buscar para comprobar actualizaciones.";
  }
};

const loadPenguLoaderStatus = async () => {
  if (!els.downloadPenguLoaderLabel || !window.riftAtlas.getPenguLoaderStatus) return;
  try {
    const status = await window.riftAtlas.getPenguLoaderStatus();
    const setPenguText = (text) => {
      if (els.downloadPenguLoaderLabel) els.downloadPenguLoaderLabel.textContent = text;
      if (els.overlayPenguStatusLabel) els.overlayPenguStatusLabel.textContent = `Pengu Loader: ${text}`;
    };
    if (els.overlayLaunchPenguButton) {
      els.overlayLaunchPenguButton.disabled = false;
      els.overlayLaunchPenguButton.textContent = status.active ? "Reaplicar Pengu" : "Activar Pengu";
    }
    if (els.overlayDeactivatePenguButton) {
      els.overlayDeactivatePenguButton.disabled = !status.active && !status.proxyInstalled && !status.ifeoActive && !status.running;
    }
    if (status.active) {
      const pathText = status.leagueClientPath || status.executablePath;
      setPenguText(pathText
        ? `Activo silencioso: ${pathText}`
        : "Activo silencioso");
      return;
    }
    if (status.disabled && status.proxyInstalled) {
      setPenguText(status.executablePath
        ? `Desactivado: ${status.executablePath}`
        : "Desactivado");
      return;
    }
    if (status.running) {
      setPenguText(status.executablePath
        ? `Ejecutandose: ${status.executablePath}`
        : "Ejecutandose");
      return;
    }
    setPenguText(status.executablePath
      ? `Instalado: ${status.executablePath}`
      : "No instalado en Rift Atlas. Usa Instalar Pengu Loader.");
  } catch (error) {
    const message = error.message || "No pude comprobar Pengu Loader.";
    els.downloadPenguLoaderLabel.textContent = message;
    if (els.overlayPenguStatusLabel) els.overlayPenguStatusLabel.textContent = `Pengu Loader: ${message}`;
  }
};

const activatePenguFromUi = async () => {
  try {
    if (els.downloadProgressLabel) els.downloadProgressLabel.textContent = "Activando Pengu Loader...";
    if (els.overlayPenguStatusLabel) els.overlayPenguStatusLabel.textContent = "Pengu Loader: activando...";
    if (els.overlayLaunchPenguButton) els.overlayLaunchPenguButton.disabled = true;
    await window.riftAtlas.installRiftAtlasPenguPlugin?.().catch(() => null);
    const result = await window.riftAtlas.launchPenguLoader?.();
    await window.riftAtlas.closePenguLoaderUi?.().catch(() => null);
    await loadPenguLoaderStatus();
    const message = result?.error
      ? `No pude activar Pengu Loader: ${result.error}`
      : result?.waitingForLeague
        ? (result.message || "Abri League Client; Rift Atlas activara Pengu cuando detecte el lockfile.")
        : result?.proxyInstalled === false
          ? `Pengu Loader no quedo activo: ${result.proxyError || "falta d3d9.dll en League."}`
          : result?.restartedClient
            ? "Pengu Loader activado. League Client se reinicio para cargar Rift Atlas."
            : result?.needsClientRestart
              ? "Pengu Loader activado. Cierra y abre League Client si no aparece RA."
              : "Pengu Loader activado. Abre League Client para ver RA.";
    if (els.downloadProgressLabel) els.downloadProgressLabel.textContent = message;
    if (els.overlayPenguStatusLabel) els.overlayPenguStatusLabel.textContent = `Pengu Loader: ${message}`;
  } catch (error) {
    const message = error.message || "No pude activar Pengu Loader.";
    if (els.downloadProgressLabel) els.downloadProgressLabel.textContent = message;
    if (els.overlayPenguStatusLabel) els.overlayPenguStatusLabel.textContent = `Pengu Loader: ${message}`;
  } finally {
    await loadPenguLoaderStatus();
  }
};

const deactivatePenguFromUi = async () => {
  try {
    if (els.downloadProgressLabel) els.downloadProgressLabel.textContent = "Apagando Pengu Loader...";
    if (els.overlayPenguStatusLabel) els.overlayPenguStatusLabel.textContent = "Pengu Loader: apagando...";
    if (els.overlayDeactivatePenguButton) els.overlayDeactivatePenguButton.disabled = true;
    const result = await window.riftAtlas.deactivatePenguLoader?.();
    await window.riftAtlas.closePenguLoaderUi?.().catch(() => null);
    await loadPenguLoaderStatus();
    const message = result?.error
      ? `No pude apagar Pengu Loader: ${result.error}`
      : result?.proxyRemoved === false
        ? `Pengu desactivado por config, pero no borre el proxy: ${result.proxyError || "revisa d3d9.dll."}`
        : result?.restartedClient
          ? "Pengu Loader apagado. League Client se reinicio sin plugin."
          : result?.needsClientRestart
            ? "Pengu Loader apagado. Cierra y abre League Client para descargarlo de esta sesion."
            : "Pengu Loader apagado.";
    if (els.downloadProgressLabel) els.downloadProgressLabel.textContent = message;
    if (els.overlayPenguStatusLabel) els.overlayPenguStatusLabel.textContent = `Pengu Loader: ${message}`;
  } catch (error) {
    const message = error.message || "No pude apagar Pengu Loader.";
    if (els.downloadProgressLabel) els.downloadProgressLabel.textContent = message;
    if (els.overlayPenguStatusLabel) els.overlayPenguStatusLabel.textContent = `Pengu Loader: ${message}`;
  } finally {
    await loadPenguLoaderStatus();
  }
};

const uninstallPenguFromUi = async () => {
  if (!window.confirm("Desinstalar Pengu Loader de Rift Atlas? Esto desactiva Pengu y borra la copia local de la carpeta de instalacion.")) {
    return;
  }
  if (!beginDownload("pengu-uninstall")) return;
  try {
    if (els.downloadProgressLabel) els.downloadProgressLabel.textContent = "Desinstalando Pengu Loader...";
    if (els.overlayPenguStatusLabel) els.overlayPenguStatusLabel.textContent = "Pengu Loader: desinstalando...";
    const result = await window.riftAtlas.uninstallPenguLoader?.();
    await loadPenguLoaderStatus();
    const failedCount = Array.isArray(result?.failedPaths) ? result.failedPaths.length : 0;
    const message = failedCount > 0
      ? `Pengu parcialmente desinstalado. ${failedCount} ruta(s) no se pudieron borrar.`
      : "Pengu Loader desinstalado de Rift Atlas.";
    if (els.downloadProgressLabel) els.downloadProgressLabel.textContent = message;
    if (els.overlayPenguStatusLabel) els.overlayPenguStatusLabel.textContent = `Pengu Loader: ${message}`;
  } catch (error) {
    const message = error.message || "No pude desinstalar Pengu Loader.";
    if (els.downloadProgressLabel) els.downloadProgressLabel.textContent = message;
    if (els.overlayPenguStatusLabel) els.overlayPenguStatusLabel.textContent = `Pengu Loader: ${message}`;
  } finally {
    finishDownload();
    await loadPenguLoaderStatus();
  }
};

const hideFirstDllModal = () => {
  if (els.firstDllModal) els.firstDllModal.hidden = true;
  window.riftAtlasTutorial?.resumeAfterModal?.();
  setTimeout(() => scheduleTutorialAutostart(), 250);
};

const showFirstDllModal = async (status = null) => {
  if (!els.firstDllModal) return;
  window.riftAtlasTutorial?.pauseForModal?.();
  const dllStatus = status || await window.riftAtlas.getEngineDllStatus?.().catch(() => null);
  if (els.firstDllPathLabel) {
    els.firstDllPathLabel.textContent = dllStatus?.dllPath || "Carpeta de instalacion\\engine\\tools\\cslol-dll.dll";
  }
  els.firstDllModal.hidden = false;
};

const checkFirstDllNotice = async () => {
  if (!window.riftAtlas.getEngineDllStatus) return;
  const status = await window.riftAtlas.getEngineDllStatus().catch(() => null);
  const dllExists = Boolean(status?.exists ?? status?.installed);
  if (!status || !status.engineInstalled || dllExists) return;
  await showFirstDllModal(status);
};

const getIgnoredUpdateVersion = () => localStorage.getItem("riftAtlas:ignoredUpdateVersion") || "";

const setUpdatePanelVisible = ({ hasUpdate = false } = {}) => {
  if (els.updateHideLabel) els.updateHideLabel.hidden = !hasUpdate;
  if (els.updateDownloadButton) els.updateDownloadButton.hidden = !hasUpdate;
  if (els.updateDismissButton) els.updateDismissButton.hidden = !hasUpdate;
};

const renderUpdateStatus = (result = null, { hiddenByUser = false } = {}) => {
  state.availableUpdate = result?.hasUpdate ? result : null;
  if (!els.updateStatusLabel || !els.updateDetailsLabel) return;

  if (!result) {
    els.updateStatusLabel.textContent = "No se pudo comprobar";
    els.updateDetailsLabel.textContent = "Toca Buscar para intentar de nuevo.";
    setUpdatePanelVisible({ hasUpdate: false });
    return;
  }

  if (result.hasUpdate && !hiddenByUser) {
    els.updateStatusLabel.textContent = `Nueva version ${result.latestVersion}`;
    els.updateDetailsLabel.textContent = `Actual: ${result.currentVersion}. ${result.hasAutoUpdate ? `Lista para instalar: ${result.assetName}.` : "El release no tiene latest.json de Tauri; se abrira GitHub para instalar manual."}`;
    setUpdatePanelVisible({ hasUpdate: true });
    if (els.updateDownloadButton) els.updateDownloadButton.textContent = result.hasAutoUpdate ? "Actualizar" : "Abrir release";
    if (els.updateHideCheckbox) els.updateHideCheckbox.checked = false;
    return;
  }

  els.updateStatusLabel.textContent = hiddenByUser ? `Version ${result.latestVersion} ocultada` : "Rift Atlas esta actualizado";
  els.updateDetailsLabel.textContent = hiddenByUser
    ? "Esta version no se volvera a mostrar automaticamente. Podes usar Buscar para revisar igual."
    : `Version actual: ${result.currentVersion}.`;
  setUpdatePanelVisible({ hasUpdate: false });
};

const checkForUpdates = async ({ manual = false } = {}) => {
  if (!window.riftAtlas.checkUpdates || !els.updateStatusLabel) return null;
  if (manual && els.updateHideCheckbox) els.updateHideCheckbox.checked = false;
  if (manual) {
    els.updateStatusLabel.textContent = "Buscando actualizaciones...";
    els.updateDetailsLabel.textContent = "Consultando GitHub Releases...";
  }
  if (els.checkUpdatesButton) els.checkUpdatesButton.disabled = true;
  try {
    const result = await window.riftAtlas.checkUpdates();
    const ignoredVersion = getIgnoredUpdateVersion();
    const hiddenByUser = !manual && result.hasUpdate && ignoredVersion === result.latestVersion;
    renderUpdateStatus(result, { hiddenByUser });
    return result;
  } catch (error) {
    state.availableUpdate = null;
    els.updateStatusLabel.textContent = "Error buscando actualizaciones";
    els.updateDetailsLabel.textContent = error.message || "No se pudo consultar GitHub Releases.";
    setUpdatePanelVisible({ hasUpdate: false });
    return null;
  } finally {
    if (els.checkUpdatesButton) els.checkUpdatesButton.disabled = false;
  }
};

const downloadAvailableUpdate = async () => {
  const update = state.availableUpdate;
  if (!update?.hasAutoUpdate || !update?.downloadUrl || !window.riftAtlas.downloadUpdate) {
    if (update?.releaseUrl) await window.riftAtlas.openExternal(update.releaseUrl);
    return;
  }
  if (els.updateDownloadButton) {
    els.updateDownloadButton.disabled = true;
    els.updateDownloadButton.textContent = "Descargando...";
  }
  if (els.updateDismissButton) els.updateDismissButton.disabled = true;
  if (els.checkUpdatesButton) els.checkUpdatesButton.disabled = true;
  if (els.updateStatusLabel) els.updateStatusLabel.textContent = `Descargando version ${update.latestVersion}...`;
  if (els.updateDetailsLabel) els.updateDetailsLabel.textContent = "Rift Atlas va a reiniciarse para instalar sin abrir el instalador.";

  try {
    const result = await window.riftAtlas.downloadUpdate(update);
    if (els.updateStatusLabel) els.updateStatusLabel.textContent = "Instalando actualizacion";
    if (els.updateDetailsLabel) {
      els.updateDetailsLabel.textContent = `Se descargo ${result.assetName || "la actualizacion"}. La app se va a cerrar y volver actualizada.`;
    }
    if (els.updateDownloadButton) els.updateDownloadButton.textContent = "Instalando...";
  } catch (error) {
    if (els.updateStatusLabel) els.updateStatusLabel.textContent = "Error descargando actualizacion";
    if (els.updateDetailsLabel) els.updateDetailsLabel.textContent = error.message || "No se pudo instalar la actualizacion.";
    if (els.updateDownloadButton) {
      els.updateDownloadButton.disabled = false;
      els.updateDownloadButton.textContent = "Actualizar";
    }
    if (els.updateDismissButton) els.updateDismissButton.disabled = false;
    if (els.checkUpdatesButton) els.checkUpdatesButton.disabled = false;
  }
};

const autoConfigureOverlay = async ({ silent = false } = {}) => {
  if (!silent && els.importStatusLabel) {
    setConfigStatus("Detectando engine, DLL y League...");
  }
  if (els.autoConfigureButton) {
    els.autoConfigureButton.disabled = true;
  }

  try {
    const result = await window.riftAtlas.autoConfigureOverlay({
      enginePath: state.ltkOverlaySidecarPath,
      engineBinary: state.engineBinaryName,
      dllPath: state.ltkOverlayDllPath,
      leagueGamePath: state.leagueGamePath,
      ltkPath: ""
    });

    if (result.enginePath) setLtkOverlaySidecarPath(result.enginePath);
    if (result.dllPath) setLtkOverlayDllPath(result.dllPath);
    if (result.leagueGamePath) setLeagueGamePath(result.leagueGamePath);
    const missing = result.warnings || [];
    if (els.importStatusLabel && (!silent || missing.length)) {
      setConfigStatus(result.success
        ? "Configuracion lista. Ya podes seleccionar skins y ejecutar."
        : `Falta configurar: ${missing.join(" ")}`);
    }
    return result;
  } catch (error) {
    if (els.importStatusLabel && !silent) {
      setConfigStatus(error.message);
    }
    return null;
  } finally {
    if (els.autoConfigureButton) {
      els.autoConfigureButton.disabled = false;
    }
  }
};

const downloadCslolTools = async (engineBinary = state.engineBinaryName) => {
  if (!beginDownload("engine")) return;
  const selectedEngineBinary = engineBinary === "mod-tools.exe" ? "mod-tools.exe" : "ltk-manager.exe";
  setEngineBinaryName(selectedEngineBinary);
  const engineLabel = selectedEngineBinary === "mod-tools.exe" ? "mod-tools" : "LTK";
  if (els.downloadProgressLabel) {
    els.downloadProgressLabel.textContent = `Iniciando descarga de ${engineLabel}...`;
  }
  if (els.importStatusLabel) {
    setConfigStatus(`Descargando ${engineLabel}...`);
  }

  try {
    const result = await window.riftAtlas.downloadCslolTools({ engineBinary: selectedEngineBinary });
    if (result.enginePath) setLtkOverlaySidecarPath(result.enginePath);
    if (result.dllPath) setLtkOverlayDllPath(result.dllPath);
    const manualDllMessage = "Engine instalado. DLL no anadida: selecciona cslol-dll.dll y Rift Atlas la copiara a engine/tools.";
    if (els.downloadProgressLabel) {
      els.downloadProgressLabel.textContent = result.manualDllRequired
        ? manualDllMessage
        : (result.dllInstallMessage
          ? `Engine ${result.version} descargado. ${result.dllInstallMessage}`
          : `Engine ${result.version} descargado.`);
    }
    setConfigStatus(result.dllPath
      ? (result.dllInstallMessage || `Engine ${result.version} listo.`)
      : manualDllMessage);
    if (!result.dllPath) {
      const dllStatus = await window.riftAtlas.getEngineDllStatus?.().catch(() => null);
      await showFirstDllModal(dllStatus || { exists: false });
    }
    await autoConfigureOverlay({ silent: true });
  } catch (error) {
    setConfigStatus(`Error descargando engine: ${error.message}`);
  } finally {
    finishDownload();
  }
};

const loadDownloadedLeagueSkins = async () => {
  if ((!els.downloadLeagueSkinsButton && !els.downloadLeagueSkinsButtonDownload) || state.importingQueue) return;
  if (!beginDownload("league-skins")) return;
  if (els.downloadProgressLabel) {
    els.downloadProgressLabel.textContent = "Iniciando descarga de LeagueSkins...";
  }
  if (els.skinLibraryLabel) els.skinLibraryLabel.textContent = "Descargando LeagueSkins desde GitHub...";

  try {
    const result = await window.riftAtlas.downloadLeagueSkins();
    setSkinLibrary(result);
    if (els.downloadProgressLabel) {
      els.downloadProgressLabel.textContent = `LeagueSkins descargado e indexado: ${result.skins?.length || 0} paquete(s).`;
    }
    if (els.importStatusLabel) els.importStatusLabel.textContent = `LeagueSkins ${result.branch} descargado e indexado.`;
  } catch (error) {
    if (els.skinLibraryLabel) els.skinLibraryLabel.textContent = `Error descargando LeagueSkins: ${error.message}`;
    if (els.downloadProgressLabel) {
      els.downloadProgressLabel.textContent = `Error descargando LeagueSkins: ${error.message}`;
    }
  } finally {
    finishDownload();
  }
};

const downloadPenguLoader = async () => {
  if (!beginDownload("pengu-loader")) return;
  if (els.downloadProgressLabel) {
    els.downloadProgressLabel.textContent = "Buscando Pengu Loader silencioso...";
  }

  try {
    const result = await window.riftAtlas.downloadPenguLoader?.();
    if (result?.executablePath && els.downloadPenguLoaderLabel) {
      els.downloadPenguLoaderLabel.textContent = result.executablePath;
    }
    if (els.downloadProgressLabel) {
      els.downloadProgressLabel.textContent = `Pengu Loader silencioso instalado${result?.version ? ` (${result.version})` : ""}. Plugin Rift Atlas instalado. Usa Activar antes de abrir League.`;
    }
  } catch (error) {
    if (els.downloadProgressLabel) {
      els.downloadProgressLabel.textContent = `Error instalando Pengu Loader: ${error.message}`;
    }
  } finally {
    finishDownload();
  }
};

let firstRunBootstrapPromise = null;
let firstRunBootstrapResult = null;
const startFirstRunBootstrap = () => {
  if (firstRunBootstrapPromise) return firstRunBootstrapPromise;
  if (!window.riftAtlas.bootstrapFirstRun) return Promise.resolve(null);

  firstRunBootstrapPromise = (async () => {
    state.activeDownloadType = "first-run-bootstrap";
    setDownloadButtonsState();
    setEngineBinaryName("mod-tools.exe");
    if (els.downloadProgressLabel) {
      els.downloadProgressLabel.textContent = "Verificando componentes instalados...";
    }
    setConfigStatus("Verificando componentes instalados...");

    try {
      const result = await window.riftAtlas.bootstrapFirstRun();
      if (result?.enginePath) setLtkOverlaySidecarPath(result.enginePath);
      if (result?.leagueSkinsPath) {
        state.skinLibrary = [];
        await loadDownloadedLeagueSkinsFromDisk({ silent: true }).catch(() => false);
      }
      await loadPenguLoaderStatus();
      await autoConfigureOverlay({ silent: true });
      await checkFirstDllNotice();

      const errors = Array.isArray(result?.errors) ? result.errors.filter(Boolean) : [];
      const message = result?.complete
        ? (result.injectionReady
          ? (result.skipped
            ? "Componentes iniciales verificados. Rift Atlas esta listo para inyectar."
            : "Primera instalacion lista: mod-tools, LeagueSkins y Pengu Loader descargados.")
          : "Descargas iniciales listas. Falta agregar cslol-dll.dll para habilitar la inyeccion.")
        : `Preparacion inicial incompleta${errors.length ? `: ${errors.join(" | ")}` : ". Se reintentara al iniciar."}`;
      if (els.downloadProgressLabel) els.downloadProgressLabel.textContent = message;
      setConfigStatus(message);
      firstRunBootstrapResult = result;
      return result;
    } catch (error) {
      const message = `No pude completar la preparacion inicial: ${error.message || error}. Se reintentara al iniciar.`;
      if (els.downloadProgressLabel) els.downloadProgressLabel.textContent = message;
      setConfigStatus(message);
      firstRunBootstrapResult = { complete: false, errors: [error.message || String(error)] };
      return firstRunBootstrapResult;
    } finally {
      if (state.activeDownloadType === "first-run-bootstrap") finishDownload();
    }
  })();

  return firstRunBootstrapPromise;
};

let loadingLocalLeagueSkins = false;
let championsReadyPromise = null;
let skinLibraryReadyPromise = null;
let userModsReadyPromise = null;

const loadDownloadedLeagueSkinsFromDisk = async ({ silent = false } = {}) => {
  if (loadingLocalLeagueSkins || state.skinLibrary.length || !window.riftAtlas.indexDownloadedLeagueSkins) return false;
  loadingLocalLeagueSkins = true;
  if (!silent) {
    if (els.skinLibraryLabel) els.skinLibraryLabel.textContent = "Buscando LeagueSkins descargado...";
  }

  try {
    const result = await window.riftAtlas.indexDownloadedLeagueSkins();
    if (!result?.skins?.length) {
      if (!silent && els.skinLibraryLabel) els.skinLibraryLabel.textContent = "LeagueSkins descargado no tiene paquetes compatibles.";
      return false;
    }
    setSkinLibrary(result);
    if (!silent && els.downloadProgressLabel) {
      els.downloadProgressLabel.textContent = `LeagueSkins local cargado: ${result.skins.length} paquete(s).`;
    }
    return true;
  } catch (error) {
    if (!silent) {
      if (els.skinLibraryLabel) els.skinLibraryLabel.textContent = error.message || "No pude cargar LeagueSkins descargado.";
    }
    return false;
  } finally {
    loadingLocalLeagueSkins = false;
  }
};

const loadSavedSkinLibrary = async () => {
  if (!window.riftAtlas.indexSkinLibrary) return;

  const candidates = [];
  if (state.skinLibraryPath) {
    candidates.push(state.skinLibraryPath);
  }

  if (window.riftAtlas.getDownloadedLeagueSkinsPath) {
    const downloadedPath = await window.riftAtlas.getDownloadedLeagueSkinsPath().catch(() => "");
    if (downloadedPath && !candidates.includes(downloadedPath)) {
      candidates.push(downloadedPath);
    }
  }

  if (!candidates.length) {
    await loadDownloadedLeagueSkinsFromDisk({ silent: true });
    return;
  }

  for (const folderPath of candidates) {
    if (els.skinLibraryLabel) els.skinLibraryLabel.textContent = "Indexando LeagueSkins guardado...";
    try {
      setSkinLibrary(await window.riftAtlas.indexSkinLibrary(folderPath));
      return;
    } catch {
      // Try the next known LeagueSkins location.
    }
  }

  localStorage.removeItem("riftAtlas:skinLibraryPath");
  state.skinLibraryPath = "";
  if (els.skinLibraryLabel) els.skinLibraryLabel.textContent = "Selecciona o descarga LeagueSkins para gestionar tu biblioteca.";
};

const ensureChampionsLoaded = async () => {
  if (state.champions.length) return true;
  if (!championsReadyPromise) {
    championsReadyPromise = loadChampions().finally(() => {
      championsReadyPromise = null;
    });
  }
  await championsReadyPromise;
  return state.champions.length > 0;
};

const ensureSkinLibraryLoaded = async () => {
  await ensureChampionsLoaded();
  if (state.skinLibrary.length) return true;
  if (!skinLibraryReadyPromise) {
    skinLibraryReadyPromise = loadSavedSkinLibrary().finally(() => {
      skinLibraryReadyPromise = null;
    });
  }
  await skinLibraryReadyPromise;
  return state.skinLibrary.length > 0;
};

const ensureUserModsLoaded = async () => {
  await ensureChampionsLoaded().catch(() => false);
  if (!userModsReadyPromise) {
    userModsReadyPromise = syncUserModsFolder("startup", { silent: true })
      .catch(() => null)
      .finally(() => {
        userModsReadyPromise = null;
      });
  }
  await userModsReadyPromise;
  return state.customMods.length > 0;
};

const championMatches = (champion) => {
  const haystack = `${champion.name} ${champion.title} ${champion.tags.join(" ")}`.toLowerCase();
  const matchesRole = state.role === "all" || champion.tags.includes(state.role);
  return matchesRole && haystack.includes(state.query.toLowerCase());
};

const getFilteredChampions = () => state.champions.filter(championMatches);

const createChampionCard = (champion) => {
  const node = template.content.firstElementChild.cloneNode(true);
  const img = node.querySelector("img");
  node.dataset.id = champion.id;
  node.classList.toggle("active", champion.id === state.selectedId);
  img.src = `${CDN}/cdn/${state.version}/img/champion/${champion.image.full}`;
  img.alt = champion.name;
  node.querySelector(".champion-name").textContent = champion.name;
  node.querySelector("small").textContent = champion.tags.join(" / ");
  node.addEventListener("click", () => selectChampion(champion.id));
  return node;
};

const renderChampionGrid = ({ revealSelected = false, resetScroll = false } = {}) => {
  const champions = getFilteredChampions();
  els.countLabel.textContent = champions.length.toString();
  els.championGrid.replaceChildren(...champions.map(createChampionCard));

  if (champions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No encontre campeones con ese filtro.";
    els.championGrid.replaceChildren(empty);
    els.championGrid.scrollTop = 0;
    return;
  }

  const activeCard = state.selectedId ? els.championGrid.querySelector(`.champion-card[data-id="${CSS.escape(state.selectedId)}"]`) : null;
  if (activeCard && revealSelected) {
    activeCard.scrollIntoView({ block: "nearest", inline: "nearest" });
  } else if (resetScroll) {
    els.championGrid.scrollTop = 0;
  }
};

const renderTierGrid = () => {
  const tierData = state.tiersByLane[state.lane];
  if (!tierData) {
    els.tierGrid.innerHTML = '<div class="tier-empty">Cargando tier list...</div>';
    return;
  }

  const rows = tierData.rows || [];
  if (rows.length === 0) {
    const laneLabel = ROLE_LABELS[state.lane] || state.lane;
    els.tierGrid.innerHTML = `<div class="tier-empty">No hay tiers para ${escapeHtml(laneLabel)} ahora mismo.${tierData.warning ? `<br>${escapeHtml(tierData.warning)}` : ""}</div>`;
    return;
  }

  els.tierGrid.innerHTML = rows
    .map((row) => {
      const champion = getChampionByTierRow(row);
      const championName = champion?.name || row.champion;
      const championImage = champion ? `${CDN}/cdn/${state.version}/img/champion/${champion.image.full}` : "";
      return `
        <div class="tier-row" data-champion-id="${champion?.id || ""}">
          <span class="tier-rank">${row.rank}</span>
          ${championImage ? `<img src="${championImage}" alt="${escapeHtml(championName)}" />` : ""}
          <span class="tier-name">${escapeHtml(championName)}</span>
          <strong class="tier-badge ${getTierClass(row.tier)}">${row.tier}</strong>
          <span>${row.winrate.toFixed(1)}%</span>
          <span>${row.pickrate.toFixed(1)}%</span>
          <span>${row.banrate.toFixed(1)}%</span>
          <span>${row.games ? row.games.toLocaleString("es-AR") : "-"}</span>
        </div>
      `;
    })
    .join("");

  els.tierGrid.querySelectorAll(".tier-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.championId;
      if (!id) return;
      els.tierGrid.querySelectorAll(".tier-row.selected").forEach((r) => r.classList.remove("selected"));
      row.classList.add("selected");
      selectChampion(id, { scrollTo: false }).catch(showError);
    });
  });
};

const loadTierLane = async (force = false) => {
  if (!state.version) {
    return;
  }
  if (!force && state.tiersByLane[state.lane]) {
    renderTierGrid();
    return;
  }

  els.tierGrid.innerHTML = '<div class="tier-empty">Cargando tier list...</div>';
  els.tierMeta.textContent = `Cargando datos de tier list para ${ROLE_LABELS[state.lane]}...`;
  try {
    const data = await window.riftAtlas.getTierLane({
      lane: state.lane,
      version: state.version
    });
    state.tiersByLane[state.lane] = data;
    const patch = data.rows[0]?.patch || state.version;
    const date = data.updatedAt ? new Date(data.updatedAt).toLocaleString("es-AR") : "";
    els.tierMeta.textContent = `${data.source} · ${ROLE_LABELS[state.lane]} · Patch ${patch}${date ? ` · ${date}` : ""}${data.warning ? ` · ${data.warning}` : ""}`;
    if (!data.rows || data.rows.length === 0) {
      els.tierMeta.textContent += " · No hay datos disponibles.";
    }
    renderTierGrid();
  } catch (error) {
    els.tierMeta.textContent = "No pude cargar la fuente de datos de tier list.";
    els.tierGrid.innerHTML = `<div class="tier-empty">${escapeHtml(error.message)}</div>`;
  }
};

const renderFavorites = () => {
  if (!els.favoritesCount || !els.favoritesGrid) return;
  const favorites = state.champions.filter((champion) => state.favorites.has(champion.id));
  els.favoritesCount.textContent = favorites.length.toString();
  els.favoritesGrid.replaceChildren(...favorites.map(createChampionCard));

  if (favorites.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Todavia no marcaste favoritos.";
    els.favoritesGrid.replaceChildren(empty);
  }
};

const renderDetail = (champion) => {
  const splash = `${CDN}/cdn/img/champion/splash/${champion.id}_0.jpg`;
  const passiveImage = `${CDN}/cdn/${state.version}/img/passive/${champion.passive.image.full}`;
  const spells = champion.spells.map((spell, index) => ({ ...spell, key: ["Q", "W", "E", "R"][index] }));

  els.championDetail.innerHTML = `
    <div class="splash">
      <img class="splash-bg" src="${splash}" alt="" aria-hidden="true" />
      <div class="splash-content">
        <div class="tags">${champion.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
        <h2>${champion.name}</h2>
        <p>${champion.title}</p>
      </div>
    </div>
    <div class="detail-body">
      <p>${champion.lore}</p>
      <div class="stats-grid">
        <div class="stat-box"><span>Ataque</span><strong>${champion.info.attack}</strong></div>
        <div class="stat-box"><span>Defensa</span><strong>${champion.info.defense}</strong></div>
        <div class="stat-box"><span>Magia</span><strong>${champion.info.magic}</strong></div>
        <div class="stat-box"><span>Dificultad</span><strong>${champion.info.difficulty}</strong></div>
      </div>
      <div class="spell-grid">
        <article class="spell-card">
          <img src="${passiveImage}" alt="${champion.passive.name}" />
          <div>
            <h3>Pasiva: ${champion.passive.name}</h3>
            <p>${cleanText(champion.passive.description)}</p>
          </div>
        </article>
        ${spells
      .map(
        (spell) => `
              <article class="spell-card">
                <img src="${CDN}/cdn/${state.version}/img/spell/${spell.image.full}" alt="${spell.name}" />
                <div>
                  <h3>${spell.key}: ${spell.name}</h3>
                  <p>${cleanText(spell.description)}</p>
                </div>
              </article>
            `
      )
      .join("")}
      </div>
    </div>
  `;

};

const selectChampion = async (id, { scrollTo = true } = {}) => {
  state.selectedId = id;
  renderChampionGrid({ revealSelected: scrollTo });
  const response = await fetch(`${CDN}/cdn/${state.version}/data/es_AR/champion/${id}.json`);
  if (!response.ok) {
    throw new Error("No se pudo cargar el detalle del campeon.");
  }
  const payload = await response.json();
  renderDetail(payload.data[id]);
};

let modsTabScanInterval = null;

const scanModsFolderIfNeeded = async () => {
  if (!document.querySelector("#modsView.active")) return;
  try {
    await syncUserModsFolder("tab-focus", { silent: true });
  } catch (_) { /* ignore */ }
};

const setView = (view) => {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".content-view").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${view}View`);
  });
  els.championToolbar.hidden = view !== "champions";

  if (view === "mods") {
    scanModsFolderIfNeeded();
    if (!modsTabScanInterval) {
      modsTabScanInterval = setInterval(scanModsFolderIfNeeded, 8000);
    }
  } else if (modsTabScanInterval) {
    clearInterval(modsTabScanInterval);
    modsTabScanInterval = null;
  }
};

const closeIntroSidebar = () => {
  els.sidebar?.classList.remove("is-open");
};

const renderModPackages = (result) => {
  if (!result) return;
  els.modsFolderLabel.textContent = `${result.folderPath} - ${result.packages.length} paquete(s) encontrados.`;
  if (result.packages.length === 0) {
    els.modsPackageList.innerHTML = `
      <div class="empty-state compact">
        <h2>Sin paquetes compatibles</h2>
        <p>No encontre archivos .fantome, .zip o .rse en esa carpeta.</p>
      </div>
    `;
    return;
  }
  els.modsPackageList.innerHTML = result.packages
    .map(
      (item) => `
        <button class="mod-package-row" type="button" data-path="${escapeHtml(item.path)}">
          <span class="mod-extension">${escapeHtml(getDisplayExtension(item))}</span>
          <span>
            <strong>${escapeHtml(item.name)}</strong>
            <small>${escapeHtml(item.relativePath)} - click para agregar y seleccionar</small>
          </span>
          <span>${formatBytes(item.size)}</span>
        </button>
      `
    )
    .join("");

  els.modsPackageList.querySelectorAll(".mod-package-row").forEach((button) => {
    button.addEventListener("click", () => {
      const item = result.packages.find((pkg) => pkg.path === button.dataset.path);
      if (!item) return;
      addCustomMods([item]);
      const { replaced } = queueSkinKey(item.path);
      saveQueuedSkins();
      scheduleAutoApplyQueuedFromPengu("local-mod-added");
      els.modsFolderLabel.textContent = replaced
        ? `${item.name} agregado y seleccionado. Cambio ${replaced} mod(s) del mismo campeon.`
        : `${item.name} agregado y seleccionado.`;
      renderCustomMods();
      renderSelectionTray();
      sendPenguSkinCatalog("local-mod-added");
    });
  });
};

const getSkinKey = (skin) => skin.path;

const getFilteredSkins = () => {
  const query = state.skinQuery.toLowerCase();
  return state.skinLibrary.filter((skin) => {
    const key = getSkinKey(skin);
    const hasImage = Boolean(getSkinLoadingImage(skin));
    const matchesQuery = `${skin.champion} ${skin.skin} ${skin.variant} ${skin.name}`.toLowerCase().includes(query);
    const matchesChampion = state.skinChampion === "all" || skin.champion === state.skinChampion;
    const matchesType = state.skinType === "all" || skin.extension === state.skinType;
    const matchesState =
      state.skinState === "all" ||
      (state.skinState === "queued" && state.queuedSkins.has(key)) ||
      (state.skinState === "favorites" && state.favoriteSkins.has(key)) ||
      (state.skinState === "with-image" && hasImage) ||
      (state.skinState === "missing-image" && !hasImage);
    return matchesQuery && matchesChampion && matchesType && matchesState;
  });
};

const resetSkinPaging = () => {
  state.skinVisibleCount = SKIN_PAGE_SIZE;
  if (els.mainContent) {
    els.mainContent.scrollTop = 0;
  }
};

const resetSkinView = ({ clearProfile = false } = {}) => {
  resetSkinPaging();
  if (clearProfile) {
    state.selectedSkinKey = "";
  }
};

const renderSkinChampionOptions = () => {
  if (!els.skinChampionSelect) return;
  const champions = [...new Set(state.skinLibrary.map((skin) => skin.champion))].sort((a, b) => a.localeCompare(b, "es"));
  els.skinChampionSelect.innerHTML = '<option value="all">Todos</option>' + champions.map((champion) => `<option value="${escapeHtml(champion)}">${escapeHtml(champion)}</option>`).join("");
  els.skinChampionSelect.value = champions.includes(state.skinChampion) ? state.skinChampion : "all";
  state.skinChampion = els.skinChampionSelect.value;
};

let skinScrollQueued = false;

const loadMoreSkinsIfNeeded = () => {
  if (!els.mainContent || state.importingQueue || skinScrollQueued) return;
  if (!document.querySelector("#modsView.active")) return;
  const skins = getFilteredSkins();
  if (state.skinVisibleCount >= skins.length) return;

  skinScrollQueued = true;
  requestAnimationFrame(() => {
    skinScrollQueued = false;
    const remaining = els.mainContent.scrollHeight - els.mainContent.scrollTop - els.mainContent.clientHeight;
    if (remaining < 900 && state.skinVisibleCount < skins.length) {
      state.skinVisibleCount += SKIN_PAGE_SIZE;
      renderSkinLibrary();
    }
  });
};

const bindSkinLibraryActions = () => {
  if (!els.skinLibraryList) return;
  els.skinLibraryList.querySelectorAll(".skin-row").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      state.selectedSkinKey = row.dataset.path;
      renderSkinLibrary();
    });
  });

  els.skinLibraryList.querySelectorAll(".skin-favorite").forEach((button) => {
    button.addEventListener("click", (event) => {
      stopButtonEvent(event);
      if (state.favoriteSkins.has(button.dataset.path)) {
        state.favoriteSkins.delete(button.dataset.path);
      } else {
        state.favoriteSkins.add(button.dataset.path);
      }
      state.selectedSkinKey = button.dataset.path;
      saveFavoriteSkins();
      renderSkinProfile();
      sendPenguSkinCatalog("favorite-updated");
    });
  });

  els.skinLibraryList.querySelectorAll(".skin-toggle").forEach((button) => {
    button.addEventListener("click", (event) => {
      stopButtonEvent(event);
      if (state.managedSkins.has(button.dataset.path)) {
        state.managedSkins.delete(button.dataset.path);
      } else {
        state.managedSkins.add(button.dataset.path);
      }
      state.selectedSkinKey = button.dataset.path;
      saveManagedSkins();
      renderSkinProfile();
    });
  });

  els.skinLibraryList.querySelectorAll(".skin-reveal").forEach((button) => {
    button.addEventListener("click", (event) => {
      stopButtonEvent(event);
      window.riftAtlas.revealModPath(button.dataset.path);
    });
  });

  els.skinLibraryList.querySelectorAll(".skin-edit").forEach((button) => {
    button.addEventListener("click", (event) => {
      stopButtonEvent(event);
      state.selectedSkinKey = button.dataset.path;
      openSkinMetadataModal(button.dataset.path);
    });
  });

  els.skinLibraryList.querySelectorAll(".skin-queue").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const path = button.dataset.path;
      if (!path) return;
      if (state.queuedSkins.has(path)) {
        removeQueuedSkinKey(path);
      } else {
        queueSkinKey(path);
      }
      saveQueuedSkins();
    });
  });

  els.skinLibraryList.querySelectorAll(".skin-art img").forEach((image) => {
    image.addEventListener("error", () => {
      const art = image.closest(".skin-art");
      const fallback = image.dataset.fallback;
      const original = image.currentSrc || image.src;

      if (fallback && fallback !== original && !skinArtFallbackCache.get(original)) {
        skinArtFallbackCache.set(original, fallback);
        image.src = fallback;
        return;
      }

      art?.classList.add("missing-art");
      image.remove();
    });
  });
};

const renderSkinLibrary = () => {
  if (els.managedSkinsCount) els.managedSkinsCount.textContent = `${state.customMods.length} cargados`;
  if (els.queuedSkinsCount) els.queuedSkinsCount.textContent = `${state.queuedSkins.size} seleccionados`;
  if (els.groupSkinsCheckbox) els.groupSkinsCheckbox.checked = state.groupSkinsByChampion;
  if (els.libraryIndexStatus) {
    const count = getUnifiedLibrarySkins().length;
    els.libraryIndexStatus.textContent = state.libraryIndex?.indexPath
      ? `${count} entrada(s). Indice: ${state.libraryIndex.indexPath}`
      : `${count} entrada(s). Indice local pendiente.`;
  }
  if (els.clearQueueButton) {
    const hasActiveP2P = [...state.queuedSkins].some(isActivePartyP2PPath);
    els.clearQueueButton.textContent = hasActiveP2P ? "Limpiar no P2P" : "Limpiar todo";
    els.clearQueueButton.disabled = state.queuedSkins.size === 0 || state.importingQueue;
  }
  renderSelectionTray();
  renderSkinProfile();
  renderSkinsP2PSection();

  if (!els.skinLibraryList) return;

  if (!state.skinLibrary.length) {
    els.skinLibraryList.innerHTML = `
      <div class="empty-state compact">
        <h2>Sin biblioteca</h2>
        <p>Selecciona la carpeta LeagueSkins para indexar paquetes locales.</p>
      </div>
    `;
    return;
  }

  const skins = getFilteredSkins();
  if (!skins.length) {
    els.skinLibraryList.innerHTML = `
      <div class="empty-state compact">
        <h2>Sin resultados</h2>
        <p>No encontre skins con ese filtro.</p>
      </div>
    `;
    return;
  }

  const visibleSkins = skins.slice(0, state.skinVisibleCount);
  const limitNote =
    skins.length > visibleSkins.length
      ? `
        <div class="skin-result-note">
          Mostrando ${visibleSkins.length} de ${skins.length} paquetes.
        </div>
      `
      : "";
  els.skinLibraryList.innerHTML = limitNote + visibleSkins
    .map((skin) => {
      skin = applySkinMetadata(skin);
      const key = getSkinKey(skin);
      const managed = state.managedSkins.has(key);
      const queued = state.queuedSkins.has(key);
      const favorite = state.favoriteSkins.has(key);
      const art = getSkinLoadingImage(skin);
      const fallbackArt = getSkinBaseLoadingImage(skin);
      return `
        <article class="skin-row ${managed ? "managed" : ""} ${queued ? "queued" : ""} ${state.selectedSkinKey === key ? "selected" : ""}" data-path="${escapeHtml(key)}">
          <div class="skin-art ${art ? "" : "missing-art"}">
            ${art ? `<img src="${art}" data-fallback="${escapeHtml(fallbackArt)}" alt="${escapeHtml(getSkinDisplayName(skin))}" loading="lazy" />` : ""}
            <span class="skin-art-fallback">${escapeHtml(getDisplayExtension(skin))}</span>
            <span class="mod-extension">${escapeHtml(getDisplayExtension(skin))}</span>
          </div>
          <div class="skin-copy">
            <span>${escapeHtml(skin.champion)}</span>
            <strong>${escapeHtml(getSkinVisibleName(skin))}</strong>
            <small>${queued ? "Seleccionada - " : ""}${skin.needsFantonize ? "Genera .fantome local - " : ""}${skin.numericSource ? `ID ${escapeHtml(skin.rawChampion)} / ${escapeHtml(skin.rawSkin)} - ` : ""}${escapeHtml(skin.variant || skin.relativePath)}</small>
          </div>
          <div class="skin-card-footer">
            <span>${formatBytes(skin.size)}</span>
            <button class="secondary-button skin-favorite compact-hidden" type="button" data-path="${escapeHtml(key)}">${favorite ? "★" : "☆"}</button>
            <button class="secondary-button skin-toggle compact-hidden" type="button" data-path="${escapeHtml(key)}">${managed ? "Quitar" : "Gestionar"}</button>
            <button class="${queued ? "secondary-button" : "docs-link"} skin-queue" type="button" data-path="${escapeHtml(key)}">${queued ? "Quitar" : "Seleccionar"}</button>
          </div>
          <button class="secondary-button skin-edit" type="button" data-path="${escapeHtml(key)}">Editar</button>
          <button class="secondary-button skin-reveal" type="button" data-path="${escapeHtml(skin.path)}">Abrir</button>
        </article>
      `;
    })
    .join("");

  if (state.groupSkinsByChampion) {
    const rows = [...els.skinLibraryList.querySelectorAll(".skin-row")];
    const groups = new Map();
    rows.forEach((row) => {
      const champion = row.querySelector(".skin-copy span")?.textContent?.trim() || "Sin campeon";
      const normalizedChampion = champion.split(" - ")[0] || champion;
      if (!groups.has(normalizedChampion)) groups.set(normalizedChampion, []);
      groups.get(normalizedChampion).push(row);
    });
    els.skinLibraryList.innerHTML = limitNote;
    [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "es"))
      .forEach(([champion, groupRows]) => {
        const section = document.createElement("section");
        section.className = "skin-champion-group";
        section.innerHTML = `
          <div class="skin-group-heading">
            <strong>${escapeHtml(champion)}</strong>
            <span>${groupRows.length} skin(s)</span>
          </div>
        `;
        groupRows.forEach((row) => section.append(row));
        els.skinLibraryList.append(section);
      });
  }

  bindSkinLibraryActions();
};

const loadPresetToQueue = (preset = getActivePreset()) => {
  if (!preset) return;
  state.queuedSkins = new Set(normalizeQueuedSkinKeys(preset.skinKeys));
  saveQueuedSkins();
  if (els.presetStatusLabel) els.presetStatusLabel.textContent = `Preset "${preset.name}" cargado a la cola.`;
  if (preset.autoApply) {
    setTimeout(() => applyQueuedSkins().catch(() => false), 100);
  }
};

const buildPreflightChecks = (skinKeys = []) => {
  const queued = skinKeys.map(getSkinByKey).filter(Boolean);
  const paths = queued.map((skin) => skin.path).filter(Boolean);
  const champions = queued.map(getQueueChampionKey).filter(Boolean);
  const duplicateChampions = champions.filter((champion, index) => champions.indexOf(champion) !== index);
  return [
    { id: "league", ok: Boolean(state.leagueGamePath), label: "League path", detail: state.leagueGamePath || "No configurado" },
    { id: "engine", ok: Boolean(state.ltkOverlaySidecarPath), label: "Engine", detail: state.ltkOverlaySidecarPath || "No configurado" },
    { id: "dll", ok: state.engineBinaryName === "mod-tools.exe" || Boolean(state.ltkOverlayDllPath), label: "DLL", detail: state.engineBinaryName === "mod-tools.exe" ? "No requerida por runoverlay" : (state.ltkOverlayDllPath || "No configurada") },
    { id: "mods", ok: paths.length === skinKeys.length && paths.length > 0, label: "Mods locales", detail: `${paths.length}/${skinKeys.length} archivo(s) resueltos` },
    { id: "pengu", ok: state.penguBridgeConnected || !state.penguAutoParty, label: "Pengu", detail: state.penguBridgeConnected ? "Plugin conectado" : "No conectado; overlay manual puede continuar" },
    { id: "conflicts", ok: duplicateChampions.length === 0, label: "Conflictos", detail: duplicateChampions.length ? "Hay mas de una skin para el mismo campeon" : "Sin conflictos obvios" },
    { id: "cache", ok: true, label: "Overlay cache", detail: state.customOverlayPath ? "Overlay base disponible" : "Se construira si hace falta" }
  ];
};

const confirmPreflight = (checks = []) => new Promise((resolve) => {
  if (!els.preflightModal || !els.preflightList) {
    resolve(true);
    return;
  }
  const blocking = checks.filter((check) => !check.ok && ["league", "engine", "mods"].includes(check.id));
  els.preflightSummary.textContent = blocking.length
    ? `${blocking.length} punto(s) importantes necesitan atencion.`
    : "Todo listo para aplicar.";
  els.preflightList.innerHTML = checks
    .map((check) => `
      <article class="diagnostic-row ${check.ok ? "ok" : "bad"}">
        <span>${check.ok ? "OK" : "!"}</span>
        <div>
          <strong>${escapeHtml(check.label)}</strong>
          <small>${escapeHtml(check.detail)}</small>
        </div>
      </article>
    `)
    .join("");
  els.preflightModal.hidden = false;
  const finish = (value) => {
    els.preflightModal.hidden = true;
    els.confirmPreflightButton.onclick = null;
    els.cancelPreflightButton.onclick = null;
    resolve(value);
  };
  els.confirmPreflightButton.onclick = () => finish(true);
  els.cancelPreflightButton.onclick = () => finish(false);
});

const applyQueuedSkins = async (skinKeysOverride = null, options = {}) => {
  if (state.importingQueue) return false;
  const isPartyApply = Array.isArray(skinKeysOverride);
  if (isPartyConnected() && !isPartyApply) {
    setOverlayPanelStatus({
      label: "Party activa",
      message: "Party ejecuta automaticamente la seleccion sincronizada cuando todos estan listos."
    });
    renderSelectionTray();
    renderCompactLauncher();
    return false;
  }
  const skinKeys = isPartyApply ? skinKeysOverride : [...state.queuedSkins];
  const optionExtraMods = Array.isArray(options.extraMods) ? options.extraMods.filter((mod) => mod?.path) : [];
  const totalRequestedMods = skinKeys.length + optionExtraMods.length;
  if (totalRequestedMods === 0) return false;
  if (!options.skipPreflight && !state.preflightAcceptedOnce && !isPartyApply) {
    const accepted = await confirmPreflight(buildPreflightChecks(skinKeys));
    if (!accepted) return false;
    state.preflightAcceptedOnce = true;
    setTimeout(() => {
      state.preflightAcceptedOnce = false;
    }, 1500);
  }
  state.importingQueue = true;
  renderSkinLibrary();

  const queued = skinKeys.map(getSkinByKey).filter(Boolean);
  const skinPaths = queued.map((s) => s.path).filter(Boolean);

  if (!skinPaths.length && !optionExtraMods.length) {
    state.importingQueue = false;
    renderSkinLibrary();
    setOverlayPanelStatus({ message: "Las skins seleccionadas no tienen archivo local." });
    return false;
  }

  if (!state.ltkOverlaySidecarPath) {
    state.importingQueue = false;
    await autoConfigureOverlay({ silent: true });
    state.importingQueue = true;
  }

  if (!state.ltkOverlaySidecarPath) {
    state.importingQueue = false;
    renderSkinLibrary();
    setOverlayPanelStatus({
      label: "Engine faltante",
      message: `No encontre ${state.engineBinaryName}. Instalalo desde Descargas o cambia el modo de engine en Configuracion.`
    });
    return false;
  }

  const restartingOverlay = state.overlayRunning;
  const totalOverlayMods = skinPaths.length + optionExtraMods.length;
  setOverlayPanelStatus({
    label: restartingOverlay ? "Reiniciando overlay" : "Aplicando",
    message: restartingOverlay
      ? `Deteniendo overlay actual para aplicar ${formatSkinCount(totalOverlayMods)}...`
      : `Aplicando ${formatSkinCount(totalOverlayMods)} (mkoverlay + runoverlay)...`
  });
  try {
    if (restartingOverlay) {
      await window.riftAtlas.stopOverlay();
      state.overlayRunning = false;
      await refreshOverlayStatus();
      setOverlayPanelStatus({
        label: "Aplicando",
        message: `Overlay anterior detenido. Aplicando ${formatSkinCount(totalOverlayMods)} (mkoverlay + runoverlay)...`
      });
    }

    await startRoseEarlyMonitor("manual-apply");

    const extraMods = [...await getSelectedRoseExtraMods(), ...optionExtraMods];

    const runOverlay = state.engineBinaryName === "mod-tools.exe"
      ? window.riftAtlas.runRoseOverlay
      : window.riftAtlas.runBocchiOverlay;
    if (!runOverlay) throw new Error("Runner de overlay no disponible; reinicia la aplicacion.");
    const result = await runOverlay({
      sidecarPath: state.ltkOverlaySidecarPath,
      dllPath: state.ltkOverlayDllPath,
      gamePath: state.leagueGamePath,
      skinPaths,
      skinEntries: queued,
      roseMode: state.engineBinaryName === "mod-tools.exe",
      forceFreshOverlay: true,
      extraMods: extraMods.length > 0 ? extraMods : undefined
    });
    await stopRoseEarlyMonitor("manual-overlay-ready");

    if (result.enginePath) {
      setLtkOverlaySidecarPath(result.enginePath);
    }
    addOverlayHistoryEntry(queued);
    if (result.ready === false) {
      setOverlayPanelStatus({
        label: "Overlay esperando",
        message: `Runoverlay quedo listo con ${formatSkinCount(totalOverlayMods)}. Esperando a que League cargue la partida para enganchar la DLL.`,
        active: true
      });
    } else {
      setOverlayPanelStatus({
        label: "Overlay activo",
        message: `Overlay activo. ${formatSkinCount(totalOverlayMods)} cargada${totalOverlayMods === 1 ? "" : "s"}. Entra a partida para ver las skins.`,
        active: true
      });
    }
    await refreshOverlayStatus();
    return true;
  } catch (error) {
    setOverlayPanelStatus({
      label: "Error",
      message: `Error: ${error.message}`,
      error: true
    });
    return false;
  } finally {
    await stopRoseEarlyMonitor("apply-finally");
    state.importingQueue = false;
    renderSkinLibrary();
  }
};

const isLeagueGameRunning = async () => {
  if (GAMEFLOW_ACTIVE_PHASES.has(state.penguGameflowPhase)) return true;
  try {
    const status = await window.riftAtlas.isLeagueGameRunning?.(state.leagueGamePath);
    return Boolean(status?.running);
  } catch {
    return false;
  }
};

const maybeRunCustomOverlayFromPrebuild = async (reason = "prebuild") => {
  if (!state.customOverlayPath || state.importingQueue || state.overlayRunning) return false;
  if (!state.ltkOverlaySidecarPath || !state.leagueGamePath) return false;

  const customKeys = (state.customOverlayKeys || []).filter((key) => {
    const skin = getSkinByKey(key);
    return skin?.custom && !isDownloadedLeagueSkinsPath(key);
  });
  if (!customKeys.length) return false;

  const running = await isLeagueGameRunning();
  if (!running) {
    window.riftAtlas.appendOverlayLog(`[Diagnostico] prebuild custom listo pero League no esta en partida (${reason}). overlay=${state.customOverlayPath}`).catch(() => { });
    return false;
  }

  const signature = `${state.customOverlayPath}|${customKeys.join("|")}`;
  if (state.autoRunCustomOverlaySignature === signature) return false;
  state.autoRunCustomOverlaySignature = signature;

  state.importingQueue = true;
  setOverlayPanelStatus({
    label: "Activando overlay",
    message: "Partida detectada. Arrancando runoverlay con mods propios..."
  });
  try {
    window.riftAtlas.appendOverlayLog(`[Diagnostico] auto-run overlay custom (${reason}): ${state.customOverlayPath}`).catch(() => { });
    const result = await window.riftAtlas.runBocchiOverlay({
      sidecarPath: state.ltkOverlaySidecarPath,
      dllPath: state.ltkOverlayDllPath,
      gamePath: state.leagueGamePath,
      skinEntries: [],
      baseOverlayPath: state.customOverlayPath,
      allowNoCacheBase: true
    });
    if (result?.enginePath) setLtkOverlaySidecarPath(result.enginePath);
    setOverlayPanelStatus({
      label: result?.ready === false ? "Overlay esperando" : "Overlay activo",
      message: result?.ready === false
        ? "Runoverlay quedo listo y espera enganchar League."
        : "Overlay activo con mods propios.",
      active: true
    });
    await refreshOverlayStatus();
    return Boolean(result?.success);
  } catch (error) {
    state.autoRunCustomOverlaySignature = "";
    setOverlayPanelStatus({
      label: "Error",
      message: `No pude arrancar el overlay custom: ${error.message || error}`,
      error: true
    });
    return false;
  } finally {
    state.importingQueue = false;
    renderSkinLibrary();
    renderSelectionTray();
  }
};

const prebuildCustomOverlay = async () => {
  if (state.prebuildingOverlay) return;
  state.prebuildingOverlay = true;
  try {
    if (state.engineBinaryName === "mod-tools.exe") {
      state.customOverlayPath = "";
      state.customOverlayKeys = [];
      state.autoRunCustomOverlaySignature = "";
      return;
    }
    if (!state.ltkOverlaySidecarPath || !state.leagueGamePath) return;
    const customKeys = [...state.queuedSkins].filter((key) => {
      const skin = getSkinByKey(key);
      return skin?.custom && !isDownloadedLeagueSkinsPath(key);
    });
    if (!customKeys.length) {
      state.customOverlayPath = "";
      state.customOverlayKeys = [];
      renderBaseOverlayStatus();
      return;
    }

    const entries = customKeys.map((k) => getSkinByKey(k)).filter(Boolean);
    if (!entries.length) {
      state.customOverlayPath = "";
      state.customOverlayKeys = [];
      renderBaseOverlayStatus();
      return;
    }

    const result = await window.riftAtlas.buildBaseOverlay({
      sidecarPath: state.ltkOverlaySidecarPath,
      gamePath: state.leagueGamePath,
      skinEntries: entries
    });
    if (result?.overlayPath) {
      state.customOverlayPath = result.overlayPath;
      state.customOverlayKeys = customKeys;
    } else {
      state.customOverlayPath = "";
      state.customOverlayKeys = [];
      state.autoRunCustomOverlaySignature = "";
    }
  } catch {
    state.customOverlayPath = "";
    state.customOverlayKeys = [];
    state.autoRunCustomOverlaySignature = "";
  } finally {
    state.prebuildingOverlay = false;
  }
  renderBaseOverlayStatus();
};

const schedulePrebuildCustomOverlay = () => {
  if (state.customOverlayTimer) clearTimeout(state.customOverlayTimer);
  state.customOverlayTimer = setTimeout(() => {
    state.customOverlayTimer = null;
    prebuildCustomOverlay();
  }, 700);
};

const applyPartyQueue = async () => {
  const readiness = getPartyReadiness();
  const partyKeys = getPartySharedKeys();
  const partyExtraMods = getPartyPeerExtraMods();
  if (!readiness.allReady || (!partyKeys.length && !partyExtraMods.length)) {
    renderParty();
    return;
  }
  await window.riftAtlas.appendOverlayLog?.(`[PartyMode] Aplicando party estilo Rose: propias=${partyKeys.length} peers=${partyExtraMods.length}.`).catch(() => { });
  await applyQueuedSkins(partyKeys, {
    extraMods: partyExtraMods,
    source: "party"
  });
};

const stopOverlayFromUi = async () => {
  try {
    const result = await window.riftAtlas.stopOverlay();
    state.importingQueue = false;
    state.overlayRunning = false;
    state.autoRunCustomOverlaySignature = "";
    setOverlayPanelStatus({
      label: "Sin overlay",
      message: result.stopped ? "Overlay detenido." : "No habia overlay activo."
    });
    setConfigStatus(result.stopped ? "Overlay detenido." : "No habia overlay activo.");
    renderSkinLibrary();
    renderSelectionTray();
    renderCompactLauncher();
    renderParty();
    await refreshOverlayStatus();
  } catch (error) {
    state.importingQueue = false;
    setOverlayPanelStatus({ label: "Error", message: error.message, error: true });
    setConfigStatus(error.message);
    renderSkinLibrary();
    renderSelectionTray();
    renderCompactLauncher();
  }
};

const refreshOverlayStatus = async () => {
  try {
    const status = await window.riftAtlas.overlayStatus();
    const wasRunning = state.overlayRunning;
    state.overlayRunning = Boolean(status.running);
    state.overlayProfilePath = status.profilePath || "";
    const signature = [
      state.overlayRunning ? "1" : "0",
      status.ready ? "1" : "0",
      state.overlayProfilePath,
      status.error || "",
      state.overlayActiveMessage || ""
    ].join("::");
    const statusChanged = signature !== lastOverlayStatusSignature;
    lastOverlayStatusSignature = signature;
    if (state.importingQueue && !status.error) {
      if (statusChanged) renderCompactLauncher();
      return;
    }
    if (!statusChanged) {
      return;
    }
    if (status.error) {
      state.overlayRunning = false;
      setConfigStatus(status.error);
      setOverlayPanelStatus({ label: "Error de inyeccion", message: status.error, error: true });
    } else if (state.overlayRunning) {
      if (status.ready === false) {
        setOverlayPanelStatus({
          label: "Overlay esperando",
          message: state.overlayActiveMessage || "Runoverlay esta listo y esperando que League cargue la partida.",
          active: true
        });
      } else {
        setOverlayPanelStatus({
          label: "Overlay activo",
          message: state.overlayActiveMessage || "Overlay activo. Entra a partida para ver las skins.",
          active: true
        });
      }
    } else {
      setOverlayPanelStatus({
        label: "Sin overlay",
        message: "Listo para seleccionar skins."
      });
    }
    if (wasRunning !== state.overlayRunning) {
      renderSelectionTray();
      renderParty();
    }
    renderCompactLauncher();
  } catch {
    // ignore polling errors
  }
};

const runDiagnostics = async () => {
  if (!els.diagnosticsList) return;
  els.diagnosticsList.innerHTML = '<div class="tier-empty">Comprobando instalacion...</div>';
  try {
    const result = await window.riftAtlas.diagnoseOverlay({
      enginePath: state.ltkOverlaySidecarPath,
      dllPath: state.ltkOverlayDllPath,
      leagueGamePath: state.leagueGamePath
    });
    if (els.diagnosticSummary) {
      els.diagnosticSummary.textContent = result.ok ? "Listo para ejecutar" : "Faltan rutas";
    }
    els.diagnosticsList.innerHTML = result.checks
      .map((check) => `
        <article class="diagnostic-row ${check.ok ? "ok" : "bad"}">
          <span>${check.ok ? "OK" : "!"}</span>
          <div>
            <strong>${escapeHtml(check.label)}</strong>
            <small>${escapeHtml(check.message)}${check.value ? ` · ${escapeHtml(check.value)}` : ""}</small>
          </div>
        </article>
      `)
      .join("");
  } catch (error) {
    if (els.diagnosticSummary) els.diagnosticSummary.textContent = "Error";
    els.diagnosticsList.innerHTML = `<div class="tier-empty">${escapeHtml(error.message)}</div>`;
  }
};

const renderLeagueIssueRows = (items = [], label, mapper) => items
  .map((item) => `
    <article class="diagnostic-row bad">
      <span>!</span>
      <div>
        <strong>${escapeHtml(label)}</strong>
        <small>${escapeHtml(mapper(item))}</small>
      </div>
    </article>
  `)
  .join("");

const renderMaintenance = async () => {
  if (!els.maintenanceList) return;
  els.maintenanceList.innerHTML = '<div class="tier-empty">Leyendo caches...</div>';
  try {
    const result = await window.riftAtlas.maintenanceStatus?.();
    els.maintenanceList.innerHTML = (result?.targets || [])
      .map((target) => `
        <article class="diagnostic-row ${target.exists ? "ok" : ""}">
          <span>${target.exists ? "OK" : "-"}</span>
          <div>
            <strong>${escapeHtml(target.name)}</strong>
            <small>${escapeHtml(target.path)} - ${formatBytes(target.size || 0)}</small>
          </div>
        </article>
      `)
      .join("") || '<div class="tier-empty">Sin datos de mantenimiento.</div>';
  } catch (error) {
    els.maintenanceList.innerHTML = `<div class="tier-empty">${escapeHtml(error.message)}</div>`;
  }
};

const cleanupMaintenanceTargets = async (targets = []) => {
  await window.riftAtlas.cleanupMaintenance?.({ targets });
  await renderMaintenance();
  setConfigStatus("Mantenimiento completado.");
};

const runLeagueInstallCheck = async () => {
  if (!els.leagueCheckList) return;
  if (els.leagueCheckSummary) els.leagueCheckSummary.textContent = "Chequeando...";
  if (els.leagueCheckDetails) els.leagueCheckDetails.textContent = state.leagueGamePath || "League no configurado";
  els.leagueCheckList.innerHTML = '<div class="tier-empty">Revisando Data/FINAL...</div>';
  try {
    const result = await window.riftAtlas.checkLeagueInstall({
      leagueGamePath: state.leagueGamePath
    });
    if (els.leagueCheckSummary) {
      els.leagueCheckSummary.textContent = result.ok ? "League coincide" : "League con diferencias";
    }
    if (els.leagueCheckDetails) {
      els.leagueCheckDetails.textContent = `${result.actualCount}/${result.expectedCount} archivos. Faltan ${result.missingCount}, distintos ${result.mismatchCount}, extras ${result.extraCount}.`;
    }
    const rows = [
      renderLeagueIssueRows(result.missing || [], "Falta archivo", (item) => item.relativePath),
      renderLeagueIssueRows(result.sizeMismatch || [], "Tamano distinto", (item) => `${item.relativePath} esperado ${formatBytes(item.expectedSize)} / actual ${formatBytes(item.actualSize)}`),
      renderLeagueIssueRows(result.extra || [], "Archivo extra", (item) => item.relativePath)
    ].join("");
    els.leagueCheckList.innerHTML = rows || `
      <article class="diagnostic-row ok">
        <span>OK</span>
        <div>
          <strong>Data/FINAL</strong>
          <small>${escapeHtml(result.finalDir)}</small>
        </div>
      </article>
    `;
  } catch (error) {
    if (els.leagueCheckSummary) els.leagueCheckSummary.textContent = "Error";
    if (els.leagueCheckDetails) els.leagueCheckDetails.textContent = error.message;
    els.leagueCheckList.innerHTML = `<div class="tier-empty">${escapeHtml(error.message)}</div>`;
  }
};

const applyToLtk = async () => {
  if (state.importingQueue || state.queuedSkins.size === 0) return;
  state.importingQueue = true;
  renderSkinLibrary();

  const queued = [...state.queuedSkins].map(getSkinByKey).filter(Boolean);

  if (!queued.length) {
    state.importingQueue = false;
    renderSkinLibrary();
    els.importStatusLabel.textContent = "Las skins seleccionadas no tienen archivo local.";
    return;
  }

  els.importStatusLabel.textContent = `Importando ${queued.length} skins a LTK Manager...`;

  try {
    const mods = queued.map((s) => ({
      path: s.path,
      champion: s.champion || "",
      skin: s.skin || s.name || "",
      variant: s.variant || ""
    }));

    const result = await window.riftAtlas.importLtkMods({ mods });

    if (result.failed > 0) {
      const failedItems = result.results.filter((r) => !r.success);
      els.importStatusLabel.textContent = `${result.imported} importadas, ${result.skipped} omitidas, ${result.failed} fallaron. ${failedItems[0]?.error || ""}`;
    } else {
      els.importStatusLabel.textContent = `${result.imported} skins importadas en LTK Manager. Abriendo...`;
    }

    state.queuedSkins.clear();
    saveQueuedSkins();

    if (state.ltkPath) {
      await window.riftAtlas.openLtk(state.ltkPath);
      els.importStatusLabel.textContent = `${result.imported} skins en LTK. Haz clic en "Run" dentro de LTK Manager para aplicar el overlay.`;
    } else {
      els.importStatusLabel.textContent = `${result.imported} skins importadas. Configura LTK Manager en Skins > LTK Manager.`;
    }

    for (const r of result.results) {
      if (r.success && !r.skipped) {
        const skin = state.customMods.find((s) => s.path === r.path);
        if (skin) {
          state.managedSkins.add(getSkinKey(skin));
        }
      }
    }
    localStorage.setItem("riftAtlas:managedSkins", JSON.stringify([...state.managedSkins]));
    renderSkinLibrary();
  } catch (error) {
    els.importStatusLabel.textContent = `Error al importar en LTK: ${error.message}`;
  }

  state.importingQueue = false;
  renderSkinLibrary();
};

const bindEvents = () => {
  els.titlebar?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button, a, input, select")) return;
    window.riftAtlas.windowStartDragging?.().catch(() => null);
  });
  els.titlebar?.addEventListener("dblclick", async (event) => {
    if (event.target.closest("button, a, input, select")) return;
    const maximized = await window.riftAtlas.windowToggleMaximize?.().catch(() => null);
    if (maximized !== null) updateMaximizeIcon(maximized);
  });

  // Window maximize state change - update icon
  const updateMaximizeIcon = (maximized) => {
    if (els.windowMaximizeButton) {
      els.windowMaximizeButton.textContent = maximized ? "❐" : "□";
      els.windowMaximizeButton.title = maximized ? "Restaurar" : "Maximizar o restaurar";
    }
  };
  window.riftAtlas.onWindowMaximizeChange?.((payload) => {
    updateMaximizeIcon(payload?.maximized);
  });
  window.riftAtlas.windowIsMaximized?.().then((m) => updateMaximizeIcon(m)).catch(() => {});

  els.windowMinimizeButton?.addEventListener("click", () => window.riftAtlas.windowMinimize?.());
  els.windowMaximizeButton?.addEventListener("click", async () => {
    const maximized = await window.riftAtlas.windowToggleMaximize?.().catch(() => null);
    if (maximized !== null) updateMaximizeIcon(maximized);
  });
  els.windowCloseButton?.addEventListener("click", () => window.riftAtlas.windowHide?.());

  // Detect league path button
  els.detectLeaguePathButton?.addEventListener("click", async () => {
    els.detectLeaguePathButton.disabled = true;
    els.detectLeaguePathButton.textContent = "Detectando...";
    try {
      await detectLeaguePathFromSystem({ silent: false });
    } finally {
      els.detectLeaguePathButton.disabled = false;
      els.detectLeaguePathButton.textContent = "Detectar";
    }
  });

  // League detected on startup
  window.riftAtlas.onLeagueDetected?.((payload) => {
    if (payload?.detected && payload.leagueGamePath) {
      setLeagueGamePath(payload.leagueGamePath);
    }
  });

  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    renderChampionGrid({ resetScroll: true });
  });

  document.querySelectorAll(".filter-pill").forEach((button) => {
    button.addEventListener("click", () => {
      state.role = button.dataset.role;
      document.querySelectorAll(".filter-pill").forEach((item) => item.classList.toggle("active", item === button));
      renderChampionGrid({ resetScroll: true });
    });
  });

  document.querySelectorAll(".lane-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.lane = button.dataset.lane;
      document.querySelectorAll(".lane-tab").forEach((item) => item.classList.toggle("active", item === button));
      loadTierLane();
    });
  });

  els.refreshTiersButton.addEventListener("click", () => {
    delete state.tiersByLane[state.lane];
    loadTierLane(true);
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      setView(button.dataset.view);
      closeIntroSidebar();
    });
  });

  document.addEventListener("pointerdown", (event) => {
    if (!els.sidebar?.classList.contains("is-open")) return;
    if (event.target.closest(".sidebar")) return;
    closeIntroSidebar();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeIntroSidebar();
  });

  document.querySelectorAll(".nav-shortcut").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.viewTarget));
  });

  els.buildSearchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const champion = getChampionByDatasetName(els.buildChampionInput.value.trim());
    if (!champion) {
      if (els.buildStatusLabel) els.buildStatusLabel.textContent = "No encontre ese campeon.";
      return;
    }
    state.buildChampionId = champion.id;
    updateBuildView();
  });

  els.buildSourceSelect?.addEventListener("change", (event) => {
    state.buildSource = event.target.value === "opgg" ? "opgg" : "metasrc";
    updateBuildView();
  });

  els.buildRegionSelect?.addEventListener("change", (event) => {
    state.buildRegion = event.target.value;
    updateBuildView();
  });

  els.openBuildExternalButton?.addEventListener("click", () => {
    window.riftAtlas.openExternal(state.buildUrl || getBuildUrl());
  });

  els.openBuildExternalButtonInline?.addEventListener("click", () => {
    window.riftAtlas.openExternal(state.buildUrl || getBuildUrl());
  });

  document.querySelectorAll(".external-link").forEach((button) => {
    button.addEventListener("click", () => {
      window.riftAtlas.openExternal(button.dataset.url);
    });
  });

  els.selectModsFolderButton.addEventListener("click", async () => {
    els.modsFolderLabel.textContent = "Leyendo carpeta...";
    try {
      renderModPackages(await window.riftAtlas.selectModFolder());
    } catch (error) {
      els.modsFolderLabel.textContent = error.message;
    }
  });

  els.selectLeagueGameButton.addEventListener("click", async () => {
    const selectedPath = await window.riftAtlas.selectLeagueGame();
    if (selectedPath) {
      setLeagueGamePath(selectedPath);
      setConfigStatus("Ejecutable de League configurado.");
    }
  });

  els.clearQueueButton.addEventListener("click", () => {
    clearSkinSelection();
    els.importStatusLabel.textContent = "Seleccion y gestionadas limpiadas.";
  });

  document.querySelectorAll(".selection-clear-button").forEach((button) => button.addEventListener("click", () => {
    clearSkinSelection();
    els.importStatusLabel.textContent = "Seleccion y gestionadas limpiadas.";
  }));

  document.querySelectorAll(".selection-apply-button").forEach((button) => button.addEventListener("click", applyQueuedSkins));

  document.querySelectorAll(".selection-stop-button").forEach((button) => button.addEventListener("click", stopOverlayFromUi));

  document.querySelectorAll("#rebuildBaseOverlayButton").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Construyendo...";
    await prebuildCustomOverlay();
    renderBaseOverlayStatus();
    button.disabled = false;
    button.textContent = "Reconstruir";
  }));

  els.clearOverlayHistoryButton?.addEventListener("click", () => {
    state.overlayHistory = [];
    saveOverlayHistory();
  });

  els.runDiagnosticsButton?.addEventListener("click", runDiagnostics);
  els.checkLeagueInstallButton?.addEventListener("click", runLeagueInstallCheck);
  els.refreshMaintenanceButton?.addEventListener("click", renderMaintenance);
  els.cleanupOverlayCacheButton?.addEventListener("click", () => cleanupMaintenanceTargets(["overlays", "staging"]));
  els.cleanupPreviewCacheButton?.addEventListener("click", () => cleanupMaintenanceTargets(["previews"]));
  els.cleanupPartyCacheButton?.addEventListener("click", () => cleanupMaintenanceTargets(["party", "party-transfers"]));
  els.cleanupDownloadsButton?.addEventListener("click", () => cleanupMaintenanceTargets(["downloads"]));
  els.openLogsFolderButton?.addEventListener("click", async () => {
    const folderPath = await window.riftAtlas.openLogsFolder?.();
    setConfigStatus(`Logs abiertos: ${folderPath}`);
  });
  els.exportDiagnosticsButton?.addEventListener("click", async () => {
    const result = await window.riftAtlas.exportDiagnostics?.({
      queuedSkins: [...state.queuedSkins],
      presets: state.presets,
      leagueGamePath: state.leagueGamePath,
      ltkOverlaySidecarPath: state.ltkOverlaySidecarPath,
      ltkOverlayDllPath: state.ltkOverlayDllPath,
      libraryIndex: state.libraryIndex
    });
    setConfigStatus(`Diagnostico exportado: ${result?.exportPath || ""}`);
  });

  document.getElementById("helpStartTutorialButton")?.addEventListener("click", () => {
    tutorialAutoStarted = false;
    forceStartTutorial({ reason: "help-page" });
  });

  if (window.riftAtlas.onDownloadProgress) {
    window.riftAtlas.onDownloadProgress((payload) => {
      if (!payload || !payload.type) return;
      const bootstrapComponent = state.activeDownloadType === "first-run-bootstrap" &&
        ["first-run-bootstrap", "engine", "league-skins", "pengu-loader"].includes(payload.type);
      if (state.activeDownloadType && !bootstrapComponent && payload.type !== state.activeDownloadType && payload.type !== "app-update") return;
      const percentText = formatDownloadProgress(payload);
      if (els.downloadProgressLabel && ["first-run-bootstrap", "engine", "league-skins", "pengu-loader"].includes(payload.type)) {
        els.downloadProgressLabel.textContent = `${payload.message || "Descargando..."}${percentText}`;
      }
      if (els.updateStatusLabel && payload.type === "app-update") {
        els.updateStatusLabel.textContent = payload.message || "Descargando actualizacion...";
        if (els.updateDetailsLabel) {
          els.updateDetailsLabel.textContent = percentText
            ? `Progreso:${percentText}`
            : "Descargando instalador dentro de la app...";
        }
      }
      if (els.configStatusLabel && payload.message) {
        els.configStatusLabel.textContent = payload.message;
      }
    });
  }

  if (window.riftAtlas.onPenguBridgeStatus) {
    window.riftAtlas.onPenguBridgeStatus((payload = {}) => {
      state.penguBridgeConnected = Boolean(payload.connected);
      window.riftAtlas.appendOverlayLog(`[Diagnostico] puente Pengu: conectado=${state.penguBridgeConnected} clientes=${payload.clients}`).catch(() => { });
      renderPenguBridgeStatus();
      if (state.penguBridgeConnected) {
        Promise.allSettled([
          ensureSkinLibraryLoaded(),
          ensureUserModsLoaded()
        ])
          .catch((error) => {
            window.riftAtlas.appendOverlayLog(`[Diagnostico] no pude precargar LeagueSkins para Pengu: ${error.message}`).catch(() => { });
          })
          .finally(() => {
            sendPenguSkinCatalog("bridge-connected");
            sendPenguDebugMode(Boolean(window.__riftAtlasDebug), "bridge-connected");
            replayCustomModState();
          });
      }
    });
  }

  if (window.riftAtlas.onPatcherDied) {
    window.riftAtlas.onPatcherDied((payload = {}) => {
      if (payload.reason === "rose-v2-exited") {
        window.riftAtlas.appendOverlayLog("[Diagnostico] runoverlay Rose salio; se conserva estado hasta fin de partida.").catch(() => { });
        refreshOverlayStatus();
        return;
      }
      window.riftAtlas.appendOverlayLog("[Diagnostico] patcher-died event recibido, limpiando estado inmediatamente.").catch(() => { });
      state.overlayRunning = false;
      setOverlayPanelStatus({ label: "Sin overlay", message: "Overlay terminado." });
      renderSelectionTray();
      renderCompactLauncher();
      renderParty();
    });
  }

  if (window.riftAtlas.onPenguLobbyState) {
    window.riftAtlas.onPenguLobbyState((payload = {}) => {
      state.penguLobby = payload.hasLobby === false ? null : payload;
      renderPenguBridgeStatus();
      schedulePenguAutoParty();
    });
  }

  if (window.riftAtlas.onUiCommand) {
    window.riftAtlas.onUiCommand((cmd = {}) => {
      if (cmd.type === "show-skin") {
        const skinName = cmd.skinName || "";
        const champName = cmd.championName || "";
        const skinId = Number(cmd.skinId || 0);
        window.riftAtlas.appendOverlayLog(`[UiCommand] show-skin: ${champName} - ${skinName} (${skinId})`).catch(() => { });
        setOverlayPanelStatus({
          label: "Skin detectada",
          message: `${champName} - ${skinName}`
        });
        if (els.skinProfilePanel && skinName) {
          els.skinProfilePanel.innerHTML = `
            <div class="empty-state compact">
              <h2>${escapeHtml(champName)} - ${escapeHtml(skinName)}</h2>
              <p>Skin seleccionada en champ select (ID: ${skinId})</p>
            </div>
          `;
        }
      } else if (cmd.type === "champion-exchange") {
        window.riftAtlas.appendOverlayLog(`[UiCommand] champion-exchange detectado por main loop.`).catch(() => { });
        setOverlayPanelStatus({
          label: "Champion exchange",
          message: "Campeon cambiado, reseteando overlay."
        });
      } else if (cmd.type === "hide-skin") {
        window.riftAtlas.appendOverlayLog(`[UiCommand] hide-skin`).catch(() => { });
      } else if (cmd.type === "reset-selection") {
        window.riftAtlas.appendOverlayLog(`[UiCommand] reset-selection`).catch(() => { });
      }
    });
  }

  if (window.riftAtlas.onPenguMessage) {
    window.riftAtlas.onPenguMessage((payload = {}) => {
      if (payload.source === "rift-atlas-app") return;
      if (payload.type?.startsWith("party-")) {
        handlePenguPartyModeMessage(payload).catch((error) => {
          window.riftAtlas.appendOverlayLog(`[PartyMode] ${error.message}`).catch(() => { });
        });
        return;
      }
      if (payload.type === "dismiss-custom-mod") {
        lastCustomModStateSignature = "";
        state.selectedCustomMod = null;
        clearRoseAuthoritativeSelection();
        window.riftAtlas.appendOverlayLog("[Rose] custom mod descartado desde el popup de Pengu.").catch(() => { });
        return;
      }
      if (payload.type === "skin-catalog-request") {
        Promise.allSettled([
          ensureSkinLibraryLoaded(),
          ensureUserModsLoaded()
        ])
          .catch((error) => {
            window.riftAtlas.appendOverlayLog(`[Diagnostico] no pude cargar LeagueSkins para catalog-request: ${error.message}`).catch(() => { });
          })
          .finally(() => sendPenguSkinCatalog("client-request"));
      }
      if (payload.type === "phase-change") {
        handlePenguPhaseChange(payload);
      }
      if (payload.type === "champion-locked") {
        state.penguChampionLocked = true;
        const lockedChampionId = Number(payload.championId || 0);
        state.lastLockedChampionId = lockedChampionId;
        const lockedSelectedSkinId = Number(payload.selectedSkinId || payload.skinId || 0);
        if (lockedChampionId && lockedSelectedSkinId) {
          lastPenguLcuSelection = { championId: lockedChampionId, selectedSkinId: lockedSelectedSkinId, at: Date.now() };
        }
        window.riftAtlas.appendOverlayLog(`[Diagnostico] champion-locked recibido; procesando skin-syncs desde ahora.`).catch(() => { });
        // The first skin snapshot can arrive just before the lock event. Rose
        // retains that snapshot; replay it now instead of waiting for the DOM to
        // emit the same skin again (which is not guaranteed for every champion).
        const pendingLockedPayload = lastPenguSkinSyncPayload?.canonical
          ? null
          : (lastPenguSkinSyncPayload || {});
        const replayPayload = {
          ...pendingLockedPayload,
          championId: Number(pendingLockedPayload.championId || lockedChampionId || 0) || undefined,
          // Rose: if the monitor already saw a carousel/DOM skin text, that text
          // is the source of truth. The lock event can still contain the skin
          // League selected on entry (for example Neeko Cosplay before the user
          // moves to Bewitching).
          selectedSkinId: Number(
            (pendingLockedPayload.skin || pendingLockedPayload.originalName
              ? (pendingLockedPayload.selectedSkinId || pendingLockedPayload.skinId || lockedSelectedSkinId)
              : lockedSelectedSkinId) || 0
          ) || undefined,
          skin: pendingLockedPayload.skin || pendingLockedPayload.originalName || payload.name || undefined,
          originalName: pendingLockedPayload.originalName || pendingLockedPayload.skin || payload.name || undefined,
        };
        if (replayPayload.skin || replayPayload.selectedSkinId || replayPayload.skinId) {
          penguSkinSyncQueue = penguSkinSyncQueue
            .catch(() => null)
            .then(() => handlePenguSkinSync(replayPayload))
            .catch((error) => {
              window.riftAtlas.appendOverlayLog(`[Diagnostico] replay post-lock fallo: ${error.message || error}`).catch(() => { });
            });
        }
      }
      if (payload.type === "champion-exchange") {
        const oldChamp = Number(payload.oldChampionId || 0);
        const newChamp = Number(payload.newChampionId || 0);
        window.riftAtlas.appendOverlayLog(`[Rose] Champion exchange detectado: ${oldChamp} -> ${newChamp}. Reseteando estado de inyeccion.`).catch(() => { });
        penguApplyGeneration += 1;
        penguSkinSyncGeneration += 1;
        penguSkinSyncQueue = Promise.resolve();
        clearRoseAuthoritativeSelection();
        state.lastLockedChampionId = 0;
        state.roseFinalizationCommitted = false;
        state.roseFinalizationApplyStarted = false;
        state.roseFinalizationSignature = "";
        state.lastHoverWritten = false;
        state.lastRoseInjectionTime = 0;
        state.loadoutCountdownActive = false;
        state.loadoutT0 = 0;
        state.loadoutLeft0Ms = 0;
        state.lastRemainMs = 0;
        clearPenguApplyLock();
        clearRoseFinalizationTimer();
        penguBackgroundApplyKey = "";
        penguBackgroundApplyInFlightKey = "";
        lastPenguSkinSyncPayload = null;
        lastPenguSkinSyncKey = "";
        lastPenguSkinSyncAt = 0;
        lastPenguLcuSelection = null;
        lastPenguChromaSelection = null;
        lastPenguChromaPanel = null;
        state.penguChampionLocked = false;
        // Rose: en exchange se limpia TODO, incluyendo selected_custom_mod.
        state.selectedCustomMod = null;
        state.penguSessionQueuedSkins.clear();
        state.queuedSkins.clear();
        saveQueuedSkins();
        renderSkinLibrary();
        renderSelectionTray();
        if (state.overlayRunning && window.riftAtlas.stopOverlay) {
          window.riftAtlas.stopOverlay().catch(() => { });
          state.overlayRunning = false;
        }
        window.riftAtlas.appendOverlayLog(`[Rose] Exchange: overlay detenido, queued skins limpiados, apply locks reiniciados (gen=${penguApplyGeneration}).`).catch(() => { });
      }
      if (payload.type === "loadout-finalization") {
        handlePenguLoadoutFinalization(payload);
      }
      if (payload.type === "carousel-status") {
        handlePenguCarouselStatus(payload);
      }
      if (payload.type === "skin-apply") {
        window.riftAtlas.appendOverlayLog(`[Diagnostico] skin-apply recibido, encolando por handlePenguSkinSync (estilo Rose: un solo camino)`).catch(() => { });
      }
      if (payload.type === "lcu-selection-state") {
        const championId = Number(payload.championId || 0);
        const selectedSkinId = Number(payload.selectedSkinId || 0);
        if (championId && selectedSkinId) {
          lastPenguLcuSelection = { championId, selectedSkinId, at: Date.now() };
          if (roseAuthoritativeSelection.championId === championId && roseAuthoritativeSelection.payload) {
            roseAuthoritativeSelection = {
              ...roseAuthoritativeSelection,
              payload: {
                ...roseAuthoritativeSelection.payload,
                actualLcuSkinId: selectedSkinId,
              },
            };
          }
          if (lastPenguSkinSyncPayload?.championId === championId) {
            lastPenguSkinSyncPayload = {
              ...lastPenguSkinSyncPayload,
              actualLcuSkinId: selectedSkinId,
            };
          }
        }
      }
      if (payload.type === "skin-state" || payload.type === "force-skin-result") {
        const forceRequestId = String(payload.forceRequestId || "");
        if (forceRequestId && pendingPenguForceSkinRequests.has(forceRequestId)) {
          const pending = pendingPenguForceSkinRequests.get(forceRequestId);
          pendingPenguForceSkinRequests.delete(forceRequestId);
          pending?.resolve?.(payload);
        }
        const forcedChampionId = Number(payload.championId || 0);
        const verifiedSkinId = Number(payload.verifiedSkinId || 0);
        if (payload.type === "force-skin-result" && forcedChampionId && verifiedSkinId) {
          lastPenguLcuSelection = { championId: forcedChampionId, selectedSkinId: verifiedSkinId, at: Date.now() };
        }
        const signature = `${payload.championId || ""}:${payload.skinId || ""}:${payload.name || ""}:${payload.owned ?? ""}:${payload.forceOk ?? ""}:${payload.forceError || ""}`;
        const now = Date.now();
        if (signature !== lastPenguSkinStateSignature || now - lastPenguSkinStateAt > 5000) {
          lastPenguSkinStateSignature = signature;
          lastPenguSkinStateAt = now;
          window.riftAtlas.appendOverlayLog(`[Diagnostico] ${payload.type} recibido: championId=${payload.championId} skinId=${payload.skinId} name=${payload.name} owned=${payload.owned === true ? "si" : payload.owned === false ? "no" : "?"} accepted=${payload.requestAccepted ?? ""} forceOk=${payload.forceOk ?? ""} method=${payload.forceMethod || ""} verified=${payload.verifiedSkinId || ""} error=${payload.forceError || ""}`).catch(() => { });
        }
      }
      if (payload.type === "owned-skins") {
        state.penguOwnedSkinIds = new Set(
          (payload.ownedSkinIds || [])
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0)
        );
        for (const skinMap of lcuChampionSkinCache.values()) {
          for (const [chromaId, baseSkinId] of skinMap.baseSkinByChroma?.entries?.() || []) {
            if (state.penguOwnedSkinIds.has(Number(chromaId))) {
              state.penguOwnedSkinIds.add(Number(baseSkinId));
            }
          }
        }
        state.penguOwnedSkinsReady = true;
        const count = state.penguOwnedSkinIds.size || payload.count || 0;
        if (count !== lastPenguOwnedSkinCount) {
          lastPenguOwnedSkinCount = count;
          window.riftAtlas.appendOverlayLog(`[Diagnostico] Pengu inventario del cliente cargado: ${count} owned skin(s). No es el total de LeagueSkins.`).catch(() => { });
        }
      }
      if (payload.type === "chroma-panel-opened") {
        lastPenguChromaPanel = {
          championId: Number(payload.championId || 0),
          skinId: Number(payload.skinId || 0),
          open: true,
          at: Date.now()
        };
        window.riftAtlas.appendOverlayLog(`[Diagnostico] chroma panel abierto: championId=${payload.championId || ""} skinId=${payload.skinId || ""}`).catch(() => { });
      }
      if (payload.type === "chroma-panel-closed") {
        lastPenguChromaPanel = {
          championId: Number(payload.championId || 0),
          skinId: Number(payload.skinId || payload.baseSkinId || 0),
          open: false,
          at: Date.now()
        };
        window.riftAtlas.appendOverlayLog(`[Diagnostico] chroma panel cerrado: championId=${payload.championId || ""} skinId=${payload.skinId || payload.baseSkinId || ""} reason=${payload.reason || ""}`).catch(() => { });
      }
      if (payload.type === "chroma-selection") {
        window.riftAtlas.sendPenguMessage?.({
          type: "chroma-state",
          championId: Number(payload.championId || 0),
          currentSkinId: Number(payload.baseSkinId || payload.skinId || 0),
          selectedChromaId: Number(payload.chromaId || payload.selectedSkinId || payload.skinId || 0),
          chromaColor: payload.primaryColor || null,
          chromaColors: payload.colors || [],
          chromaName: payload.chromaName || "",
          source: "rift-atlas-app"
        }).catch(() => null);
      }
      if (payload.type === "request-chroma-data" && payload.skinId) {
        const signature = `${payload.skinId}:${payload.skin || ""}`;
        lastPenguSkinId = Number(payload.skinId);
        if (signature !== lastPenguChromaRequestSignature) {
          lastPenguChromaRequestSignature = signature;
          window.riftAtlas.appendOverlayLog(`[Diagnostico] request-chroma-data almacenado: skinId=${lastPenguSkinId} skin=${payload.skin || ""}`).catch(() => { });
        }
      }
      if (payload.type === "skin-sync" || payload.type === "chroma-selection" || payload.type === "skin-apply" || (payload.skin && !payload.type)) {
        penguSkinSyncQueue = penguSkinSyncQueue.catch(() => null).then(() => handlePenguSkinSync(payload)).catch((error) => {
          window.riftAtlas.sendPenguMessage?.({
            type: "skin-apply-result",
            ok: false,
            key: payload.key || payload.path,
            message: error.message
          }).catch(() => null);
        });
      }
    });
  }

  els.createPartyButton?.addEventListener("click", async () => {
    try {
      if (isPartyConnected()) {
        await leaveParty();
      } else {
        await createParty();
      }
    } catch (error) {
      if (els.partyConnectionLabel) els.partyConnectionLabel.textContent = error.message;
    }
  });

  els.joinPartyButton?.addEventListener("click", async () => {
    try {
      if (!isPartyConnected()) {
        throw new Error("Enable Party Mode antes de agregar un friend token.");
      }
      if (!partyOwnToken) {
        throw new Error("Esta party no tiene token Rose propio. Usa Enable Party Mode manual.");
      }
      await joinParty();
    } catch (error) {
      if (els.partyConnectionLabel) els.partyConnectionLabel.textContent = error.message;
    }
  });

  els.leavePartyButton?.addEventListener("click", () => {
    leaveParty();
  });

  els.penguAutoPartyCheckbox?.addEventListener("change", (event) => {
    state.penguAutoParty = event.target.checked;
    localStorage.setItem("riftAtlas:penguAutoParty", state.penguAutoParty ? "1" : "0");
    renderPenguBridgeStatus();
    schedulePenguAutoParty(100);
  });

  els.skinsP2PSyncButton?.addEventListener("click", () => {
    syncPartySkins();
    requestMissingRoomFiles();
    renderParty();
  });

  els.copyPartyLinkButton?.addEventListener("click", async () => {
    if (!state.partyLink) return;
    try {
      await navigator.clipboard.writeText(state.partyLink);
      if ("value" in els.partyShareLinkLabel) {
        els.partyShareLinkLabel.value = state.partyLink;
      } else {
        els.partyShareLinkLabel.textContent = `${state.partyLink} copiado.`;
      }
      els.copyPartyLinkButton.textContent = "Copied!";
      setTimeout(() => {
        if (els.copyPartyLinkButton) els.copyPartyLinkButton.textContent = "Copy";
      }, 1800);
    } catch {
      if ("value" in els.partyShareLinkLabel) {
        els.partyShareLinkLabel.value = state.partyLink;
      } else {
        els.partyShareLinkLabel.textContent = state.partyLink;
      }
    }
  });

  els.autoConfigureButton?.addEventListener("click", () => {
    autoConfigureOverlay();
  });

  els.checkUpdatesButton?.addEventListener("click", () => {
    checkForUpdates({ manual: true });
  });

  els.updateDownloadButton?.addEventListener("click", async () => {
    await downloadAvailableUpdate();
  });

  els.updateDismissButton?.addEventListener("click", () => {
    const update = state.availableUpdate;
    if (update?.latestVersion && els.updateHideCheckbox?.checked) {
      localStorage.setItem("riftAtlas:ignoredUpdateVersion", update.latestVersion);
    }
    renderUpdateStatus(update, { hiddenByUser: Boolean(update?.latestVersion && els.updateHideCheckbox?.checked) });
  });

  els.downloadCslolButton?.addEventListener("click", () => {
    if (window.riftAtlasTutorial?.isActive?.()) window.riftAtlasTutorial.pauseForModal();
    if (els.engineChoiceModal) els.engineChoiceModal.hidden = false;
  });

  els.downloadEngineButton?.addEventListener("click", () => {
    if (window.riftAtlasTutorial?.isActive?.()) window.riftAtlasTutorial.pauseForModal();
    if (els.engineChoiceModal) els.engineChoiceModal.hidden = false;
  });

  const hideEngineChoiceModal = () => {
    if (els.engineChoiceModal) els.engineChoiceModal.hidden = true;
    if (window.riftAtlasTutorial?.isPaused?.()) window.riftAtlasTutorial.resumeAfterModal();
  };

  els.chooseLtkManagerButton?.addEventListener("click", () => {
    hideEngineChoiceModal();
    downloadCslolTools("ltk-manager.exe");
  });

  els.chooseModToolsButton?.addEventListener("click", () => {
    hideEngineChoiceModal();
    downloadCslolTools("mod-tools.exe");
  });

  els.cancelEngineChoiceButton?.addEventListener("click", hideEngineChoiceModal);

  els.engineBinarySelector?.addEventListener("change", (e) => {
    setEngineBinaryName(e.target.value, { detect: true });
  });

  els.engineModeButtons?.forEach((button) => {
    button.addEventListener("click", () => {
      setEngineBinaryName(button.dataset.engineBinary, { detect: true });
      setConfigStatus(button.dataset.engineBinary === "mod-tools.exe"
        ? "Modo Rose seleccionado: mod-tools usa mkoverlay + runoverlay."
        : "Modo LTK seleccionado: ltk-manager usa mkoverlay + patcher.");
    });
  });

  setEngineBinaryName(state.engineBinaryName);

  els.downloadLeagueSkinsButton?.addEventListener("click", () => {
    loadDownloadedLeagueSkins();
  });

  els.downloadLeagueSkinsButtonDownload?.addEventListener("click", () => {
    loadDownloadedLeagueSkins();
  });

  els.downloadPenguLoaderButton?.addEventListener("click", () => {
    downloadPenguLoader();
  });

  els.launchPenguLoaderButton?.addEventListener("click", activatePenguFromUi);
  els.uninstallPenguLoaderButton?.addEventListener("click", uninstallPenguFromUi);
  els.overlayLaunchPenguButton?.addEventListener("click", activatePenguFromUi);
  els.overlayDeactivatePenguButton?.addEventListener("click", deactivatePenguFromUi);

  els.openEngineFolderButton?.addEventListener("click", async () => {
    await window.riftAtlas.openEngineFolder?.();
  });

  els.firstDllOpenFolderButton?.addEventListener("click", async () => {
    await window.riftAtlas.openEngineFolder?.();
  });

  els.firstDllDoneButton?.addEventListener("click", async () => {
    try {
      const installedPath = await window.riftAtlas.selectBocchiDll?.();
      if (!installedPath) return;
      setLtkOverlayDllPath(installedPath);
      hideFirstDllModal();
      setConfigStatus("DLL instalada por Rift Atlas.");
      await autoConfigureOverlay({ silent: true });
    } catch (error) {
      setConfigStatus(error.message || "No pude instalar el DLL.");
    }
  });

  els.firstDllLaterButton?.addEventListener("click", () => {
    hideFirstDllModal();
  });

  els.openDllFolderButton?.addEventListener("click", async () => {
    await revealPath(state.ltkOverlayDllPath);
  });

  els.openLeagueSkinsFolderButton?.addEventListener("click", async () => {
    await revealPath(state.skinLibraryPath);
  });

  els.openPenguLoaderFolderButton?.addEventListener("click", async () => {
    try {
      const folderPath = await window.riftAtlas.openPenguLoaderFolder?.();
      if (els.downloadPenguLoaderLabel) els.downloadPenguLoaderLabel.textContent = folderPath;
      if (els.downloadProgressLabel) els.downloadProgressLabel.textContent = "Carpeta de Pengu Loader abierta.";
    } catch (error) {
      if (els.downloadProgressLabel) els.downloadProgressLabel.textContent = error.message || "No pude abrir la carpeta de Pengu.";
    }
  });

  els.openAppDataFolderButton?.addEventListener("click", async () => {
    try {
      const folderPath = await window.riftAtlas.openUserDataPath();
      if (els.appDataPathLabel) els.appDataPathLabel.textContent = folderPath;
      setConfigStatus("Directorio de la app abierto.");
    } catch (error) {
      setConfigStatus(error.message || "No se pudo abrir el directorio de la app.");
    }
  });

  els.factoryResetButton?.addEventListener("click", async () => {
    const confirmed = window.confirm("Esto va a desactivar y borrar Pengu de Rift Atlas, y tambien borrar configuracion, skins descargadas, engine, DLL, P2P, presets y caches de overlay/mods. La app se cerrara y volvera a abrir limpia. Queres continuar?");
    if (!confirmed) return;
    try {
      els.factoryResetButton.disabled = true;
      setConfigStatus("Restableciendo Rift Atlas...");
      localStorage.clear();
      await window.riftAtlas.factoryReset?.();
    } catch (error) {
      els.factoryResetButton.disabled = false;
      setConfigStatus(error.message || "No pude restablecer Rift Atlas.");
    }
  });

  // ThresholdManager UI
  const loadInjectionThresholdUI = async () => {
    try {
      const value = await window.riftAtlas.loadInjectionThreshold?.() ?? 0.5;
      const ms = Math.round(value * 1000);
      state.skinWriteMs = ms;
      if (els.injectionThresholdSlider) els.injectionThresholdSlider.value = ms;
      if (els.injectionThresholdLabel) els.injectionThresholdLabel.textContent = `${ms}ms`;
    } catch (error) {
      // ignore
    }
  };

  const saveInjectionThresholdUI = async () => {
    try {
        const ms = Number(els.injectionThresholdSlider?.value || 500);
      const seconds = ms / 1000;
      await window.riftAtlas.saveInjectionThreshold?.(seconds);
      state.skinWriteMs = ms;
      if (els.injectionThresholdLabel) els.injectionThresholdLabel.textContent = `${ms}ms`;
      setConfigStatus(`Cooldown de inyeccion actualizado: ${ms}ms`);
    } catch (error) {
      setConfigStatus(`Error: ${error.message || error}`);
    }
  };

  els.injectionThresholdSlider?.addEventListener("input", (event) => {
    const ms = Number(event.target.value || 500);
    if (els.injectionThresholdLabel) els.injectionThresholdLabel.textContent = `${ms}ms`;
  });

  els.saveThresholdButton?.addEventListener("click", saveInjectionThresholdUI);

  // BaseSkinTracker UI
  const loadBaseSkinStatsUI = async () => {
    try {
      const stats = await window.riftAtlas.getBaseSkinTrackerStats?.() ?? {};
      if (els.baseSkinStatsDetails) els.baseSkinStatsDetails.hidden = false;
      if (els.statTotalSamples) els.statTotalSamples.textContent = stats.total_samples ?? 0;
      if (els.statConfirmed) els.statConfirmed.textContent = stats.confirmed_count ?? 0;
      if (els.statTimeouts) els.statTimeouts.textContent = stats.timeout_count ?? 0;
      if (els.statAvg) els.statAvg.textContent = stats.avg_ms != null ? `${stats.avg_ms}ms` : "-";
      if (els.statP90) els.statP90.textContent = stats.p90_ms != null ? `${stats.p90_ms}ms` : "-";
      if (els.statMax) els.statMax.textContent = stats.max_ms != null ? `${stats.max_ms}ms` : "-";
      if (els.statRecommended) {
        els.statRecommended.textContent = stats.recommended_threshold_ms != null ? `${stats.recommended_threshold_ms}ms` : "-";
      }
      if (els.baseSkinStatsLabel) {
        els.baseSkinStatsLabel.textContent = stats.total_samples > 0 ? `${stats.total_samples} samples` : "Sin datos";
      }
    } catch (error) {
      // ignore
    }
  };

  els.refreshStatsButton?.addEventListener("click", loadBaseSkinStatsUI);

  els.clearStatsButton?.addEventListener("click", async () => {
    const confirmed = window.confirm("Esto borra todas las muestras de confirmacion de skin base. Queres continuar?");
    if (!confirmed) return;
    try {
      await window.riftAtlas.clearBaseSkinTrackerSamples?.();
      loadBaseSkinStatsUI();
      setConfigStatus("Samples de confirmacion borrados.");
    } catch (error) {
      setConfigStatus(`Error: ${error.message || error}`);
    }
  });

  // Load threshold and stats on settings view
  loadInjectionThresholdUI();
  loadBaseSkinStatsUI();

  els.openModsFolderButton?.addEventListener("click", async () => {
    try {
      await openCustomModDestinationFolder();
    } catch (error) {
      if (els.customModsLabel) els.customModsLabel.textContent = `Error: ${error.message || error}`;
    }
  });

  els.modDropZone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.modDropZone.classList.add("drag-over");
  });

  els.modDropZone?.addEventListener("dragleave", () => {
    els.modDropZone.classList.remove("drag-over");
  });

  els.modDropZone?.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.modDropZone.classList.remove("drag-over");
    try {
      const paths = window.riftAtlas.getDroppedFilePaths?.(event.dataTransfer?.files || []) || [];
      if (paths.length) await importCustomModPathsToSelectedSkin(paths, "drop");
    } catch (error) {
      if (els.customModsLabel) els.customModsLabel.textContent = error.message;
    }
  });

  window.addEventListener("rift-atlas:file-drop", async (event) => {
    try {
      const paths = event.detail?.paths || [];
      if (paths.length) await importCustomModPathsToSelectedSkin(paths, "drop");
    } catch (error) {
      if (els.customModsLabel) els.customModsLabel.textContent = error.message;
    }
  });

  els.groupSkinsCheckbox?.addEventListener("change", (event) => {
    state.groupSkinsByChampion = event.target.checked;
    localStorage.setItem("riftAtlas:groupSkinsByChampion", state.groupSkinsByChampion ? "1" : "0");
    renderSkinLibrary();
  });

  els.skinMetadataForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveMetadataForm().catch((error) => {
      if (els.metadataPreviewInput) els.metadataPreviewInput.value = error.message;
    });
  });

  els.cancelMetadataButton?.addEventListener("click", closeSkinMetadataModal);

  els.chooseMetadataPreviewButton?.addEventListener("click", async () => {
    const previewPath = await window.riftAtlas.selectPreviewImage?.();
    if (!previewPath) return;
    const key = els.metadataSkinKeyInput?.value || previewPath;
    const cached = await window.riftAtlas.cachePreview?.({ key, source: previewPath }).catch(() => null);
    els.metadataPreviewInput.value = cached?.previewUrl || previewPath;
  });

  els.regenerateMetadataPreviewButton?.addEventListener("click", async () => {
    const key = els.metadataSkinKeyInput?.value || "";
    const skin = getSkinByKey(key);
    if (!skin) return;
    const preview = await inferPreviewForSkin(skin);
    els.metadataPreviewInput.value = preview;
  });

  els.stopOverlayButton?.addEventListener("click", stopOverlayFromUi);

  els.selectLtkOverlaySidecarButton?.addEventListener("click", async () => {
    const p = await window.riftAtlas.selectBocchiSidecar();
    if (p) {
      const binary = getEngineBinaryFromPath(p);
      if (binary) setEngineBinaryName(binary);
      setLtkOverlaySidecarPath(p);
      setConfigStatus(binary === "mod-tools.exe"
        ? "Engine Rose configurado."
        : "Engine LTK configurado.");
    }
  });


  els.selectLtkOverlayDllButton?.addEventListener("click", async () => {
    try {
      const p = await window.riftAtlas.selectBocchiDll();
      if (p) { setLtkOverlayDllPath(p); setConfigStatus("DLL instalada por Rift Atlas."); }
    } catch (error) {
      setConfigStatus(error.message || "La DLL se coloca manualmente en la carpeta engine.");
    }
  });

  els.selectLtkButton?.addEventListener("click", async () => {
    const selectedPath = await window.riftAtlas.selectLtk();
    if (selectedPath) {
      setLtkPath(selectedPath);
      setConfigStatus("LTK Manager configurado.");
    }
  });

  els.openLtkButton?.addEventListener("click", async () => {
    try {
      await window.riftAtlas.openLtk(state.ltkPath);
    } catch (error) {
      if (els.ltkPathLabel) els.ltkPathLabel.textContent = error.message;
    }
  });

  els.downloadLtkButton?.addEventListener("click", async () => {
    els.downloadLtkButton.disabled = true;
    els.downloadLtkButton.textContent = "Descargando...";
    if (els.ltkPathLabel) els.ltkPathLabel.textContent = "Descargando LTK Manager...";
    if (els.revealLtkDownloadButton) els.revealLtkDownloadButton.style.display = "none";
    try {
      const result = await window.riftAtlas.downloadAndInstallLtk();
      if (els.ltkPathLabel) els.ltkPathLabel.textContent = `Descargado: ${result.assetName}`;
      setConfigStatus(`LTK Manager ${result.version} descargado en ${result.setupPath}. Ejecuta el instalador manualmente.`);
      if (els.revealLtkDownloadButton) {
        els.revealLtkDownloadButton.style.display = "";
        els.revealLtkDownloadButton.onclick = () => {
          window.riftAtlas.revealModPath(result.setupPath);
        };
      }
    } catch (error) {
      if (els.ltkPathLabel) els.ltkPathLabel.textContent = "No configurado";
      setConfigStatus(`Error: ${error.message}`);
    } finally {
      els.downloadLtkButton.disabled = false;
      els.downloadLtkButton.textContent = "Descargar LTK Manager";
    }
  });

  document.querySelectorAll(".selection-save-button").forEach((button) => button.addEventListener("click", () => {
    const name = `Seleccion ${new Date().toLocaleString("es-AR")}`;
    const preset = createProfilePreset(name);
    state.presets.push(preset);
    state.activePresetId = preset.id;
    savePresets();
    els.importStatusLabel.textContent = `Seleccion guardada como "${name}".`;
  }));

  els.selectSkinLibraryButton?.addEventListener("click", async () => {
    if (els.skinLibraryLabel) els.skinLibraryLabel.textContent = "Indexando LeagueSkins...";
    try {
      const result = await window.riftAtlas.selectSkinLibrary();
      if (result) setSkinLibrary(result);
    } catch (error) {
      if (els.skinLibraryLabel) els.skinLibraryLabel.textContent = error.message;
    }
  });

  els.skinSearchInput?.addEventListener("input", (event) => {
    state.skinQuery = event.target.value.trim();
    resetSkinView({ clearProfile: true });
    renderSkinLibrary();
  });

  els.skinChampionSelect?.addEventListener("change", (event) => {
    state.skinChampion = event.target.value;
    resetSkinView({ clearProfile: true });
    renderSkinLibrary();
  });

  els.skinTypeSelect?.addEventListener("change", (event) => {
    state.skinType = event.target.value;
    resetSkinView({ clearProfile: true });
    renderSkinLibrary();
  });

  els.skinStateSelect?.addEventListener("change", (event) => {
    state.skinState = event.target.value;
    resetSkinView({ clearProfile: true });
    renderSkinLibrary();
  });

  els.mainContent?.addEventListener("scroll", loadMoreSkinsIfNeeded, { passive: true });

  els.createPresetButton?.addEventListener("click", () => {
    const name = els.presetNameInput.value.trim();
    if (!name) {
      if (els.presetStatusLabel) els.presetStatusLabel.textContent = "Escribe un nombre para el preset.";
      return;
    }
    const preset = createProfilePreset(name);
    state.presets.push(preset);
    state.activePresetId = preset.id;
    if (els.presetNameInput) els.presetNameInput.value = "";
    if (els.presetStatusLabel) els.presetStatusLabel.textContent = `Preset "${name}" creado con ${preset.skinKeys.length} skin(s).`;
    savePresets();
  });

  els.presetSelect?.addEventListener("change", (event) => {
    state.activePresetId = event.target.value;
    savePresets();
  });

  els.saveQueuePresetButton?.addEventListener("click", () => {
    const preset = getActivePreset();
    if (!preset) return;
    preset.skinKeys = [...state.queuedSkins];
    preset.enginePath = state.ltkOverlaySidecarPath;
    preset.dllPath = state.ltkOverlayDllPath;
    preset.leagueGamePath = state.leagueGamePath;
    preset.penguAutoParty = state.penguAutoParty;
    preset.updatedAt = new Date().toISOString();
    if (els.presetStatusLabel) els.presetStatusLabel.textContent = `Cola guardada en "${preset.name}" (${preset.skinKeys.length}).`;
    savePresets();
  });

  els.loadPresetQueueButton?.addEventListener("click", () => {
    loadPresetToQueue();
  });

  els.togglePresetAutoApplyButton?.addEventListener("click", () => {
    const preset = getActivePreset();
    if (!preset) return;
    preset.autoApply = !preset.autoApply;
    preset.updatedAt = new Date().toISOString();
    if (els.presetStatusLabel) {
      els.presetStatusLabel.textContent = preset.autoApply
        ? `Perfil "${preset.name}" se autoaplicara cuando lo cargues.`
        : `Autoaplicar desactivado para "${preset.name}".`;
    }
    savePresets();
  });

  els.deletePresetButton?.addEventListener("click", () => {
    const preset = getActivePreset();
    if (!preset) return;
    state.presets = state.presets.filter((item) => item.id !== preset.id);
    state.activePresetId = state.presets[0]?.id || "";
    if (els.presetStatusLabel) els.presetStatusLabel.textContent = `Preset "${preset.name}" eliminado.`;
    savePresets();
  });
};

const fetchLcuChampionSkinData = async (championKey, { forceRefresh = false } = {}) => {
  const cacheKey = String(Number(championKey) || "");
  const cached = lcuChampionSkinCache.get(cacheKey);
  if (!forceRefresh && cached) return cached;
  if (!cacheKey || !window.riftAtlas.getLcuChampionSkins) return new Map();
  const payload = await window.riftAtlas.getLcuChampionSkins(Number(cacheKey));
  const skins = Array.isArray(payload?.skins) ? payload.skins : [];
  const map = new Map();
  const baseSkinByChroma = new Map();
  for (const skin of skins) {
    const skinId = Number(skin.id || skin.skinId || 0);
    if (!skinId) continue;
    const displayName = String(skin.name || skin.skinName || "").trim();
    if (displayName) {
      map.set(String(skinId), displayName);
      const skinNum = Number(skin.num);
      if (Number.isFinite(skinNum) && skinNum >= 0) map.set(String(skinNum), displayName);
    }
    for (const chroma of Array.isArray(skin.chromas) ? skin.chromas : []) {
      const chromaId = Number(chroma.id || chroma.chromaId || 0);
      if (!chromaId) continue;
      const chromaName = String(chroma.name || chroma.chromaName || displayName).trim();
      if (chromaName) map.set(String(chromaId), chromaName);
      baseSkinByChroma.set(chromaId, skinId);
    }
  }
  map.baseSkinByChroma = baseSkinByChroma;
  map.source = "lcu";
  lcuChampionSkinCache.set(cacheKey, map);
  // Inventory can expose an owned chroma ID without repeating its parent skin
  // ID. Rose treats that parent as owned for the base-skin decision.
  for (const [chromaId, baseSkinId] of baseSkinByChroma.entries()) {
    if (state.penguOwnedSkinIds.has(Number(chromaId))) {
      state.penguOwnedSkinIds.add(Number(baseSkinId));
    }
  }
  resolveSkinLibraryNames();
  return map;
};


const loadChampions = async () => {
  els.patchLabel.textContent = "Cargando campeones...";
  els.countLabel.textContent = "0";
  els.championGrid.innerHTML = '<p class="empty-state">Cargando campeones...</p>';
  let payload = null;

  if (window.riftAtlas.getChampionData) {
    payload = await window.riftAtlas.getChampionData().catch(() => null);
  }

  if (!payload?.version || !payload?.champions?.length) {
    const versions = await fetchJsonWithTimeout(`${CDN}/api/versions.json`, {}, 10000);
    const version = versions[0];
    const championList = await fetchJsonWithTimeout(`${CDN}/cdn/${version}/data/es_AR/champion.json`, {}, 10000)
      .catch(() => fetchJsonWithTimeout(`${CDN}/cdn/${version}/data/en_US/champion.json`, {}, 10000));
    payload = {
      version,
      champions: Object.values(championList.data || {})
    };
  }

  state.version = payload.version;
  els.patchLabel.textContent = state.version;
  state.champions = payload.champions.sort((a, b) => a.name.localeCompare(b.name, "es"));
  state.customMods = state.customMods.map(enrichCustomMod);
  localStorage.setItem("riftAtlas:customMods", JSON.stringify(state.customMods));
  renderChampionGrid();
  renderBuildChampionOptions();
  updateBuildView();
  loadTierLane();
  renderCustomMods();
  renderSelectionTray();
  sendPenguSkinCatalog("champions-loaded");

  if (state.champions.length > 0) {
    selectChampion(state.champions[0].id).catch(showError);
  }

};

const showError = (error) => {
  els.patchLabel.textContent = "Sin conexion";
  els.countLabel.textContent = "0";
  els.championGrid.innerHTML = `
    <div class="empty-state">
      <h2>No pude cargar los campeones</h2>
      <p>${escapeHtml(error.message)}</p>
    </div>
  `;
  els.championDetail.innerHTML = `
    <div class="empty-state">
      <h2>No pude cargar los datos</h2>
      <p>${escapeHtml(error.message)}</p>
    </div>
  `;
};

let tutorialAutoStarted = false;
let tutorialAutoStartScheduled = false;
const hasLocalTutorialSeen = () =>
  localStorage.getItem("riftAtlas:tutorialIntroSeen:v2") === "1" ||
  localStorage.getItem("riftAtlas:tutorialIntroDisabled") === "1";

const logTutorial = (payload = {}) => {
  const entry = {
    at: new Date().toISOString(),
    ...payload
  };
  window.__riftAtlasTutorialLastLog = entry;
};

const setTutorialDebug = (patch = {}) => {
  window.__riftAtlasTutorialDebug = {
    ...(window.__riftAtlasTutorialDebug || {}),
    updatedAt: new Date().toISOString(),
    ...patch
  };
  logTutorial(window.__riftAtlasTutorialDebug);
};

const forceStartTutorial = ({ attempt = 0, reason = "auto" } = {}) => {
  setTutorialDebug({ attempt, reason, hasStarter: Boolean(window.startRiftAtlasTutorial) });
  if (tutorialAutoStarted) return true;
  if (!window.startRiftAtlasTutorial) {
    if (attempt < 12) setTimeout(() => forceStartTutorial({ attempt: attempt + 1, reason }), 500);
    return false;
  }
  if (els.firstDllModal && !els.firstDllModal.hidden) {
    setTutorialDebug({ attempt, reason, waitingFor: "first-dll-modal" });
    if (attempt < 12) setTimeout(() => forceStartTutorial({ attempt: attempt + 1, reason }), 700);
    return false;
  }
  const started = window.startRiftAtlasTutorial(setView, {
    force: true,
    showIntroControls: true,
    setupResult: firstRunBootstrapResult
  });
  setTutorialDebug({ attempt, reason, started });
  if (started) {
    tutorialAutoStarted = true;
    window.riftAtlas.markFirstRunComplete?.().catch(() => null);
    return true;
  }
  if (attempt < 12) setTimeout(() => forceStartTutorial({ attempt: attempt + 1, reason }), 700);
  return false;
};

const getTutorialAutostartReason = async () => {
  const flags = await window.riftAtlas.getStartupFlags?.().catch(() => null);
  setAppDebugMode(Boolean(flags?.flags?.debug || flags?.debug), "startup-flags");
  setTutorialDebug({ flags, localSeen: hasLocalTutorialSeen() });
  if (flags?.showTutorial) return "post-reset";
  if (flags?.firstRun) return "first-run-main";
  if (!hasLocalTutorialSeen()) return "first-run-local";
  return "";
};

const scheduleTutorialAutostart = async () => {
  logTutorial({ message: "schedule requested", tutorialAutoStartScheduled, tutorialAutoStarted });
  if (tutorialAutoStartScheduled || tutorialAutoStarted) return;
  tutorialAutoStartScheduled = true;
  const reason = await getTutorialAutostartReason();
  if (!reason) {
    setTutorialDebug({ skipped: "already-seen" });
    tutorialAutoStartScheduled = false;
    return;
  }
  localStorage.removeItem("riftAtlas:tutorialIntroSeen");
  localStorage.removeItem("riftAtlas:tutorialIntroSeen:v2");
  localStorage.removeItem("riftAtlas:tutorialIntroDisabled");
  [400, 1200, 2400, 4200, 6500].forEach((delay, index) => {
    setTimeout(() => forceStartTutorial({ attempt: index, reason }), delay);
  });
};

const startTutorialFromMainEvent = (flags = {}) => {
  if (flags?.flags?.debug || flags?.debug) setAppDebugMode(true, "start-tutorial-event");
  setTutorialDebug({ event: "app:start-tutorial", flags });
  tutorialAutoStartScheduled = false;
  localStorage.removeItem("riftAtlas:tutorialIntroSeen");
  localStorage.removeItem("riftAtlas:tutorialIntroSeen:v2");
  localStorage.removeItem("riftAtlas:tutorialIntroDisabled");
  Promise.resolve(firstRunBootstrapPromise).finally(() => {
    [200, 700, 1400, 2600, 4200, 6500].forEach((delay, index) => {
      setTimeout(() => forceStartTutorial({ attempt: index, reason: flags.showTutorial ? "post-reset-main-event" : "first-run-main-event" }), delay);
    });
  });
};

window.riftAtlas.onStartTutorial?.(startTutorialFromMainEvent);
window.riftAtlas.onDebugMode?.((payload = {}) => {
  setAppDebugMode(Boolean(payload.enabled), payload.source || "app-event");
});

bindEvents();
window.riftAtlas.appendOverlayLog(
  `[RoseFlow] renderer=20260625-3 ticker=rust-lcu-monotonic chroma-state=rose-base force=final-only threshold=${state.skinWriteMs}ms.`
).catch(() => { });
loadLibraryIndex().then(() => {
  renderPresets();
  renderSkinLibrary();
  persistLibraryIndex();
}).catch(() => null);
loadLtkOverlayPaths();

setLeagueGamePath(state.leagueGamePath);
detectLeaguePathFromSystem({ silent: true })
  .finally(() => autoConfigureOverlay({ silent: true }));
renderPresets();
localStorage.removeItem("riftAtlas:customModFolders");
restoreKnownLocalMods();
saveCustomMods();
saveQueuedSkins();
renderCustomMods();
renderOverlayHistory();
renderCompactLauncher();
renderParty();
renderMaintenance();
loadAppVersion();
loadAppDataPath();
loadPenguLoaderStatus();
const startupDependenciesReady = startFirstRunBootstrap();
setTimeout(() => {
  loadPenguLoaderStatus();
  checkForUpdates({ manual: false });
}, 1200);
window.addEventListener("load", () => {
  startupDependenciesReady.finally(() => scheduleTutorialAutostart());
});
setTimeout(() => {
  startupDependenciesReady.finally(() => scheduleTutorialAutostart());
}, 1200);
refreshOverlayStatus();
startupDependenciesReady.finally(() => ensureSkinLibraryLoaded().catch(showError).finally(cleanupStaleQueueKeys));
ensureUserModsLoaded().catch(() => null);
renderBaseOverlayStatus();
setInterval(refreshOverlayStatus, 3000);
setInterval(() => {
  if (state.partyStatus === "connected") {
    schedulePartySync(0);
    requestMissingRoomFiles();
  }
}, 5000);

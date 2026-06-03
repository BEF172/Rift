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
  dllDownloadSource: "bundled",
  availableUpdate: null,
  overlayRunning: false,
  overlayProfilePath: "",
  overlayActiveMessage: "",
  partyRoom: null,
  partyLink: "",
  partyStatus: "disconnected",
  selectedPartyFile: null,
  partyAutoApply: localStorage.getItem("riftAtlas:partyAutoApply") === "1",
  favorites: new Set(JSON.parse(localStorage.getItem("riftAtlas:favorites") || "[]")),
  ltkOverlaySidecarPath: localStorage.getItem("riftAtlas:ltkOverlaySidecarPath") || "",
  ltkOverlayDllPath: localStorage.getItem("riftAtlas:ltkOverlayDllPath") || ""
};

const els = {
  mainContent: document.querySelector(".main-content"),
  sidebar: document.querySelector(".sidebar"),
  apiKeyLabel: document.querySelector("#apiKeyLabel"),
  championToolbar: document.querySelector("#championToolbar"),
  patchLabel: document.querySelector("#patchLabel"),
  championGrid: document.querySelector("#championGrid"),
  championDetail: document.querySelector("#championDetail"),
  tierGrid: document.querySelector("#tierGrid"),
  tierMeta: document.querySelector("#tierMeta"),
  refreshTiersButton: document.querySelector("#refreshTiersButton"),
  searchInput: document.querySelector("#searchInput"),
  countLabel: document.querySelector("#countLabel"),
  favoritesGrid: document.querySelector("#favoritesGrid"),
  favoritesCount: document.querySelector("#favoritesCount"),
  apiKeyForm: document.querySelector("#apiKeyForm"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  apiKeyHint: document.querySelector("#apiKeyHint"),
  clearApiKeyButton: document.querySelector("#clearApiKeyButton"),
  playerSearchForm: document.querySelector("#playerSearchForm"),
  riotIdInput: document.querySelector("#riotIdInput"),
  platformSelect: document.querySelector("#platformSelect"),
  playerResults: document.querySelector("#playerResults"),
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
  selectLeagueGameButton: document.querySelector("#selectLeagueGameButton"),
  importStatusLabel: document.querySelector("#importStatusLabel"),
  configStatusLabel: document.querySelector("#configStatusLabel"),
  compactStatusLabel: document.querySelector("#compactStatusLabel"),
  compactOverlayPill: document.querySelector("#compactOverlayPill"),
  compactPresetSelect: document.querySelector("#compactPresetSelect"),
  compactLoadPresetButton: document.querySelector("#compactLoadPresetButton"),
  compactRunButton: document.querySelector("#compactRunButton"),
  compactStopButton: document.querySelector("#compactStopButton"),
  downloadCslolButton: document.querySelector("#downloadCslolButton"),
  autoConfigureButton: document.querySelector("#autoConfigureButton"),
  runDiagnosticsButton: document.querySelector("#runDiagnosticsButton"),
  diagnosticSummary: document.querySelector("#diagnosticSummary"),
  diagnosticsList: document.querySelector("#diagnosticsList"),
  updatePanel: document.querySelector("#updatePanel"),
  updateStatusLabel: document.querySelector("#updateStatusLabel"),
  updateDetailsLabel: document.querySelector("#updateDetailsLabel"),
  updateHideLabel: document.querySelector("#updateHideLabel"),
  updateHideCheckbox: document.querySelector("#updateHideCheckbox"),
  updateDownloadButton: document.querySelector("#updateDownloadButton"),
  updateDismissButton: document.querySelector("#updateDismissButton"),
  checkUpdatesButton: document.querySelector("#checkUpdatesButton"),
  ltkOverlaySidecarLabel: document.querySelector("#ltkOverlaySidecarLabel"),
  ltkOverlayDllLabel: document.querySelector("#ltkOverlayDllLabel"),
  appDataPathLabel: document.querySelector("#appDataPathLabel"),
  openAppDataFolderButton: document.querySelector("#openAppDataFolderButton"),
  selectLtkOverlaySidecarButton: document.querySelector("#selectLtkOverlaySidecarButton"),
  selectLtkOverlayDllButton: document.querySelector("#selectLtkOverlayDllButton"),
  ltkPathLabel: document.querySelector("#ltkPathLabel"),
  selectLtkButton: document.querySelector("#selectLtkButton"),
  openLtkButton: document.querySelector("#openLtkButton"),
  downloadLtkButton: document.querySelector("#downloadLtkButton"),
  revealLtkDownloadButton: document.querySelector("#revealLtkDownloadButton"),
  overlayStatusIndicator: document.querySelector("#overlayStatusIndicator"),
  overlayStatusLabel: document.querySelector("#overlayStatusLabel"),
  skinsOverlayStatusIndicator: document.querySelector("#skinsOverlayStatusIndicator"),
  skinsOverlayStatusLabel: document.querySelector("#skinsOverlayStatusLabel"),
  skinsOverlayStatusMessage: document.querySelector("#skinsOverlayStatusMessage"),
  stopOverlayButton: document.querySelector("#stopOverlayButton"),
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
  partyAutoApplyCheckbox: document.querySelector("#partyAutoApplyCheckbox"),
  applyPartyButton: document.querySelector("#applyPartyButton"),
  partyShareLinkLabel: document.querySelector("#partyShareLinkLabel"),
  copyPartyLinkButton: document.querySelector("#copyPartyLinkButton"),
  partyMembersList: document.querySelector("#partyMembersList"),
  partyFileProfile: document.querySelector("#partyFileProfile"),
  presetNameInput: document.querySelector("#presetNameInput"),
  createPresetButton: document.querySelector("#createPresetButton"),
  presetSelect: document.querySelector("#presetSelect"),
  presetStatusLabel: document.querySelector("#presetStatusLabel"),
  saveQueuePresetButton: document.querySelector("#saveQueuePresetButton"),
  loadPresetQueueButton: document.querySelector("#loadPresetQueueButton"),
  deletePresetButton: document.querySelector("#deletePresetButton"),
  presetList: document.querySelector("#presetList"),
  howItWorksTitle: document.querySelector("#howItWorksTitle"),
  howItWorksDesc: document.querySelector("#howItWorksDesc"),
  downloadLeagueSkinsButton: document.querySelector("#downloadLeagueSkinsButton"),
  downloadEngineButton: document.querySelector("#downloadEngineButton"),
  downloadLeagueSkinsButtonDownload: document.querySelector("#downloadLeagueSkinsButtonDownload"),
  dllSourceSelect: document.querySelector("#dllSourceSelect"),
  settingsDllSourceSelect: document.querySelector("#settingsDllSourceSelect"),
  openEngineFolderButton: document.querySelector("#openEngineFolderButton"),
  openDllFolderButton: document.querySelector("#openDllFolderButton"),
  openLeagueSkinsFolderButton: document.querySelector("#openLeagueSkinsFolderButton"),
  downloadProgressLabel: document.querySelector("#downloadProgressLabel"),
  downloadEnginePathLabel: document.querySelector("#downloadEnginePathLabel"),
  downloadLeaguePathLabel: document.querySelector("#downloadLeaguePathLabel"),
  downloadSkinLibraryLabel: document.querySelector("#downloadSkinLibraryLabel"),
  firstDllModal: document.querySelector("#firstDllModal"),
  firstDllPathLabel: document.querySelector("#firstDllPathLabel"),
  firstDllOpenFolderButton: document.querySelector("#firstDllOpenFolderButton"),
  firstDllDoneButton: document.querySelector("#firstDllDoneButton"),
  firstDllLaterButton: document.querySelector("#firstDllLaterButton"),
  selectSkinLibraryButton: document.querySelector("#selectSkinLibraryButton"),
  addCustomModFilesButton: document.querySelector("#addCustomModFilesButton"),
  addCustomModFolderButton: document.querySelector("#addCustomModFolderButton"),
  customModsLabel: document.querySelector("#customModsLabel"),
  customModsList: document.querySelector("#customModsList"),
  skinsP2PSection: document.querySelector("#skinsP2PSection"),
  skinsP2PLabel: document.querySelector("#skinsP2PLabel"),
  skinsP2PList: document.querySelector("#skinsP2PList"),
  skinsP2PSyncButton: document.querySelector("#skinsP2PSyncButton"),
  skinsP2PApplyButton: document.querySelector("#skinsP2PApplyButton"),
  skinLibraryLabel: document.querySelector("#skinLibraryLabel"),
  skinSearchInput: document.querySelector("#skinSearchInput"),
  skinChampionSelect: document.querySelector("#skinChampionSelect"),
  skinTypeSelect: document.querySelector("#skinTypeSelect"),
  skinStateSelect: document.querySelector("#skinStateSelect"),
  skinLibraryList: document.querySelector("#skinLibraryList"),
  skinProfilePanel: document.querySelector("#skinProfilePanel"),
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
  bottomApplyButton: document.querySelector("#bottomApplyButton")
};

const template = document.querySelector("#championCardTemplate");
const CDN = "https://ddragon.leagueoflegends.com";
const SKIN_PAGE_SIZE = 15;
const skinArtFallbackCache = new Map();
const QUEUES = {
  400: "Normal Draft",
  420: "Ranked Solo/Duo",
  430: "Normal Blind",
  440: "Ranked Flex",
  450: "ARAM",
  700: "Clash",
  900: "ARURF",
  1020: "One for All",
  1700: "Arena",
  1900: "Pick URF"
};
const ROLE_LABELS = {
  top: "Top",
  jungle: "Jungla",
  middle: "Mid",
  bottom: "ADC",
  support: "Support"
};
const POSITION_LABELS = {
  TOP: "Top",
  JUNGLE: "Jungla",
  MIDDLE: "Mid",
  BOTTOM: "ADC",
  UTILITY: "Support"
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const cleanText = (value = "") =>
  value
    .replace(/<[^>]+>/g, "")
    .replace(/{{.*?}}/g, "")
    .replace(/\s+/g, " ")
    .trim();

const fetchJsonWithTimeout = async (url, timeoutMs = 20000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const getChampionByNumericId = (championId) => state.champions.find((champion) => Number(champion.key) === Number(championId));

const getChampionSquare = (championId, fallbackName) => {
  const champion = getChampionByNumericId(championId);
  const image = champion?.image?.full || `${fallbackName}.png`;
  return `${CDN}/cdn/${state.version}/img/champion/${image}`;
};

const formatDuration = (seconds = 0) => {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
};

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

const getItemImage = (itemId) => `${CDN}/cdn/${state.version}/img/item/${itemId}.png`;

const getChampionIconByKey = (championKey, fallbackName) => {
  const champion = getChampionByNumericId(championKey) || getChampionByDatasetName(fallbackName);
  return champion ? `${CDN}/cdn/${state.version}/img/champion/${champion.image.full}` : "";
};

const getSkinChampionId = (skin) => {
  if (skin.championKey && !/^\d+$/.test(String(skin.championKey))) return skin.championKey;
  return getChampionByNumericId(skin.rawChampion)?.id || getChampionByDatasetName(skin.champion)?.id || "";
};

const getSkinLoadingImage = (skin) => {
  if (skin.imageUrl) return skin.imageUrl;
  const championId = getSkinChampionId(skin);
  if (!championId) return "";
  const artNum = skin.imageSkinNum ?? skin.skinNum;
  if (artNum === null || artNum === undefined || artNum === "") return "";
  const skinNum = Number(artNum);
  if (!Number.isFinite(skinNum)) return "";
  return `${CDN}/cdn/img/champion/loading/${championId}_${skinNum}.jpg`;
};

const getSkinBaseLoadingImage = (skin) => {
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
  renderSkinLibrary();
};

const saveQueuedSkins = () => {
  localStorage.setItem("riftAtlas:queuedSkins", JSON.stringify([...state.queuedSkins]));
  // Update only the queue counters and status, not the entire library
  if (els.queuedSkinsCount) els.queuedSkinsCount.textContent = `${state.queuedSkins.size} seleccionadas`;
  if (els.clearQueueButton) {
    const hasActiveP2P = [...state.queuedSkins].some(isActivePartyP2PPath);
    els.clearQueueButton.textContent = hasActiveP2P ? "Limpiar no P2P" : "Limpiar todo";
    els.clearQueueButton.disabled = (state.queuedSkins.size === 0 && state.managedSkins.size === 0) || state.importingQueue;
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
  renderPresets();
  renderCompactLauncher();
  renderSelectionTray();
  schedulePartySync();
};

const saveCustomMods = () => {
  localStorage.setItem("riftAtlas:customMods", JSON.stringify(state.customMods));
  renderCustomMods();
  renderSelectionTray();
  renderPresets();
  renderCompactLauncher();
};

const saveFavoriteSkins = () => {
  localStorage.setItem("riftAtlas:favoriteSkins", JSON.stringify([...state.favoriteSkins]));
  renderSkinLibrary();
};

const saveOverlayHistory = () => {
  localStorage.setItem("riftAtlas:overlayHistory", JSON.stringify(state.overlayHistory.slice(0, 12)));
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

const setSkinLibrary = (result) => {
  if (!result) return;
  state.skinLibrary = result.skins || [];
  state.skinChampion = "all";
  resetSkinView({ clearProfile: true });
  state.skinLibraryPath = result.folderPath || "";
  if (state.skinLibraryPath) {
    localStorage.setItem("riftAtlas:skinLibraryPath", state.skinLibraryPath);
  }
  els.skinLibraryLabel.textContent = `${state.skinLibraryPath} - ${state.skinLibrary.length} skin/package(s)`;
  if (els.downloadSkinLibraryLabel) els.downloadSkinLibraryLabel.textContent = state.skinLibraryPath || "No configurado";
  renderSkinChampionOptions();
  renderSkinLibrary();
};

const clearSkinSelection = () => {
  state.queuedSkins.clear();
  state.managedSkins.clear();
  localStorage.setItem("riftAtlas:managedSkins", JSON.stringify([]));
  saveQueuedSkins();
};

const savePresets = () => {
  localStorage.setItem("riftAtlas:presets", JSON.stringify(state.presets));
  localStorage.setItem("riftAtlas:activePresetId", state.activePresetId || "");
  renderPresets();
  renderCompactLauncher();
};

const sanitizeImportName = (value = "") =>
  String(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Imported Mod";

const getSkinDisplayName = (skin) => `${skin.champion} - ${skin.skin}${skin.variant ? ` - ${skin.variant}` : ""}`;

const getSkinImportName = (skin) => sanitizeImportName(getSkinDisplayName(skin));

const getSkinByKey = (key) =>
  state.skinLibrary.find((skin) => getSkinKey(skin) === key) ||
  state.customMods.find((mod) => getSkinKey(mod) === key);

const getActivePreset = () => state.presets.find((preset) => preset.id === state.activePresetId);

const renderSelectedMiniCard = (skin) => {
  const art = getSkinLoadingImage(skin);
  const icon = art || getChampionIconByKey(skin.rawChampion, skin.champion);
  return `
    <button class="selected-mini-card" type="button" data-path="${escapeHtml(getSkinKey(skin))}">
      ${icon ? `<img src="${icon}" alt="${escapeHtml(skin.champion)}" />` : `<span>${escapeHtml(skin.extension.replace(".", ""))}</span>`}
      <strong>${escapeHtml(skin.skin)}</strong>
      <small>${escapeHtml(skin.champion)}</small>
    </button>
  `;
};

const normalizeCustomMod = (item) => ({
  ...item,
  champion: item.champion || "Mod propio",
  skin: item.skin || item.name || "Mod local",
  variant: item.variant || item.relativePath || "",
  custom: true
});

const addCustomMods = (items = []) => {
  const nextByPath = new Map(state.customMods.map((item) => [item.path, item]));
  items.map(normalizeCustomMod).forEach((item) => {
    if (item.path) nextByPath.set(item.path, item);
  });
  state.customMods = [...nextByPath.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
  saveCustomMods();
};

const renderCustomMods = () => {
  if (!els.customModsList) return;
  const selectedCount = state.customMods.filter((item) => state.queuedSkins.has(getSkinKey(item))).length;
  if (els.customModsLabel) {
    els.customModsLabel.textContent = state.customMods.length
      ? `${state.customMods.length} mod(s) propios cargados. ${selectedCount} seleccionados.`
      : "Agrega .fantome, .zip, .rse, .wad o .wad.client tuyos. Sirve para skins, fonts, mapas y otros mods locales.";
  }

  if (!state.customMods.length) {
    els.customModsList.innerHTML = `
      <div class="empty-state compact">
        <h2>Sin mods propios</h2>
        <p>Agrega paquetes locales que no formen parte de LeagueSkins.</p>
      </div>
    `;
    return;
  }

  els.customModsList.innerHTML = state.customMods
    .map((item) => {
      const key = getSkinKey(item);
      const queued = state.queuedSkins.has(key);
      return `
        <article class="custom-mod-row ${queued ? "queued" : ""}" data-path="${escapeHtml(key)}">
          <span class="mod-extension">${escapeHtml(item.extension.replace(".", ""))}</span>
          <div>
            <strong>${escapeHtml(item.name || item.skin)}</strong>
            <small>${escapeHtml(item.relativePath || item.path)}</small>
          </div>
          <span>${formatBytes(item.size)}</span>
          <button class="${queued ? "secondary-button" : "docs-link"} custom-mod-queue" type="button" data-path="${escapeHtml(key)}">${queued ? "Quitar" : "Seleccionar"}</button>
          <button class="secondary-button custom-mod-reveal" type="button" data-path="${escapeHtml(item.path)}">Abrir</button>
          <button class="secondary-button custom-mod-remove" type="button" data-path="${escapeHtml(key)}">Eliminar</button>
        </article>
      `;
    })
    .join("");

  els.customModsList.querySelectorAll(".custom-mod-queue").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.queuedSkins.has(button.dataset.path)) {
        state.queuedSkins.delete(button.dataset.path);
      } else {
        state.queuedSkins.add(button.dataset.path);
      }
      saveQueuedSkins();
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
    button.addEventListener("click", () => window.riftAtlas.revealModPath(button.dataset.path));
  });

  els.customModsList.querySelectorAll(".custom-mod-remove").forEach((button) => {
    button.addEventListener("click", () => {
      state.customMods = state.customMods.filter((item) => getSkinKey(item) !== button.dataset.path);
      state.queuedSkins.delete(button.dataset.path);
      saveCustomMods();
      saveQueuedSkins();
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
  const art = getSkinLoadingImage(skin);
  const fallbackArt = getSkinBaseLoadingImage(skin);
  els.skinProfilePanel.innerHTML = `
    <article class="skin-profile-card">
      <div class="skin-profile-art ${art ? "" : "missing-art"}">
        ${art ? `<img src="${art}" data-fallback="${escapeHtml(fallbackArt)}" alt="${escapeHtml(getSkinDisplayName(skin))}" />` : ""}
        <span>${escapeHtml(skin.extension?.replace(".", "") || "MOD")}</span>
      </div>
      <div class="skin-profile-copy">
        <span>${escapeHtml(skin.custom ? "Mod propio" : "LeagueSkins")}</span>
        <h3>${escapeHtml(skin.skin || skin.name)}</h3>
        <p>${escapeHtml(skin.champion || "Mod propio")}</p>
        <dl>
          <div><dt>Tipo</dt><dd>${escapeHtml(skin.extension || "-")}</dd></div>
          <div><dt>Tamano</dt><dd>${formatBytes(skin.size)}</dd></div>
          <div><dt>Ruta</dt><dd title="${escapeHtml(skin.path)}">${escapeHtml(skin.relativePath || skin.path)}</dd></div>
        </dl>
      </div>
      <div class="skin-profile-actions">
        <button class="${queued ? "secondary-button" : "docs-link"} profile-queue" type="button">${queued ? "Quitar" : "Seleccionar"}</button>
        <button class="secondary-button profile-favorite" type="button">${favorite ? "Quitar favorita" : "Favorita"}</button>
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
    if (state.queuedSkins.has(key)) state.queuedSkins.delete(key);
    else state.queuedSkins.add(key);
    saveQueuedSkins();
  });
  els.skinProfilePanel.querySelector(".profile-favorite")?.addEventListener("click", () => {
    if (state.favoriteSkins.has(key)) state.favoriteSkins.delete(key);
    else state.favoriteSkins.add(key);
    saveFavoriteSkins();
    renderSkinProfile();
  });
  els.skinProfilePanel.querySelector(".profile-reveal")?.addEventListener("click", () => window.riftAtlas.revealModPath(skin.path));
};

const getSelectionName = (items = []) => {
  if (!items.length) return "Seleccion vacia";
  const first = items[0];
  if (items.length === 1) return first.skin || first.name || "1 mod";
  return `${first.skin || first.name || "Mod"} + ${items.length - 1} mas`;
};

let partyPeer = null;
let partyConnections = new Map();
let partyIsHost = false;
let partyTransferSeq = 0;
const PARTY_CHUNK_SIZE = 64 * 1024;
const PARTY_CHUNK_ACK_TIMEOUT_MS = 15000;
const partyIncomingTransfers = new Map();
const partyRequestedHashes = new Set();
const partyChunkAckWaiters = new Map();
const partyFileInfoCache = new Map();
const partyTransferStatus = new Map();
let partyAutoApplyTriggered = false;
let partySyncTimer = null;

const getPartyDisplayName = () => els.partyNameInput?.value.trim() || localStorage.getItem("riftAtlas:partyName") || "Rift Atlas";

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

const getPartySkinFiles = () =>
  [...state.queuedSkins]
    .map(getSkinByKey)
    .filter(Boolean)
    .map((skin) => ({
      key: getSkinKey(skin),
      name: skin.skin || skin.name || "Mod",
      champion: skin.champion || "Mod propio",
      fileName: String(skin.relativePath || skin.path || skin.name || "archivo").split(/[\\/]/).pop(),
      size: skin.size || 0,
      source: skin.custom ? "Mod propio" : "LeagueSkins",
      localPath: skin.path || "",
      extension: skin.extension || "",
      mtimeMs: skin.mtimeMs || 0
    }));

const getPartySkinFilesWithInfo = async () =>
  Promise.all(getPartySkinFiles().map(async (skin) => {
    try {
      const cacheKey = `${skin.localPath}|${skin.size || 0}|${skin.mtimeMs || 0}`;
      const cached = partyFileInfoCache.get(cacheKey);
      if (cached) {
        return { ...skin, fileName: cached.fileName, size: cached.size, hash: cached.hash, mimeType: cached.mimeType };
      }
      const info = await window.riftAtlas.getPartyFileInfo(skin.localPath);
      partyFileInfoCache.set(cacheKey, info);
      return { ...skin, fileName: info.fileName, size: info.size, hash: info.hash, mimeType: info.mimeType };
    } catch {
      return skin;
    }
  }));

const getPartyTransferKey = (skin = {}, fallback = "") => skin.hash || skin.key || skin.fileName || fallback;

const getLocalPartyFile = (remoteSkin = {}) =>
  [...state.customMods, ...state.skinLibrary].find((skin) => {
    const sameHash = remoteSkin.hash && skin.partyHash === remoteSkin.hash;
    const sameName = !remoteSkin.hash && remoteSkin.fileName && String(skin.path || "").endsWith(remoteSkin.fileName);
    const sameKey = remoteSkin.key && getSkinKey(skin) === remoteSkin.key;
    return sameHash || sameName || sameKey;
  });

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
  return {
    ready: activeTransfers.length === 0,
    pending: activeTransfers.length,
    label: activeTransfers.length ? `${activeTransfers.length} transferencia(s) pendientes` : "Listo"
  };
};

const getLocalPartyMember = () => ({
  id: partyPeer?.id || "local",
  name: getPartyDisplayName(),
  activeSkins: getPartySkinFiles(),
  isHost: partyIsHost,
  connected: Boolean(partyPeer),
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
  if (!partyPeer || state.partyStatus !== "connected") return;
  const readyState = getLocalPartyReadyState();
  updatePartyMemberReady(partyPeer.id, readyState);
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

const getAllPartyFiles = () =>
  getAllPartyMembers().flatMap((member) =>
    (member.activeSkins || []).map((file) => ({ ...file, ownerId: member.id, ownerName: member.name || "Jugador" }))
  );

const findPartyFileByKey = (key = "") =>
  getAllPartyFiles().find((file) => getPartyTransferKey(file) === key || file.key === key || file.fileName === key);

const sendPartyFile = async (connection, transferId, skin = {}) => {
  const transferKey = getPartyTransferKey(skin, transferId);
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
      progress: 0
    });
    connection.send({ type: "file-accept", id: transferId, metadata: info, skin });
    const totalChunks = Math.ceil(info.size / PARTY_CHUNK_SIZE);
    for (let sequence = 0; sequence < totalChunks; sequence += 1) {
      const data = await window.riftAtlas.readPartyFileChunk({
        filePath: localPath,
        offset: sequence * PARTY_CHUNK_SIZE,
        length: PARTY_CHUNK_SIZE
      });
      connection.send({ type: "file-chunk", id: transferId, sequence, totalChunks, data });
      setPartyTransferStatus(transferKey, {
        status: "enviando",
        progress: Math.round(((sequence + 1) / Math.max(totalChunks, 1)) * 100)
      });
      await waitForPartyChunkAck(transferId, sequence);
    }
    connection.send({ type: "file-complete", id: transferId });
    setPartyTransferStatus(transferKey, { status: "enviado", progress: 100 });
  } catch (error) {
    connection.send({ type: "file-error", id: transferId, error: error.message, skin });
    setPartyTransferStatus(transferKey, { status: "error", error: error.message });
  }
};

const requestPartyFile = (peerId, skin = {}) => {
  if (!skin.hash || hasLocalPartyFile(skin)) return;
  const transferKey = getPartyTransferKey(skin);
  const current = partyTransferStatus.get(transferKey);
  if (["solicitando", "recibiendo", "descargando"].includes(current?.status)) return;
  const connection = partyConnections.get(peerId) ||
    [...partyConnections.values()].find((candidate) => candidate.open);
  if (!connection?.open) return;
  partyRequestedHashes.add(skin.hash);
  connection.send({
    type: "file-request",
    id: `transfer-${Date.now()}-${partyTransferSeq += 1}`,
    skin
  });
  setPartyTransferStatus(transferKey, {
    fileName: skin.fileName || skin.name,
    champion: skin.champion || "",
    owner: skin.ownerName || peerId,
    status: "solicitando",
    progress: 0
  });
  if (els.partyConnectionLabel) {
    els.partyConnectionLabel.textContent = `conectado, descargando P2P: ${skin.fileName || skin.name}`;
  }
};

const waitForPartyChunkAck = (transferId, sequence) => {
  const key = `${transferId}:${sequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      partyChunkAckWaiters.delete(key);
      reject(new Error(`Timeout esperando ACK del chunk ${sequence + 1}`));
    }, PARTY_CHUNK_ACK_TIMEOUT_MS);
    partyChunkAckWaiters.set(key, {
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
  skins.forEach((skin) => requestPartyFile(peerId, skin));
};

const requestMissingRoomFiles = () => {
  if (!state.partyRoom || !partyPeer) return;
  getAllPartyMembers()
    .filter((member) => member.id !== partyPeer.id)
    .forEach((member) => requestMissingPartyFiles(member.id, member.activeSkins || []));
};

const handlePartyFileMessage = async (peerId, message = {}) => {
  const connection = partyConnections.get(peerId);
  if (!connection) return true;
  if (message.type === "file-request") {
    await sendPartyFile(connection, message.id, message.skin);
    return true;
  }
  if (message.type === "file-accept") {
    const transferKey = getPartyTransferKey(message.skin, message.metadata?.hash || message.id);
    partyIncomingTransfers.set(message.id, {
      metadata: message.metadata,
      skin: message.skin,
      key: transferKey,
      chunks: new Map(),
      totalChunks: Math.ceil((message.metadata?.size || 0) / PARTY_CHUNK_SIZE)
    });
    setPartyTransferStatus(transferKey, {
      fileName: message.metadata?.fileName || message.skin?.fileName || message.skin?.name,
      champion: message.skin?.champion || "",
      owner: message.skin?.ownerName || peerId,
      status: "recibiendo",
      progress: 0
    });
    return true;
  }
  if (message.type === "file-chunk") {
    const transfer = partyIncomingTransfers.get(message.id);
    if (!transfer) return true;
    transfer.chunks.set(message.sequence, message.data);
    connection.send({ type: "file-ack", id: message.id, sequence: message.sequence });
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
    const waiterKey = `${message.id}:${message.sequence}`;
    const waiter = partyChunkAckWaiters.get(waiterKey);
    if (waiter) {
      partyChunkAckWaiters.delete(waiterKey);
      waiter.resolve();
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
      state.queuedSkins.add(mod.path);
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
    setPartyTransferStatus(transfer?.key || message.id, { status: "error", error: message.error });
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
  const allReady = connected && members.length > 0 && readyMembers === members.length && localReady.ready;
  return { connected, members, localReady, readyMembers, allReady };
};

const maybeAutoApplyParty = () => {
  const readiness = getPartyReadiness();
  if (!state.partyAutoApply || partyAutoApplyTriggered || !readiness.allReady || state.importingQueue || state.queuedSkins.size === 0) return;
  partyAutoApplyTriggered = true;
  applyQueuedSkins();
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
  const selectableKey = localFile?.path || selected.key || "";
  const canSelect = Boolean(localFile || selected.ownerId === partyPeer?.id);
  const isSelected = Boolean(selectableKey && state.queuedSkins.has(selectableKey));
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
    <button class="docs-link party-profile-toggle" type="button" data-key="${escapeHtml(selectableKey)}" ${canSelect && selectableKey ? "" : "disabled"}>${isSelected ? "Quitar de seleccion" : "Seleccionar"}</button>
    <button class="secondary-button party-profile-open" type="button" ${localFile?.path ? "" : "disabled"}>Abrir archivo</button>
  `;
  els.partyFileProfile.querySelector(".party-profile-toggle")?.addEventListener("click", () => {
    const key = selectableKey;
    if (!key) return;
    if (state.queuedSkins.has(key)) {
      state.queuedSkins.delete(key);
    } else {
      state.queuedSkins.add(key);
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
  if (els.skinsP2PApplyButton) {
    const readiness = getPartyReadiness();
    els.skinsP2PApplyButton.disabled = !readiness.allReady || state.importingQueue || state.queuedSkins.size === 0;
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
          <button class="secondary-button skins-p2p-request" type="button" data-key="${escapeHtml(key)}" ${localFile ? "disabled" : ""}>Pedir</button>
          <button class="docs-link skins-p2p-select" type="button" data-path="${escapeHtml(selectableKey)}" disabled>${localFile ? "Seleccionado" : "Esperando"}</button>
        </article>
      `;
    })
    .join("");

  els.skinsP2PList.querySelectorAll(".skins-p2p-request").forEach((button) => {
    button.addEventListener("click", () => {
      const file = findPartyFileByKey(button.dataset.key);
      if (!file) return;
      requestPartyFile(file.ownerId, file);
      renderParty();
    });
  });
};

const renderParty = () => {
  if (!els.partyStatusPill) return;
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
    els.partyFilesLabel.textContent = `archivos p2p: ${files.length ? files.map((file) => file.fileName || file.name).join(", ") : "ninguno"}`;
  }
  if (els.partyReadySummary) {
    els.partyReadySummary.textContent = connected ? (allReady ? "Todos listos" : localReady.label) : "Desconectado";
  }
  if (els.partyReadyDetails) {
    els.partyReadyDetails.textContent = connected
      ? `${readyMembers}/${members.length} miembro(s) listos. ${state.partyAutoApply ? "Auto-ejecutar esta activado." : "Auto-ejecutar apagado."}`
      : "Crea o entra a una party para sincronizar archivos.";
  }
  if (els.partyShareLinkLabel) {
    els.partyShareLinkLabel.textContent = state.partyLink || "Crea una party para generar un link.";
  }
  if (els.createPartyButton) els.createPartyButton.disabled = connected;
  if (els.joinPartyButton) els.joinPartyButton.disabled = connected;
  if (els.leavePartyButton) els.leavePartyButton.disabled = !connected;
  if (els.copyPartyLinkButton) els.copyPartyLinkButton.disabled = !state.partyLink;
  if (els.applyPartyButton) els.applyPartyButton.disabled = !allReady || state.importingQueue || state.queuedSkins.size === 0;
  if (els.partyAutoApplyCheckbox) els.partyAutoApplyCheckbox.checked = state.partyAutoApply;
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
          </div>
        `).join("")
      : "";
  }
  renderPartyFileProfile();
  renderSkinsP2PSection();
  maybeAutoApplyParty();
  if (!els.partyMembersList) return;
  if (!members.length) {
    els.partyMembersList.innerHTML = `
      <div class="empty-state compact">
        <h2>Sin party</h2>
        <p>Crea una sala o entra con un codigo para ver archivos P2P.</p>
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
    requestMissingRoomFiles();
    sendPartyReadyUpdate();
    renderParty();
    return;
  }
  if (message.type === "skins-update") {
    partyAutoApplyTriggered = false;
    updatePartyMemberSkins(peerId, message.data || []);
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
    partyConnections.delete(connection.peer);
    if (partyIsHost && state.partyRoom) {
      state.partyRoom = {
        ...state.partyRoom,
        members: state.partyRoom.members.filter((member) => member.id !== connection.peer)
      };
      broadcastPartyRoom();
    }
    sendPartyReadyUpdate();
    renderParty();
  });
  connection.on("error", () => renderParty());
};

const syncPartySkins = async () => {
  if (!partyPeer || state.partyStatus !== "connected") return;
  partyAutoApplyTriggered = false;
  const skins = await getPartySkinFilesWithInfo();
  if (state.partyRoom) {
    updatePartyMemberSkins(partyPeer.id, skins);
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
  renderParty();
};

const clearLocalP2PState = async () => {
  const p2pPaths = new Set(
    state.customMods
      .filter((mod) => mod.source === "p2p")
      .map((mod) => mod.path)
      .filter(Boolean)
  );
  if (p2pPaths.size) {
    state.customMods = state.customMods.filter((mod) => mod.source !== "p2p");
    p2pPaths.forEach((modPath) => state.queuedSkins.delete(modPath));
    saveCustomMods();
    saveQueuedSkins();
  }
  await window.riftAtlas.clearPartyP2PFiles?.().catch(() => null);
};

const leaveParty = async () => {
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
  state.partyLink = "";
  state.partyStatus = "disconnected";
  state.selectedPartyFile = null;
  partyTransferStatus.clear();
  partyIncomingTransfers.clear();
  partyRequestedHashes.clear();
  partyChunkAckWaiters.forEach((waiter) => waiter.reject(new Error("Party cerrada.")));
  partyChunkAckWaiters.clear();
  partyAutoApplyTriggered = false;
  await clearLocalP2PState();
  renderParty();
};

const createParty = async () => {
  if (!window.Peer) {
    throw new Error("PeerJS no esta cargado.");
  }
  await leaveParty();
  const roomId = generatePartyRoomId();
  const displayName = getPartyDisplayName();
  localStorage.setItem("riftAtlas:partyName", displayName);
  partyIsHost = true;
  state.partyStatus = "connecting";
  renderParty();
  partyPeer = new window.Peer(roomId, { debug: 1 });
  partyPeer.on("open", (id) => {
    state.partyRoom = {
      id,
      createdAt: new Date().toISOString(),
      host: { ...getLocalPartyMember(), id, isHost: true, connected: true },
      members: []
    };
    state.partyLink = `rift-atlas-party:${id}`;
    state.partyStatus = "connected";
    renderParty();
    syncPartySkins();
    sendPartyReadyUpdate();
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
      broadcastPartyRoom();
      renderParty();
    });
  });
  partyPeer.on("error", (error) => {
    state.partyStatus = "disconnected";
    if (els.partyConnectionLabel) els.partyConnectionLabel.textContent = `Error party: ${error.message || error}`;
    renderParty();
  });
};

const joinParty = async () => {
  if (!window.Peer) {
    throw new Error("PeerJS no esta cargado.");
  }
  const roomId = normalizePartyCode(els.partyLinkInput?.value);
  if (!roomId) throw new Error("Pega un link o codigo de party.");
  await leaveParty();
  const displayName = getPartyDisplayName();
  localStorage.setItem("riftAtlas:partyName", displayName);
  partyIsHost = false;
  state.partyStatus = "connecting";
  state.partyLink = `rift-atlas-party:${roomId}`;
  renderParty();
  const peerId = `${roomId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  partyPeer = new window.Peer(peerId, { debug: 1 });
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
    });
  });
  partyPeer.on("connection", attachPartyConnection);
  partyPeer.on("error", (error) => {
    state.partyStatus = "disconnected";
    if (els.partyConnectionLabel) els.partyConnectionLabel.textContent = `Error party: ${error.message || error}`;
    renderParty();
  });
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
      state.queuedSkins = new Set(entry.skinKeys);
      saveQueuedSkins();
      els.importStatusLabel.textContent = `Historial "${entry.name}" cargado.`;
    });
  });
};

const renderCompactLauncher = () => {
  if (!els.compactPresetSelect) return;
  const selectedCount = state.queuedSkins.size;
  els.compactPresetSelect.innerHTML =
    '<option value="">Cola actual</option>' +
    state.presets.map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)} (${preset.skinKeys.length})</option>`).join("");
  if (els.compactStatusLabel) {
    els.compactStatusLabel.textContent = `${selectedCount} mod(s) en cola${state.activePresetId ? " - preset activo disponible" : ""}.`;
  }
  if (els.compactOverlayPill) {
    els.compactOverlayPill.textContent = state.overlayRunning ? "Overlay activo" : "Sin overlay";
    els.compactOverlayPill.classList.toggle("active", state.overlayRunning);
  }
  if (els.compactRunButton) {
    els.compactRunButton.disabled = selectedCount === 0 || state.importingQueue || state.overlayRunning;
  }
};

const renderSelectionTray = () => {
  if (!els.selectionTraySummary || !els.selectionTrayList) return;
  const queuedKeys = [...state.queuedSkins];
  const selected = queuedKeys.map(getSkinByKey).filter(Boolean);
  const selectedCount = queuedKeys.length;
  const activeP2PCount = queuedKeys.filter(isActivePartyP2PPath).length;
  const hasMissingSkins = selectedCount > selected.length;
  const hasAnythingToClear = selectedCount > 0 || state.managedSkins.size > 0;
  els.selectionTraySummary.textContent = selectedCount
    ? `${selectedCount} skin(s) listas para aplicar.`
    : "No hay skins seleccionadas.";
  document.querySelectorAll(".selection-action-bar").forEach((bar) => {
    bar.classList.toggle("has-selection", selectedCount > 0);
    bar.querySelector(".selection-selected-count").textContent = `${selectedCount} skin${selectedCount === 1 ? "" : "s"} seleccionada${selectedCount === 1 ? "" : "s"}`;
    bar.querySelector(".selection-selected-hint").textContent = selectedCount
      ? hasMissingSkins
        ? "Algunas skins no se cargaron en la biblioteca."
        : activeP2PCount
          ? "Las skins P2P locales se pueden quitar de la cola manualmente."
          : "Toca una miniatura para quitarla de la cola."
      : "No hay skins en cola. Agregalas desde Skins o Party.";

    const applyButton = bar.querySelector(".selection-apply-button");
    const clearButton = bar.querySelector(".selection-clear-button");
    const saveButton = bar.querySelector(".selection-save-button");
    const stopButton = bar.querySelector(".selection-stop-button");
    const miniList = bar.querySelector(".selection-mini-list");

    applyButton.textContent = selectedCount
      ? state.overlayRunning
        ? "Overlay activo"
        : `Ejecutar ${selectedCount}`
      : "Sin skins";
    applyButton.disabled = selectedCount === 0 || state.importingQueue || state.overlayRunning;
    applyButton.title = state.overlayRunning ? "Deten el overlay antes de ejecutar otra vez." : "";
    clearButton.textContent = activeP2PCount ? "Limpiar no P2P" : "Limpiar todo";
    clearButton.disabled = !hasAnythingToClear || state.importingQueue;
    saveButton.disabled = selectedCount === 0 || state.importingQueue;
    stopButton.disabled = state.importingQueue;

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
        state.queuedSkins.delete(button.dataset.path);
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
      const name = skin ? skin.skin : key.split(/[/\\]/).pop() || "Skin en cola";
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
      state.queuedSkins.delete(button.dataset.path);
      saveQueuedSkins();
    });
  });
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
        <article class="preset-row ${preset.id === state.activePresetId ? "active" : ""}" data-id="${escapeHtml(preset.id)}">
          <div>
            <strong>${escapeHtml(preset.name)}</strong>
            <small>${preset.skinKeys.length} skin(s)${missing ? ` - ${missing} no cargadas ahora` : ""}</small>
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
    });
  });
};

const setLtkOverlaySidecarPath = (p) => {
  const value = p && /(^|[\\/])ltk-manager\.exe$/i.test(p) && !/ltk manager/i.test(p) ? p : "";
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

const loadLtkOverlayPaths = () => {
  setLtkOverlaySidecarPath(state.ltkOverlaySidecarPath);
  setLtkOverlayDllPath(state.ltkOverlayDllPath);
  if (els.downloadLeaguePathLabel) els.downloadLeaguePathLabel.textContent = state.leagueGamePath || "No configurado";
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

  if (els.downloadCslolButton) {
    els.downloadCslolButton.disabled = busy;
    els.downloadCslolButton.textContent = engineBusy ? "Descargando..." : "Descargar engine";
  }
  if (els.downloadEngineButton) {
    els.downloadEngineButton.disabled = busy;
    els.downloadEngineButton.textContent = engineBusy ? "Descargando..." : "Descargar engine + DLL";
  }
  if (els.downloadLeagueSkinsButton) {
    els.downloadLeagueSkinsButton.disabled = busy;
    els.downloadLeagueSkinsButton.textContent = leagueSkinsBusy ? "Descargando..." : "Descargar LeagueSkins";
  }
  if (els.downloadLeagueSkinsButtonDownload) {
    els.downloadLeagueSkinsButtonDownload.disabled = busy;
    els.downloadLeagueSkinsButtonDownload.textContent = leagueSkinsBusy ? "Descargando..." : "Descargar LeagueSkins";
  }
  if (els.dllSourceSelect) els.dllSourceSelect.disabled = busy;
  if (els.settingsDllSourceSelect) els.settingsDllSourceSelect.disabled = busy;
};

const normalizeDllDownloadSource = (source) => {
  if (source === "bundled" || source === "ltk") return source;
  return "cslol";
};

const setDllDownloadSource = (source) => {
  state.dllDownloadSource = normalizeDllDownloadSource(source);
  localStorage.setItem("riftAtlas:dllDownloadSource", state.dllDownloadSource);
  if (els.dllSourceSelect) els.dllSourceSelect.value = state.dllDownloadSource;
  if (els.settingsDllSourceSelect) els.settingsDllSourceSelect.value = state.dllDownloadSource;
};

const beginDownload = (type) => {
  if (state.activeDownloadType) {
    const label = state.activeDownloadType === "engine" ? "engine" : "LeagueSkins";
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
  if (!els.appDataPathLabel || !window.riftAtlas.getUserDataPath) return;
  try {
    els.appDataPathLabel.textContent = await window.riftAtlas.getUserDataPath();
  } catch (error) {
    els.appDataPathLabel.textContent = error.message || "No disponible";
  }
};

const hideFirstDllModal = ({ remember = true } = {}) => {
  if (els.firstDllModal) els.firstDllModal.hidden = true;
  if (remember) localStorage.setItem("riftAtlas:firstDllNoticeShown", "1");
};

const showFirstDllModal = async (status = null) => {
  if (!els.firstDllModal) return;
  const dllStatus = status || await window.riftAtlas.getEngineDllStatus?.().catch(() => null);
  if (els.firstDllPathLabel) {
    els.firstDllPathLabel.textContent = dllStatus?.dllPath || "AppData\\Roaming\\Rift Atlas\\engine\\cslol-dll.dll";
  }
  els.firstDllModal.hidden = false;
  await window.riftAtlas.openEngineFolder?.().catch(() => null);
};

const checkFirstDllNotice = async () => {
  if (!window.riftAtlas.getEngineDllStatus || localStorage.getItem("riftAtlas:firstDllNoticeShown") === "1") return;
  const status = await window.riftAtlas.getEngineDllStatus().catch(() => null);
  if (!status || status.exists) return;
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
    els.updateDetailsLabel.textContent = `Actual: ${result.currentVersion}. ${result.assetName ? `Descarga: ${result.assetName}.` : "Abre el release para descargar."}`;
    setUpdatePanelVisible({ hasUpdate: true });
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
  els.updateStatusLabel.textContent = "Buscando actualizaciones...";
  els.updateDetailsLabel.textContent = "Consultando GitHub Releases...";
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

const downloadCslolTools = async () => {
  if (!beginDownload("engine")) return;
  const dllSource = normalizeDllDownloadSource(state.dllDownloadSource);
  if (els.downloadProgressLabel) {
    const sourceLabel = dllSource === "bundled" ? "DLL incluido" : (dllSource === "ltk" ? "ltk-manager" : "cslol-manager");
    els.downloadProgressLabel.textContent = `Iniciando descarga del engine con DLL desde ${sourceLabel}...`;
  }
  if (els.importStatusLabel) {
    setConfigStatus("Descargando engine...");
  }

  try {
    const result = await window.riftAtlas.downloadCslolTools({ dllSource });
    if (result.enginePath) setLtkOverlaySidecarPath(result.enginePath);
    if (result.dllPath) setLtkOverlayDllPath(result.dllPath);
    if (els.downloadProgressLabel) {
      els.downloadProgressLabel.textContent = result.dllPath
        ? `Engine ${result.version} descargado. ${result.dllInstallMessage || "DLL lista."}`
        : `Engine ${result.version} descargado y configurado. La DLL se extraera al ejecutar.`;
    }
    setConfigStatus(result.dllPath
      ? (result.dllInstallMessage || `Engine ${result.version} listo.`)
      : `Engine ${result.version} listo. La DLL se extraera desde LTK al ejecutar si hace falta.`);
    await autoConfigureOverlay({ silent: true });
  } catch (error) {
    setConfigStatus(`Error descargando engine: ${error.message}`);
  } finally {
    finishDownload();
  }
};

const loadDownloadedLeagueSkins = async () => {
  if (!els.downloadLeagueSkinsButton || state.importingQueue) return;
  if (!beginDownload("league-skins")) return;
  if (els.downloadProgressLabel) {
    els.downloadProgressLabel.textContent = "Iniciando descarga de LeagueSkins...";
  }
  els.skinLibraryLabel.textContent = "Descargando LeagueSkins desde GitHub...";

  try {
    const result = await window.riftAtlas.downloadLeagueSkins();
    setSkinLibrary(result);
    if (els.downloadProgressLabel) {
      els.downloadProgressLabel.textContent = `LeagueSkins descargado e indexado: ${result.skins?.length || 0} paquete(s).`;
    }
    els.importStatusLabel.textContent = `LeagueSkins ${result.branch} descargado e indexado.`;
  } catch (error) {
    els.skinLibraryLabel.textContent = `Error descargando LeagueSkins: ${error.message}`;
    if (els.downloadProgressLabel) {
      els.downloadProgressLabel.textContent = `Error descargando LeagueSkins: ${error.message}`;
    }
  } finally {
    finishDownload();
  }
};

let loadingLocalLeagueSkins = false;

const loadDownloadedLeagueSkinsFromDisk = async ({ silent = false } = {}) => {
  if (loadingLocalLeagueSkins || state.skinLibrary.length || !window.riftAtlas.indexDownloadedLeagueSkins) return false;
  loadingLocalLeagueSkins = true;
  if (!silent) {
    els.skinLibraryLabel.textContent = "Buscando LeagueSkins descargado...";
  }

  try {
    const result = await window.riftAtlas.indexDownloadedLeagueSkins();
    if (!result?.skins?.length) {
      if (!silent) els.skinLibraryLabel.textContent = "LeagueSkins descargado no tiene paquetes compatibles.";
      return false;
    }
    setSkinLibrary(result);
    if (!silent && els.downloadProgressLabel) {
      els.downloadProgressLabel.textContent = `LeagueSkins local cargado: ${result.skins.length} paquete(s).`;
    }
    return true;
  } catch (error) {
    if (!silent) {
      els.skinLibraryLabel.textContent = error.message || "No pude cargar LeagueSkins descargado.";
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
    els.skinLibraryLabel.textContent = "Indexando LeagueSkins guardado...";
    try {
      setSkinLibrary(await window.riftAtlas.indexSkinLibrary(folderPath));
      return;
    } catch {
      // Try the next known LeagueSkins location.
    }
  }

  localStorage.removeItem("riftAtlas:skinLibraryPath");
  state.skinLibraryPath = "";
  els.skinLibraryLabel.textContent = "Selecciona o descarga LeagueSkins para gestionar tu biblioteca.";
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

const renderChampionGrid = () => {
  const champions = getFilteredChampions();
  els.countLabel.textContent = champions.length.toString();
  els.championGrid.replaceChildren(...champions.map(createChampionCard));

  if (champions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No encontre campeones con ese filtro.";
    els.championGrid.replaceChildren(empty);
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
        <button class="tier-row" type="button" data-champion-id="${champion?.id || ""}">
          <span class="tier-rank">${row.rank}</span>
          ${championImage ? `<img src="${championImage}" alt="${escapeHtml(championName)}" />` : ""}
          <span class="tier-name">${escapeHtml(championName)}</span>
          <strong class="tier-badge ${getTierClass(row.tier)}">${row.tier}</strong>
          <span>${row.winrate.toFixed(1)}%</span>
          <span>${row.pickrate.toFixed(1)}%</span>
          <span>${row.banrate.toFixed(1)}%</span>
          <span>${row.games ? row.games.toLocaleString("es-AR") : "-"}</span>
        </button>
      `;
    })
    .join("");

  els.tierGrid.querySelectorAll(".tier-row").forEach((card) => {
    card.addEventListener("click", () => {
      if (card.dataset.championId) {
        setView("champions");
        selectChampion(card.dataset.championId).catch(showError);
      }
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
    <div class="splash" style="background-image: url('${splash}')">
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

const selectChampion = async (id) => {
  state.selectedId = id;
  renderChampionGrid();
  const response = await fetch(`${CDN}/cdn/${state.version}/data/es_AR/champion/${id}.json`);
  if (!response.ok) {
    throw new Error("No se pudo cargar el detalle del campeon.");
  }
  const payload = await response.json();
  renderDetail(payload.data[id]);
};

const setView = (view) => {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".content-view").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${view}View`);
  });
  els.championToolbar.hidden = view !== "champions";
  if (view === "mods" && !state.skinLibrary.length) {
    loadDownloadedLeagueSkinsFromDisk({ silent: true });
  }
};

const closeIntroSidebar = () => {
  els.sidebar?.classList.remove("is-open");
};

const renderPlayerLoading = () => {
  if (!els.playerResults) return;
  els.playerResults.innerHTML = `
    <div class="empty-state">
      <h2>Consultando Riot API</h2>
      <p>Buscando perfil, clasificatorias, partida activa y ultimas partidas.</p>
    </div>
  `;
};

const renderPlayerError = (error) => {
  if (!els.playerResults) return;
  els.playerResults.innerHTML = `
    <div class="empty-state">
      <h2>No pude cargar el jugador</h2>
      <p>${escapeHtml(error.message)}</p>
    </div>
  `;
};

const renderPlayer = (data) => {
  if (!els.playerResults) return;
  const profileIcon = `${CDN}/cdn/${state.version}/img/profileicon/${data.summoner.profileIconId}.png`;
  els.playerResults.innerHTML = renderPlayerHTML(data, profileIcon);
};

const setApiKeyStatus = (hasKey, message = "") => {
  if (!els.apiKeyLabel || !els.apiKeyHint) return;
  els.apiKeyLabel.textContent = hasKey ? "API lista" : "Sin key";
  els.apiKeyLabel.classList.toggle("ready", hasKey);
  els.apiKeyHint.textContent = message || (hasKey ? "API key activa para esta sesion." : "La clave queda solo en memoria hasta cerrar la app. No se guarda en disco.");
};

const renderRanked = (ranked) => {
  if (!ranked.length) {
    return '<div class="rank-card"><strong>Sin clasificatorias</strong><span>No hay entradas ranked para esta region.</span></div>';
  }

  return ranked
    .map(
      (entry) => `
        <div class="rank-card">
          <strong>${escapeHtml(entry.queueType.replaceAll("_", " "))}</strong>
          <span>${escapeHtml(entry.tier)} ${escapeHtml(entry.rank)} - ${entry.leaguePoints} LP</span>
          <span>${entry.wins}V / ${entry.losses}D</span>
        </div>
      `
    )
    .join("");
};

const renderActiveGame = (activeGame) => {
  if (!activeGame) {
    return '<div class="live-card"><strong>No esta en partida</strong><span>Riot no reporta una partida activa ahora mismo.</span></div>';
  }

  return `
    <div class="live-card">
      <strong>${escapeHtml(QUEUES[activeGame.gameQueueConfigId] || activeGame.gameMode || "Partida activa")}</strong>
      <span>${activeGame.participants.length} jugadores - ${formatDuration(activeGame.gameLength)}</span>
    </div>
  `;
};

const renderParticipant = (participant, highlightPuuid = "") => {
  const isHighlight = participant.puuid === highlightPuuid;
  return `
    <div class="team-player ${isHighlight ? "highlight" : ""}">
      <img src="${getChampionSquare(participant.championId, participant.championName)}" alt="${escapeHtml(participant.championName)}" />
      <div>
        <strong>${escapeHtml(participant.riotIdGameName)}${participant.riotIdTagLine ? `#${escapeHtml(participant.riotIdTagLine)}` : ""}</strong>
        <span>${escapeHtml(POSITION_LABELS[participant.teamPosition] || participant.teamPosition)} · ${escapeHtml(participant.championName)} · ${participant.kills}/${participant.deaths}/${participant.assists}</span>
      </div>
    </div>
  `;
};

const renderTeamList = (title, participants, highlightPuuid) => `
  <div class="team-list">
    <h4>${title}</h4>
    ${participants.map((participant) => renderParticipant(participant, highlightPuuid)).join("")}
  </div>
`;

const renderItems = (items = []) => {
  if (!items.length) {
    return '<span class="muted-text">Sin items</span>';
  }
  return items.map((itemId) => `<img src="${getItemImage(itemId)}" alt="Item ${itemId}" title="Item ${itemId}" />`).join("");
};

const renderBuildTimeline = (events = []) => {
  const purchases = events.filter((event) => event.type === "ITEM_PURCHASED").slice(0, 12);
  if (!purchases.length) {
    return '<span class="muted-text">Timeline de build no disponible.</span>';
  }

  return purchases
    .map(
      (event) => `
        <div class="build-event">
          <img src="${getItemImage(event.itemId)}" alt="Item ${event.itemId}" />
          <span>${formatDuration(event.timestamp / 1000)}</span>
        </div>
      `
    )
    .join("");
};

const renderMatches = (matches) =>
  matches
    .map(
      (match) => `
        <article class="match-card expanded ${match.win ? "win" : "loss"}">
          <div class="match-summary">
            <img src="${getChampionSquare(match.championId, match.championName)}" alt="${escapeHtml(match.championName)}" />
            <div>
              <strong>${escapeHtml(match.championName)} - ${escapeHtml(QUEUES[match.queueId] || match.gameMode)}</strong>
              <span>${escapeHtml(POSITION_LABELS[match.teamPosition] || match.teamPosition || "Rol")} · ${match.kills}/${match.deaths}/${match.assists} KDA · ${match.creepScore} CS (${match.creepScorePerMinute.toFixed(1)}/min) · ${formatDuration(match.gameDuration)} · ${formatDate(match.gameCreation)}</span>
            </div>
            <span class="match-result">${match.win ? "Victoria" : "Derrota"}</span>
          </div>
          <div class="build-panel">
            <div>
              <h4>Build final</h4>
              <div class="item-strip">${renderItems(match.itemIds)}</div>
            </div>
            <div>
              <h4>Tiempo de build</h4>
              <div class="build-timeline">${renderBuildTimeline(match.itemTimeline)}</div>
            </div>
            <div>
              <h4>Recursos</h4>
              <p>${match.goldEarned.toLocaleString("es-AR")} oro · ${match.visionScore} vision</p>
            </div>
          </div>
          <div class="teams-grid">
            ${renderTeamList("Tu equipo", match.allyTeam, match.playerPuuid)}
            ${renderTeamList("Rivales", match.enemyTeam, "")}
          </div>
        </article>
      `
    )
    .join("");

const renderPlayerHTML = (data, profileIcon) => `
  <div class="player-header">
    <img class="profile-icon" src="${profileIcon}" alt="Icono de perfil" />
    <div class="player-title">
      <h2>${escapeHtml(data.account.gameName)}#${escapeHtml(data.account.tagLine)}</h2>
      <p>Nivel ${data.summoner.summonerLevel}</p>
    </div>
    <span class="live-badge ${data.activeGame ? "active" : ""}">${data.activeGame ? "En partida" : "Offline"}</span>
  </div>
  <div class="result-grid">
    <section class="result-section">
      <h3>Clasificatorias</h3>
      ${renderRanked(data.ranked)}
      <h3>Partida activa</h3>
      ${renderActiveGame(data.activeGame)}
    </section>
    <section class="result-section">
      <h3>Ultimas partidas</h3>
      ${data.matches.length ? renderMatches(data.matches) : '<div class="match-card"><strong>Sin partidas recientes</strong><span>No hay partidas para mostrar.</span></div>'}
    </section>
  </div>
`;

const lookupPlayer = async () => {
  if (!els.riotIdInput || !els.platformSelect) return;
  const riotId = els.riotIdInput.value.trim();
  if (!riotId) {
    renderPlayerError(new Error("Escribe un Riot ID, por ejemplo Nombre#TAG."));
    return;
  }
  renderPlayerLoading();
  try {
    const data = await window.riftAtlas.lookupPlayer({
      riotId,
      platform: els.platformSelect.value
    });
    renderPlayer(data);
  } catch (error) {
    renderPlayerError(error);
  }
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
          <span class="mod-extension">${escapeHtml(item.extension.replace(".", ""))}</span>
          <span>
            <strong>${escapeHtml(item.name)}</strong>
            <small>${escapeHtml(item.relativePath)}</small>
          </span>
          <span>${formatBytes(item.size)}</span>
        </button>
      `
    )
    .join("");

  els.modsPackageList.querySelectorAll(".mod-package-row").forEach((button) => {
    button.addEventListener("click", () => {
      window.riftAtlas.revealModPath(button.dataset.path);
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
  els.skinLibraryList.querySelectorAll(".skin-row").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      state.selectedSkinKey = row.dataset.path;
      renderSkinLibrary();
    });
  });

  els.skinLibraryList.querySelectorAll(".skin-favorite").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.favoriteSkins.has(button.dataset.path)) {
        state.favoriteSkins.delete(button.dataset.path);
      } else {
        state.favoriteSkins.add(button.dataset.path);
      }
      state.selectedSkinKey = button.dataset.path;
      saveFavoriteSkins();
      renderSkinProfile();
    });
  });

  els.skinLibraryList.querySelectorAll(".skin-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.managedSkins.has(button.dataset.path)) {
        state.managedSkins.delete(button.dataset.path);
      } else {
        state.managedSkins.add(button.dataset.path);
      }
      saveManagedSkins();
    });
  });

  els.skinLibraryList.querySelectorAll(".skin-reveal").forEach((button) => {
    button.addEventListener("click", () => {
      window.riftAtlas.revealModPath(button.dataset.path);
    });
  });

  els.skinLibraryList.querySelectorAll(".skin-queue").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const path = button.dataset.path;
      if (!path) return;
      if (state.queuedSkins.has(path)) {
        state.queuedSkins.delete(path);
      } else {
        state.queuedSkins.add(path);
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
  els.managedSkinsCount.textContent = `${state.managedSkins.size} gestionadas`;
  els.queuedSkinsCount.textContent = `${state.queuedSkins.size} seleccionadas`;
  if (els.clearQueueButton) {
    const hasActiveP2P = [...state.queuedSkins].some(isActivePartyP2PPath);
    els.clearQueueButton.textContent = hasActiveP2P ? "Limpiar no P2P" : "Limpiar todo";
  }
  els.clearQueueButton.disabled = (state.queuedSkins.size === 0 && state.managedSkins.size === 0) || state.importingQueue;
  renderSelectionTray();
  renderCustomMods();
  renderSkinProfile();
  renderSkinsP2PSection();

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
            <span class="skin-art-fallback">${escapeHtml(skin.extension.replace(".", ""))}</span>
            <span class="mod-extension">${escapeHtml(skin.extension.replace(".", ""))}</span>
          </div>
          <div class="skin-copy">
            <span>${escapeHtml(skin.champion)}</span>
            <strong>${escapeHtml(skin.skin)}</strong>
            <small>${queued ? "Seleccionada - " : ""}${skin.needsFantonize ? "Genera .fantome local - " : ""}${skin.numericSource ? `ID ${escapeHtml(skin.rawChampion)} / ${escapeHtml(skin.rawSkin)} - ` : ""}${escapeHtml(skin.variant || skin.relativePath)}</small>
          </div>
          <div class="skin-card-footer">
            <span>${formatBytes(skin.size)}</span>
            <button class="secondary-button skin-favorite compact-hidden" type="button" data-path="${escapeHtml(key)}">${favorite ? "★" : "☆"}</button>
            <button class="secondary-button skin-toggle compact-hidden" type="button" data-path="${escapeHtml(key)}">${managed ? "Quitar" : "Gestionar"}</button>
            <button class="${queued ? "secondary-button" : "docs-link"} skin-queue" type="button" data-path="${escapeHtml(key)}">${queued ? "Quitar" : "Seleccionar"}</button>
          </div>
          <button class="secondary-button skin-reveal" type="button" data-path="${escapeHtml(skin.path)}">Abrir</button>
        </article>
      `;
    })
    .join("");

  bindSkinLibraryActions();
};

const loadPresetToQueue = (preset = getActivePreset()) => {
  if (!preset) return;
  state.queuedSkins = new Set(preset.skinKeys);
  saveQueuedSkins();
  if (els.presetStatusLabel) els.presetStatusLabel.textContent = `Preset "${preset.name}" cargado a la cola.`;
};

const applyQueuedSkins = async () => {
  if (state.importingQueue) return;
  if (state.overlayRunning) {
    setOverlayPanelStatus({
      label: "Overlay activo",
      message: "Overlay activo. Detenlo antes de ejecutar otra vez.",
      active: true
    });
    return;
  }
  if (state.queuedSkins.size === 0) return;
  state.importingQueue = true;
  renderSkinLibrary();

  const queued = [...state.queuedSkins].map(getSkinByKey).filter(Boolean);
  const skinPaths = queued.map((s) => s.path).filter(Boolean);

  if (!skinPaths.length) {
    state.importingQueue = false;
    renderSkinLibrary();
    setOverlayPanelStatus({ message: "Las skins seleccionadas no tienen archivo local." });
    return;
  }

  if (!state.ltkOverlaySidecarPath) {
    state.importingQueue = false;
    renderSkinLibrary();
    setOverlayPanelStatus({ message: "Engine no configurado. Descargalo o configuralo en Configuracion." });
    return;
  }

  setOverlayPanelStatus({
    label: "Aplicando",
    message: `Inyectando ${formatSkinCount(skinPaths.length)} (mkoverlay + patcher)...`
  });
  try {
    const result = await window.riftAtlas.runBocchiOverlay({
      sidecarPath: state.ltkOverlaySidecarPath,
      dllPath: state.ltkOverlayDllPath,
      gamePath: state.leagueGamePath,
      skinPaths,
      skinEntries: queued
    });

    if (result.enginePath) {
      setLtkOverlaySidecarPath(result.enginePath);
    }
    addOverlayHistoryEntry(queued);
    setOverlayPanelStatus({
      label: "Overlay activo",
      message: `Overlay activo. ${formatSkinCount(skinPaths.length)} cargada${skinPaths.length === 1 ? "" : "s"}. Entra a partida para ver las skins.`,
      active: true
    });
    await refreshOverlayStatus();
  } catch (error) {
    setOverlayPanelStatus({
      label: "Error",
      message: `Error: ${error.message}`,
      error: true
    });
  }

  state.importingQueue = false;
  renderSkinLibrary();
};

const stopOverlayFromUi = async () => {
  try {
    const result = await window.riftAtlas.stopOverlay();
    setOverlayPanelStatus({
      label: "Sin overlay",
      message: result.stopped ? "Overlay detenido." : "No habia overlay activo."
    });
    setConfigStatus(result.stopped ? "Overlay detenido." : "No habia overlay activo.");
    await refreshOverlayStatus();
  } catch (error) {
    setOverlayPanelStatus({ label: "Error", message: error.message, error: true });
    setConfigStatus(error.message);
  }
};

const refreshOverlayStatus = async () => {
  try {
    const status = await window.riftAtlas.overlayStatus();
    const wasRunning = state.overlayRunning;
    state.overlayRunning = Boolean(status.running);
    state.overlayProfilePath = status.profilePath || "";
    if (state.importingQueue && !status.error) {
      renderCompactLauncher();
      return;
    }
    if (status.error) {
      state.overlayRunning = false;
      setConfigStatus(status.error);
      setOverlayPanelStatus({ label: "Error de DLL", message: status.error, error: true });
    } else if (state.overlayRunning) {
      setOverlayPanelStatus({
        label: "Overlay activo",
        message: state.overlayActiveMessage || "Overlay activo. Entra a partida para ver las skins.",
        active: true
      });
    } else {
      setOverlayPanelStatus({
        label: "Sin overlay",
        message: "Listo para seleccionar skins."
      });
    }
    if (wasRunning !== state.overlayRunning) {
      renderSelectionTray();
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
        const skin = state.skinLibrary.find((s) => s.path === r.path);
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
  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    renderChampionGrid();
  });

  document.querySelectorAll(".filter-pill").forEach((button) => {
    button.addEventListener("click", () => {
      state.role = button.dataset.role;
      document.querySelectorAll(".filter-pill").forEach((item) => item.classList.toggle("active", item === button));
      renderChampionGrid();
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

  els.apiKeyForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await window.riftAtlas.setRiotApiKey(els.apiKeyInput.value);
      els.apiKeyInput.value = "";
      setApiKeyStatus(true, "API key cargada solo para esta sesion.");
    } catch (error) {
      setApiKeyStatus(false, error.message);
    }
  });

  els.clearApiKeyButton?.addEventListener("click", async () => {
    const hasEnvKey = await window.riftAtlas.clearRiotApiKey();
    setApiKeyStatus(hasEnvKey, hasEnvKey ? "Key de sesion borrada. Sigue activa la variable RIOT_API_KEY." : "Key de sesion borrada.");
    els.apiKeyInput.value = "";
  });

  els.playerSearchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    lookupPlayer();
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

  els.compactRunButton?.addEventListener("click", applyQueuedSkins);
  els.compactStopButton?.addEventListener("click", stopOverlayFromUi);
  els.compactLoadPresetButton?.addEventListener("click", () => {
    const preset = state.presets.find((item) => item.id === els.compactPresetSelect.value) || getActivePreset();
    if (preset) loadPresetToQueue(preset);
  });

  els.clearOverlayHistoryButton?.addEventListener("click", () => {
    state.overlayHistory = [];
    saveOverlayHistory();
  });

  els.runDiagnosticsButton?.addEventListener("click", runDiagnostics);

  if (window.riftAtlas.onDownloadProgress) {
    window.riftAtlas.onDownloadProgress((payload) => {
      if (!payload || !payload.type) return;
      if (state.activeDownloadType && payload.type !== state.activeDownloadType) return;
      const percentText = formatDownloadProgress(payload);
      if (els.downloadProgressLabel && ["engine", "league-skins"].includes(payload.type)) {
        els.downloadProgressLabel.textContent = `${payload.message || "Descargando..."}${percentText}`;
      }
      if (els.configStatusLabel && payload.message) {
        els.configStatusLabel.textContent = payload.message;
      }
    });
  }

  els.createPartyButton?.addEventListener("click", async () => {
    try {
      await createParty();
    } catch (error) {
      if (els.partyConnectionLabel) els.partyConnectionLabel.textContent = error.message;
    }
  });

  els.joinPartyButton?.addEventListener("click", async () => {
    try {
      await joinParty();
    } catch (error) {
      if (els.partyConnectionLabel) els.partyConnectionLabel.textContent = error.message;
    }
  });

  els.leavePartyButton?.addEventListener("click", () => {
    leaveParty();
  });

  els.applyPartyButton?.addEventListener("click", applyQueuedSkins);

  els.partyAutoApplyCheckbox?.addEventListener("change", (event) => {
    state.partyAutoApply = event.target.checked;
    localStorage.setItem("riftAtlas:partyAutoApply", state.partyAutoApply ? "1" : "0");
    partyAutoApplyTriggered = false;
    renderParty();
  });

  els.skinsP2PSyncButton?.addEventListener("click", () => {
    syncPartySkins();
    requestMissingRoomFiles();
    renderParty();
  });

  els.skinsP2PApplyButton?.addEventListener("click", applyQueuedSkins);

  els.copyPartyLinkButton?.addEventListener("click", async () => {
    if (!state.partyLink) return;
    try {
      await navigator.clipboard.writeText(state.partyLink);
      els.partyShareLinkLabel.textContent = `${state.partyLink} copiado.`;
    } catch {
      els.partyShareLinkLabel.textContent = state.partyLink;
    }
  });

  els.autoConfigureButton?.addEventListener("click", () => {
    autoConfigureOverlay();
  });

  els.checkUpdatesButton?.addEventListener("click", () => {
    checkForUpdates({ manual: true });
  });

  els.updateDownloadButton?.addEventListener("click", async () => {
    const update = state.availableUpdate;
    if (!update?.downloadUrl && !update?.releaseUrl) return;
    await window.riftAtlas.openExternal(update.downloadUrl || update.releaseUrl);
  });

  els.updateDismissButton?.addEventListener("click", () => {
    const update = state.availableUpdate;
    if (update?.latestVersion && els.updateHideCheckbox?.checked) {
      localStorage.setItem("riftAtlas:ignoredUpdateVersion", update.latestVersion);
    }
    renderUpdateStatus(update, { hiddenByUser: Boolean(update?.latestVersion && els.updateHideCheckbox?.checked) });
  });

  els.dllSourceSelect?.addEventListener("change", (event) => {
    setDllDownloadSource(event.target.value);
  });

  els.settingsDllSourceSelect?.addEventListener("change", (event) => {
    setDllDownloadSource(event.target.value);
  });

  els.downloadCslolButton?.addEventListener("click", () => {
    downloadCslolTools();
  });

  els.downloadLeagueSkinsButton?.addEventListener("click", () => {
    loadDownloadedLeagueSkins();
  });

  els.downloadEngineButton?.addEventListener("click", () => {
    downloadCslolTools();
  });

  els.downloadLeagueSkinsButtonDownload?.addEventListener("click", () => {
    loadDownloadedLeagueSkins();
  });

  els.openEngineFolderButton?.addEventListener("click", async () => {
    await window.riftAtlas.openEngineFolder?.();
  });

  els.firstDllOpenFolderButton?.addEventListener("click", async () => {
    await window.riftAtlas.openEngineFolder?.();
  });

  els.firstDllDoneButton?.addEventListener("click", async () => {
    const status = await window.riftAtlas.getEngineDllStatus?.().catch(() => null);
    if (status?.exists) {
      setLtkOverlayDllPath(status.dllPath);
      hideFirstDllModal();
      setConfigStatus("DLL detectada correctamente.");
      return;
    }
    if (els.firstDllPathLabel) {
      els.firstDllPathLabel.textContent = status?.dllPath || "Todavia no encontre cslol-dll.dll.";
    }
    setConfigStatus("Todavia no encontre cslol-dll.dll en la carpeta engine.");
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

  els.openAppDataFolderButton?.addEventListener("click", async () => {
    try {
      const folderPath = await window.riftAtlas.openUserDataPath();
      if (els.appDataPathLabel) els.appDataPathLabel.textContent = folderPath;
      setConfigStatus("Directorio de la app abierto.");
    } catch (error) {
      setConfigStatus(error.message || "No se pudo abrir el directorio de la app.");
    }
  });

  els.addCustomModFilesButton?.addEventListener("click", async () => {
    try {
      if (els.customModsLabel) els.customModsLabel.textContent = "Leyendo archivo(s) propios...";
      const items = await window.riftAtlas.selectCustomModFiles();
      addCustomMods(items);
    } catch (error) {
      if (els.customModsLabel) els.customModsLabel.textContent = error.message;
    }
  });

  els.addCustomModFolderButton?.addEventListener("click", async () => {
    try {
      if (els.customModsLabel) els.customModsLabel.textContent = "Leyendo carpeta de mods propios...";
      const result = await window.riftAtlas.selectCustomModFolder();
      addCustomMods(result.packages || []);
      if (result.folderPath && els.customModsLabel) {
        els.customModsLabel.textContent = `${result.folderPath} - ${result.packages.length} mod(s) propios encontrados.`;
      }
    } catch (error) {
      if (els.customModsLabel) els.customModsLabel.textContent = error.message;
    }
  });

  els.stopOverlayButton?.addEventListener("click", stopOverlayFromUi);

  els.selectLtkOverlaySidecarButton?.addEventListener("click", async () => {
    const p = await window.riftAtlas.selectBocchiSidecar();
    if (p) { setLtkOverlaySidecarPath(p); setConfigStatus("Engine overlay configurado."); }
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
    const preset = {
      id: `preset-${Date.now()}`,
      name,
      skinKeys: [...state.queuedSkins],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.presets.push(preset);
    state.activePresetId = preset.id;
    savePresets();
    els.importStatusLabel.textContent = `Seleccion guardada como "${name}".`;
  }));

  els.selectSkinLibraryButton.addEventListener("click", async () => {
    els.skinLibraryLabel.textContent = "Indexando LeagueSkins...";
    try {
      const result = await window.riftAtlas.selectSkinLibrary();
      if (result) setSkinLibrary(result);
    } catch (error) {
      els.skinLibraryLabel.textContent = error.message;
    }
  });

  els.skinSearchInput.addEventListener("input", (event) => {
    state.skinQuery = event.target.value.trim();
    resetSkinView({ clearProfile: true });
    renderSkinLibrary();
  });

  els.skinChampionSelect.addEventListener("change", (event) => {
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
    const preset = {
      id: `preset-${Date.now()}`,
      name,
      skinKeys: [...state.queuedSkins],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
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
    preset.updatedAt = new Date().toISOString();
    if (els.presetStatusLabel) els.presetStatusLabel.textContent = `Cola guardada en "${preset.name}" (${preset.skinKeys.length}).`;
    savePresets();
  });

  els.loadPresetQueueButton?.addEventListener("click", () => {
    loadPresetToQueue();
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
  renderChampionGrid();
  renderBuildChampionOptions();
  updateBuildView();
  loadTierLane();

  if (state.champions.length > 0) {
    selectChampion(state.champions[0].id).catch(showError);
  }
};

const loadApiKeyStatus = async () => {
  const hasKey = await window.riftAtlas.hasRiotApiKey();
  setApiKeyStatus(hasKey);
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

bindEvents();
setDllDownloadSource("bundled");
loadLtkOverlayPaths();
setLeagueGamePath(state.leagueGamePath);
autoConfigureOverlay({ silent: true });
renderPresets();
renderCustomMods();
renderOverlayHistory();
renderCompactLauncher();
renderParty();
loadApiKeyStatus();
loadAppVersion();
loadAppDataPath();
setTimeout(() => {
  checkFirstDllNotice();
}, 700);
setTimeout(() => {
  checkForUpdates({ manual: false });
}, 1200);
refreshOverlayStatus();
loadChampions().catch(showError);
setTimeout(() => {
  loadSavedSkinLibrary();
}, 2500);
setInterval(refreshOverlayStatus, 3000);
setInterval(() => {
  if (state.partyStatus === "connected") {
    schedulePartySync(0);
    requestMissingRoomFiles();
  }
}, 5000);

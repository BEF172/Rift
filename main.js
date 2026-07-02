const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } = require("electron");
const { execFile, spawn } = require("node:child_process");
const { createWriteStream, existsSync, mkdirSync } = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { once } = require("node:events");
const extractZip = require("extract-zip");
const SevenZipWasm = require("7z-wasm");
const yauzl = require("yauzl");
const { autoUpdater } = require("electron-updater");
const { WebSocketServer } = require("ws");
const { createSkinsIndexStore } = require("./src/main/skins-index-store");

const getAppDataDir = () => (app.isPackaged ? path.dirname(app.getPath("exe")) : __dirname);
const electronProfileDir = path.join(getAppDataDir(), "webview-data");
for (const dir of [electronProfileDir, path.join(getAppDataDir(), "cache"), path.join(getAppDataDir(), "logs"), path.join(getAppDataDir(), "crash-dumps")]) {
  mkdirSync(dir, { recursive: true });
}
app.commandLine.appendSwitch("disk-cache-dir", path.join(getAppDataDir(), "cache"));
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.setPath("userData", electronProfileDir);
app.setPath("sessionData", electronProfileDir);
app.setPath("cache", path.join(getAppDataDir(), "cache"));
app.setPath("logs", path.join(getAppDataDir(), "logs"));
app.setPath("crashDumps", path.join(getAppDataDir(), "crash-dumps"));

const APP_ID = "com.riftatlas.desktop";
const APP_ICON = path.join(__dirname, "assets", "icon.ico");
const APP_ICON_PNG = path.join(__dirname, "assets", "icon.png");

app.setAppUserModelId(APP_ID);
app.setName("Rift Atlas");

const tierLaneCache = new Map();
let skinMetadataCache = null;
let penguBridgeServer = null;
let penguAssetServer = null;
let appTray = null;
let isQuitting = false;
const penguBridgeClients = new Set();
let penguAutoActivationTimer = null;
let penguAutoActivationInFlight = false;
let penguAutoActivationCompleted = false;
let penguLastLeagueReadySignature = "";
let penguLastAutoActivationAt = 0;
let penguLastBridgeConnectedAt = 0;
const startupFlags = {
  showTutorial: process.argv.includes("--rift-atlas-show-tutorial")
};

const skinsIndexStore = createSkinsIndexStore({ fs, path, getAppDataDir });
const getFirstRunSentinelPath = () => path.join(getAppDataDir(), ".first-run-complete");
const isFirstRun = () => !existsSync(getFirstRunSentinelPath());

const TIER_ROLES = ["top", "jungle", "middle", "bottom", "support"];
const UGG_ROLE_MAP = {
  top: "top",
  jungle: "jungle",
  middle: "mid",
  bottom: "adc",
  support: "supp"
};
const UGG_PAGE_ROLE_MAP = {
  top: "top",
  jungle: "jungle",
  middle: "mid",
  bottom: "adc",
  support: "support"
};
const UGG_TIER_PAGE_BY_LANE = {
  top: "top-lane-tier-list",
  jungle: "jungle-tier-list",
  middle: "mid-lane-tier-list",
  bottom: "adc-tier-list",
  support: "support-tier-list"
};
const MOD_PACKAGE_EXTENSIONS = new Set([".fantome", ".zip", ".rse", ".wad", ".wad.client"]);
const SUSPICIOUS_WAD_SIZE = 1024 * 1024;
const MKOVERLAY_BASE_TIMEOUT_MS = 1000 * 60 * 5;
const MKOVERLAY_PER_MB_TIMEOUT_MS = 1000 * 20;
const MKOVERLAY_MAX_TIMEOUT_MS = 1000 * 60 * 30;
const HASHTABLE_URL = "https://raw.communitydragon.org/data/hashes/lol/hashes.game.txt";
const LTK_REPO_API = "https://api.github.com/repos/LeagueToolkit/ltk-manager/releases/latest";
const CSLOL_REPO_API = "https://api.github.com/repos/LeagueToolkit/cslol-manager/releases/latest";
const HITORI_RELEASE_API = "https://api.github.com/repos/hitori-rebocchi/hitori-bocchi/releases/latest";
const LEAGUE_SKINS_REPO_API = "https://api.github.com/repos/Alban1911/LeagueSkins";
const RIFT_ATLAS_RELEASE_API = "https://api.github.com/repos/BEF172/Rift/releases/latest";
const PENGU_DISTRO_RELEASE_API = "https://api.github.com/repos/PenguLoader/distro/releases/latest";
const ROSE_PENGU_REPO_API = "https://api.github.com/repos/Tariolle/ROSE-Pengu";
const SKIN_INDEX_CACHE_VERSION = 10;
const OVERLAY_CACHE_MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5GB
const OVERLAY_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const OVERLAY_NO_CACHE_MARKER = ".rift-atlas-no-cache";
const MOD_STAGING_CACHE_MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5GB
const MOD_STAGING_SOURCE_MARKER = ".rift-atlas-stage-source.json";
const GAME_SUSPEND_MONITOR_INTERVAL_MS = 100;
const GAME_SUSPEND_AUTO_RESUME_MS = 15000;
const PENGU_BRIDGE_PORT = 45731;
const PENGU_ASSET_PORT = 45732;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sendDownloadProgress = (window, payload) => {
  try {
    window?.webContents?.send("download-progress", payload);
  } catch {
    // ignore if window closed
  }
};

const getUnpackedAssetPath = (...parts) => {
  const baseDir = __dirname.includes("app.asar")
    ? __dirname.replace("app.asar", "app.asar.unpacked")
    : __dirname;
  return path.join(baseDir, ...parts);
};

const getPackagedAssetPath = (...parts) => {
  if (app.isPackaged && process.resourcesPath) {
    const unpackedPath = path.join(process.resourcesPath, "app.asar.unpacked", ...parts);
    if (existsSync(unpackedPath)) return unpackedPath;
  }
  return path.join(__dirname, ...parts);
};

const createSevenZip = async () => {
  const sevenZipFactory = SevenZipWasm.default || SevenZipWasm;
  const wasmPath = getUnpackedAssetPath("node_modules", "7z-wasm", "7zz.wasm");
  return sevenZipFactory({
    locateFile: (fileName) => (fileName === "7zz.wasm" ? wasmPath : fileName)
  });
};

const formatBytes = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFilesTotalSize = async (filePaths = []) => {
  let total = 0;
  for (const filePath of filePaths) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat?.isFile()) total += stat.size;
    if (stat?.isDirectory()) total += await getDirectorySize(filePath);
  }
  return total;
};

const getDirectorySize = async (dirPath) => {
  let total = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await getDirectorySize(fullPath);
      } else if (entry.isFile()) {
        const stat = await fs.stat(fullPath);
        total += stat.size;
      }
    }
  } catch {}
  return total;
};

const isNoCacheOverlay = async (overlayPath = "") => {
  try {
    await fs.access(path.join(overlayPath, OVERLAY_NO_CACHE_MARKER));
    return true;
  } catch {
    return false;
  }
};

const markOverlayCachePolicy = async (overlayPath = "") => {
  if (!overlayPath) return;
  const size = await getDirectorySize(overlayPath).catch(() => 0);
  if (size > OVERLAY_CACHE_MAX_BYTES) {
    await fs.writeFile(path.join(overlayPath, OVERLAY_NO_CACHE_MARKER), JSON.stringify({
      reason: "oversize",
      size,
      maxBytes: OVERLAY_CACHE_MAX_BYTES,
      createdAt: new Date().toISOString()
    })).catch(() => {});
    await appendOverlayLog(`Overlay marcado como no-cache: ${formatBytes(size)} supera ${formatBytes(OVERLAY_CACHE_MAX_BYTES)}.`).catch(() => {});
  }
};

const cleanupNoCacheOverlay = async (overlayPath = "") => {
  if (!overlayPath || overlayPath === currentProfilePath) return false;
  if (!await isNoCacheOverlay(overlayPath).catch(() => false)) return false;
  await fs.rm(overlayPath, { recursive: true, force: true }).catch(() => {});
  await appendOverlayLog(`Overlay no-cache eliminado: ${overlayPath}`).catch(() => {});
  return true;
};

const pruneOverlayCache = async (options = {}) => {
  const cacheDir = path.join(getAppDataDir(), "cslol-overlay-cache");
  const protectedPaths = new Set([currentProfilePath, ...(options.protectedPaths || [])].filter(Boolean).map((p) => path.resolve(p).toLowerCase()));
  try {
    const entries = await fs.readdir(cacheDir, { withFileTypes: true });
    const dirs = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(cacheDir, entry.name);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) continue;
      const size = await getDirectorySize(fullPath);
      dirs.push({
        name: entry.name,
        path: fullPath,
        mtimeMs: stat.mtimeMs,
        size,
        noCache: await isNoCacheOverlay(fullPath).catch(() => false),
        protected: protectedPaths.has(path.resolve(fullPath).toLowerCase())
      });
    }

    // Ordenar por mtime mas viejo primero
    dirs.sort((a, b) => a.mtimeMs - b.mtimeMs);

    let totalBytes = dirs.reduce((sum, d) => sum + d.size, 0);
    let pruned = 0;
    const remaining = [];

    // Borrar entries viejos por edad
    const now = Date.now();
    for (const dir of dirs) {
      if (!dir.protected && (dir.noCache || dir.size > OVERLAY_CACHE_MAX_BYTES || now - dir.mtimeMs > OVERLAY_CACHE_MAX_AGE_MS)) {
        await fs.rm(dir.path, { recursive: true, force: true }).catch(() => {});
        totalBytes -= dir.size;
        pruned++;
      } else {
        remaining.push(dir);
      }
    }

    // Si sigue sobre el limite, borrar los mas viejos hasta estar bajo el limite
    if (totalBytes > OVERLAY_CACHE_MAX_BYTES) {
      for (const dir of remaining) {
        if (totalBytes <= OVERLAY_CACHE_MAX_BYTES) break;
        if (dir.protected) continue;
        await fs.rm(dir.path, { recursive: true, force: true }).catch(() => {});
        totalBytes -= dir.size;
        pruned++;
      }
    }

    if (pruned > 0) {
      await appendOverlayLog(`Cache overlay podado: ${pruned} entrada(s) eliminadas. Total aprox: ${formatBytes(totalBytes)} / ${formatBytes(OVERLAY_CACHE_MAX_BYTES)}.`).catch(() => {});
    } else if (totalBytes > OVERLAY_CACHE_MAX_BYTES) {
      await appendOverlayLog(`Cache overlay sigue sobre ${formatBytes(OVERLAY_CACHE_MAX_BYTES)} (${formatBytes(totalBytes)}) porque las entradas restantes estan protegidas por overlay activo.`).catch(() => {});
    }
  } catch {}
};

const getMkoverlayTimeoutMs = (bytes = 0) => {
  const extra = Math.ceil((Number(bytes) || 0) / (1024 * 1024)) * MKOVERLAY_PER_MB_TIMEOUT_MS;
  return Math.min(MKOVERLAY_MAX_TIMEOUT_MS, Math.max(MKOVERLAY_BASE_TIMEOUT_MS, MKOVERLAY_BASE_TIMEOUT_MS + extra));
};

const getPackageWadNames = (filePath) => new Promise((resolve) => {
  const extension = filePath.toLowerCase().endsWith(".wad.client") ? ".wad.client" : path.extname(filePath).toLowerCase();
  if ([".wad", ".wad.client"].includes(extension)) {
    resolve([path.basename(filePath)]);
    return;
  }
  if (![".zip", ".fantome"].includes(extension)) {
    resolve([]);
    return;
  }

  yauzl.open(filePath, { lazyEntries: true }, (error, zipfile) => {
    if (error || !zipfile) {
      resolve([]);
      return;
    }

    const wadNames = new Set();
    zipfile.readEntry();
    zipfile.on("entry", (entry) => {
      const entryName = entry.fileName.replace(/\\/g, "/");
      if (/(^|\/)WAD\/.+\.wad(\.client)?$/i.test(entryName)) {
        wadNames.add(path.basename(entryName));
      }
      zipfile.readEntry();
    });
    zipfile.on("end", () => resolve([...wadNames].sort((a, b) => a.localeCompare(b))));
    zipfile.on("error", () => resolve([...wadNames].sort((a, b) => a.localeCompare(b))));
  });
});

const getOverlayCacheKey = async ({ gamePath, skinPaths = [] }) => {
  const hash = crypto.createHash("sha256");
  hash.update("rift-atlas-overlay-cache-v3-fresh-state");
  const gameStat = await fs.stat(gamePath).catch(() => null);
  const gameFolder = path.dirname(gamePath);
  hash.update(path.normalize(gamePath).toLowerCase());
  hash.update(`:${gameStat?.size || 0}:${Math.trunc(gameStat?.mtimeMs || 0)}`);

  for (const skinPath of [...skinPaths].sort((a, b) => String(a).localeCompare(String(b)))) {
    const stat = await fs.stat(skinPath).catch(() => null);
    hash.update("|");
    hash.update(path.normalize(skinPath).toLowerCase());
    hash.update(`:${stat?.size || 0}:${Math.trunc(stat?.mtimeMs || 0)}`);

    const wadNames = await getPackageWadNames(String(skinPath)).catch(() => []);
    for (const wadName of wadNames) {
      const baseWadPath = path.join(gameFolder, "DATA", "FINAL", "Champions", wadName);
      const baseWadStat = await fs.stat(baseWadPath).catch(() => null);
      hash.update(`:base-wad:${wadName.toLowerCase()}:${baseWadStat?.size || 0}:${Math.trunc(baseWadStat?.mtimeMs || 0)}`);
    }
  }

  return hash.digest("hex").slice(0, 24);
};

const isUsableOverlayPath = async (overlayPath, options = {}) => {
  try {
    if (!options.allowNoCache && await isNoCacheOverlay(overlayPath).catch(() => false)) return false;
    const entries = await fs.readdir(overlayPath);
    return entries.includes("DATA");
  } catch {
    return false;
  }
};

const fetchJsonWithTimeout = async (url, options = {}, timeoutMs = 60000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const fetchJsonWithTimeoutShort = async (url, options = {}, timeoutMs = 10000) => {
  return fetchJsonWithTimeout(url, options, timeoutMs);
};

const fetchTextWithTimeout = async (url, options = {}, timeoutMs = 60000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
};

const fetchJsonWithRetry = async (url, options = {}, attempts = 3) => {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await fetchJsonWithTimeout(url, options);
    } catch (error) {
      lastError = error;
      await sleep(700 * (index + 1));
    }
  }

  throw lastError;
};

const fetchTextWithRetry = async (url, options = {}, attempts = 3) => {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await fetchTextWithTimeout(url, options);
    } catch (error) {
      lastError = error;
      await sleep(700 * (index + 1));
    }
  }

  throw lastError;
};

const getSkinMetadata = async () => {
  const now = Date.now();
  if (skinMetadataCache && now - skinMetadataCache.createdAt < 1000 * 60 * 60 * 12) {
    return skinMetadataCache.payload;
  }

  const versions = await fetchJsonWithTimeout("https://ddragon.leagueoflegends.com/api/versions.json");
  const version = versions[0];
  const championList = await fetchJsonWithTimeout(`https://ddragon.leagueoflegends.com/cdn/${version}/data/es_AR/champion.json`);
  const champions = Object.values(championList.data);
  const championsByKey = new Map(champions.map((champion) => [String(champion.key), champion]));
  const payload = {
    version,
    championsByKey,
    skinsByChampionKey: new Map(),
    skinDetailsByChampionKey: new Map(),
    pendingSkinDetailsByChampionKey: new Map()
  };

  skinMetadataCache = {
    createdAt: now,
    payload
  };
  return payload;
};

const getDataDragonChampionData = async () => {
  const versions = await fetchJsonWithTimeoutShort("https://ddragon.leagueoflegends.com/api/versions.json");
  const version = versions[0];
  const championList = await fetchJsonWithTimeoutShort(`https://ddragon.leagueoflegends.com/cdn/${version}/data/es_AR/champion.json`)
    .catch(() => fetchJsonWithTimeoutShort(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`));
  return {
    version,
    champions: Object.values(championList.data || {})
  };
};

const getChampionSkins = async (championKey) => {
  const details = await getChampionSkinDetails(championKey);
  return details.names;
};

const getChampionSkinDetails = async (championKey) => {
  const metadata = await getSkinMetadata();
  const champion = metadata.championsByKey.get(String(championKey));
  if (!champion) {
    return { names: new Map(), recordsByName: new Map(), recordsById: new Map() };
  }

  if (metadata.skinDetailsByChampionKey.has(String(championKey))) {
    return metadata.skinDetailsByChampionKey.get(String(championKey));
  }

  if (metadata.pendingSkinDetailsByChampionKey.has(String(championKey))) {
    return metadata.pendingSkinDetailsByChampionKey.get(String(championKey));
  }

  const pendingDetails = (async () => {
    const [detail, englishDetail] = await Promise.all([
      fetchJsonWithTimeout(`https://ddragon.leagueoflegends.com/cdn/${metadata.version}/data/es_AR/champion/${champion.id}.json`),
      fetchJsonWithRetry(`https://ddragon.leagueoflegends.com/cdn/${metadata.version}/data/en_US/champion/${champion.id}.json`, {}, 2).catch(() => null)
    ]);
    const championDetail = detail.data[champion.id];
    const englishSkinsByNum = new Map((englishDetail?.data?.[champion.id]?.skins || []).map((skin) => [Number(skin.num), skin]));
    const names = new Map();
    const recordsByName = new Map();
    const recordsById = new Map();

    for (const skin of championDetail.skins || []) {
      const skinNum = Number(skin.num);
      const fullSkinId = Number(champion.key) * 1000 + skinNum;
      const englishSkin = englishSkinsByNum.get(skinNum);
      const displayName = skin.name === "default" ? `${champion.name} clasico` : skin.name;
      const record = {
        num: skinNum,
        fullSkinId,
        name: displayName
      };
      names.set(String(skinNum), displayName);
      names.set(String(fullSkinId), displayName);
      recordsById.set(String(skinNum), record);
      recordsById.set(String(fullSkinId), record);
      recordsByName.set(normalizeChampionName(displayName), record);
      recordsByName.set(normalizeChampionName(skin.name), record);
      if (englishSkin?.name) {
        recordsByName.set(normalizeChampionName(englishSkin.name), record);
      }
    }

    const details = { names, recordsByName, recordsById };
    metadata.skinsByChampionKey.set(String(championKey), names);
    metadata.skinDetailsByChampionKey.set(String(championKey), details);
    return details;
  })();

  metadata.pendingSkinDetailsByChampionKey.set(String(championKey), pendingDetails);
  try {
    return await pendingDetails;
  } finally {
    metadata.pendingSkinDetailsByChampionKey.delete(String(championKey));
  }
};

const isNumericId = (value = "") => /^\d+$/.test(String(value));

const sanitizeFileName = (value = "") =>
  String(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Imported Mod";

const stripModExtension = (fileName = "") => {
  const lower = String(fileName).toLowerCase();
  if (lower.endsWith(".wad.client")) {
    return String(fileName).slice(0, -".wad.client".length);
  }
  return path.basename(String(fileName), path.extname(String(fileName)));
};

const normalizeChampionName = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const simplifySkinCandidate = (value = "") =>
  stripModExtension(String(value))
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const findSkinRecord = (skinDetails, candidates = []) => {
  if (!skinDetails?.recordsByName) return null;
  const normalizedCandidates = candidates
    .flatMap((candidate) => {
      const simplified = simplifySkinCandidate(candidate);
      return [
        candidate,
        simplified,
        simplified.replace(/\b([a-z]+)\s+\1\b/gi, "$1")
      ];
    })
    .map((candidate) => normalizeChampionName(candidate))
    .filter(Boolean);

  for (const candidate of normalizedCandidates) {
    const exact = skinDetails.recordsByName.get(candidate);
    if (exact) return exact;
  }

  for (const candidate of normalizedCandidates) {
    for (const [, record] of skinDetails.recordsByName) {
      const recordName = normalizeChampionName(record.name);
      if (candidate && recordName && (candidate.includes(recordName) || recordName.includes(candidate))) {
        return record;
      }
    }
  }

  return null;
};

const getSkinArtNum = (skinDetails, skinRecord, skinNum) => {
  if (!skinRecord?.name) return skinNum;
  const baseName = simplifySkinCandidate(skinRecord.name);
  if (!baseName || baseName === skinRecord.name) return skinNum;
  const baseRecord = findSkinRecord(skinDetails, [baseName]);
  return baseRecord?.num ?? skinNum;
};

const getSkinImageUrl = (championKey, imageSkinNum) =>
  championKey && imageSkinNum !== null && imageSkinNum !== undefined
    ? `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championKey}_${imageSkinNum}.jpg`
    : "";

const getTierForRank = (index) => {
  if (index < 5) return "S";
  if (index < 13) return "A";
  if (index < 23) return "B";
  if (index < 33) return "C";
  return "D";
};

const getUggTierFromStdevs = (stdevs = 0) => {
  if (stdevs >= 2.5) return "S+";
  if (stdevs >= 1) return "S";
  if (stdevs >= 0) return "A";
  if (stdevs >= -1) return "B";
  if (stdevs >= -2) return "C";
  return "D";
};

const parsePatchForUgg = (version = "") => {
  const [major, minor] = String(version).split(".");
  return major && minor ? `${major}_${minor}` : "16_11";
};

const extractWindowState = (html, globalName, nextGlobalName) => {
  const marker = `window.${globalName} = `;
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const jsonStart = start + marker.length;
  const nextMarker = `window.${nextGlobalName}`;
  const end = html.indexOf(nextMarker, jsonStart);
  const source = (end === -1 ? html.slice(jsonStart) : html.slice(jsonStart, end)).trim();
  return JSON.parse(source.replace(/;$/, ""));
};

const getPatchFromUggStateKey = (key = "") => key.match(/\/(\d+_\d+)\/ranked_solo_5x5\//)?.[1]?.replace("_", ".") || "";

const getUggBuildSlug = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const getBestUggBuildEntry = (data = {}) => {
  const entries = Object.entries(data)
    .map(([roleKey, build]) => ({
      roleKey,
      role: roleKey.split("_").pop(),
      build,
      matches: Number(build?.rec_skill_path?.matches || build?.rec_core_items?.matches || build?.rec_runes?.matches || 0)
    }))
    .filter((entry) => entry.build && entry.matches > 0)
    .sort((a, b) => b.matches - a.matches);
  return entries[0] || null;
};

const fetchUggChampionBuild = async ({ championId, championName, version }) => {
  const slug = getUggBuildSlug(championId || championName);
  if (!slug) {
    throw new Error("Campeon invalido para build.");
  }

  const html = await fetchTextWithRetry(`https://u.gg/lol/champions/${slug}/build?rank=emerald_plus`, {
    headers: {
      accept: "text/html",
      "user-agent": "Mozilla/5.0 RiftAtlas/1.0"
    }
  });
  const state = extractWindowState(html, "__SSR_DATA__", "__APOLLO_STATE__");
  const stateKeys = Object.keys(state || {}).filter((key) => {
    const payload = state[key];
    return key.includes("overview/") && JSON.stringify(payload?.data || {}).includes("rec_core_items");
  });
  const candidates = stateKeys
    .map((key) => {
      const entry = getBestUggBuildEntry(state[key]?.data || {});
      return entry ? { key, ...entry } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.matches - a.matches);
  const selected = candidates[0];
  if (!selected) {
    throw new Error("U.GG no entrego una build recomendada.");
  }

  const build = selected.build;
  return {
    source: "U.GG",
    championId,
    championName,
    role: selected.role,
    patch: selected.key.match(/\/(\d+_\d+)\//)?.[1]?.replace("_", ".") || parsePatchForUgg(version).replace("_", "."),
    updatedAt: new Date().toISOString(),
    matches: selected.matches,
    runes: {
      primaryStyle: build.rec_runes?.primary_style || null,
      subStyle: build.rec_runes?.sub_style || null,
      perks: build.rec_runes?.active_perks || [],
      winrate: build.rec_runes?.win_rate || 0,
      matches: build.rec_runes?.matches || 0
    },
    summonerSpells: {
      ids: build.rec_summoner_spells?.ids || [],
      winrate: build.rec_summoner_spells?.win_rate || 0,
      matches: build.rec_summoner_spells?.matches || 0
    },
    startingItems: {
      ids: build.rec_starting_items?.ids || [],
      winrate: build.rec_starting_items?.win_rate || 0,
      matches: build.rec_starting_items?.matches || 0
    },
    coreItems: {
      ids: build.rec_core_items?.ids || [],
      winrate: build.rec_core_items?.win_rate || 0,
      matches: build.rec_core_items?.matches || 0
    },
    skills: {
      priority: build.rec_skills?.slots || [],
      path: build.rec_skill_path?.slots || [],
      winrate: build.rec_skill_path?.win_rate || 0,
      matches: build.rec_skill_path?.matches || 0
    },
    url: `https://u.gg/lol/champions/${slug}/build?rank=emerald_plus`
  };
};

const fetchUggLaneTierListFromPage = async (lane) => {
  const pageRole = UGG_PAGE_ROLE_MAP[lane];
  const page = UGG_TIER_PAGE_BY_LANE[lane];
  const html = await fetchTextWithRetry(`https://u.gg/lol/${page}?rank=emerald_plus`, {
    headers: {
      accept: "text/html",
      "user-agent": "Mozilla/5.0 RiftAtlas/1.0"
    }
  });
  const state = extractWindowState(html, "__SSR_DATA__", "__APOLLO_STATE__");
  const stateKey = Object.keys(state || {}).find((key) =>
    key.includes("/champion_ranking/") &&
    key.includes("/ranked_solo_5x5/emerald_plus/")
  );
  const data = stateKey ? state[stateKey]?.data : null;
  const roleRows = data?.win_rates?.[pageRole] || [];
  if (!roleRows.length) {
    throw new Error("U.GG no incluyo la tier list en la pagina.");
  }

  const rows = roleRows
    .filter((row) => Number(row.pick_rate) >= 1)
    .sort((a, b) => Number(b.tier?.stdevs || 0) - Number(a.tier?.stdevs || 0))
    .slice(0, 35)
    .map((row, index) => ({
      championId: String(row.champion_id),
      champion: String(row.champion_id),
      role: lane,
      patch: getPatchFromUggStateKey(stateKey),
      date: data.last_updated_at,
      games: Number(row.matches) || 0,
      winrate: Number(row.win_rate) || 0,
      pickrate: Number(row.pick_rate) || 0,
      banrate: Number(row.ban_rate) || 0,
      score: Number(row.tier?.stdevs) || 0,
      tier: getUggTierFromStdevs(Number(row.tier?.stdevs) || 0),
      rank: index + 1
    }));

  return {
    source: "U.GG",
    updatedAt: data.last_updated_at,
    role: lane,
    rows
  };
};

const fetchUggLaneTierList = async (lane, version) => {
  try {
    return await fetchUggLaneTierListFromPage(lane);
  } catch (pageError) {
    console.warn(`[tiers] U.GG page parser failed: ${pageError.message}`);
  }

  const uggLane = UGG_ROLE_MAP[lane];
  const patch = parsePatchForUgg(version);
  const url = `https://stats2.u.gg/lol/1.5/champion_ranking/world/${patch}/ranked_solo_5x5/emerald_plus/1.5.0.json`;
  const data = await fetchJsonWithRetry(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 RiftAtlas/1.0"
    }
  });
  const roleRows = data[0]?.[uggLane] || [];
  const bansByChampionId = data[1] || {};
  const updatedAt = data[2] || new Date().toISOString();
  const totalMatches = Number(data[3]) || 1;

  const rows = roleRows
    .map((row) => {
      const championId = String(row[0]);
      const wins = Number(row[2]) || 0;
      const games = Number(row[3]) || 0;
      const bans = Number(bansByChampionId[championId]) || 0;
      const winrate = games ? (wins / games) * 100 : 0;
      const pickrate = (games / totalMatches) * 100;
      const banrate = (bans / totalMatches) * 100;
      return {
        championId,
        champion: championId,
        role: lane,
        patch: patch.replace("_", "."),
        date: updatedAt,
        games,
        winrate,
        pickrate,
        banrate,
        score: winrate + pickrate * 0.7 + banrate * 0.35
      };
    })
    .filter((row) => row.games >= 80)
    .sort((a, b) => b.score - a.score)
    .slice(0, 35)
    .map((row, index) => ({
      ...row,
      tier: getTierForRank(index),
      rank: index + 1
    }));

  return {
    source: "U.GG",
    updatedAt,
    role: lane,
    rows
  };
};

const fetchHuggingFaceLaneTierList = async (lane) => {
  const params = new URLSearchParams({
    dataset: "HakimT/lol-champion-ranked-stats",
    config: "default",
    split: "train",
    where: `"role"='${lane}'`,
    orderby: '"date" DESC',
    offset: "0",
    length: "100"
  });
  const data = await fetchJsonWithRetry(`https://datasets-server.huggingface.co/filter?${params.toString()}`);
  const rows = data.rows.map((item) => item.row);
  const latestDate = rows[0]?.date;
  const latestRows = rows.filter((row) => row.date === latestDate);

  return {
    source: "HakimT/lol-champion-ranked-stats",
    updatedAt: latestDate || new Date().toISOString(),
    role: lane,
    rows: latestRows
      .map((row) => ({
        champion: row.champion,
        role: lane,
        patch: row.patch,
        date: row.date,
        games: 0,
        winrate: Number(row.winrate),
        pickrate: Number(row.pickrate),
        banrate: Number(row.banrate),
        score: Number(row.winrate) + Number(row.pickrate) * 0.55 + Number(row.banrate) * 0.25
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 35)
      .map((row, index) => ({
        ...row,
        tier: getTierForRank(index),
        rank: index + 1
      }))
  };
};

const getChampionTierLane = async (lane, version) => {
  const normalizedLane = TIER_ROLES.includes(lane) ? lane : "top";
  const cacheKey = `${normalizedLane}:${parsePatchForUgg(version)}`;
  const now = Date.now();
  const cached = tierLaneCache.get(cacheKey);
  if (cached && now - cached.createdAt < 1000 * 60 * 30) {
    return cached.payload;
  }

  let payload;
  try {
    payload = await fetchUggLaneTierList(normalizedLane, version);
  } catch (uggError) {
    try {
      payload = await fetchHuggingFaceLaneTierList(normalizedLane);
      payload.warning = `U.GG no respondio (${uggError.message}); usando fallback comunitario.`;
    } catch (fallbackError) {
      payload = {
        source: "No disponible",
        updatedAt: new Date().toISOString(),
        role: normalizedLane,
        rows: [],
        warning: `No pude cargar tiers: ${fallbackError.message}`
      };
    }
  }

  tierLaneCache.set(cacheKey, {
    createdAt: now,
    payload
  });
  return payload;
};

const listModPackages = async (folderPath) => {
  const packages = [];

  const walk = async (currentPath) => {
    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      const lowercaseName = entry.name.toLowerCase();
      const extension = lowercaseName.endsWith(".wad.client") ? ".wad.client" : path.extname(entry.name).toLowerCase();
      if (!MOD_PACKAGE_EXTENSIONS.has(extension)) {
        continue;
      }

      const stat = await fs.stat(entryPath).catch(() => null);
      if (!stat) {
        continue;
      }

      packages.push({
        name: entry.name,
        extension,
        path: entryPath,
        relativePath: path.relative(folderPath, entryPath),
        size: stat.size,
        mtimeMs: stat.mtimeMs
      });
    }
  };

  await walk(folderPath);
  return packages;
};

const pruneModStagingCache = async () => {
  const cacheDir = path.join(getAppDataDir(), "mod-staging-cache");
  try {
    const entries = await fs.readdir(cacheDir, { withFileTypes: true });
    const dirs = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(cacheDir, entry.name);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) continue;
      dirs.push({
        path: fullPath,
        mtimeMs: stat.mtimeMs,
        size: await getDirectorySize(fullPath)
      });
    }
    dirs.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let totalBytes = dirs.reduce((sum, dir) => sum + dir.size, 0);
    let pruned = 0;
    for (const dir of dirs) {
      if (totalBytes <= MOD_STAGING_CACHE_MAX_BYTES) break;
      await fs.rm(dir.path, { recursive: true, force: true }).catch(() => {});
      totalBytes -= dir.size;
      pruned += 1;
    }
    if (pruned) {
      await appendOverlayLog(`Cache staging mods podado: ${pruned} entrada(s) eliminadas.`).catch(() => {});
    }
  } catch {}
};

const getStagedModSourcePath = async (modPath = "") => {
  try {
    const payload = JSON.parse(await fs.readFile(path.join(modPath, MOD_STAGING_SOURCE_MARKER), "utf8"));
    return payload?.sourcePath || "";
  } catch {
    return "";
  }
};

const getOverlayModFallbackPaths = async (modPaths = []) => {
  const fallbackPaths = [];
  let changed = false;
  for (const modPath of modPaths) {
    const sourcePath = await getStagedModSourcePath(modPath);
    if (sourcePath) {
      fallbackPaths.push(sourcePath);
      changed = true;
    } else {
      fallbackPaths.push(modPath);
    }
  }
  return changed ? fallbackPaths : null;
};

const LOCAL_PREVIEW_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

const getLeagueSkinIdCandidates = (championId, value) => {
  const champion = String(Number(championId) || "");
  const raw = String(Number(value) || "");
  if (!raw) return [];

  const ids = new Set([raw]);
  if (champion && raw.startsWith(champion) && raw.length > champion.length) {
    const shortId = String(Number(raw.slice(champion.length)) || "");
    if (shortId) ids.add(shortId);
  }
  if (champion && Number(raw) < 1000) {
    ids.add(String((Number(champion) * 1000) + Number(raw)));
  }

  return [...ids].filter(Boolean);
};

const getLocalPreviewUri = ({ championId, skinId, chromaId }) => {
  const safeChampionId = String(Number(championId) || "");
  const safeSkinId = String(Number(skinId) || "");
  const safeChromaId = String(Number(chromaId) || "");
  if (!safeChampionId || !safeSkinId || !safeChromaId) return "";
  return `local-preview://${safeChampionId}/${safeSkinId}/${safeChromaId}/${safeChromaId}.png`;
};

const getLocalPreviewInfo = async (item, repoParts = null) => {
  const parts = repoParts || String(item.relativePath || "").split(path.sep).filter(Boolean);
  const fileBase = stripModExtension(item.name);
  const previewNames = [...new Set([
    fileBase,
    parts.at(-2) || "",
    parts[2] || "",
    parts[1] || ""
  ].filter(Boolean))];
  const searchDirs = [...new Set([
    path.dirname(item.path),
    path.dirname(path.dirname(item.path))
  ])];

  for (const dir of searchDirs) {
    for (const name of previewNames) {
      for (const ext of LOCAL_PREVIEW_EXTENSIONS) {
        const previewPath = path.join(dir, `${name}${ext}`);
        if (await fileExists(previewPath)) {
          const championId = parts[0] || "";
          const skinId = parts[1] || "";
          const previewId = parts.length > 3 ? (parts[2] || fileBase) : fileBase;
          return {
            localPreviewPath: previewPath,
            localPreviewUrl: pathToFileURL(previewPath).href,
            localPreviewUri: championId && skinId && previewId
              ? `local-preview://${championId}/${skinId}/${previewId}/${path.basename(previewPath)}`
              : ""
          };
        }
      }
    }
  }

  return {
    localPreviewPath: "",
    localPreviewUrl: "",
    localPreviewUri: ""
  };
};

const getModPackageExtension = (filePath) => {
  const lowercaseName = path.basename(String(filePath || "")).toLowerCase();
  return lowercaseName.endsWith(".wad.client") ? ".wad.client" : path.extname(lowercaseName);
};

const getModPackageFromFile = async (filePath, rootPath = path.dirname(filePath)) => {
  const extension = getModPackageExtension(filePath);
  if (!MOD_PACKAGE_EXTENSIONS.has(extension)) {
    return null;
  }

  const stat = await fs.stat(filePath);
  const archiveInfo = await inspectArchivePackage(filePath).catch(() => ({}));
  const relativePath = path.relative(rootPath, filePath) || path.basename(filePath);
  const relativeParts = relativePath.split(path.sep).filter(Boolean);
  const roseSkinId = relativeParts[0]?.toLowerCase() === "skins" && /^\d+$/.test(relativeParts[1] || "")
    ? Number(relativeParts[1])
    : 0;
  const roseChampionId = roseSkinId ? Math.floor(roseSkinId / 1000) : 0;
  const roseSkinNum = roseSkinId ? roseSkinId % 1000 : null;
  return {
    name: path.basename(filePath),
    extension,
    path: filePath,
    relativePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    archiveInfo,
    targetWads: archiveInfo.targetWads || [],
    targetSkinNums: archiveInfo.targetSkinNums || [],
    rawChampion: roseChampionId ? String(roseChampionId) : "",
    rawSkin: roseSkinId ? String(roseSkinId) : "",
    rawVariant: stripModExtension(path.basename(filePath)),
    champion: roseChampionId ? String(roseChampionId) : "",
    championKey: roseChampionId ? String(roseChampionId) : "",
    championId: roseChampionId ? String(roseChampionId) : "",
    skin: roseSkinId ? String(roseSkinId) : "",
    skinId: roseSkinId || undefined,
    skinNum: roseSkinNum,
    variant: stripModExtension(path.basename(filePath)),
    source: roseSkinId ? "user-mods" : "local",
    custom: true
  };
};

const getSkinIndexCachePath = () => path.join(getAppDataDir(), "cache", "skin-library-index.json");
const getUnifiedLibraryIndexPath = () => skinsIndexStore.getIndexPath();
const getPreviewCacheDir = () => skinsIndexStore.getPreviewCacheDir();

const readSkinIndexCache = async (folderPath) => {
  try {
    const payload = JSON.parse(await fs.readFile(getSkinIndexCachePath(), "utf8"));
    if (payload.version !== SKIN_INDEX_CACHE_VERSION || payload.folderPath !== folderPath || !Array.isArray(payload.skins)) {
      return new Map();
    }

    const existingSkins = [];
    for (const skin of payload.skins) {
      if (skin?.path && await fileExists(skin.path)) {
        existingSkins.push(skin);
      }
    }
    return new Map(existingSkins.map((skin) => [skin.path, skin]));
  } catch {
    return new Map();
  }
};

const writeSkinIndexCache = async (folderPath, skins) => {
  const cachePath = getSkinIndexCachePath();
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify({
    version: SKIN_INDEX_CACHE_VERSION,
    folderPath,
    createdAt: new Date().toISOString(),
    skins
  }));
};

const isCachedSkinFresh = (cached, item) =>
  cached &&
  cached.path === item.path &&
  cached.size === item.size &&
  Number(cached.mtimeMs || 0) === Number(item.mtimeMs || 0);

const handleChromaDataRequest = async (message, socket) => {
    try {
        const skinId = Number(message.skinId || message.baseSkinId || 0);
        const championKey = String(message.championKey || message.championId || "");
        const requestedSkinName = normalizeChampionName(message.skinName || message.name || "");
        const knownChromaIds = Array.isArray(message.knownChromaIds)
            ? new Set(message.knownChromaIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
            : new Set();

        if (!skinId) return;

        const sendResponse = (chromas, error, baseSkinId = 0) => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "chroma-data", skinId, baseSkinId, championId: Number(championKey), championKey, chromas, error: error || null }));
            }
        };

        const cachePath = getSkinIndexCachePath();
        const content = await fs.readFile(cachePath, "utf8").catch(() => "{}");
        const payload = JSON.parse(content);
        const allSkins = Array.isArray(payload.skins) ? payload.skins : [];

        if (allSkins.length === 0) { sendResponse([], "cache-vacio"); return; }

        const championEntries = allSkins.filter(s => String(s.championId || s.championKey) === championKey);
        if (championEntries.length === 0) { sendResponse([], "sin-champion"); return; }

        const targetSkinNum = skinId % 1000;
        const championIdNum = Number(championKey) || 0;
        const targetFullSkinId = championIdNum && targetSkinNum >= 0
            ? (championIdNum * 1000) + targetSkinNum
            : skinId;
        const toFullId = (value) => {
            const numeric = Number(value || 0);
            if (!Number.isFinite(numeric) || numeric <= 0) return 0;
            if (!championIdNum || numeric >= 1000) return numeric;
            return (championIdNum * 1000) + numeric;
        };
        const firstNumericId = (...values) => {
            for (const value of values) {
                const numeric = Number(value || 0);
                if (Number.isFinite(numeric) && numeric > 0) return numeric;
            }
            return 0;
        };
        const getEntryBaseId = (entry) =>
            toFullId(firstNumericId(entry?.rawSkin, entry?.baseSkinId, entry?.baseImageSkinNum, entry?.imageSkinNum, entry?.skinNum));
        const getEntryVariantId = (entry) =>
            toFullId(firstNumericId(entry?.rawVariant, entry?.fileBaseId, entry?.skinNum, entry?.imageSkinNum, entry?.rawSkin));
        const isRealChromaEntry = (entry) => {
            const baseId = getEntryBaseId(entry);
            const variantId = getEntryVariantId(entry);
            return baseId > 0 && variantId > 0 && variantId !== baseId;
        };
        const matchesRequestedBase = (entry, baseId = targetFullSkinId) => {
            const entryBaseId = getEntryBaseId(entry);
            const entryVariantId = getEntryVariantId(entry);
            return entryBaseId === baseId || entryVariantId === baseId;
        };
        const requestedBaseSkinId =
            getEntryBaseId(championEntries.find((entry) => getEntryVariantId(entry) === targetFullSkinId)) ||
            targetFullSkinId;

        let chromaCandidates = championEntries.filter(e =>
            isRealChromaEntry(e) && matchesRequestedBase(e, requestedBaseSkinId)
        );

        if (knownChromaIds.size > 0) {
            const byKnownIds = championEntries.filter(e => {
                const rawVariantId = Number(e.rawVariant || 0);
                const rawSkinId = Number(e.rawSkin || 0);
                const skinNum = Number(e.skinNum || 0);
                return knownChromaIds.has(rawVariantId) ||
                    knownChromaIds.has(rawSkinId) ||
                    knownChromaIds.has(skinNum) ||
                    knownChromaIds.has(Number(`${championKey}${String(skinNum).padStart(3, "0")}`));
            });
            if (byKnownIds.length > 0) {
                chromaCandidates = byKnownIds;
            }
        }

        if (chromaCandidates.length === 0 && requestedSkinName) {
            const namedBase = championEntries.find(e => {
                const names = [e.skin, e.variant, e.metaName, e.name].map((value) => normalizeChampionName(value || ""));
                return names.some((name) => name && (name.includes(requestedSkinName) || requestedSkinName.includes(name)));
            });
            const namedBaseId = getEntryBaseId(namedBase);
            if (namedBaseId > 0) {
                chromaCandidates = championEntries.filter(e =>
                    isRealChromaEntry(e) && matchesRequestedBase(e, namedBaseId)
                );
            }
        }

        if (chromaCandidates.length === 0 && targetSkinNum !== 0) {
            chromaCandidates = championEntries.filter(e => {
                const rawSkinId = getEntryBaseId(e);
                const rawVariantId = getEntryVariantId(e);
                return rawSkinId > 0 &&
                    rawSkinId % 1000 === targetSkinNum &&
                    rawVariantId > 0 &&
                    rawVariantId !== rawSkinId;
            });
        }

        if (chromaCandidates.length === 0 && targetSkinNum === 0) {
            sendResponse([], null);
            return;
        }

        const resolvedBaseSkinId = getEntryBaseId(chromaCandidates[0]) || skinId;

        const chromas = await Promise.all(chromaCandidates.map(async (v) => {
          const variantId = getEntryVariantId(v) || 0;
          const baseId = getEntryBaseId(v) || 0;
          const previewPath = v.localPreviewPath && await fileExists(v.localPreviewPath)
            ? v.localPreviewPath
            : await findIndexedPreviewFile({ championId: championKey, skinId: baseId, chromaId: variantId })
              || await findLeagueSkinsPreviewFile({ championId: championKey, skinId: baseId, chromaId: variantId });
          return {
            id: variantId,
            baseId,
            name: v.variant || v.skin || `Skin ${v.skinNum}`,
            variant: v.variant || "",
            skin: v.skin || "",
            imagePath: previewPath
              ? getLocalPreviewUri({ championId: championKey, skinId: baseId, chromaId: variantId })
              : "",
            colors: [],
            primaryColor: null,
          };
        }));

        sendResponse(chromas, null, resolvedBaseSkinId);
    } catch (e) {
        try { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "chroma-data", chromas: [], error: "handler-error" })); } catch (_) {}
    }
};

const inspectArchivePackage = (filePath) => new Promise((resolve) => {
  const extension = filePath.toLowerCase().endsWith(".wad.client") ? ".wad.client" : path.extname(filePath).toLowerCase();
  if ([".wad", ".wad.client"].includes(extension)) {
    fs.stat(filePath)
      .then((stat) => {
        const suspicious = stat.size > 0 && stat.size < SUSPICIOUS_WAD_SIZE;
        resolve({
          wadCount: 1,
          maxWadSize: stat.size,
          suspicious,
          targetWads: [path.basename(filePath)],
          targetSkinNums: []
        });
      })
      .catch(() => resolve({}));
    return;
  }

  if (![".zip", ".fantome"].includes(extension)) {
    resolve({});
    return;
  }

  yauzl.open(filePath, { lazyEntries: true }, (error, zipfile) => {
    if (error || !zipfile) {
      resolve({});
      return;
    }

    let wadCount = 0;
    let maxWadSize = 0;
    let hasMetaInfo = false;
    let hasMetaDetails = false;
    let hasWadFolder = false;
    const targetWads = new Set();
    const targetSkinNums = new Set();
    zipfile.readEntry();
    zipfile.on("entry", (entry) => {
      const normalizedEntryName = entry.fileName.replace(/\\/g, "/");
      const entryName = normalizedEntryName.toLowerCase();
      if (entryName === "meta/info.json") hasMetaInfo = true;
      if (entryName === "meta/details.json") hasMetaDetails = true;
      if (entryName.startsWith("wad/")) hasWadFolder = true;
      const wadMatch = normalizedEntryName.match(/(?:^|\/)WAD\/([^/]+\.wad(?:\.client)?)(?:\/|$)/i);
      if (wadMatch?.[1]) targetWads.add(wadMatch[1]);
      const skinMatch = entryName.match(/(?:^|\/)skins\/skin(\d+)(?:\.bin|\/)/i);
      if (skinMatch?.[1]) targetSkinNums.add(Number(skinMatch[1]));
      if (entryName.endsWith(".wad") || entryName.endsWith(".wad.client")) {
        wadCount += 1;
        maxWadSize = Math.max(maxWadSize, entry.uncompressedSize || 0);
      }
      zipfile.readEntry();
    });
    zipfile.on("end", () => {
      const suspicious = wadCount > 0 && maxWadSize > 0 && maxWadSize < SUSPICIOUS_WAD_SIZE;
      resolve({
        wadCount,
        maxWadSize,
        suspicious,
        hasMetaInfo,
        hasMetaDetails,
        hasWadFolder,
        targetWads: [...targetWads].sort((a, b) => a.localeCompare(b)),
        targetSkinNums: [...targetSkinNums].sort((a, b) => a - b)
      });
    });
    zipfile.on("error", () => resolve({}));
  });
});

const readArchiveMetaInfo = (filePath) => new Promise((resolve) => {
  const extension = filePath.toLowerCase().endsWith(".wad.client") ? ".wad.client" : path.extname(filePath).toLowerCase();
  if (![".zip", ".fantome"].includes(extension)) {
    resolve(null);
    return;
  }

  yauzl.open(filePath, { lazyEntries: true }, (error, zipfile) => {
    if (error || !zipfile) {
      resolve(null);
      return;
    }

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      zipfile.close();
      resolve(value);
    };

    zipfile.readEntry();
    zipfile.on("entry", (entry) => {
      if (entry.fileName.toLowerCase() !== "meta/info.json") {
        zipfile.readEntry();
        return;
      }

      zipfile.openReadStream(entry, (streamError, stream) => {
        if (streamError || !stream) {
          finish(null);
          return;
        }
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", () => {
          try {
            finish(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            finish(null);
          }
        });
        stream.on("error", () => finish(null));
      });
    });
    zipfile.on("end", () => finish(null));
    zipfile.on("error", () => finish(null));
  });
});

const processSkinPackage = async (item, metadata) => {
  const parts = item.relativePath.split(path.sep).filter(Boolean);
  const offset = parts[0]?.toLowerCase() === "skins" ? 1 : 0;
  const repoParts = parts.slice(offset);
  const rawChampion = repoParts[0] || "Sin campeon";
  const rawSkin = repoParts[1] || stripModExtension(item.name);
  const rawVariant = repoParts.length >= 3 ? repoParts[2] : "";
  const championEntry = metadata?.championsByKey.get(String(rawChampion));
  const fileBase = stripModExtension(item.name);
  const fileBaseId = fileBase.match(/^\d+$/) ? fileBase : "";
  const archiveInfo = item.archiveInfo || {};
  const packageExtension = String(item.extension || "").toLowerCase();
  const metaInfo = archiveInfo.hasMetaInfo ? await readArchiveMetaInfo(item.path).catch(() => null) : null;
  const baseSkinCandidates = [fileBase, rawSkin, repoParts.at(-2) || "", metaInfo?.Name || "", rawVariant];

  let champion = championEntry?.name || rawChampion;
  let skin = rawSkin;
  let variant = rawVariant;
  let skins = championEntry ? await getChampionSkins(rawChampion).catch(() => new Map()) : new Map();
  let skinDetails = championEntry ? await getChampionSkinDetails(rawChampion).catch(() => null) : null;
  let championKey = championEntry?.id || "";
  let championId = championEntry?.key || "";
  let skinNum = null;
  let imageSkinNum = null;
  let baseImageSkinNum = null;
  let numericSource = isNumericId(rawChampion) || isNumericId(rawSkin) || isNumericId(fileBaseId);
  const localPreview = await getLocalPreviewInfo(item, repoParts).catch(() => ({
    localPreviewPath: "",
    localPreviewUrl: "",
    localPreviewUri: ""
  }));

  if (championEntry) {
    const skinFromPath = skins.get(String(rawSkin));
    const skinFromFile = skins.get(String(fileBaseId));
    const skinFromParent = skins.get(String(repoParts.at(-2) || ""));
    const skinFromMeta = metaInfo?.Name ? skins.get(String(metaInfo.Name)) : "";
    skin = skinFromFile || skinFromParent || skinFromMeta || skinFromPath || rawSkin;
    variant = skins.get(String(rawVariant)) || rawVariant;
    const skinRecord = findSkinRecord(skinDetails, [...baseSkinCandidates, skin]);
    skinNum =
      skinDetails?.recordsById.get(String(fileBaseId))?.num ??
      skinDetails?.recordsById.get(String(rawSkin))?.num ??
      skinDetails?.recordsById.get(String(repoParts.at(-2) || ""))?.num ??
      skinRecord?.num ??
      null;
    imageSkinNum = getSkinArtNum(skinDetails, skinRecord, skinNum);
    baseImageSkinNum = imageSkinNum;
    if (skinRecord?.name) skin = skinRecord.name;
  } else {
    const maybeChampion = metadata?.championsByKey
      ? [...metadata.championsByKey.values()].find((entry) =>
        normalizeChampionName(entry.name) === normalizeChampionName(rawChampion) ||
        normalizeChampionName(entry.id) === normalizeChampionName(rawChampion)
      )
      : null;
    if (maybeChampion) {
      champion = maybeChampion.name;
      championKey = maybeChampion.id;
      championId = maybeChampion.key;
      skins = await getChampionSkins(maybeChampion.key).catch(() => new Map());
      skinDetails = await getChampionSkinDetails(maybeChampion.key).catch(() => null);
      skin = skins.get(String(fileBaseId)) || skins.get(String(metaInfo?.Name || "")) || skins.get(String(rawSkin)) || fileBase;
      const skinRecord = findSkinRecord(skinDetails, [...baseSkinCandidates, skin]);
      skinNum =
        skinDetails?.recordsById.get(String(fileBaseId))?.num ??
        skinRecord?.num ??
        null;
      imageSkinNum = getSkinArtNum(skinDetails, skinRecord, skinNum);
      baseImageSkinNum = imageSkinNum;
      if (skinRecord?.name) skin = skinRecord.name;
    } else {
      skin = fileBase || rawSkin;
    }
  }

  return {
    ...item,
    rawChampion,
    rawSkin,
    rawVariant,
    fileBaseId,
    champion,
    championKey,
    championId,
    skin,
    skinNum,
    imageSkinNum,
    baseImageSkinNum,
    imageUrl: localPreview.localPreviewUrl || "",
    localPreviewPath: localPreview.localPreviewPath,
    localPreviewUri: localPreview.localPreviewUri,
    variant,
    resolved: Boolean(championEntry || skins.has(String(rawSkin)) || skins.has(String(fileBaseId))),
    numericSource,
    archiveInfo,
    metaName: metaInfo?.Name || "",
    needsFantonize: Boolean([".zip", ".wad", ".wad.client"].includes(packageExtension) && archiveInfo.suspicious && championKey && skinNum !== null)
  };
};

const getFallbackSkinPackage = (item) => {
  const parts = String(item.relativePath || item.name || "").split(path.sep).filter(Boolean);
  const offset = parts[0]?.toLowerCase() === "skins" ? 1 : 0;
  const repoParts = parts.slice(offset);
  return {
    ...item,
    rawChampion: repoParts[0] || "Sin campeon",
    rawSkin: repoParts[1] || stripModExtension(item.name),
    rawVariant: repoParts.length >= 3 ? repoParts[2] : "",
    fileBaseId: stripModExtension(item.name).match(/^\d+$/) ? stripModExtension(item.name) : "",
    champion: repoParts[0] || "Sin campeon",
    championKey: "",
    championId: "",
    skin: repoParts[1] || stripModExtension(item.name),
    skinNum: null,
    imageSkinNum: null,
    baseImageSkinNum: null,
    imageUrl: "",
    localPreviewPath: "",
    localPreviewUri: "",
    variant: repoParts.length >= 3 ? repoParts[2] : "",
    resolved: false,
    numericSource: false,
    archiveInfo: item.archiveInfo || {},
    needsFantonize: false
  };
};

const mapWithConcurrency = async (items, limit, mapper) => {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

const indexSkinLibrary = async (folderPath) => {
  const packages = await listModPackages(folderPath);
  const cachedByPath = await readSkinIndexCache(folderPath);
  const indexed = new Array(packages.length);
  const changed = [];

  packages.forEach((item, index) => {
    const cached = cachedByPath.get(item.path);
    if (isCachedSkinFresh(cached, item)) {
      indexed[index] = { ...cached, ...item };
    } else {
      changed.push({ item, index });
    }
  });

  if (changed.length) {
    const metadata = await getSkinMetadata().catch(() => null);
    const processed = await mapWithConcurrency(changed, 24, ({ item }) =>
      processSkinPackage(item, metadata).catch(() => getFallbackSkinPackage(item))
    );
    processed.forEach((skin, changedIndex) => {
      indexed[changed[changedIndex].index] = skin;
    });
  }

  const skins = indexed.filter(Boolean);
  await writeSkinIndexCache(folderPath, skins).catch(() => { });
  return skins;
};

const downloadFile = async (url, destinationPath, onProgress = () => { }) => {
  const response = await fetch(url, {
    headers: {
      "user-agent": "RiftAtlas"
    }
  });

  if (!response.ok) {
    throw new Error(`No pude descargar el archivo (${response.status}).`);
  }
  if (!response.body) {
    throw new Error("La descarga no devolvio contenido.");
  }

  const total = Number(response.headers.get("content-length")) || 0;
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  const writer = createWriteStream(destinationPath);
  const reader = response.body.getReader();
  let downloaded = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      downloaded += value.length;
      writer.write(Buffer.from(value));
      onProgress({ downloaded, total, percent: total ? Math.round((downloaded / total) * 100) : undefined });
    }
    writer.end();
    await once(writer, "finish");
  } catch (error) {
    writer.destroy();
    throw error;
  }

  return destinationPath;
};

const downloadAndIndexLeagueSkins = async (window) => {
  const repo = await fetchJsonWithTimeout(LEAGUE_SKINS_REPO_API, {
    headers: { "user-agent": "RiftAtlas" }
  });
  const branch = repo.default_branch || "main";
  const downloadUrl = `https://codeload.github.com/Alban1911/LeagueSkins/zip/refs/heads/${encodeURIComponent(branch)}`;
  const installRoot = path.join(getAppDataDir(), "downloaded-libraries");
  const targetDir = path.join(installRoot, "LeagueSkins");
  const tempDir = path.join(installRoot, "LeagueSkins.download");
  const zipPath = path.join(tempDir, "LeagueSkins.zip");

  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
  await fs.mkdir(tempDir, { recursive: true });
  await downloadFile(downloadUrl, zipPath, (progress) => {
    sendDownloadProgress(window, {
      type: "league-skins",
      message: "Descargando LeagueSkins...",
      ...progress
    });
  });
  sendDownloadProgress(window, {
    type: "league-skins",
    message: "Descarga de LeagueSkins completa. Extrayendo...",
    percent: 100
  });
  await extractZip(zipPath, { dir: tempDir });
  sendDownloadProgress(window, {
    type: "league-skins",
    message: "LeagueSkins extraido. Preparando biblioteca..."
  });

  const entries = await fs.readdir(tempDir, { withFileTypes: true });
  const extractedRoot = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(tempDir, entry.name))
    .find((entryPath) => path.basename(entryPath).toLowerCase().includes("leagueskins"));

  if (!extractedRoot) {
    throw new Error("No pude encontrar la carpeta extraida de LeagueSkins.");
  }

  await fs.rm(targetDir, { recursive: true, force: true }).catch(() => { });
  await fs.rename(extractedRoot, targetDir);
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
  sendDownloadProgress(window, {
    type: "league-skins",
    message: "Indexando LeagueSkins..."
  });
  const skins = await indexSkinLibrary(targetDir);
  sendDownloadProgress(window, {
    type: "league-skins",
    message: `LeagueSkins listo: ${skins.length} paquete(s).`,
    percent: 100
  });

  return {
    folderPath: targetDir,
    branch,
    skins
  };
};

const getDownloadedLeagueSkinsPath = async () => {
  const targetDir = path.join(getAppDataDir(), "downloaded-libraries", "LeagueSkins");
  const skinsDir = path.join(targetDir, "skins");
  try {
    const stat = await fs.stat(skinsDir);
    return stat.isDirectory() ? targetDir : "";
  } catch {
    return "";
  }
};

const execFileAsync = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { ...options, timeout: 1000 * 60 * 5, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });

const resolveLeagueGameExecutable = async (selectedPath) => {
  const target = String(selectedPath || "");
  if (!target.toLowerCase().endsWith(".exe")) {
    throw new Error("Configura League of Legends.exe antes de importar.");
  }

  const filename = path.basename(target).toLowerCase();
  const candidates = filename === "leagueclient.exe"
    ? [path.join(path.dirname(target), "Game", "League of Legends.exe")]
    : [target, path.join(path.dirname(target), "Game", "League of Legends.exe")];

  for (const candidate of candidates) {
    if (path.basename(candidate).toLowerCase() !== "league of legends.exe") {
      continue;
    }

    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }

  throw new Error("Selecciona el ejecutable del juego: ...\\League of Legends\\Game\\League of Legends.exe, no LeagueClient.exe.");
};

const normalizeVersion = (value = "") =>
  String(value || "").trim().replace(/^v/i, "");

const compareVersions = (left, right) => {
  const leftParts = normalizeVersion(left).split(/\.|-|_/).map((part) => Number(part) || 0);
  const rightParts = normalizeVersion(right).split(/\.|-|_/).map((part) => Number(part) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const a = leftParts[index] || 0;
    const b = rightParts[index] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }

  return 0;
};

const getAppReleaseInfo = async () => {
  const headers = { Accept: "application/vnd.github.v3+json" };
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
    headers.Authorization = `token ${process.env.GITHUB_TOKEN || process.env.GH_TOKEN}`;
  }
  return await fetchJsonWithTimeout(RIFT_ATLAS_RELEASE_API, { headers }, 15000);
};

ipcMain.handle("app:check-updates", async () => {
  const currentVersion = app.getVersion();
  const release = await getAppReleaseInfo();
  const latestVersion = normalizeVersion(release.tag_name || release.name || "");
  if (!latestVersion) {
    throw new Error("El ultimo release no tiene version.");
  }

  const setupAsset = (release.assets || []).find((asset) =>
    /\.exe$/i.test(asset.name || "") && /setup|rift|atlas/i.test(asset.name || "")
  ) || (release.assets || []).find((asset) => /\.exe$/i.test(asset.name || ""));
  const latestMetadataAsset = (release.assets || []).find((asset) => /^latest\.ya?ml$/i.test(asset.name || ""));
  const downloadUrl = setupAsset?.browser_download_url || release.html_url || "";

  return {
    currentVersion,
    latestVersion,
    releaseName: release.name || release.tag_name || latestVersion,
    releaseUrl: release.html_url || "",
    downloadUrl,
    assetName: setupAsset?.name || "",
    hasAutoUpdate: Boolean(setupAsset && latestMetadataAsset),
    latestMetadataName: latestMetadataAsset?.name || "",
    publishedAt: release.published_at || "",
    notes: String(release.body || "").slice(0, 1200),
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0
  };
});

ipcMain.handle("app:download-update", async (event, payload = {}) => {
  const release = await getAppReleaseInfo();
  const currentVersion = app.getVersion();
  const latestVersion = normalizeVersion(release.tag_name || release.name || "");
  if (!latestVersion || compareVersions(latestVersion, currentVersion) <= 0) {
    throw new Error("No hay una actualizacion nueva para instalar.");
  }

  if (!app.isPackaged && process.env.RIFT_ATLAS_ALLOW_DEV_UPDATE !== "1") {
    throw new Error("La instalacion automatica solo funciona en la app instalada. En desarrollo, usa el instalador del release.");
  }

  const latestMetadataAsset = (release.assets || []).find((asset) => /^latest\.ya?ml$/i.test(asset.name || ""));
  if (!latestMetadataAsset) {
    throw new Error("El release no tiene latest.yml. Ejecuta npm run dist y sube el .exe, .blockmap y latest.yml al release.");
  }

  const window = BrowserWindow.fromWebContents(event.sender);
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "BEF172",
    repo: "Rift"
  });

  const sendUpdateProgress = (payload) => {
    sendDownloadProgress(window, { type: "app-update", ...payload });
  };
  const progressHandler = (progress) => {
    sendUpdateProgress({
      message: `Descargando Rift Atlas ${latestVersion}...`,
      downloaded: progress.transferred,
      total: progress.total,
      percent: progress.percent
    });
  };
  const errorHandler = (error) => {
    sendUpdateProgress({
      message: `Error descargando actualizacion: ${error.message || error}`
    });
  };

  autoUpdater.on("download-progress", progressHandler);
  autoUpdater.once("error", errorHandler);
  sendDownloadProgress(BrowserWindow.fromWebContents(event.sender), {
    type: "app-update",
    message: `Descargando Rift Atlas ${latestVersion}...`,
    percent: 0
  });

  try {
    const updateCheck = await autoUpdater.checkForUpdates();
    const updateInfo = updateCheck?.updateInfo;
    const updaterVersion = normalizeVersion(updateInfo?.version || "");
    if (!updaterVersion || compareVersions(updaterVersion, currentVersion) <= 0) {
      throw new Error("No hay una actualizacion nueva disponible para electron-updater.");
    }

    await autoUpdater.downloadUpdate();
    sendUpdateProgress({
      message: "Actualizacion descargada. Reiniciando para instalar...",
      percent: 100
    });

    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true);
    }, 800);

    return {
      version: updaterVersion,
      assetName: payload.assetName || `Rift Atlas ${updaterVersion}`,
      installing: true
    };
  } finally {
    autoUpdater.removeListener("download-progress", progressHandler);
    autoUpdater.removeListener("error", errorHandler);
  }
});

const cleanupUpdateInstallers = async () => {
  const candidates = [
    path.join(getAppDataDir(), "updates"),
    path.join(getAppDataDir(), "pending"),
    path.join(app.getPath("temp"), "Rift Atlas-updater"),
    path.join(app.getPath("temp"), "rift-atlas-updater"),
    path.join(app.getPath("temp"), `${app.getName()}-updater`)
  ];
  if (process.platform === "win32") {
    candidates.push(
      path.join(app.getPath("appData"), `${app.getName()}-updater`),
      path.join(process.env.LOCALAPPDATA || "", `${app.getName()}-updater`)
    );
  }

  for (const target of [...new Set(candidates.filter(Boolean).map((item) => path.resolve(item)))]) {
    const base = path.basename(target).toLowerCase();
    if (!/(updates?|pending|updater)/i.test(base)) continue;
    await fs.rm(target, { recursive: true, force: true }).catch(() => { });
  }
};

ipcMain.handle("app:open-external", (_event, url) => {
  const target = String(url || "");
  if (!target.startsWith("https://github.com/") && !target.startsWith("https://u.gg/") && !target.startsWith("https://www.metasrc.com/") && !target.startsWith("https://op.gg/") && !target.startsWith("https://developer.riotgames.com/")) {
    throw new Error("URL externa no permitida.");
  }

  shell.openExternal(target);
  return true;
});

ipcMain.handle("app:get-user-data-path", () => getAppDataDir());
ipcMain.handle("app:get-version", () => app.getVersion());

ipcMain.handle("app:get-startup-flags", () => ({
  ...startupFlags,
  firstRun: isFirstRun()
}));

ipcMain.handle("app:mark-first-run-complete", async () => {
  await fs.mkdir(path.dirname(getFirstRunSentinelPath()), { recursive: true });
  await fs.writeFile(getFirstRunSentinelPath(), new Date().toISOString(), "utf8");
  return true;
});

ipcMain.on("app:tutorial-log", () => { });

ipcMain.handle("app:factory-reset", async () => {
  const userDataPath = getAppDataDir();
  await cancelOverlayRun("Restablecer de fabrica.").catch(() => false);
  if (runningOverlayProcess) {
    runningOverlayProcess.stdin?.write("\n");
    runningOverlayProcess.kill();
    runningOverlayProcess = null;
  }
  await uninstallPenguLoader().catch(() => {});
  await terminatePenguLoaderUi().catch(() => {});

  const resetTargets = [
    "cache",
    "cslol-overlay-cache",
    "cslol-profiles",
    "downloaded-libraries",
    "downloaded-updates",
    "engine",
    "hashtable",
    "ltk-dll",
    "mod-files",
    "mod-staging-cache",
    "party-files",
    "pengu-loader",
    "Pengu Loader",
    "presets",
    "skin-library-index.json",
    "engine-version.txt",
    "overlay.log",
    "last-overlay-log.txt",
    ".first-run-complete"
  ].map((entry) => path.join(userDataPath, entry));

  const removed = [];
  const failed = [];
  for (const target of resetTargets) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      removed.push(target);
    } catch (error) {
      failed.push({ target, error: error.message });
    }
  }

  app.relaunch({
    args: [...process.argv.slice(1), "--rift-atlas-show-tutorial"]
  });
  app.exit(0);
  return { scheduled: true, userDataPath, removed, failed };
});

ipcMain.handle("app:get-engine-dll-status", async () => {
  const engineDir = path.join(getAppDataDir(), "engine");
  const dllPath = path.join(engineDir, "cslol-dll.dll");
  const exists = await fs.access(dllPath).then(() => true).catch(() => false);
  return { exists, engineDir, dllPath };
});

ipcMain.handle("app:open-engine-folder", async () => {
  const engineDir = path.join(getAppDataDir(), "engine");
  await fs.mkdir(engineDir, { recursive: true });
  const error = await shell.openPath(engineDir);
  if (error) {
    throw new Error(error);
  }
  return engineDir;
});

ipcMain.handle("app:open-user-data-path", async () => {
  const targetPath = getAppDataDir();
  await fs.mkdir(targetPath, { recursive: true });
  const error = await shell.openPath(targetPath);
  if (error) {
    throw new Error(error);
  }
  return targetPath;
});

ipcMain.handle("library:read-index", async () => {
  return skinsIndexStore.read();
});

ipcMain.handle("library:write-index", async (_event, payload = {}) => {
  return skinsIndexStore.write(payload);
});

ipcMain.handle("library:select-preview-image", async () => {
  const result = await dialog.showOpenDialog({
    title: "Seleccionar preview",
    properties: ["openFile"],
    filters: [
      { name: "Imagenes", extensions: ["png", "jpg", "jpeg", "webp"] },
      { name: "Todos", extensions: ["*"] }
    ]
  });
  return result.canceled ? "" : result.filePaths[0] || "";
});

ipcMain.handle("library:cache-preview", async (_event, payload = {}) => {
  const source = String(payload.source || "");
  const key = crypto.createHash("sha1").update(String(payload.key || source || Date.now())).digest("hex");
  const cacheDir = getPreviewCacheDir();
  await fs.mkdir(cacheDir, { recursive: true });
  let buffer = null;
  let extension = ".jpg";

  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, { headers: { "user-agent": "RiftAtlas" } });
    if (!response.ok) throw new Error(`No pude cachear preview (${response.status}).`);
    buffer = Buffer.from(await response.arrayBuffer());
    const contentType = String(response.headers.get("content-type") || "");
    extension = contentType.includes("png") ? ".png" : contentType.includes("webp") ? ".webp" : ".jpg";
  } else if (source) {
    buffer = await fs.readFile(source);
    const ext = path.extname(source).toLowerCase();
    extension = [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? ext : ".png";
  }

  if (!buffer) throw new Error("Preview vacia.");
  const previewPath = path.join(cacheDir, `${key}${extension}`);
  await fs.writeFile(previewPath, buffer);
  return { previewPath, previewUrl: pathToFileURL(previewPath).href };
});

const getMaintenanceDirInfo = async (name, relativePath) => {
  const targetPath = path.join(getAppDataDir(), relativePath);
  const exists = await fileExists(targetPath);
  return {
    name,
    path: targetPath,
    exists,
    size: exists ? await getDirectorySize(targetPath).catch(() => 0) : 0
  };
};

ipcMain.handle("maintenance:status", async () => {
  const targets = await Promise.all([
    getMaintenanceDirInfo("Overlays", "cslol-overlay-cache"),
    getMaintenanceDirInfo("Previews", path.join("cache", "previews")),
    getMaintenanceDirInfo("Party P2P", "p2p"),
    getMaintenanceDirInfo("Party transfers", "party-transfers"),
    getMaintenanceDirInfo("Descargas temporales", "downloads"),
    getMaintenanceDirInfo("Mod staging", "mod-staging-cache")
  ]);
  return { appDataDir: getAppDataDir(), targets };
});

ipcMain.handle("maintenance:cleanup", async (_event, payload = {}) => {
  const allowed = new Map([
    ["overlays", "cslol-overlay-cache"],
    ["previews", path.join("cache", "previews")],
    ["party", "p2p"],
    ["party-transfers", "party-transfers"],
    ["downloads", "downloads"],
    ["staging", "mod-staging-cache"]
  ]);
  const requested = Array.isArray(payload.targets) ? payload.targets : [];
  const removed = [];
  for (const key of requested) {
    const relativePath = allowed.get(key);
    if (!relativePath) continue;
    const targetPath = path.resolve(path.join(getAppDataDir(), relativePath));
    const appDataRoot = path.resolve(getAppDataDir());
    if (targetPath !== appDataRoot && targetPath.startsWith(`${appDataRoot}${path.sep}`)) {
      await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
      removed.push(targetPath);
    }
  }
  return { removed };
});

ipcMain.handle("maintenance:export-diagnostics", async (_event, payload = {}) => {
  const exportPath = path.join(getAppDataDir(), `rift-atlas-diagnostics-${Date.now()}.json`);
  const diagnostics = {
    createdAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    appDataDir: getAppDataDir(),
    payload,
    maintenance: await Promise.all([
      getMaintenanceDirInfo("Overlays", "cslol-overlay-cache"),
      getMaintenanceDirInfo("Previews", path.join("cache", "previews")),
      getMaintenanceDirInfo("Party P2P", "p2p"),
      getMaintenanceDirInfo("Mod staging", "mod-staging-cache")
    ])
  };
  await fs.writeFile(exportPath, JSON.stringify(diagnostics, null, 2), "utf8");
  shell.showItemInFolder(exportPath);
  return { exportPath };
});

ipcMain.handle("maintenance:open-logs-folder", async () => {
  const targetPath = getAppDataDir();
  await fs.mkdir(targetPath, { recursive: true });
  const error = await shell.openPath(targetPath);
  if (error) throw new Error(error);
  return targetPath;
});

ipcMain.handle("pengu:download-loader", async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return downloadAndInstallPenguLoaderPortable(window);
});

ipcMain.handle("pengu:open-loader-folder", async () => {
  const targetPath = getPenguLoaderRuntimeDir();
  await fs.mkdir(targetPath, { recursive: true });
  const error = await shell.openPath(targetPath);
  if (error) {
    throw new Error(error);
  }
  return targetPath;
});

ipcMain.handle("pengu:get-loader-status", async () => {
  const executablePath = await findBundledPenguLoaderExecutable();
  return {
    executablePath,
    running: await isPenguLoaderRunning(),
    ...(await getPenguLoaderActivationStatus(executablePath))
  };
});

ipcMain.handle("pengu:launch-loader", async () => launchPenguLoader({
  allowElevation: true,
  requireLeagueReady: true,
  source: "manual"
}));

ipcMain.handle("pengu:deactivate-loader", async () => deactivatePenguLoader({ allowElevation: true }));

ipcMain.handle("pengu:uninstall-loader", async () => uninstallPenguLoader());

ipcMain.handle("pengu:close-loader-ui", async () => ({ closed: await terminatePenguLoaderUi() }));

ipcMain.handle("pengu:install-rift-plugin", async () => installRiftAtlasPenguPlugin());

ipcMain.handle("pengu:send-message", async (_event, payload = {}) => ({
  sent: sendPenguBridgeMessage(payload)
}));

ipcMain.handle("mods:select-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Seleccionar carpeta de mods o skins",
    properties: ["openDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  const folderPath = result.filePaths[0];
  return {
    folderPath,
    packages: await listModPackages(folderPath)
  };
});

ipcMain.handle("mods:select-custom-mod-files", async () => {
  const result = await dialog.showOpenDialog({
    title: "Agregar mods propios",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Mods compatibles", extensions: ["fantome", "zip", "rse", "wad", "client"] },
      { name: "Todos", extensions: ["*"] }
    ]
  });

  if (result.canceled || !result.filePaths.length) {
    return [];
  }

  const packages = await Promise.all(result.filePaths.map((filePath) => getModPackageFromFile(filePath)));
  return packages.filter(Boolean);
});

const enrichLocalModPackages = async (folderPath) => {
  const packages = await listModPackages(folderPath);
  const enriched = await Promise.all(packages.map((item) => getModPackageFromFile(item.path, folderPath)));
  return enriched.filter(Boolean).map((item) => ({ ...item, custom: true }));
};

const getUserModsRoot = () => path.join(getAppDataDir(), "mods");
const ensureUserModsLayout = async () => {
  const root = getUserModsRoot();
  const categories = ["skins", "maps", "fonts", "announcers", "ui", "ux", "voiceover", "loading_screen", "vfx", "sfx", "others"];
  await Promise.all(categories.map((category) => fs.mkdir(path.join(root, category), { recursive: true })));
  return root;
};

ipcMain.handle("mods:open-user-mods-folder", async () => {
  const folderPath = await ensureUserModsLayout();
  const error = await shell.openPath(folderPath);
  if (error) throw new Error(error);
  return { folderPath };
});

ipcMain.handle("mods:open-custom-skin-mod-folder", async (_event, skinId) => {
  const numericSkinId = Number(skinId || 0);
  if (!numericSkinId) throw new Error("Skin ID invalido.");
  const root = await ensureUserModsLayout();
  const folderPath = path.join(root, "skins", String(numericSkinId));
  await fs.mkdir(folderPath, { recursive: true });
  const error = await shell.openPath(folderPath);
  if (error) throw new Error(error);
  return { folderPath, skinId: numericSkinId };
});

const normalizeUserModCategory = (category = "") => {
  switch (String(category || "").trim().toLowerCase()) {
    case "map":
    case "maps":
      return "maps";
    case "font":
    case "fonts":
      return "fonts";
    case "announcer":
    case "announcers":
      return "announcers";
    case "ui":
      return "ui";
    case "ux":
      return "ux";
    case "voice":
    case "voiceover":
    case "voice_over":
      return "voiceover";
    case "loading":
    case "loading_screen":
    case "loading-screen":
      return "loading_screen";
    case "vfx":
      return "vfx";
    case "sfx":
      return "sfx";
    case "other":
    case "others":
    case "misc":
      return "others";
    default:
      return "";
  }
};

ipcMain.handle("mods:open-custom-mod-category-folder", async (_event, category) => {
  const normalizedCategory = normalizeUserModCategory(category);
  if (!normalizedCategory) throw new Error("Categoria de mod invalida.");
  const root = await ensureUserModsLayout();
  const folderPath = path.join(root, normalizedCategory);
  await fs.mkdir(folderPath, { recursive: true });
  const error = await shell.openPath(folderPath);
  if (error) throw new Error(error);
  return { folderPath, category: normalizedCategory };
});

ipcMain.handle("mods:import-custom-mods-to-skin", async (_event, skinId, files = []) => {
  const numericSkinId = Number(skinId || 0);
  if (!numericSkinId) throw new Error("Selecciona una skin valida antes de agregar mods.");
  const root = await ensureUserModsLayout();
  const folderPath = path.join(root, "skins", String(numericSkinId));
  await fs.mkdir(folderPath, { recursive: true });

  const copiedPaths = [];
  const skippedPaths = [];
  for (const source of Array.isArray(files) ? files : []) {
    const sourcePath = String(source || "");
    const extension = getModPackageExtension(sourcePath);
    if (!sourcePath || !MOD_PACKAGE_EXTENSIONS.has(extension)) {
      skippedPaths.push(sourcePath);
      continue;
    }
    const stat = await fs.stat(sourcePath).catch(() => null);
    if (!stat?.isFile()) {
      skippedPaths.push(sourcePath);
      continue;
    }
    const targetPath = path.join(folderPath, path.basename(sourcePath));
    await fs.copyFile(sourcePath, targetPath);
    copiedPaths.push(targetPath);
  }

  const packages = await Promise.all(copiedPaths.map((filePath) => getModPackageFromFile(filePath, root)));
  return {
    folderPath,
    modsRoot: root,
    skinId: numericSkinId,
    copied: copiedPaths.length,
    skipped: skippedPaths.length,
    skippedPaths,
    packages: packages.filter(Boolean)
  };
});

ipcMain.handle("mods:import-custom-mods-to-category", async (_event, category, files = []) => {
  const normalizedCategory = normalizeUserModCategory(category);
  if (!normalizedCategory) throw new Error("Categoria de mod invalida.");
  const root = await ensureUserModsLayout();
  const folderPath = path.join(root, normalizedCategory);
  await fs.mkdir(folderPath, { recursive: true });

  const copiedPaths = [];
  const skippedPaths = [];
  for (const source of Array.isArray(files) ? files : []) {
    const sourcePath = String(source || "");
    const extension = getModPackageExtension(sourcePath);
    if (!sourcePath || !MOD_PACKAGE_EXTENSIONS.has(extension)) {
      skippedPaths.push(sourcePath);
      continue;
    }
    const stat = await fs.stat(sourcePath).catch(() => null);
    if (!stat?.isFile()) {
      skippedPaths.push(sourcePath);
      continue;
    }
    const targetPath = path.join(folderPath, path.basename(sourcePath));
    await fs.copyFile(sourcePath, targetPath);
    copiedPaths.push(targetPath);
  }

  const packages = await Promise.all(copiedPaths.map((filePath) => getModPackageFromFile(filePath, root)));
  return {
    folderPath,
    modsRoot: root,
    category: normalizedCategory,
    copied: copiedPaths.length,
    skipped: skippedPaths.length,
    skippedPaths,
    packages: packages.filter(Boolean)
  };
});

ipcMain.handle("mods:index-user-mods-folder", async () => {
  const folderPath = await ensureUserModsLayout();
  return {
    folderPath,
    packages: await enrichLocalModPackages(folderPath)
  };
});

ipcMain.handle("mods:select-custom-mod-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Agregar carpeta de mods propios",
    properties: ["openDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return {
      folderPath: "",
      packages: []
    };
  }

  const folderPath = result.filePaths[0];
  return {
    folderPath,
    packages: await enrichLocalModPackages(folderPath)
  };
});

ipcMain.handle("mods:index-custom-mod-folder", async (_event, folderPath) => {
  const resolvedFolder = String(folderPath || "");
  if (!resolvedFolder) {
    return {
      folderPath: "",
      packages: []
    };
  }

  const stat = await fs.stat(resolvedFolder);
  if (!stat.isDirectory()) {
    throw new Error("La ruta de mods propios no es una carpeta.");
  }

  return {
    folderPath: resolvedFolder,
    packages: await enrichLocalModPackages(resolvedFolder)
  };
});

ipcMain.handle("mods:index-custom-mod-files", async (_event, filePaths = []) => {
  const paths = Array.isArray(filePaths) ? filePaths : [];
  const packages = await Promise.all(paths.map((filePath) => getModPackageFromFile(String(filePath || "")).catch(() => null)));
  return packages.filter(Boolean).map((item) => ({ ...item, custom: true }));
});

ipcMain.handle("mods:reveal-path", (_event, filePath) => {
  shell.showItemInFolder(String(filePath || ""));
  return true;
});

ipcMain.handle("mods:select-league-game", async () => {
  const result = await dialog.showOpenDialog({
    title: "Seleccionar Game\\League of Legends.exe",
    properties: ["openFile"],
    filters: [{ name: "League of Legends", extensions: ["exe"] }]
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  return resolveLeagueGameExecutable(result.filePaths[0]);
});

const getLeagueFinalDirFromGamePath = async (leagueGamePath = "") => {
  const executablePath = await resolveLeagueGameExecutable(String(leagueGamePath || ""));
  return path.join(path.dirname(executablePath), "Data", "FINAL");
};

const readLeagueFinalManifest = async () => {
  const manifestPath = getPackagedAssetPath("assets", "league-final-manifest.txt");
  const content = await fs.readFile(manifestPath, "utf8");
  const entries = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [relativePath = "", fileName = "", sizeText = "0"] = line.split("\t");
      return {
        relativePath: relativePath.replace(/\\/g, "/"),
        fileName,
        size: Number(sizeText) || 0
      };
    })
    .filter((entry) => entry.relativePath);
  return { manifestPath, entries };
};

const listLeagueFinalFiles = async (finalDir) => {
  const entries = [];
  const walk = async (currentDir) => {
    const dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of dirEntries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(entryPath);
      entries.push({
        absolutePath: entryPath,
        relativePath: path.relative(finalDir, entryPath).replace(/\\/g, "/"),
        fileName: entry.name,
        size: stat.size
      });
    }
  };
  await walk(finalDir);
  return entries;
};

ipcMain.handle("mods:check-league-install", async (_event, payload = {}) => {
  const finalDir = await getLeagueFinalDirFromGamePath(payload.leagueGamePath);
  await fs.access(finalDir);

  const { manifestPath, entries: expectedEntries } = await readLeagueFinalManifest();
  const actualEntries = await listLeagueFinalFiles(finalDir);
  const actualByPath = new Map(actualEntries.map((entry) => [entry.relativePath.toLowerCase(), entry]));
  const expectedByPath = new Map(expectedEntries.map((entry) => [entry.relativePath.toLowerCase(), entry]));
  const missing = [];
  const sizeMismatch = [];

  for (const expected of expectedEntries) {
    const actual = actualByPath.get(expected.relativePath.toLowerCase());
    if (!actual) {
      missing.push(expected);
      continue;
    }
    if (actual.size !== expected.size) {
      sizeMismatch.push({
        relativePath: expected.relativePath,
        fileName: expected.fileName,
        expectedSize: expected.size,
        actualSize: actual.size
      });
    }
  }

  const extra = actualEntries.filter((entry) => !expectedByPath.has(entry.relativePath.toLowerCase()));
  const ok = missing.length === 0 && sizeMismatch.length === 0;

  return {
    ok,
    finalDir,
    manifestPath,
    expectedCount: expectedEntries.length,
    actualCount: actualEntries.length,
    missingCount: missing.length,
    mismatchCount: sizeMismatch.length,
    extraCount: extra.length,
    missing: missing.slice(0, 30),
    sizeMismatch: sizeMismatch.slice(0, 30),
    extra: extra.slice(0, 30)
  };
});

ipcMain.handle("mods:select-ltk", async () => {
  const result = await dialog.showOpenDialog({
    title: "Seleccionar LTK Manager",
    properties: ["openFile"],
    filters: [{ name: "Ejecutable", extensions: ["exe"] }]
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("mods:open-ltk", async (_event, executablePath) => {
  const target = String(executablePath || "");
  if (!target.toLowerCase().endsWith(".exe")) {
    throw new Error("Selecciona un ejecutable .exe de LTK Manager.");
  }

  const error = await shell.openPath(target);
  if (error) {
    throw new Error(error);
  }

  return true;
});

const LTK_DATA_DIR = path.join(getAppDataDir(), "ltk-manager");

ipcMain.handle("ltk:detect", async () => {
  const candidates = [
    "C:\\Program Files\\LTK Manager\\ltk-manager.exe",
    "C:\\Program Files (x86)\\LTK Manager\\ltk-manager.exe",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "ltk-manager", "ltk-manager.exe"),
    path.join(process.env.LOCALAPPDATA || "", "ltk-manager", "ltk-manager.exe"),
    path.join(process.env.APPDATA || "", "ltk-manager", "ltk-manager.exe")
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch { }
  }
  return null;
});

ipcMain.handle("ltk:get-status", async (_event, payload) => {
  const exePath = String(payload?.exePath || "");
  let exeExists = false;
  try { await fs.access(exePath); exeExists = true; } catch { }

  const dataDir = LTK_DATA_DIR;
  let dataDirExists = false;
  try { await fs.access(dataDir); dataDirExists = true; } catch { }

  let library = null;
  try {
    const content = await fs.readFile(path.join(dataDir, "library.json"), "utf8");
    library = JSON.parse(content);
  } catch { }

  return { exePath, exeExists, dataDir, dataDirExists, library };
});

ipcMain.handle("ltk:import-mods", async (_event, payload) => {
  const mods = payload?.mods || [];
  if (!mods.length) throw new Error("No hay mods para importar.");

  const dataDir = LTK_DATA_DIR;
  const archivesDir = path.join(dataDir, "archives");
  const modsDir = path.join(dataDir, "mods");
  const libraryPath = path.join(dataDir, "library.json");
  const archivesMetaPath = path.join(dataDir, "archives.json");

  await fs.mkdir(archivesDir, { recursive: true });
  await fs.mkdir(modsDir, { recursive: true });

  let library = { profiles: [], mods: [], folders: [], last_opened: null };
  let archivesMeta = { archives: [] };

  try {
    const libContent = await fs.readFile(libraryPath, "utf8");
    library = JSON.parse(libContent);
    if (!library.mods) library.mods = [];
    if (!library.profiles) library.profiles = [];
    if (!library.folders) library.folders = [];
  } catch { }

  try {
    const archContent = await fs.readFile(archivesMetaPath, "utf8");
    archivesMeta = JSON.parse(archContent);
    if (!archivesMeta.archives) archivesMeta.archives = [];
  } catch { }

  const existingNames = new Set();
  for (const m of library.mods) {
    if (m.source_filename) existingNames.add(m.source_filename.toLowerCase());
  }
  for (const a of archivesMeta.archives) {
    if (a.original_name) existingNames.add(a.original_name.toLowerCase());
  }

  const results = [];

  for (const mod of mods) {
    const sourcePath = String(mod.path || "");
    if (!sourcePath) continue;

    try { await fs.access(sourcePath); } catch {
      results.push({ path: sourcePath, success: false, error: "Archivo no encontrado" });
      continue;
    }

    const ext = path.extname(sourcePath).toLowerCase();
    if (ext !== ".fantome" && ext !== ".modpkg") {
      results.push({ path: sourcePath, success: false, error: `Extension no soportada: ${ext}. Usa .fantome o .modpkg.` });
      continue;
    }

    const sourceFilename = path.basename(sourcePath);

    if (existingNames.has(sourceFilename.toLowerCase())) {
      results.push({ path: sourcePath, success: true, skipped: true, message: "Ya importado anteriormente" });
      continue;
    }

    const modId = crypto.randomUUID();
    const displayName = `${mod.champion || "Desconocido"} - ${mod.skin || sourceFilename}${mod.variant ? ` - ${mod.variant}` : ""}`;

    const archivePath = path.join(archivesDir, `${modId}${ext}`);
    await fs.copyFile(sourcePath, archivePath);

    const stat = await fs.stat(sourcePath);
    const now = new Date().toISOString();

    archivesMeta.archives.push({
      id: modId,
      original_name: sourceFilename,
      title: displayName,
      size: stat.size,
      compression: null,
      created_at: now
    });

    const modConfig = {
      id: modId,
      title: displayName,
      author: "",
      version: "1.0.0",
      description: "",
      groups: [],
      tags: [],
      color: null,
      size: stat.size,
      installed_size: null,
      enabled: true,
      source_archive: modId,
      source_filename: sourceFilename,
      champion_name: mod.champion || "",
      skin_name: mod.skin || "",
      created_at: now
    };

    const modConfigDir = path.join(modsDir, modId);
    await fs.mkdir(modConfigDir, { recursive: true });
    await fs.writeFile(path.join(modConfigDir, "mod.config.json"), JSON.stringify(modConfig, null, 2));

    library.mods.push(modConfig);
    existingNames.add(sourceFilename.toLowerCase());

    results.push({ path: sourcePath, modId, displayName, success: true });
  }

  const now = new Date().toISOString();
  let riftProfile = library.profiles.find((p) => p.name === "Rift Atlas");
  if (!riftProfile) {
    riftProfile = {
      id: crypto.randomUUID(),
      name: "Rift Atlas",
      mods: library.mods.map((m) => ({ id: m.id, enabled: true })),
      created_at: now
    };
    library.profiles.push(riftProfile);
  } else {
    const existingIds = new Set(riftProfile.mods.map((m) => m.id));
    for (const mc of library.mods) {
      if (!existingIds.has(mc.id)) {
        riftProfile.mods.push({ id: mc.id, enabled: true });
      }
    }
  }

  library.last_opened = riftProfile.id;

  await fs.writeFile(libraryPath, JSON.stringify(library, null, 2));
  await fs.writeFile(archivesMetaPath, JSON.stringify(archivesMeta, null, 2));

  return {
    success: true,
    imported: results.filter((r) => r.success && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => !r.success).length,
    results,
    profileId: riftProfile.id
  };
});

ipcMain.handle("mods:select-bocchi-sidecar", async () => {
  const result = await dialog.showOpenDialog({
    title: "Seleccionar engine propio (ltk-manager.exe)",
    properties: ["openFile", "openDirectory"],
    filters: [{ name: "Ejecutable", extensions: ["exe"] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return resolveHitoriEngineExecutable(result.filePaths[0]);
});

ipcMain.handle("mods:select-bocchi-dll", async () => {
  const result = await dialog.showOpenDialog({
    title: "Seleccionar cslol-dll.dll",
    buttonLabel: "Seleccionar DLL",
    properties: ["openFile"],
    filters: [{ name: "DLL", extensions: ["dll"] }]
  });

  if (result.canceled || !result.filePaths?.[0]) return null;
  const selectedPath = result.filePaths[0];
  const engineDir = path.join(getAppDataDir(), "engine");
  const installedDllPath = path.join(engineDir, "cslol-dll.dll");

  await fs.mkdir(engineDir, { recursive: true });
  await fs.copyFile(selectedPath, installedDllPath);
  return installedDllPath;
});

const findExistingPath = async (candidates) => {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch { }
  }
  return null;
};

const copyDirectory = async (sourcePath, destinationPath) => {
  await fs.mkdir(destinationPath, { recursive: true });
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    const sourceEntryPath = path.join(sourcePath, entry.name);
    const destinationEntryPath = path.join(destinationPath, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourceEntryPath, destinationEntryPath);
    } else {
      await fs.copyFile(sourceEntryPath, destinationEntryPath);
    }
  }
};

const extractSevenZipSfx = async (archivePath, extractPath) => {
  await fs.mkdir(extractPath, { recursive: true });
  const tempDir = path.dirname(archivePath);
  const archiveName = path.basename(archivePath);
  const extractDirName = path.basename(extractPath);
  const sevenZip = await createSevenZip();
  const mountRoot = "/nodefs";

  try {
    sevenZip.FS.mkdir(mountRoot);
  } catch { }
  sevenZip.FS.mount(sevenZip.NODEFS, { root: tempDir }, mountRoot);
  sevenZip.FS.chdir(mountRoot);
  sevenZip.callMain(["x", archiveName, `-o${extractDirName}`, "-y"]);
};

const getLatestLtkSetupAsset = async () => {
  const release = await fetchJsonWithTimeout(LTK_REPO_API, {
    headers: { "user-agent": "RiftAtlas" }
  });

  const asset = release.assets?.find((a) =>
    a.name.toLowerCase().endsWith("-setup.exe") ||
    a.name.toLowerCase().includes("setup")
  );

  if (!asset) {
    throw new Error("No encontre el instalador de LTK Manager en el ultimo release.");
  }

  return { release, asset };
};

const getLatestCslolWindowsAsset = async () => {
  const release = await fetchJsonWithTimeout(CSLOL_REPO_API, {
    headers: { "user-agent": "RiftAtlas" }
  });

  const asset = release.assets?.find((a) => a.name.toLowerCase() === "cslol-manager-windows.exe") ||
    release.assets?.find((a) => a.name.toLowerCase().includes("windows") && a.name.toLowerCase().endsWith(".exe"));

  if (!asset) {
    throw new Error("No encontre cslol-manager-windows.exe en el ultimo release.");
  }

  return { release, asset };
};

const getPenguLoaderDownloadDir = () => path.join(getAppDataDir(), "pengu-loader");
const getPenguLoaderRuntimeDir = () => path.join(getAppDataDir(), "Pengu Loader");
const getRiftAtlasPenguPluginsRuntimeDir = () => path.join(getPenguLoaderRuntimeDir(), "plugins");
const getRiftAtlasPenguPluginRuntimeDir = () => path.join(getRiftAtlasPenguPluginsRuntimeDir(), "RiftAtlas-00-Core");
const PENGU_LOADER_EXE_NAMES = ["Pengu Loader.exe", "pengu-loader.exe", "PenguLoader.exe"];

const execFileText = (file, args = [], options = {}) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, timeout: 15000, ...options }, (error, stdout, stderr) => {
    if (error) {
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
      return;
    }
    resolve(String(stdout || ""));
  });
});

const fileExists = async (filePath) => {
  if (!filePath) return false;
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
};

const directoryExists = async (dirPath) => {
  if (!dirPath) return false;
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
};

const getBundledRiftAtlasPenguPluginDir = () => getPackagedAssetPath("Pengu Loader", "plugins", "RiftAtlas-00-Core");
const getBundledRiftAtlasPenguPluginsDir = () => getPackagedAssetPath("Pengu Loader", "plugins");

const installRiftAtlasPenguPlugin = async () => {
  const sourceRoot = getBundledRiftAtlasPenguPluginsDir();
  const fallbackSourceDir = getBundledRiftAtlasPenguPluginDir();
  if (!await directoryExists(sourceRoot) && !await directoryExists(fallbackSourceDir)) {
    throw new Error(`No encontre los plugins de Pengu en ${sourceRoot}.`);
  }
  const targetRoot = getRiftAtlasPenguPluginsRuntimeDir();
  await fs.mkdir(targetRoot, { recursive: true });

  // Snapshot plugin enable state como Rose (index.js = enabled, index.js_ = disabled)
  const enableSnapshot = new Map();
  try {
    const existing = await fs.readdir(targetRoot, { withFileTypes: true });
    for (const entry of existing) {
      if (!entry.isDirectory()) continue;
      const hasIndexJs = await fileExists(path.join(targetRoot, entry.name, "index.js"));
      const hasIndexJsDisabled = await fileExists(path.join(targetRoot, entry.name, "index.js_"));
      enableSnapshot.set(entry.name, hasIndexJs && !hasIndexJsDisabled);
    }
  } catch { /* first install, no snapshot needed */ }

  const sourcePlugins = await directoryExists(sourceRoot)
    ? (await fs.readdir(sourceRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, sourceDir: path.join(sourceRoot, entry.name) }))
    : [{ name: "RiftAtlas-00-Core", sourceDir: fallbackSourceDir }];

  // Replace the complete Rift Atlas plugin set. Keeping old managed folders
  // would run two SkinMonitors after upgrades (the exact race Rose avoids by
  // having a single bridge owner). Third-party Pengu plugins are untouched.
  try {
    const existing = await fs.readdir(targetRoot, { withFileTypes: true });
    await Promise.all(existing
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("RiftAtlas-"))
      .map((entry) => fs.rm(path.join(targetRoot, entry.name), { recursive: true, force: true })));
  } catch { /* first install */ }

  for (const plugin of sourcePlugins) {
    const targetDir = path.join(targetRoot, plugin.name);
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => { });
    await fs.cp(plugin.sourceDir, targetDir, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
  }

  // Restore enable state como Rose
  for (const [name, wasEnabled] of enableSnapshot) {
    if (!wasEnabled) {
      const pluginDir = path.join(targetRoot, name);
      const hasIndexJs = await fileExists(path.join(pluginDir, "index.js"));
      if (hasIndexJs) {
        await fs.rename(path.join(pluginDir, "index.js"), path.join(pluginDir, "index.js_")).catch(() => {});
      }
    }
  }

  const targetDir = getRiftAtlasPenguPluginRuntimeDir();
  return {
    pluginDir: targetDir,
    entryPath: path.join(targetDir, "index.js"),
    plugins: sourcePlugins.map((plugin) => plugin.name)
  };
};

const getPenguLoaderCandidatePaths = () => {
  const bases = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Pengu Loader"),
    path.join(process.env.LOCALAPPDATA || "", "Pengu Loader"),
    path.join(process.env.APPDATA || "", "Pengu Loader"),
    path.join(process.env.PROGRAMFILES || "", "Pengu Loader"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Pengu Loader")
  ].filter(Boolean);

  return bases.flatMap((basePath) => PENGU_LOADER_EXE_NAMES.map((exeName) => path.join(basePath, exeName)));
};

const parseWindowsCommandPath = (value = "") => {
  const trimmed = String(value || "").trim();
  const quoted = trimmed.match(/^"([^"]+\.exe)"/i);
  if (quoted) return quoted[1];
  const plain = trimmed.match(/^(.+?\.exe)(?:\s|$)/i);
  return plain ? plain[1].trim() : trimmed;
};

const findPenguLoaderFromRegistry = async () => {
  if (process.platform !== "win32") return "";
  const roots = [
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
  ];

  for (const root of roots) {
    let output = "";
    try {
      output = await execFileText("reg", ["query", root, "/s"]);
    } catch {
      continue;
    }

    const chunks = output.split(/\r?\n\r?\n/);
    for (const chunk of chunks) {
      if (!/DisplayName\s+REG_\w+\s+Pengu Loader/i.test(chunk)) continue;
      const installLocation = chunk.match(/InstallLocation\s+REG_\w+\s+(.+)/i)?.[1]?.trim();
      const displayIcon = chunk.match(/DisplayIcon\s+REG_\w+\s+(.+)/i)?.[1]?.trim();
      const candidates = [
        ...PENGU_LOADER_EXE_NAMES.map((exeName) => installLocation ? path.join(installLocation, exeName) : ""),
        parseWindowsCommandPath(displayIcon)
      ];
      for (const candidate of candidates) {
        if (await fileExists(candidate)) return candidate;
      }
    }
  }

  return "";
};

const findPenguLoaderExecutable = async () => {
  for (const candidate of getPenguLoaderCandidatePaths()) {
    if (await fileExists(candidate)) return candidate;
  }
  return findPenguLoaderFromRegistry();
};

const findBundledPenguLoaderExecutable = async () => {
  for (const exeName of PENGU_LOADER_EXE_NAMES) {
    const candidate = path.join(getPenguLoaderRuntimeDir(), exeName);
    if (await fileExists(candidate)) return candidate;
  }
  return "";
};

const isPenguLoaderRunning = async () => {
  if (process.platform !== "win32") return false;
  for (const exeName of PENGU_LOADER_EXE_NAMES) {
    try {
      const output = await execFileText("tasklist", ["/FI", `IMAGENAME eq ${exeName}`, "/NH"]);
      if (output.toLowerCase().includes(exeName.toLowerCase())) return true;
    } catch {
      // Keep trying other names.
    }
  }
  return false;
};

const isLeagueClientRunning = async () => {
  if (process.platform !== "win32") return false;
  const names = ["LeagueClient.exe", "LeagueClientUx.exe", "LeagueClientUxRender.exe"];
  for (const name of names) {
    try {
      const output = await execFileText("tasklist", ["/FI", `IMAGENAME eq ${name}`, "/NH"]);
      if (output.toLowerCase().includes(name.toLowerCase())) return true;
    } catch {
      // Keep trying other League client processes.
    }
  }
  return false;
};

const findLeagueClientLockfile = async (leagueClientPath = "") => {
  const candidates = [
    process.env.LCU_LOCKFILE || "",
    leagueClientPath ? path.join(leagueClientPath, "lockfile") : "",
    "C:\\Riot Games\\League of Legends\\lockfile",
    "D:\\Riot Games\\League of Legends\\lockfile",
    path.join(process.env.PROGRAMFILES || "", "Riot Games", "League of Legends", "lockfile"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Riot Games", "League of Legends", "lockfile")
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  if (process.platform === "win32") {
    try {
      const runningPath = (await execFileText("powershell.exe", [
        "-NoProfile",
        "-Command",
        "(Get-Process LeagueClient -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)"
      ], { timeout: 10000 })).trim();
      if (runningPath) {
        const lockfilePath = path.join(path.dirname(runningPath), "lockfile");
        if (await fileExists(lockfilePath)) return lockfilePath;
      }
    } catch {
      // Fall back to static candidates.
    }
  }

  return "";
};

const terminatePenguLoaderUi = async () => {
  if (process.platform !== "win32") return false;
  let terminated = false;
  for (const exeName of PENGU_LOADER_EXE_NAMES) {
    try {
      await execFileText("taskkill", ["/IM", exeName, "/F"], { timeout: 10000 });
      terminated = true;
    } catch {
      // taskkill returns an error when the process is not running.
    }
  }
  return terminated;
};

const getPenguLeagueClientPath = async () => {
  if (process.platform === "win32") {
    try {
      const runningPath = (await execFileText("powershell.exe", [
        "-NoProfile",
        "-Command",
        "(Get-Process LeagueClientUx -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)"
      ], { timeout: 10000 })).trim();
      if (runningPath) {
        const runningDir = path.dirname(runningPath);
        if (await fileExists(path.join(runningDir, "LeagueClient.exe"))) return runningDir;
      }
    } catch {
      // Fall back to the configured game executable.
    }
  }

  const gamePath = await resolveLeagueGameExecutableOptional("");
  if (!gamePath) return "";
  const gameDir = path.dirname(gamePath);
  const leagueRoot = path.dirname(gameDir);
  return await fileExists(path.join(leagueRoot, "LeagueClient.exe")) ? leagueRoot : gameDir;
};

const getPenguLeagueGamePath = async (leagueClientPath = "") => {
  const gameDirFromClient = leagueClientPath ? path.join(leagueClientPath, "Game") : "";
  if (gameDirFromClient && await fileExists(path.join(gameDirFromClient, "League of Legends.exe"))) {
    return gameDirFromClient;
  }

  const gameExe = await resolveLeagueGameExecutableOptional("");
  return gameExe ? path.dirname(gameExe) : "";
};

const getLeagueClientReadyState = async () => {
  const leagueClientPath = await getPenguLeagueClientPath();
  const leagueGamePath = await getPenguLeagueGamePath(leagueClientPath);
  const running = await isLeagueClientRunning();
  const lockfilePath = await findLeagueClientLockfile(leagueClientPath);
  return {
    running,
    ready: Boolean(running && lockfilePath),
    lockfilePath,
    leagueClientPath,
    leagueGamePath
  };
};

const getRosePenguConfigPath = () => path.join(process.env.LOCALAPPDATA || getAppDataDir(), "Rift Atlas", "Rose", "config.ini");

const setIniValue = (content, section, key, value) => {
  const lines = String(content || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const sectionPattern = new RegExp(`^\\s*\\[${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*$`, "i");
  const keyPattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`, "i");
  let sectionIndex = lines.findIndex((line) => sectionPattern.test(line));
  if (sectionIndex === -1) {
    if (lines.length && lines[lines.length - 1].trim()) lines.push("");
    lines.push(`[${section}]`);
    sectionIndex = lines.length - 1;
  }

  let insertIndex = lines.length;
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\[.+\]\s*$/.test(lines[index])) {
      insertIndex = index;
      break;
    }
    if (keyPattern.test(lines[index])) {
      lines[index] = `${key}=${value}`;
      return lines.join("\n").replace(/\n+$/, "\n");
    }
  }

  lines.splice(insertIndex, 0, `${key}=${value}`);
  return lines.join("\n").replace(/\n+$/, "\n");
};

const writeRosePenguConfig = async ({ executablePath, leagueClientPath }) => {
  if (!executablePath || !leagueClientPath) return "";
  const loaderDir = path.dirname(executablePath);
  const leagueGameDir = path.join(leagueClientPath, "Game");
  const configPath = getRosePenguConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  let content = await fs.readFile(configPath, "utf8").catch(() => "[General]\n");
  content = setIniValue(content, "General", "clientpath", leagueClientPath);
  if (await directoryExists(leagueGameDir)) {
    content = setIniValue(content, "General", "leaguepath", leagueGameDir);
  }
  content = setIniValue(content, "General", "disabled", "0");
  content = setIniValue(content, "General", "loaderpath", loaderDir);
  await fs.writeFile(configPath, content, "utf8");
  return configPath;
};

const setRosePenguDisabled = async (disabled) => {
  const configPath = getRosePenguConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  let content = await fs.readFile(configPath, "utf8").catch(() => "[General]\n");
  content = setIniValue(content, "General", "disabled", disabled ? "1" : "0");
  await fs.writeFile(configPath, content, "utf8");
  return configPath;
};

const PENGU_ACTIVE_FLAG = path.join(getAppDataDir(), ".pengu-active");

const writePenguActiveFlag = async () => {
  await fs.mkdir(path.dirname(PENGU_ACTIVE_FLAG), { recursive: true });
  await fs.writeFile(PENGU_ACTIVE_FLAG, "active", "utf8");
};

const clearPenguActiveFlag = async () => {
  await fs.rm(PENGU_ACTIVE_FLAG, { force: true }).catch(() => {});
};

const isPenguActiveFlagPresent = async () => {
  try { await fs.stat(PENGU_ACTIVE_FLAG); return true; } catch { return false; }
};

const IFEO_ROOT = "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options";
const IFEO_KEY_NAME = "LeagueClientUx.exe";
const IFEO_REG_PATH = `${IFEO_ROOT}\\${IFEO_KEY_NAME}`;
const IFEO_VALUE_NAME = "Debugger";

const cleanupLegacyPenguIFEO = async () => {
  try {
    const output = await execFileText("reg", ["query", IFEO_REG_PATH, "/v", IFEO_VALUE_NAME], { timeout: 5000 }).catch(() => "");
    if (output.includes("core.dll")) {
      await execFileText("reg", ["delete", IFEO_REG_PATH, "/v", IFEO_VALUE_NAME, "/f"], { timeout: 5000 });
    }
  } catch {}
};

const getIFEOCommand = (coreDllPath) => `rundll32 "${coreDllPath}",#6000`;

const ensurePenguIFEOInstalled = async (executablePath) => {
  const loaderDir = path.dirname(executablePath);
  const corePath = path.join(loaderDir, "core.dll");
  try {
    await fs.stat(corePath);
  } catch {
    return { ifeoInstalled: false, ifeoError: "core.dll no encontrada en el runtime de Pengu Loader." };
  }
  const debuggerValue = getIFEOCommand(corePath);
  try {
    await execFileText("reg", [
      "add", IFEO_REG_PATH,
      "/v", IFEO_VALUE_NAME,
      "/t", "REG_SZ",
      "/d", debuggerValue,
      "/f"
    ], { timeout: 10000 });
    return { ifeoInstalled: true, ifeoPath: IFEO_REG_PATH, ifeoValue: debuggerValue };
  } catch (error) {
    return { ifeoInstalled: false, ifeoError: error.message || "No pude crear entrada IFEO." };
  }
};

const ensurePenguProxyInstalled = async (executablePath, leagueClientPath) => {
  if (!executablePath || !leagueClientPath) {
    return { proxyInstalled: false, proxyPath: "", proxyError: "No encontre la ruta de League." };
  }

  try {
    const configPath = await writeRosePenguConfig({ executablePath, leagueClientPath });
    await runPenguLoaderCli(executablePath, ["--set-league-path", leagueClientPath, "--silent"]).catch(() => {});
    await writePenguActiveFlag();
    const activated = await runPenguLoaderCli(executablePath, ["--force-activate", "--silent"]).then(() => true).catch(() => false);
    if (activated) {
      await cleanupLegacyPenguIFEO();
      const proxyPath = path.join(leagueClientPath, "d3d9.dll");
      return { proxyInstalled: true, proxyPath, configPath, activated, ifeoInstalled: false, method: "force-activate" };
    }

    // Fallback a IFEO si force-activate fallo
    const ifeoResult = await ensurePenguIFEOInstalled(executablePath);
    if (ifeoResult.ifeoInstalled) {
      await writePenguActiveFlag();
      const proxyPath = path.join(leagueClientPath, "d3d9.dll");
      return { proxyInstalled: true, proxyPath, configPath, activated: true, ifeoInstalled: true, method: "ifeo", ...ifeoResult };
    }

    const proxyPath = path.join(leagueClientPath, "d3d9.dll");
    return { proxyInstalled: false, proxyPath, configPath, activated: false, ifeoInstalled: false, ...ifeoResult };
  } catch (error) {
    return {
      proxyInstalled: false,
      proxyPath: path.join(leagueClientPath, "d3d9.dll"),
      proxyError: error.message || "No pude activar Pengu Loader."
    };
  }
};

const removePenguProxyIfManaged = async (executablePath, leagueClientPath) => {
  if (!leagueClientPath) {
    return { proxyRemoved: false, proxyPath: "", proxyError: "No encontre la ruta de League." };
  }

  const proxyPath = path.join(leagueClientPath, "d3d9.dll");
  await setRosePenguDisabled(true).catch(() => {});

  if (executablePath) {
    await removePenguIFEOIfManaged(executablePath, leagueClientPath).catch(() => {});
  }

  try {
    const proxyStat = await fs.stat(proxyPath).catch(() => null);
    if (!proxyStat) {
      await clearPenguActiveFlag();
      return { proxyRemoved: true, proxyPath, proxyExisted: false };
    }
    await fs.rm(proxyPath, { force: true });
    await clearPenguActiveFlag();
    return { proxyRemoved: true, proxyPath, proxyExisted: true };
  } catch (error) {
    return {
      proxyRemoved: false,
      proxyPath,
      proxyError: error.message || "No pude quitar d3d9.dll de League."
    };
  }
};

const removePenguIFEOIfManaged = async (executablePath, leagueClientPath) => {
  if (!executablePath || !leagueClientPath) {
    return { ifeoRemoved: false, ifeoPath: "", ifeoExisted: false, ifeoError: "No encontre la ruta de League." };
  }
  const loaderDir = path.dirname(executablePath);
  const corePath = path.join(loaderDir, "core.dll");
  try {
    const output = await execFileText("reg", [
      "query", IFEO_REG_PATH,
      "/v", IFEO_VALUE_NAME
    ], { timeout: 10000 });
    const isOurs = output.includes("core.dll");
    if (isOurs) {
      await execFileText("reg", [
        "delete", IFEO_REG_PATH,
        "/v", IFEO_VALUE_NAME,
        "/f"
      ], { timeout: 10000 });
    }
    return { ifeoRemoved: true, ifeoPath: IFEO_REG_PATH, ifeoExisted: isOurs };
  } catch {
    return { ifeoRemoved: true, ifeoPath: IFEO_REG_PATH, ifeoExisted: false };
  }
};

const getPenguIFEOActivationStatus = async () => {
  try {
    const output = await execFileText("reg", ["query", IFEO_REG_PATH, "/v", IFEO_VALUE_NAME], { timeout: 5000 });
    return { ifeoActive: output.includes("core.dll") };
  } catch {
    return { ifeoActive: false };
  }
};

const getPenguLoaderActivationStatus = async (executablePath) => {
  const leagueReadyState = await getLeagueClientReadyState();
  const { leagueClientPath, leagueGamePath, lockfilePath, ready: leagueReady } = leagueReadyState;
  if (!executablePath || !leagueClientPath) {
    return { active: false, proxyInstalled: false, proxyPath: "", leagueClientPath, leagueGamePath, lockfilePath, leagueReady };
  }

  const proxyPath = path.join(leagueClientPath, "d3d9.dll");

  try {
    const proxyStat = await fs.stat(proxyPath).catch(() => null);
    const configPath = getRosePenguConfigPath();
    const configContent = await fs.readFile(configPath, "utf8").catch(() => "");
    const disabled = /^\s*disabled\s*=\s*1\s*$/im.test(configContent);
    const proxyInstalled = Boolean(proxyStat);
    const { ifeoActive } = await getPenguIFEOActivationStatus();
    return {
      active: (proxyInstalled || ifeoActive) && !disabled,
      proxyInstalled,
      ifeoActive,
      disabled,
      configPath,
      proxyPath,
      leagueClientPath,
      leagueGamePath,
      lockfilePath,
      leagueReady
    };
  } catch {
    return { active: false, proxyInstalled: false, proxyPath: "", leagueClientPath, leagueGamePath, lockfilePath, leagueReady };
  }
};

const runPenguLoaderCli = async (executablePath, args = []) =>
  execFileText(executablePath, args, {
    cwd: path.dirname(executablePath),
    timeout: 30000,
    env: {
      ...process.env,
      // ROSE-Pengu hardcodes its config dir under %LOCALAPPDATA%\Rose.
      // Point LOCALAPPDATA at Rift Atlas so it writes to Rift Atlas\Rose.
      LOCALAPPDATA: path.join(process.env.LOCALAPPDATA || "", "Rift Atlas")
    }
  });

const PENGU_BRIDGE_CONNECT_GRACE_MS = 45000;
const PENGU_REACTIVATION_COOLDOWN_MS = 90000;

const launchPenguLoader = async ({ allowElevation = false, requireLeagueReady = false, source = "manual" } = {}) => {
  const executablePath = await findBundledPenguLoaderExecutable();
  if (!executablePath) {
    return { launched: false, alreadyRunning: false, executablePath: "", missing: true };
  }

  const leagueReadyState = await getLeagueClientReadyState();
  const { leagueClientPath, leagueGamePath, lockfilePath, ready: leagueReady } = leagueReadyState;
  const restartClient = leagueReadyState.running;
  if (requireLeagueReady && !leagueReady) {
    await appendOverlayLog(`[Pengu Loader] Activacion ${source} en espera: League Client no esta listo. running=${leagueReadyState.running} lockfile=${lockfilePath || "no encontrado"}`).catch(() => { });
    return {
      launched: false,
      activated: false,
      waitingForLeague: true,
      executablePath,
      leagueClientPath,
      leagueGamePath,
      lockfilePath,
      message: "Abri League Client hasta que aparezca el cliente real; Rift Atlas activara Pengu cuando detecte el lockfile."
    };
  }
  try {
    await installRiftAtlasPenguPlugin().catch(() => null);
    await terminatePenguLoaderUi();
    await writeRosePenguConfig({ executablePath, leagueClientPath });
    await appendOverlayLog(`[Pengu Loader] Configurando ruta estilo Rose: client=${leagueClientPath || "no encontrado"} game=${leagueGamePath || "no encontrado"}`).catch(() => { });
    const leagueRootPath = leagueGamePath
      ? path.dirname(leagueGamePath)
      : "";
    if (leagueGamePath) {
      await runPenguLoaderCli(executablePath, ["--set-league-path", leagueRootPath, "--silent"]);
    } else {
      await appendOverlayLog("[Pengu Loader] No se ejecuto --set-league-path porque no se encontro la carpeta Game de League.").catch(() => { });
    }
    await writePenguActiveFlag();
    await runPenguLoaderCli(executablePath, ["--force-activate", "--silent"]);
    await cleanupLegacyPenguIFEO();
    const proxyState = await getPenguLoaderActivationStatus(executablePath);
    let restartedClient = false;
    if (restartClient) {
      try {
        await runPenguLoaderCli(executablePath, ["--restart-client", "--silent"]);
        restartedClient = true;
      } catch (restartError) {
        return {
          launched: true,
          activated: true,
          alreadyRunning: await isPenguLoaderRunning(),
          executablePath,
          leagueClientPath,
          leagueGamePath,
          needsClientRestart: true,
          restartedClient: false,
          restartError: restartError.message,
          method: "rose-cli",
          ...proxyState
        };
      }
    }
    await terminatePenguLoaderUi();
    return {
      launched: true,
      activated: true,
      alreadyRunning: await isPenguLoaderRunning(),
      executablePath,
      leagueClientPath,
      leagueGamePath,
      needsClientRestart: restartClient,
      restartedClient,
      method: "rose-cli",
      ...proxyState
    };
  } catch (error) {
    let proxyState = {};
    try {
      proxyState = await ensurePenguProxyInstalled(executablePath, leagueClientPath);
    } catch {
      proxyState = {};
    }

    const isActivated = Boolean(proxyState.active || proxyState.proxyInstalled || proxyState.ifeoActive);

    if (allowElevation) {
      return {
        launched: Boolean(proxyState.proxyInstalled || proxyState.ifeoInstalled),
        activated: isActivated,
        elevated: false,
        alreadyRunning: await isPenguLoaderRunning(),
        executablePath,
        leagueClientPath,
        leagueGamePath,
        error: error.message,
        code: error.code || "",
        method: "rose-cli-fallback",
        ...proxyState
      };
    }

    return {
      launched: Boolean(proxyState.proxyInstalled || proxyState.ifeoInstalled),
      activated: isActivated,
      alreadyRunning: await isPenguLoaderRunning(),
      executablePath,
      leagueClientPath,
      leagueGamePath,
      error: error.message,
      code: error.code || "",
      method: "rose-cli-fallback",
      ...proxyState
    };
  }
};

const deactivatePenguLoader = async ({ allowElevation = false } = {}) => {
  const executablePath = await findBundledPenguLoaderExecutable();
  const leagueClientPath = await getPenguLeagueClientPath();
  const restartClient = await isLeagueClientRunning();

  if (!executablePath) {
    const proxyState = await removePenguProxyIfManaged("", leagueClientPath);
    return {
      deactivated: proxyState.proxyRemoved,
      executablePath: "",
      leagueClientPath,
      missing: true,
      ...proxyState
    };
  }

  try {
    await terminatePenguLoaderUi();
    await setRosePenguDisabled(true).catch(() => {});
    try {
      await runPenguLoaderCli(executablePath, ["--force-deactivate", "--silent"]);
    } catch {
      // CLI fallback handled below
    }
    await removePenguProxyIfManaged(executablePath, leagueClientPath).catch(() => {});
    await removePenguIFEOIfManaged(executablePath, leagueClientPath).catch(() => {});
    const proxyState = await getPenguLoaderActivationStatus(executablePath);
    let restartedClient = false;
    if (restartClient) {
      try {
        await runPenguLoaderCli(executablePath, ["--restart-client", "--silent"]);
        restartedClient = true;
      } catch {
        restartedClient = false;
      }
    }
    await terminatePenguLoaderUi();
    return {
      deactivated: !proxyState.active && !proxyState.proxyInstalled && !proxyState.ifeoActive,
      executablePath,
      leagueClientPath,
      needsClientRestart: restartClient,
      restartedClient,
      method: "rose-cli",
      ...proxyState
    };
  } catch (error) {
    if (allowElevation) {
      return {
        deactivated: false,
        elevated: false,
        executablePath,
        leagueClientPath,
        error: error.message,
        code: error.code || "",
        method: "manual-proxy"
      };
    }

    return {
      deactivated: false,
      executablePath,
      leagueClientPath,
      error: error.message,
      code: error.code || "",
      method: "manual-proxy"
    };
  }
};

const uninstallPenguLoader = async () => {
  const deactivateResult = await deactivatePenguLoader({ allowElevation: true }).catch((error) => ({
    deactivated: false,
    error: error.message || "No pude desactivar Pengu Loader antes de desinstalar."
  }));
  await terminatePenguLoaderUi().catch(() => {});

  const paths = [
    getPenguLoaderRuntimeDir(),
    getPenguLoaderDownloadDir()
  ];
  const removedPaths = [];
  const failedPaths = [];

  for (const targetPath of paths) {
    const resolved = path.resolve(targetPath);
    const appDataRoot = path.resolve(getAppDataDir());
    if (!resolved.startsWith(`${appDataRoot}${path.sep}`)) {
      failedPaths.push({ path: targetPath, error: "Ruta fuera de AppData de Rift Atlas." });
      continue;
    }

    try {
      await fs.rm(resolved, { recursive: true, force: true });
      removedPaths.push(resolved);
    } catch (error) {
      failedPaths.push({ path: resolved, error: error.message });
    }
  }

  await clearPenguActiveFlag().catch(() => {});
  await appendOverlayLog(`[Pengu Loader] Desinstalacion solicitada. removidas=${removedPaths.length} fallidas=${failedPaths.length}`).catch(() => {});

  return {
    uninstalled: failedPaths.length === 0,
    removedPaths,
    failedPaths,
    ...deactivateResult
  };
};

const syncBundledPenguToRuntime = async () => {
  const bundledDir = getPackagedAssetPath("Pengu Loader");
  const runtimeDir = getPenguLoaderRuntimeDir();
  if (!await directoryExists(bundledDir)) return;
  await fs.mkdir(runtimeDir, { recursive: true });

  // Snapshot plugin enabled/disabled state before overwriting
  const enabledPlugins = new Set();
  const disabledPlugins = new Set();
  const pluginsDir = path.join(runtimeDir, "plugins");
  if (await directoryExists(pluginsDir)) {
    const pluginDirs = await fs.readdir(pluginsDir, { withFileTypes: true });
    for (const entry of pluginDirs) {
      if (!entry.isDirectory()) continue;
      const pluginPath = path.join(pluginsDir, entry.name);
      const hasEnabled = await fs.stat(path.join(pluginPath, "index.js")).catch(() => null);
      const hasDisabled = await fs.stat(path.join(pluginPath, "index.js_")).catch(() => null);
      if (hasDisabled) disabledPlugins.add(entry.name);
      else if (hasEnabled) enabledPlugins.add(entry.name);
    }
  }

  const exclude = new Set(["datastore", "Pengu Loader.exe", "core.dll"]);
  const entries = await fs.readdir(bundledDir, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.has(entry.name)) continue;
    const src = path.join(bundledDir, entry.name);
    const dst = path.join(runtimeDir, entry.name);
    if (entry.isDirectory()) {
      await fs.cp(src, dst, { recursive: true, force: true, errorOnExist: false }).catch(() => {});
    } else {
      await fs.copyFile(src, dst).catch(() => {});
    }
  }

  // Restore plugin state after sync
  for (const pluginName of enabledPlugins) {
    const pluginPath = path.join(pluginsDir, pluginName);
    const disabledFile = path.join(pluginPath, "index.js_");
    if (await fs.stat(disabledFile).catch(() => null)) {
      await fs.rm(disabledFile, { force: true }).catch(() => {});
    }
  }
  for (const pluginName of disabledPlugins) {
    const pluginPath = path.join(pluginsDir, pluginName);
    const enabledFile = path.join(pluginPath, "index.js");
    const disabledFile = path.join(pluginPath, "index.js_");
    if (await fs.stat(enabledFile).catch(() => null) && await fs.stat(disabledFile).catch(() => null)) {
      await fs.rm(enabledFile, { force: true }).catch(() => {});
    }
  }
};

const preparePenguRuntime = async () => {
  const executablePath = await findBundledPenguLoaderExecutable();
  if (!executablePath) {
    return { prepared: false, missing: true };
  }

  // Sync bundled Pengu Loader dir a runtime como Rose
  await syncBundledPenguToRuntime();

  const leagueClientPath = await getPenguLeagueClientPath();
  const leagueGamePath = await getPenguLeagueGamePath(leagueClientPath);
  const plugin = await installRiftAtlasPenguPlugin();
  const proxyState = await ensurePenguProxyInstalled(executablePath, leagueClientPath);
  await appendOverlayLog(`[Pengu Loader] Runtime preparado estilo Rose. No se abre Riot Client automaticamente. client=${leagueClientPath || "no encontrado"} game=${leagueGamePath || "no encontrado"}`).catch(() => { });
  return {
    prepared: Boolean(proxyState.proxyInstalled),
    executablePath,
    leagueClientPath,
    leagueGamePath,
    leagueLaunch: {
      launched: false,
      skipped: true,
      reason: "Rose-style startup: solo prepara Pengu; League se abre manualmente o por restart-client si ya estaba corriendo."
    },
    plugin,
    ...proxyState
  };
};

const tryAutoActivatePenguWhenLeagueReady = async () => {
  if (penguAutoActivationInFlight) return;
  penguAutoActivationInFlight = true;
  try {
    const executablePath = await findBundledPenguLoaderExecutable();
    if (!executablePath) return;

    const readyState = await getLeagueClientReadyState();
    if (!readyState.ready) {
      penguAutoActivationCompleted = false;
      penguLastLeagueReadySignature = "";
      return;
    }

    const now = Date.now();
    const readySignature = `${readyState.lockfilePath || ""}|${readyState.leagueClientPath || ""}`;
    if (readySignature !== penguLastLeagueReadySignature) {
      penguLastLeagueReadySignature = readySignature;
      penguAutoActivationCompleted = false;
      penguLastAutoActivationAt = 0;
      await appendOverlayLog(`[Pengu Loader] Nueva sesion LCU detectada estilo Rose. lockfile=${readyState.lockfilePath} client=${readyState.leagueClientPath}`).catch(() => { });
    }

    if (penguBridgeClients.size > 0) {
      penguAutoActivationCompleted = true;
      penguLastBridgeConnectedAt = now;
      return;
    }

    const bridgeRecentlyDisconnected = penguLastBridgeConnectedAt > 0 &&
      now - penguLastBridgeConnectedAt < PENGU_BRIDGE_CONNECT_GRACE_MS;
    if (bridgeRecentlyDisconnected) return;

    const waitingForBridge = penguAutoActivationCompleted &&
      penguLastAutoActivationAt > 0 &&
      now - penguLastAutoActivationAt < PENGU_BRIDGE_CONNECT_GRACE_MS;
    if (waitingForBridge) return;

    const recentlyRetried = penguLastAutoActivationAt > 0 &&
      now - penguLastAutoActivationAt < PENGU_REACTIVATION_COOLDOWN_MS;
    if (recentlyRetried) return;

    const reason = penguAutoActivationCompleted
      ? `bridge no reconecto tras ${Math.round((now - penguLastAutoActivationAt) / 1000)}s`
      : "League listo sin bridge Pengu";
    await appendOverlayLog(`[Pengu Loader] Reactivando estilo Rose: ${reason}. lockfile=${readyState.lockfilePath} client=${readyState.leagueClientPath}`).catch(() => { });
    penguLastAutoActivationAt = now;
    const result = await launchPenguLoader({
      allowElevation: true,
      requireLeagueReady: true,
      source: "auto-rose"
    });
    penguAutoActivationCompleted = Boolean(result?.activated || result?.proxyInstalled || result?.active);
    if (penguAutoActivationCompleted) {
      await appendOverlayLog(`[Pengu Loader] Auto-activacion estilo Rose completada; esperando bridge Pengu. restarted=${result?.restartedClient ? "si" : "no"} method=${result?.method || "?"}`).catch(() => { });
    }
  } catch (error) {
    await appendOverlayLog(`[Pengu Loader] Auto-activacion estilo Rose fallo: ${error.message || error}`).catch(() => { });
  } finally {
    penguAutoActivationInFlight = false;
  }
};

const startPenguAutoActivationWatcher = () => {
  if (penguAutoActivationTimer) return;
  penguAutoActivationTimer = setInterval(() => {
    tryAutoActivatePenguWhenLeagueReady();
  }, 2500);
  tryAutoActivatePenguWhenLeagueReady();
};

const getLatestPenguLoaderZipAsset = async () => {
  try {
    const repo = await fetchJsonWithTimeout(ROSE_PENGU_REPO_API, {
      headers: { "user-agent": "RiftAtlas" }
    });
    const branch = repo.default_branch || "main";
    return {
      release: { tag_name: "ROSE-Pengu", source: "Tariolle/ROSE-Pengu" },
      asset: {
        name: `ROSE-Pengu-${branch}.zip`,
        browser_download_url: `https://codeload.github.com/Tariolle/ROSE-Pengu/zip/refs/heads/${encodeURIComponent(branch)}`
      }
    };
  } catch {
    // Fall back to the official portable release only if the Rose fork is unavailable.
  }

  try {
    const release = await fetchJsonWithTimeout(PENGU_DISTRO_RELEASE_API, {
      headers: { "user-agent": "RiftAtlas" }
    });
    const asset = (release.assets || []).find((item) => /portable\.zip$/i.test(item.name || ""))
      || (release.assets || []).find((item) => /\.zip$/i.test(item.name || ""));
    if (asset?.browser_download_url) {
      return { release, asset };
    }
  } catch {
    // Surface a consistent error below.
  }

  throw new Error("No pude encontrar un ZIP de Pengu Loader para descargar.");
};

const findFileRecursive = async (rootDir, predicate) => {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isFile() && predicate(entryPath, entry.name)) return entryPath;
    if (entry.isDirectory()) {
      const found = await findFileRecursive(entryPath, predicate);
      if (found) return found;
    }
  }
  return "";
};

const downloadAndInstallPenguLoaderPortable = async (window) => {
  const { release, asset } = await getLatestPenguLoaderZipAsset();
  const downloadDir = getPenguLoaderDownloadDir();
  const runtimeDir = getPenguLoaderRuntimeDir();
  const tempDir = path.join(downloadDir, "extract");
  const zipPath = path.join(downloadDir, sanitizeFileName(asset.name || "pengu-loader.zip"));

  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
  await fs.mkdir(downloadDir, { recursive: true });
  sendDownloadProgress(window, {
    type: "pengu-loader",
    message: `Descargando Pengu Loader ${release.tag_name || ""}...`
  });
  await downloadFile(asset.browser_download_url, zipPath, (progress) => {
    sendDownloadProgress(window, {
      type: "pengu-loader",
      message: "Descargando Pengu Loader...",
      ...progress
    });
  });

  sendDownloadProgress(window, {
    type: "pengu-loader",
    message: "Extrayendo Pengu Loader...",
    percent: 100
  });

  await fs.mkdir(tempDir, { recursive: true });
  await extractZip(zipPath, { dir: tempDir });

  const extractedExe = await findFileRecursive(tempDir, (_filePath, fileName) =>
    PENGU_LOADER_EXE_NAMES.some((exeName) => exeName.toLowerCase() === fileName.toLowerCase())
  );
  if (!extractedExe) {
    throw new Error("El ZIP de Pengu Loader no contiene Pengu Loader.exe.");
  }

  const extractedRoot = path.dirname(extractedExe);
  await terminatePenguLoaderUi();
  await fs.rm(runtimeDir, { recursive: true, force: true }).catch(() => { });
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.cp(extractedRoot, runtimeDir, {
    recursive: true,
    force: true,
    errorOnExist: false
  });
  const plugin = await installRiftAtlasPenguPlugin();
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });

  return {
    version: release.tag_name || "",
    executablePath: path.join(runtimeDir, path.basename(extractedExe)),
    plugin,
    downloadDir,
    runtimeDir
  };
};

const normalizeDllSource = (source) => {
  if (source === "bundled" || source === "ltk") return source;
  return "cslol";
};
const getBundledCslolDllPath = () => getUnpackedAssetPath("assets", "cslol-dll.dll");
const getDllSourceMetadataPath = () => path.join(getAppDataDir(), "engine", "dll-source.json");

const readDllSourceMetadata = async () => {
  try {
    return JSON.parse(await fs.readFile(getDllSourceMetadataPath(), "utf8"));
  } catch {
    return null;
  }
};

const writeDllSourceMetadata = async (metadata = {}) => {
  const filePath = getDllSourceMetadataPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({
    ...metadata,
    downloadedAt: new Date().toISOString()
  }, null, 2));
};

const getDllDownloadSources = (preferredSource = "cslol") => {
  const sources = {
    bundled: {
      id: "bundled",
      label: "DLL incluido con Rift Atlas",
      getAsset: null
    },
    cslol: {
      id: "cslol",
      label: "LeagueToolkit/cslol-manager",
      getAsset: getLatestCslolWindowsAsset
    },
    ltk: {
      id: "ltk",
      label: "LeagueToolkit/ltk-manager",
      getAsset: getLatestLtkSetupAsset
    }
  };
  const first = normalizeDllSource(preferredSource);
  if (first === "bundled") {
    return [sources.bundled, sources.cslol, sources.ltk];
  }
  const fallback = first === "cslol" ? "ltk" : "cslol";
  return [sources[first], sources[fallback]];
};

const downloadAndExtractLtkDll = async (window = null, { forceDownload = false, dllSource = "cslol" } = {}) => {
  const targetDir = path.join(getAppDataDir(), "ltk-dll");
  const installedDllPath = path.join(targetDir, "cslol-dll.dll");

  if (forceDownload) {
    await fs.rm(installedDllPath, { force: true }).catch(() => { });
  } else {
    try {
      await fs.access(installedDllPath);
      sendDownloadProgress(window, {
        type: "engine",
        message: `Usando DLL descargada por Rift Atlas: ${installedDllPath}`
      });
      return {
        path: installedDllPath,
        sourceId: "cached",
        sourceLabel: "cache local de Rift Atlas",
        version: "",
        assetName: path.basename(installedDllPath)
      };
    } catch { }
  }

  const previousNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    const downloadSources = getDllDownloadSources(dllSource);
    const tempDir = path.join(app.getPath("temp"), "rift-atlas-ltk-dll-download");
    const findDllInExtract = async (rootPath) => {
      const queue = [rootPath];
      let seen = 0;
      while (queue.length && seen < 20000) {
        const current = queue.shift();
        seen += 1;
        let entries = [];
        try {
          entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          const entryPath = path.join(current, entry.name);
          if (entry.isFile() && entry.name.toLowerCase() === "cslol-dll.dll") {
            return entryPath;
          }
          if (entry.isDirectory()) {
            queue.push(entryPath);
          }
        }
      }
      return null;
    };

    const failures = [];
    for (const source of downloadSources) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
      await fs.mkdir(tempDir, { recursive: true });

      try {
        if (source.id === "bundled") {
          const bundledDllPath = getBundledCslolDllPath();
          await fs.access(bundledDllPath);
          await fs.mkdir(targetDir, { recursive: true });
          await fs.copyFile(bundledDllPath, installedDllPath);
          sendDownloadProgress(window, {
            type: "engine",
            message: `Trayendo DLL incluido con Rift Atlas: ${bundledDllPath} -> ${installedDllPath}`
          });
          await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
          return {
            path: installedDllPath,
            sourceId: source.id,
            sourceLabel: source.label,
            version: "incluido",
            assetName: path.basename(bundledDllPath)
          };
        }

        const { release, asset } = await source.getAsset();
        const setupExtractPath = path.join(tempDir, "setup");
        const downloadPath = path.join(tempDir, asset.name);
        const version = release.tag_name || release.name || "sin version";

        sendDownloadProgress(window, {
          type: "engine",
          message: `Descargando DLL desde ${source.label} ${version} (${asset.name})...`
        });
        await downloadFile(asset.browser_download_url, downloadPath, (progress) => {
          sendDownloadProgress(window, {
            type: "engine",
            message: `Descargando DLL desde ${source.label}...`,
            ...progress
          });
        });
        sendDownloadProgress(window, {
          type: "engine",
          message: `Extrayendo DLL desde ${downloadPath}`
        });
        await extractSevenZipSfx(downloadPath, setupExtractPath);

        const dllSource = await findDllInExtract(setupExtractPath);
        if (!dllSource) {
          throw new Error(`${asset.name} no contiene cslol-dll.dll.`);
        }

        await fs.mkdir(targetDir, { recursive: true });
        await fs.copyFile(dllSource, installedDllPath);
        sendDownloadProgress(window, {
          type: "engine",
          message: `Trayendo DLL de ${source.label} ${version}: ${dllSource} -> ${installedDllPath}`
        });
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
        return {
          path: installedDllPath,
          sourceId: source.id,
          sourceLabel: source.label,
          version,
          assetName: asset.name
        };
      } catch (error) {
        failures.push(`${source.label}: ${error.message}`);
        sendDownloadProgress(window, {
          type: "engine",
          message: `No pude usar DLL de ${source.label}: ${error.message}`
        });
      }
    }

    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
    throw new Error(`No pude descargar cslol-dll.dll. ${failures.join(" | ")}`);
  } finally {
    process.noAsar = previousNoAsar;
  }
};

const downloadAndInstallHitoriEngine = async (window, options = {}) => {
  const previousNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    const release = await fetchJsonWithTimeout(HITORI_RELEASE_API, {
      headers: { "user-agent": "RiftAtlas" }
    });
    const asset = release.assets?.find((item) => item.name.toLowerCase().endsWith("-setup.exe"));

    if (!asset) {
      throw new Error("No encontre el setup del engine en el ultimo release.");
    }

    const targetDir = path.join(getAppDataDir(), "engine");
    const tempDir = path.join(app.getPath("temp"), "rift-atlas-hitori-download");
    const setupExtractPath = path.join(tempDir, "setup");
    const appExtractPath = path.join(setupExtractPath, "$PLUGINSDIR", "app");
    const downloadPath = path.join(tempDir, asset.name);
    const installedDllPath = path.join(targetDir, "cslol-dll.dll");
    const preservedDllPath = path.join(tempDir, "preserved-cslol-dll.dll");

    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
    await fs.mkdir(tempDir, { recursive: true });
    const hadCustomDll = await fs.copyFile(installedDllPath, preservedDllPath)
      .then(() => true)
      .catch(() => false);
    sendDownloadProgress(window, {
      type: "engine",
      message: hadCustomDll
        ? "Instalando engine limpio; se conserva la DLL custom instalada."
        : "Instalando engine limpio; no se encontro DLL custom instalada."
    });

    await downloadFile(asset.browser_download_url, downloadPath, (progress) => {
      sendDownloadProgress(window, {
        type: "engine",
        message: "Descargando engine...",
        ...progress
      });
    });
    await extractSevenZipSfx(downloadPath, setupExtractPath);

    const appArchivePath = path.join(setupExtractPath, "$PLUGINSDIR", "app-64.7z");
    try {
      await fs.access(appArchivePath);
    } catch {
      throw new Error("El setup del engine no contiene app-64.7z.");
    }
    await extractSevenZipSfx(appArchivePath, appExtractPath);

    const sourceEnginePath = path.join(appExtractPath, "resources", "ltk-manager.exe");
    try { await fs.access(sourceEnginePath); } catch {
      throw new Error("No encontre el sidecar resources\\ltk-manager.exe dentro del engine.");
    }

    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => { });
    await fs.mkdir(targetDir, { recursive: true });
    const installedEnginePath = path.join(targetDir, "ltk-manager.exe");
    await fs.copyFile(sourceEnginePath, installedEnginePath);

    if (hadCustomDll) {
      await fs.copyFile(preservedDllPath, installedDllPath);
    }
    let extractedDllPath = await findExistingPath([installedDllPath]);
    let dllInstallInfo = extractedDllPath
      ? {
        sourceId: hadCustomDll ? "custom" : "engine",
        sourceLabel: hadCustomDll ? "DLL custom preservada" : "DLL local en carpeta engine",
        version: hadCustomDll ? "" : (release.tag_name || release.name || ""),
        assetName: path.basename(extractedDllPath),
        installedPath: extractedDllPath
      }
      : null;

    if (extractedDllPath && dllInstallInfo) {
      await writeDllSourceMetadata({
        sourceId: dllInstallInfo.sourceId || "",
        sourceLabel: dllInstallInfo.sourceLabel || "",
        version: dllInstallInfo.version || "",
        assetName: dllInstallInfo.assetName || path.basename(extractedDllPath),
        sourcePath: dllInstallInfo.path || extractedDllPath,
        installedPath: extractedDllPath
      }).catch(() => { });
    }
    if (extractedDllPath) {
      sendDownloadProgress(window, {
        type: "engine",
        message: hadCustomDll
          ? `DLL custom preservada junto al engine: ${extractedDllPath}`
          : `DLL lista junto al engine: ${extractedDllPath}`
      });
    } else {
      sendDownloadProgress(window, {
        type: "engine",
        message: `DLL no encontrada. Colócala manualmente en ${installedDllPath}`
      });
    }

    await fs.access(installedEnginePath);
    await fs.writeFile(path.join(getAppDataDir(), "engine-version.txt"), release.tag_name || release.name || "");
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });

    return {
      version: release.tag_name || release.name,
      assetName: asset.name,
      toolsDir: targetDir,
      enginePath: installedEnginePath,
      dllPath: extractedDllPath,
      dllSourcePath: extractedDllPath,
      dllSourceLabel: dllInstallInfo?.sourceLabel || (extractedDllPath ? "DLL local en carpeta engine" : "DLL manual requerida"),
      manualDllRequired: !extractedDllPath,
      dllInstallMessage: extractedDllPath
        ? `DLL lista junto al engine: ${extractedDllPath}`
        : `DLL no encontrada. Pégala manualmente en ${installedDllPath}`
    };
  } finally {
    process.noAsar = previousNoAsar;
  }
};

const findFileInTree = async (rootPath, filename, maxEntries = 5000) => {
  try {
    const rootStat = await fs.stat(rootPath);
    if (!rootStat.isDirectory()) return null;
  } catch {
    return null;
  }

  const queue = [rootPath];
  let seen = 0;
  const skipDirs = new Set(["node_modules", ".git", "AppData", "Windows", "Program Files", "Program Files (x86)"]);
  while (queue.length && seen < maxEntries) {
    const current = queue.shift();
    seen += 1;
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
        return entryPath;
      }
      if (entry.isDirectory() && !skipDirs.has(entry.name)) {
        queue.push(entryPath);
      }
    }
  }
  return null;
};

const findFileInCommonFolders = async (filename) => {
  const roots = [
    path.join(app.getPath("home"), "Downloads"),
    path.join(app.getPath("home"), "Desktop"),
    "D:\\Descargas",
    "D:\\Downloads"
  ];

  for (const root of roots) {
    const found = await findFileInTree(root, filename);
    if (found) return found;
  }
  return null;
};

const getHitoriEngineCandidates = (selectedPath = "") => {
  const target = String(selectedPath || "");
  const candidates = [];

  if (target) {
    const basename = path.basename(target).toLowerCase();
    if (basename === "ltk-manager.exe" && !target.toLowerCase().includes("ltk manager")) {
      candidates.push(target);
    }

    candidates.push(
      path.join(target, "ltk-manager.exe"),
      path.join(path.dirname(target), "ltk-manager.exe")
    );
  }

  candidates.push(
    path.join(getAppDataDir(), "engine", "ltk-manager.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Bocchi", "resources", "ltk-manager.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "bocchi", "resources", "ltk-manager.exe")
  );

  return candidates;
};

const resolveHitoriEngineExecutable = async (selectedPath) => {
  const candidates = getHitoriEngineCandidates(selectedPath);
  const enginePath = await findExistingPath(candidates);
  if (enginePath) {
    return enginePath;
  }

  throw new Error("Falta el engine. Descargalo desde el boton de esta pantalla.");
};

const getDllCandidates = (_selectedDllPath = "", _enginePath = "") => [
  path.join(getAppDataDir(), "engine", "cslol-dll.dll")
];

const resolveCslolDll = async (_selectedDllPath, enginePath) => {
  return findExistingPath(getDllCandidates("", enginePath));
};

const getLeagueCandidates = (selectedPath = "") => [
  selectedPath,
  "C:\\Riot Games\\League of Legends\\Game\\League of Legends.exe",
  "D:\\Riot Games\\League of Legends\\Game\\League of Legends.exe",
  path.join(process.env.LOCALAPPDATA || "", "Riot Games", "League of Legends", "Game", "League of Legends.exe")
];

const resolveLeagueGameExecutableOptional = async (selectedPath = "") => {
  try {
    return await resolveLeagueGameExecutable(selectedPath);
  } catch { }

  for (const candidate of getLeagueCandidates(selectedPath)) {
    try {
      return await resolveLeagueGameExecutable(candidate);
    } catch { }
  }
  return null;
};

ipcMain.handle("mods:auto-configure-overlay", async (_event, payload = {}) => {
  let enginePath = null;
  let dllPath = null;
  let leagueGamePath = null;
  const warnings = [];

  try {
    enginePath = await resolveHitoriEngineExecutable(payload.enginePath);
  } catch {
    enginePath = await findFileInCommonFolders("ltk-manager.exe");
  }

  leagueGamePath = await resolveLeagueGameExecutableOptional(payload.leagueGamePath);
  dllPath = await resolveCslolDll(payload.dllPath, enginePath);

  if (!enginePath) warnings.push("No encontre el engine.");
  if (!dllPath) warnings.push("No encontre cslol-dll.dll junto al engine. Pegalo manualmente en la carpeta engine.");
  if (!leagueGamePath) warnings.push("No encontre League of Legends.exe.");

  return {
    success: Boolean(enginePath && dllPath && leagueGamePath),
    enginePath,
    dllPath,
    leagueGamePath,
    ltkPath: "",
    warnings
  };
});

ipcMain.handle("mods:download-cslol-tools", async (event, payload = {}) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return downloadAndInstallHitoriEngine(window, {
    dllSource: normalizeDllSource(payload?.dllSource)
  });
});

const ensureCslolDll = async (enginePath, selectedDllPath) => {
  const bundledDllPath = path.join(getAppDataDir(), "engine", "cslol-dll.dll");

  try {
    await fs.access(bundledDllPath);
    await appendOverlayLog(`DLL instalada por Rift Atlas: ${bundledDllPath}`).catch(() => { });
    return bundledDllPath;
  } catch { }
  await appendOverlayLog(`ERROR DLL no encontrada junto al engine: ${bundledDllPath}. No se buscan DLLs locales.`).catch(() => { });
  throw new Error("cslol-dll.dll no esta junto al engine. Pegalo manualmente en AppData\\Roaming\\Rift Atlas\\engine.");
};

const ensureGameHashtable = async () => {
  const hashtablePath = path.join(getAppDataDir(), "hashtable", "hashes.game.txt");
  try {
    const stat = await fs.stat(hashtablePath);
    if (stat.size > 1024 * 1024 * 10) {
      return hashtablePath;
    }
  } catch { }

  await fs.mkdir(path.dirname(hashtablePath), { recursive: true });

  const bocchiHashtable = path.join(app.getPath("appData"), "bocchi", "hashtable", "hashes.game.txt");
  try {
    const stat = await fs.stat(bocchiHashtable);
    if (stat.size > 1024 * 1024 * 10) {
      await fs.copyFile(bocchiHashtable, hashtablePath);
      return hashtablePath;
    }
  } catch { }

  const tempPath = `${hashtablePath}.download`;
  const response = await fetch(HASHTABLE_URL, {
    headers: {
      "user-agent": "RiftAtlas"
    }
  });

  if (!response.ok || !response.body) {
    throw new Error(`No pude descargar hashes.game.txt (${response.status}).`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));
  await fs.rename(tempPath, hashtablePath);
  return hashtablePath;
};

const inferRepositorySkinParts = (skin = {}) => {
  const source = String(skin.relativePath || skin.path || "");
  const parts = source.split(/[\\/]+/).filter(Boolean);
  const skinsIndex = parts.findIndex((part) => part.toLowerCase() === "skins");
  const repoParts = skinsIndex >= 0 ? parts.slice(skinsIndex + 1) : parts.slice(-3);
  const fileName = path.basename(String(skin.path || skin.name || repoParts.at(-1) || ""));
  return {
    champion: skin.rawChampion || skin.champion || repoParts[0] || "",
    skin: skin.rawSkin || skin.skin || repoParts[1] || stripModExtension(fileName),
    fileBase: stripModExtension(fileName),
    parent: repoParts.at(-2) || ""
  };
};

const resolveFantonizeSkinEntry = async (skin = {}) => {
  const archiveInfo = skin.archiveInfo?.maxWadSize
    ? skin.archiveInfo
    : await inspectArchivePackage(skin.path).catch(() => ({}));
  const metaInfo = skin.metaName
    ? { Name: skin.metaName }
    : (archiveInfo.hasMetaInfo ? await readArchiveMetaInfo(skin.path).catch(() => null) : null);
  await appendOverlayLog(`Resolviendo skin: champion=${skin.champion || ""} rawChampion=${skin.rawChampion || ""} skin=${skin.skin || ""} rawSkin=${skin.rawSkin || ""} metaName=${metaInfo?.Name || ""} variant=${skin.variant || skin.rawVariant || ""} championKey=${skin.championKey || ""} skinNum=${skin.skinNum ?? ""} needsFantonize=${Boolean(skin.needsFantonize)} archive=${JSON.stringify(archiveInfo)}`);

  if (!archiveInfo.suspicious) {
    await appendOverlayLog("La skin no parece WAD sospechoso/miniatura; se usa directa.");
    return { ...skin, archiveInfo, needsFantonize: false };
  }

  if (skin.needsFantonize && skin.championKey && skin.skinNum !== null && skin.skinNum !== undefined) {
    await appendOverlayLog(`Skin ya resuelta para fantonize: ${skin.championKey} skinNum=${skin.skinNum}`);
    return { ...skin, archiveInfo, needsFantonize: true };
  }

  const metadata = await getSkinMetadata().catch(() => null);
  const guessed = inferRepositorySkinParts(skin);
  await appendOverlayLog(`Inferencia de ruta: champion=${guessed.champion} skin=${guessed.skin} fileBase=${guessed.fileBase} parent=${guessed.parent}`);
  const championEntry = metadata?.championsByKey
    ? [...metadata.championsByKey.values()].find((entry) =>
      normalizeChampionName(entry.name) === normalizeChampionName(guessed.champion) ||
      normalizeChampionName(entry.id) === normalizeChampionName(guessed.champion) ||
      String(entry.key) === String(guessed.champion)
    )
    : null;

  if (!championEntry) {
    await appendOverlayLog("No pude resolver campeon para fantonize; se usa el mod directo.");
    return { ...skin, archiveInfo, needsFantonize: false };
  }
  await appendOverlayLog(`Campeon resuelto: ${championEntry.name} id=${championEntry.id} key=${championEntry.key}`);

  const skinDetails = await getChampionSkinDetails(championEntry.key).catch(() => null);
  const candidates = [
    skin.skin,
    skin.rawSkin,
    metaInfo?.Name,
    guessed.skin,
    guessed.fileBase,
    guessed.parent
  ].filter(Boolean);
  let record = candidates
    .map((candidate) => skinDetails?.recordsByName.get(normalizeChampionName(candidate)))
    .find(Boolean);

  if (!record && skinDetails?.recordsByName) {
    const normCandidates = candidates.map((c) => normalizeChampionName(c));
    for (const [, rec] of skinDetails.recordsByName) {
      const normName = normalizeChampionName(rec.name);
      if (normCandidates.some((nc) => nc && (normName.includes(nc) || nc.includes(normName)))) {
        record = rec;
        break;
      }
    }
  }

  if (!record) {
    await appendOverlayLog(`No pude resolver skin num para fantonize. Candidatos=${candidates.join(" | ")}`);
    return { ...skin, archiveInfo, needsFantonize: false };
  }
  await appendOverlayLog(`Skin resuelta para fantonize: ${record.name} num=${record.num} candidatos=${candidates.join(" | ")}`);

  return {
    ...skin,
    archiveInfo,
    champion: championEntry.name,
    championKey: championEntry.id,
    skin: skin.skin || record.name || guessed.skin,
    skinNum: record.num,
    needsFantonize: true
  };
};

const createZipArchiveFromPackageDir = async ({ sourceDir, outputPath }) => {
  const tempRoot = path.dirname(sourceDir);
  const outputDir = path.dirname(outputPath);
  const outputName = path.basename(outputPath);
  const relativeOutputDir = path.relative(tempRoot, outputDir) || ".";
  await fs.mkdir(outputDir, { recursive: true });

  const sevenZip = await createSevenZip();
  const mountRoot = "/nodefs";
  try {
    sevenZip.FS.mkdir(mountRoot);
  } catch { }
  sevenZip.FS.mount(sevenZip.NODEFS, { root: tempRoot }, mountRoot);
  sevenZip.FS.chdir(path.posix.join(mountRoot, path.basename(sourceDir)));
  sevenZip.callMain(["a", "-tzip", path.posix.join("..", relativeOutputDir.replace(/\\/g, "/"), outputName), "META", "WAD"]);
};

const formatLogBytes = (bytes = 0) => {
  if (!Number.isFinite(Number(bytes))) return "desconocido";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileLogInfo = async (filePath) => {
  const target = String(filePath || "");
  if (!target) return "ruta vacia";
  try {
    const stat = await fs.stat(target);
    return `${target} | size=${formatLogBytes(stat.size)} | mtime=${new Date(stat.mtimeMs).toISOString()}`;
  } catch (error) {
    return `${target} | no accesible: ${error.code || error.message}`;
  }
};

const appendFileLogInfo = async (label, filePath) => {
  await appendOverlayLog(`${label}: ${await getFileLogInfo(filePath)}`);
};

const countDirectoryFiles = async (dirPath, { limit = 50000 } = {}) => {
  let files = 0;
  let directories = 0;
  let bytes = 0;
  const samples = [];

  const walk = async (currentPath) => {
    if (files >= limit) return;
    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        directories += 1;
        await walk(entryPath);
        continue;
      }
      files += 1;
      const stat = await fs.stat(entryPath).catch(() => null);
      if (stat) bytes += stat.size;
      if (samples.length < 12) {
        samples.push(path.relative(dirPath, entryPath) || entry.name);
      }
      if (files >= limit) break;
    }
  };

  await walk(dirPath);
  return { files, directories, bytes, samples, truncated: files >= limit };
};

const appendDirectoryLogInfo = async (label, dirPath) => {
  const target = String(dirPath || "");
  if (!target) {
    await appendOverlayLog(`${label}: ruta vacia`);
    return;
  }
  try {
    const summary = await countDirectoryFiles(target);
    await appendOverlayLog(`${label}: ${target} | files=${summary.files}${summary.truncated ? "+" : ""} | dirs=${summary.directories} | size=${formatLogBytes(summary.bytes)} | sample=${summary.samples.join(", ") || "sin archivos"}`);
  } catch (error) {
    await appendOverlayLog(`${label}: ${target} | no accesible: ${error.code || error.message}`);
  }
};

const buildMkoverlayArgs = ({ gameFolder, overlayPath, statePath, modPaths = [] }) => {
  const args = [
    "mkoverlay",
    "--game", path.normalize(gameFolder),
    "--overlay", path.normalize(overlayPath),
    "--state", path.normalize(statePath)
  ];
  for (const modPath of modPaths) {
    args.push("--mod", path.normalize(modPath));
  }
  return args;
};

const execMkoverlayWithFallback = async ({
  sidecarPath,
  toolsDir,
  gameFolder,
  overlayPath,
  statePath,
  modPaths,
  runToken,
  label = "mkoverlay"
}) => {
  let activeModPaths = modPaths;
  let args = buildMkoverlayArgs({ gameFolder, overlayPath, statePath, modPaths: activeModPaths });
  let inputBytes = await getFilesTotalSize(activeModPaths);
  let timeoutMs = getMkoverlayTimeoutMs(inputBytes);
  await appendOverlayLog(`${label} args: ${args.join(" ")}`);
  await appendOverlayLog(`${label} timeout: ${Math.round(timeoutMs / 1000)}s para ${formatLogBytes(inputBytes)} de mods.`);
  try {
    return await execToolWithTimeout(sidecarPath, args, timeoutMs, { cwd: toolsDir, runToken });
  } catch (error) {
    const fallbackPaths = await getOverlayModFallbackPaths(activeModPaths);
    if (!fallbackPaths) throw error;
    await appendOverlayLog(`${label} fallo con staging (${error.message}). Reintentando con paquete original.`);
    await fs.rm(overlayPath, { recursive: true, force: true }).catch(() => {});
    await fs.rm(statePath, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(statePath, { recursive: true });
    activeModPaths = fallbackPaths;
    args = buildMkoverlayArgs({ gameFolder, overlayPath, statePath, modPaths: activeModPaths });
    inputBytes = await getFilesTotalSize(activeModPaths);
    timeoutMs = getMkoverlayTimeoutMs(inputBytes);
    await appendOverlayLog(`${label} fallback args: ${args.join(" ")}`);
    await appendOverlayLog(`${label} fallback timeout: ${Math.round(timeoutMs / 1000)}s para ${formatLogBytes(inputBytes)} de mods.`);
    return execToolWithTimeout(sidecarPath, args, timeoutMs, { cwd: toolsDir, runToken });
  }
};

const normalizeZipPackageForOverlay = async (skin = {}) => {
  const sourcePath = String(skin?.path || "");
  const archiveInfo = skin.archiveInfo?.wadCount !== undefined
    ? skin.archiveInfo
    : await inspectArchivePackage(sourcePath).catch(() => ({}));
  await appendOverlayLog(`Analizando ZIP: ${sourcePath} | archive=${JSON.stringify(archiveInfo)}`);
  await appendFileLogInfo("ZIP origen", sourcePath);

  if (!archiveInfo.hasWadFolder && !archiveInfo.wadCount) {
    await appendOverlayLog(`Usando ZIP directo sin estructura WAD/META: ${sourcePath}`);
    return sourcePath;
  }

  const sourceStat = await fs.stat(sourcePath);
  const outputDir = path.join(getAppDataDir(), "mod-files", "normalized");
  const sourceHash = crypto.createHash("sha1").update(sourcePath).digest("hex").slice(0, 8);
  const displayName = sanitizeFileName(String(skin.skin || skin.name || stripModExtension(path.basename(sourcePath))));
  const outputPath = path.join(outputDir, `${displayName}_${sourceHash}.fantome`);

  try {
    const outputStat = await fs.stat(outputPath);
    if (outputStat.size > 0 && outputStat.mtimeMs >= sourceStat.mtimeMs) {
      await appendOverlayLog(`Usando .fantome normalizado: ${outputPath}`);
      await appendFileLogInfo(".fantome normalizado cache", outputPath);
      return outputPath;
    }
  } catch { }

  const tempRoot = path.join(app.getPath("temp"), `rift-atlas-normalize-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const extractDir = path.join(tempRoot, "package");
  try {
    await appendOverlayLog(`Normalizando ZIP en temp: ${tempRoot}`);
    await fs.mkdir(extractDir, { recursive: true });
    await extractZip(sourcePath, { dir: extractDir });
    await appendDirectoryLogInfo("ZIP extraido", extractDir);

    const metaDir = path.join(extractDir, "META");
    const wadDir = path.join(extractDir, "WAD");
    await fs.access(wadDir);
    await fs.mkdir(metaDir, { recursive: true });

    const detailsPath = path.join(metaDir, "details.json");
    try {
      await fs.access(detailsPath);
    } catch {
      await fs.writeFile(detailsPath, JSON.stringify({
        Priority: 10,
        override_: false,
        InnerPath: "",
        Random: false,
        Layers: [{
          Name: "base",
          Priority: 1,
          folder_name: "WAD",
          is_active: false
        }],
        layerss: "None"
      }, null, 2));
    }

    await fs.rm(outputPath, { force: true }).catch(() => { });
    const tempOutputPath = path.join(tempRoot, "out", path.basename(outputPath));
    await createZipArchiveFromPackageDir({ sourceDir: extractDir, outputPath: tempOutputPath });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.copyFile(tempOutputPath, outputPath);
    await appendOverlayLog(`ZIP normalizado a .fantome: ${sourcePath} -> ${outputPath}`);
    await appendFileLogInfo(".fantome normalizado escrito", outputPath);
    return outputPath;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => { });
  }
};

const extractArchiveModForOverlay = async (sourcePath, skin = {}) => {
  const sourceStat = await fs.stat(sourcePath);
  const sourceHash = crypto.createHash("sha1")
    .update(path.normalize(sourcePath).toLowerCase())
    .update(`:${sourceStat.size}:${Math.trunc(sourceStat.mtimeMs)}`)
    .digest("hex")
    .slice(0, 12);
  const displayName = sanitizeFileName(String(skin.skin || skin.name || stripModExtension(path.basename(sourcePath))));
  const outputDir = path.join(getAppDataDir(), "mod-staging-cache", `${displayName}_${sourceHash}`);

  const existing = await countDirectoryFiles(outputDir).catch(() => null);
  if (existing?.files > 0) {
    await appendOverlayLog(`Usando mod extraido cache: ${outputDir}`);
    await appendDirectoryLogInfo("Mod extraido cache detalle", outputDir);
    return outputDir;
  }

  const tempRoot = path.join(app.getPath("temp"), `rift-atlas-extract-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const tempDir = path.join(tempRoot, "mod");
  try {
    await appendOverlayLog(`Extrayendo paquete estilo Rose: ${sourcePath} -> ${outputDir}`);
    await fs.mkdir(tempDir, { recursive: true });
    await extractZip(sourcePath, { dir: tempDir });
    await appendDirectoryLogInfo("Paquete extraido temp", tempDir);
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => { });
    await fs.mkdir(path.dirname(outputDir), { recursive: true });
    await fs.rename(tempDir, outputDir).catch(async () => {
      await copyDirectory(tempDir, outputDir);
    });
    await fs.writeFile(path.join(outputDir, MOD_STAGING_SOURCE_MARKER), JSON.stringify({
      sourcePath,
      createdAt: new Date().toISOString()
    }, null, 2)).catch(() => {});
    await appendDirectoryLogInfo("Mod extraido final", outputDir);
    pruneModStagingCache().catch(() => {});
    return outputDir;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => { });
  }
};

const warmLocalModStagingCache = async (sourcePath, skin = {}) => {
  await extractArchiveModForOverlay(sourcePath, skin).catch((error) => {
    appendOverlayLog(`Staging Rose omitido para ${sourcePath}: ${error.message}`).catch(() => {});
  });
  return sourcePath;
};

const generateResolvedFantonizePackage = async ({ sidecarPath, gamePath, resolvedSkin }) => {
  await appendOverlayLog(`Generando .fantome local: ${resolvedSkin.champion} - ${resolvedSkin.skin} skin${resolvedSkin.skinNum}`);

  if (!resolvedSkin.championKey || resolvedSkin.skinNum === null || resolvedSkin.skinNum === undefined) {
    throw new Error(`No pude resolver el numero de skin para ${resolvedSkin.champion || resolvedSkin.name}.`);
  }

  const leagueRoot = path.dirname(path.dirname(gamePath));
  const wadPath = path.join(
    leagueRoot,
    "Game",
    "DATA",
    "FINAL",
    "Champions",
    `${resolvedSkin.championKey}.wad.client`
  );

  try {
    await fs.access(wadPath);
  } catch {
    throw new Error(`No encontre el WAD local para ${resolvedSkin.champion}: ${wadPath}`);
  }
  await appendFileLogInfo("WAD base de League", wadPath);

  const outputDir = path.join(getAppDataDir(), "mod-files");
  await fs.mkdir(outputDir, { recursive: true });

  const cleanSkinName = sanitizeFileName(String(resolvedSkin.skin || resolvedSkin.name || `skin${resolvedSkin.skinNum}`));
  const expectedPath = path.join(outputDir, `${resolvedSkin.championKey}_${cleanSkinName}.fantome`);
  try {
    const stat = await fs.stat(expectedPath);
    if (stat.size > 1024) {
      await appendOverlayLog(`Usando .fantome generado previamente: ${expectedPath}`);
      await appendFileLogInfo(".fantome cache fantonize", expectedPath);
      return expectedPath;
    }
  } catch { }

  const hashtablePath = await ensureGameHashtable();
  await appendFileLogInfo("Hashtable", hashtablePath);
  const request = {
    wadPath,
    champion: resolvedSkin.championKey,
    items: [{
      skinNumber: Number(resolvedSkin.skinNum),
      fileLabel: `${resolvedSkin.championKey}_${cleanSkinName}`,
      displayName: cleanSkinName
    }],
    outputDir,
    author: "Rift Atlas",
    hashtablePath,
    petNames: []
  };
  await appendOverlayLog(`Request fantonize: wadPath=${request.wadPath} champion=${request.champion} skinNumber=${request.items?.[0]?.skinNumber} outputDir=${request.outputDir}`);

  const stdout = await execToolWithTimeout(
    sidecarPath,
    ["fantonize", "--request-json", "-"],
    1000 * 60 * 8,
    {
      cwd: path.dirname(sidecarPath),
      input: JSON.stringify(request)
    }
  );

  let results;
  try {
    results = JSON.parse(String(stdout).trim());
  } catch (error) {
    throw new Error(`fantonize no devolvio JSON valido: ${error.message}`);
  }

  const written = results.find((item) => item.success && item.outputPath);
  if (!written) {
    const failed = results.find((item) => item.error)?.error || "sin detalle";
    throw new Error(`fantonize no pudo generar ${resolvedSkin.champion} - ${resolvedSkin.skin}: ${failed}`);
  }

  await appendOverlayLog(`.fantome generado: ${written.outputPath}`);
  await appendFileLogInfo(".fantome generado detalle", written.outputPath);
  return written.outputPath;
};

const generateFantomeFromLeagueWad = async ({ sidecarPath, gamePath, skin }) => {
  const sourcePath = String(skin?.path || "");
  const extension = sourcePath.toLowerCase().endsWith(".wad.client") ? ".wad.client" : path.extname(sourcePath).toLowerCase();
  const isLocalCustomArchive = Boolean(skin?.custom) &&
    !sourcePath.replace(/\//g, "\\").toLowerCase().includes("\\rift atlas\\downloaded-libraries\\leagueskins\\") &&
    [".zip", ".fantome"].includes(extension);
  await appendOverlayLog(`Preparando mod para overlay: extension=${extension || "sin extension"} display=${skin.champion || ""} - ${skin.skin || skin.name || ""}`);
  await appendFileLogInfo("Mod origen", sourcePath);
  if (extension === ".zip") {
    const resolvedSkin = await resolveFantonizeSkinEntry(skin);
    if (resolvedSkin?.needsFantonize) {
      await appendOverlayLog("ZIP con WAD mini resuelto; se usa el paquete LeagueSkins directo para mkoverlay.");
      return sourcePath;
    }
    const archiveInfo = resolvedSkin?.archiveInfo || skin.archiveInfo || {};
    if (archiveInfo.suspicious) {
      await appendOverlayLog("ERROR ZIP miniatura no resuelto; se cancela para evitar aplicar un WAD incompleto/bug visual.");
      throw new Error(`No pude resolver ${skin.skin || skin.name || path.basename(sourcePath)} a una skin de League. Reindexa LeagueSkins o revisa el paquete; no lo aplico directo para evitar modelos/VFX rotos.`);
    }
    if (isLocalCustomArchive && (archiveInfo.hasWadFolder || archiveInfo.wadCount)) {
      await appendOverlayLog("Mod local ZIP: calentando staging estilo Rose; mkoverlay usa el .zip original.");
      return warmLocalModStagingCache(sourcePath, skin);
    }
    return normalizeZipPackageForOverlay({ ...skin, archiveInfo: resolvedSkin?.archiveInfo || skin.archiveInfo });
  }
  if (extension === ".fantome") {
    if (isLocalCustomArchive) {
      const archiveInfo = skin.archiveInfo?.wadCount !== undefined
        ? skin.archiveInfo
        : await inspectArchivePackage(sourcePath).catch(() => ({}));
      if (archiveInfo.hasWadFolder || archiveInfo.wadCount) {
        await appendOverlayLog("Mod local .fantome: calentando staging estilo Rose; mkoverlay usa el .fantome original.");
        return warmLocalModStagingCache(sourcePath, skin);
      }
    }
    await appendOverlayLog(`Usando paquete .fantome directo: ${sourcePath}`);
    await appendFileLogInfo("Paquete .fantome directo", sourcePath);
    return sourcePath;
  }

  const resolvedSkin = await resolveFantonizeSkinEntry(skin);
  if (!resolvedSkin?.needsFantonize) {
    await appendOverlayLog(`Usando mod directo: ${resolvedSkin?.path || skin?.path}`);
    return resolvedSkin?.path;
  }

  return generateResolvedFantonizePackage({ sidecarPath, gamePath, resolvedSkin });
};

const spawnPatcherAndMonitor = async ({ sidecarPath, dllPath, overlayPath, runToken, dllSourceMetadata }) => {
  if (runningOverlayProcess) {
    await appendOverlayLog(`Deteniendo patcher anterior. PID=${runningOverlayProcess.pid}`);
    const previousProcess = runningOverlayProcess;
    previousProcess.stdin?.write("\n");
    previousProcess.kill();
    await waitForProcessExit(previousProcess, 2500);
    if (runningOverlayProcess === previousProcess) {
      runningOverlayProcess = null;
    }
  }
  throwIfOverlayRunCanceled(runToken);
  currentOverlayError = "";

  const bundledDll = dllPath;
  try { await fs.access(bundledDll); } catch {
    throw new Error(`cslol-dll.dll no encontrada en ${bundledDll}.`);
  }

  const runoverlayArgs = [
    "patcher",
    "--dll", bundledDll,
    "--overlay-root", path.normalize(overlayPath),
    "--flags", "0"
  ];

  await appendOverlayLog(`Iniciando patcher con overlay: ${overlayPath}`);
  await appendOverlayLog(`patcher args: ${runoverlayArgs.join(" ")}`);
  const patcherProcess = spawn(sidecarPath, runoverlayArgs, {
    cwd: path.dirname(sidecarPath),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  runningOverlayProcess = patcherProcess;
  runToken.processes.add(patcherProcess);
  currentProfilePath = overlayPath;

  let patcherExited = false;
  const handleOutput = (label, data) => {
    const text = String(data).trim();
    if (text) appendOverlayLog(`[${label}] ${text}`);
    if (runningOverlayProcess === patcherProcess && /end of life reached|EOL_TIMESTAMP|timestamp\s*>\s*EOL/i.test(text)) {
      const src = dllSourceMetadata?.sourceLabel
        ? ` Fuente usada: ${dllSourceMetadata.sourceLabel} ${dllSourceMetadata.version || ""}.`
        : "";
      currentOverlayError = `La DLL del engine esta vencida (End of life reached).${src} Reemplaza cslol-dll.dll manualmente en la carpeta engine.`;
      appendOverlayLog(`ERROR DLL vencida detectada: ${currentOverlayError}`);
      patcherProcess.stdin?.write("\n");
      patcherProcess.kill();
    }
  };
  patcherProcess.stdout?.on("data", (d) => handleOutput("PATCHER STDOUT", d));
  patcherProcess.stderr?.on("data", (d) => handleOutput("PATCHER STDERR", d));
  patcherProcess.on("exit", (code) => {
    patcherExited = true;
    runToken.processes.delete(patcherProcess);
    if (runningOverlayProcess === patcherProcess) {
      runningOverlayProcess = null;
      currentProfilePath = "";
    }
    appendOverlayLog(`Patcher exit code: ${code}`);
    cleanupNoCacheOverlay(overlayPath).then(() => pruneOverlayCache()).catch(() => {});
  });
  patcherProcess.on("error", (err) => {
    patcherExited = true;
    runToken.processes.delete(patcherProcess);
    if (runningOverlayProcess === patcherProcess) {
      runningOverlayProcess = null;
      currentProfilePath = "";
    }
    appendOverlayLog(`Patcher error: ${err.message}`);
    cleanupNoCacheOverlay(overlayPath).then(() => pruneOverlayCache()).catch(() => {});
  });

  await sleepMs(2000);
  throwIfOverlayRunCanceled(runToken);
  if (patcherExited || runningOverlayProcess !== patcherProcess) {
    throw new Error("El patcher fallo al iniciar (salio antes de tiempo).");
  }

  await appendOverlayLog(`Patcher activo. PID: ${patcherProcess.pid}`);
  await runToken.suspensionGuard?.markPatcherActive?.().catch(() => {});
  return { pid: patcherProcess.pid, profilePath: overlayPath };
};

ipcMain.handle("mods:run-bocchi-overlay", async (_event, payload) => {
  if (activeOverlayRun) {
    throw new Error("Ya hay una inyeccion en curso. Espera a que termine.");
  }
  const runToken = createOverlayRunToken();
  activeOverlayRun = runToken;
  const sidecarPath = await resolveHitoriEngineExecutable(payload?.sidecarPath);
  const dllPath = String(payload?.dllPath || "");
  const gamePath = String(payload?.gamePath || "");
  const skinEntries = Array.isArray(payload?.skinEntries)
    ? payload.skinEntries
    : (payload?.skinPaths || []).map((skinPath) => ({ path: skinPath }));
  const baseOverlayPath = payload?.baseOverlayPath;
  const allowNoCacheBase = Boolean(payload?.allowNoCacheBase);

  try {
    await appendOverlayLog("============================================================");
    await appendOverlayLog(`INICIO OVERLAY runId=${Date.now()} appUserData=${getAppDataDir()}`);
    await appendOverlayLog(`Payload: skins=${skinEntries.length} sidecar=${sidecarPath} dllConfigurada=${dllPath || "no configurada"} game=${gamePath}`);

    if (!gamePath.toLowerCase().endsWith("league of legends.exe")) {
      await appendOverlayLog(`ERROR configuracion League invalida: ${gamePath}`);
      throw new Error("League of Legends.exe no configurado.");
    }
    runToken.suspensionGuard = createGameSuspensionGuard({ gamePath, runToken });
    await appendOverlayLog(`[GameSuspend] Monitor activo durante preparacion del overlay.`);
    const overlayCacheDir = path.join(getAppDataDir(), "cslol-overlay-cache");
    const canUseBase = baseOverlayPath && await isUsableOverlayPath(baseOverlayPath, { allowNoCache: allowNoCacheBase }).catch(() => false);

    if (!skinEntries.length && !canUseBase) {
      await appendOverlayLog("ERROR no hay skins seleccionadas.");
      throw new Error("No hay skins seleccionadas.");
    }
    throwIfOverlayRunCanceled(runToken);

    if (canUseBase) {
      if (!skinEntries.length) {
        await appendOverlayLog(`MODO PREBUILD DIRECTO: overlay=${baseOverlayPath}`);
        const ensuredDll = await ensureCslolDll(sidecarPath, dllPath);
        throwIfOverlayRunCanceled(runToken);
        const dllMeta = await readDllSourceMetadata();
        await appendOverlayLog(`Engine: ${sidecarPath}`);
        await appendOverlayLog(`DLL: ${ensuredDll}`);
        await appendOverlayLog(`League: ${gamePath}`);
        const patcherResult = await spawnPatcherAndMonitor({
          sidecarPath, dllPath: ensuredDll, overlayPath: baseOverlayPath, runToken, dllSourceMetadata: dllMeta
        });
        await markOverlayCachePolicy(baseOverlayPath);
        await pruneOverlayCache({ protectedPaths: [baseOverlayPath] }).catch(() => {});
        await appendOverlayLog("FIN INICIO OVERLAY (prebuild directo): patcher activo.");
        return { success: true, ...patcherResult, enginePath: sidecarPath };
      }

      // ═══════════════════════════════════════════════════════════════
      // QUICK MERGE PATH: base overlay pre-construido + skin extra
      // ═══════════════════════════════════════════════════════════════
      await appendOverlayLog(`MODO MERGE: base=${baseOverlayPath} extras=${skinEntries.length}`);

      // Procesar solo las skins extra (las que NO estan en la base)
      const extraSkinPaths = [];
      for (const [index, entry] of skinEntries.entries()) {
        throwIfOverlayRunCanceled(runToken);
        await appendOverlayLog(`Extra #${index + 1}/${skinEntries.length}: champion=${entry?.champion || ""} skin=${entry?.skin || entry?.name || ""} path=${entry?.path}`);
        try { await fs.access(entry?.path); } catch {
          throw new Error(`Archivo no encontrado: ${entry?.path}`);
        }
        const modPath = await generateFantomeFromLeagueWad({ sidecarPath, gamePath, skin: entry });
        extraSkinPaths.push(modPath);
      }
      await appendOverlayLog(`Extra mods finales: ${extraSkinPaths.join(" | ")}`);
      throwIfOverlayRunCanceled(runToken);

      // Construir overlay extra (1 solo mod → rapido incluso cache miss)
      const extraCacheKey = await getOverlayCacheKey({ gamePath, skinPaths: extraSkinPaths });
      const extraOverlayPath = path.join(overlayCacheDir, extraCacheKey);
      const extraHit = await isUsableOverlayPath(extraOverlayPath).catch(() => false);

      if (!extraHit) {
        await appendOverlayLog(`Extra overlay cache MISS. mkoverlay para ${extraSkinPaths.length} mod(s)...`);
        await fs.rm(extraOverlayPath, { recursive: true, force: true }).catch(() => { });
        const gameFolder = path.dirname(gamePath);
        const toolsDir = path.dirname(sidecarPath);
        const profilesDir = path.join(getAppDataDir(), "cslol-profiles");
        const overlayStateDir = path.join(profilesDir, ".mkoverlay-state");
        await fs.mkdir(profilesDir, { recursive: true });
        await fs.mkdir(overlayCacheDir, { recursive: true });
        await fs.rm(overlayStateDir, { recursive: true, force: true }).catch(() => { });
        await fs.mkdir(overlayStateDir, { recursive: true });

        await execMkoverlayWithFallback({
          sidecarPath,
          toolsDir,
          gameFolder,
          overlayPath: extraOverlayPath,
          statePath: overlayStateDir,
          modPaths: extraSkinPaths,
          runToken,
          label: "mkoverlay extra"
        });
        throwIfOverlayRunCanceled(runToken);
        await markOverlayCachePolicy(extraOverlayPath);
        await pruneOverlayCache({ protectedPaths: [baseOverlayPath, extraOverlayPath] }).catch(() => {});
      }

      // Verificar extra overlay
      const extraFiles = await fs.readdir(extraOverlayPath).catch(() => []);
      if (!extraFiles.length) throw new Error("Extra overlay no genero archivos");

      // MERGE: copiar base + extra en directorio de trabajo
      const workingDir = path.join(overlayCacheDir, `merged-${Date.now()}`);
      await fs.mkdir(workingDir, { recursive: true });
      await appendOverlayLog(`Merge base → ${workingDir}`);
      await copyDirectory(baseOverlayPath, workingDir);
      await appendOverlayLog(`Merge extra → ${workingDir}`);
      await copyDirectory(extraOverlayPath, workingDir);
      await appendOverlayLog("Merge completado. Iniciando patcher...");

      // Patcher
      const ensuredDll = await ensureCslolDll(sidecarPath, dllPath);
      throwIfOverlayRunCanceled(runToken);
      const dllMeta = await readDllSourceMetadata();
      await appendOverlayLog(`Engine: ${sidecarPath}`);
      await appendOverlayLog(`DLL: ${ensuredDll}`);
      await appendOverlayLog(`League: ${gamePath}`);

      const patcherResult = await spawnPatcherAndMonitor({
        sidecarPath, dllPath: ensuredDll, overlayPath: workingDir, runToken, dllSourceMetadata: dllMeta
      });
      await markOverlayCachePolicy(workingDir);
      await pruneOverlayCache({ protectedPaths: [workingDir] }).catch(() => {});

      await appendOverlayLog("FIN INICIO OVERLAY (merge): patcher activo.");
      return { success: true, ...patcherResult, enginePath: sidecarPath };
    }

    // ═══════════════════════════════════════════════════════════════
    // FULL BUILD PATH (comportamiento original)
    // ═══════════════════════════════════════════════════════════════
    const ensuredDllPath = await ensureCslolDll(sidecarPath, dllPath);
    throwIfOverlayRunCanceled(runToken);
    const dllSourceMetadata = await readDllSourceMetadata();
    await appendOverlayLog(`Engine: ${sidecarPath}`);
    await appendOverlayLog(`DLL: ${ensuredDllPath}`);
    if (dllSourceMetadata) {
      await appendOverlayLog(`Fuente DLL: ${dllSourceMetadata.sourceLabel || "desconocida"} ${dllSourceMetadata.version || ""} asset=${dllSourceMetadata.assetName || ""} descargada=${dllSourceMetadata.downloadedAt || ""}`);
    } else {
      await appendOverlayLog("Fuente DLL: sin metadata guardada.");
    }
    await appendOverlayLog(`League: ${gamePath}`);
    await appendFileLogInfo("Engine detalle", sidecarPath);
    await appendFileLogInfo("DLL detalle", ensuredDllPath);
    await appendFileLogInfo("League exe detalle", gamePath);

    for (const [index, entry] of skinEntries.entries()) {
      throwIfOverlayRunCanceled(runToken);
      const sp = entry?.path;
      await appendOverlayLog(`Skin entrada #${index + 1}: champion=${entry?.champion || ""} skin=${entry?.skin || entry?.name || ""} variant=${entry?.variant || ""} path=${sp}`);
      await appendFileLogInfo(`Skin entrada #${index + 1} archivo`, sp);
      try { await fs.access(sp); } catch {
        await appendOverlayLog(`ERROR archivo seleccionado no encontrado: ${sp}`);
        throw new Error(`Archivo no encontrado: ${sp}`);
      }
    }

    const skinPaths = [];
    for (const [index, entry] of skinEntries.entries()) {
      throwIfOverlayRunCanceled(runToken);
      await appendOverlayLog(`Procesando skin #${index + 1}/${skinEntries.length}`);
      const modPath = await generateFantomeFromLeagueWad({ sidecarPath, gamePath, skin: entry });
      await appendFileLogInfo(`Mod final #${index + 1}`, modPath);
      skinPaths.push(modPath);
    }
    await appendOverlayLog(`Mods finales para mkoverlay: ${skinPaths.join(" | ")}`);
    throwIfOverlayRunCanceled(runToken);

    const gameFolder = path.dirname(gamePath);
    const toolsDir = path.dirname(sidecarPath);
    const profilesDir = path.join(getAppDataDir(), "cslol-profiles");
    const overlayStateDir = path.join(profilesDir, ".mkoverlay-state");
    const overlayCacheKey = await getOverlayCacheKey({ gamePath, skinPaths });
    const overlayPath = path.join(overlayCacheDir, overlayCacheKey);
    const statePath = overlayStateDir;
    await appendOverlayLog(`Rutas overlay: gameFolder=${gameFolder} toolsDir=${toolsDir} profilesDir=${profilesDir} overlayCache=${overlayPath} statePath=${statePath} cacheKey=${overlayCacheKey}`);

    await fs.mkdir(profilesDir, { recursive: true });
    await fs.mkdir(overlayCacheDir, { recursive: true });
    const oldProfiles = await fs.readdir(profilesDir, { withFileTypes: true }).catch(() => []);
    await Promise.all(oldProfiles
      .map((entry) => fs.rm(path.join(profilesDir, entry.name), { recursive: true, force: true }).catch(() => { })));
    await fs.mkdir(profilesDir, { recursive: true });
    await fs.rm(overlayStateDir, { recursive: true, force: true }).catch(() => { });
    await fs.mkdir(overlayStateDir, { recursive: true });
    await appendOverlayLog("Directorio de perfiles y state mkoverlay limpiados para nueva ejecucion.");

    const overlayCacheHit = await isUsableOverlayPath(overlayPath);
    if (overlayCacheHit) {
      await appendOverlayLog(`Overlay cache HIT: ${overlayPath}. Se salta mkoverlay.`);
      await appendDirectoryLogInfo("Overlay cache reutilizado", overlayPath);
    } else {
      await appendOverlayLog(`Overlay cache MISS: ${overlayPath}. Construyendo con mkoverlay.`);
      await fs.rm(overlayPath, { recursive: true, force: true }).catch(() => { });
    }

    if (!overlayCacheHit) {
      await appendOverlayLog(`Ejecutando mkoverlay en: ${overlayPath}`);
      let mkoverlayStdout = "";
      try {
        mkoverlayStdout = await execMkoverlayWithFallback({
          sidecarPath,
          toolsDir,
          gameFolder,
          overlayPath,
          statePath,
          modPaths: skinPaths,
          runToken,
          label: "mkoverlay"
        });
      } catch (error) {
        await appendOverlayLog(`mkoverlay fallo: ${error.message}`);
        throw new Error(`mkoverlay fallo: ${error.message}`);
      }
      throwIfOverlayRunCanceled(runToken);
      await appendOverlayLog(`mkoverlay OK${mkoverlayStdout ? `: ${mkoverlayStdout.slice(0, 500)}` : ""}`);
    }

    const overlayFiles = await fs.readdir(overlayPath).catch(() => []);
    await appendOverlayLog(`Archivos generados por overlay: ${overlayFiles.length}${overlayFiles.length ? ` (${overlayFiles.slice(0, 8).join(", ")})` : ""}`);
    await appendDirectoryLogInfo("Overlay generado detalle", overlayPath);
    await appendFileLogInfo("Overlay state detalle", statePath);
    if (overlayFiles.length === 0) {
      await appendOverlayLog(`mkoverlay no genero archivos en ${overlayPath}`);
      throw new Error(`mkoverlay no genero archivos en ${overlayPath}`);
    }

    const patcherResult = await spawnPatcherAndMonitor({
      sidecarPath, dllPath: ensuredDllPath, overlayPath, runToken, dllSourceMetadata
    });
    await markOverlayCachePolicy(overlayPath);
    await pruneOverlayCache({ protectedPaths: [overlayPath] }).catch(() => {});

    await appendOverlayLog("FIN INICIO OVERLAY: patcher activo.");
    return { success: true, ...patcherResult, enginePath: sidecarPath };
  } finally {
    await runToken.suspensionGuard?.release?.("fin-ejecucion").catch(() => {});
    runToken.suspensionGuard = null;
    if (activeOverlayRun === runToken) {
      activeOverlayRun = null;
    }
  }
});

// ── Pre-build base overlay from custom mods (no patcher start) ──
ipcMain.handle("mods:build-base-overlay", async (_event, payload) => {
  if (activeOverlayRun) {
    await appendOverlayLog("Base overlay omitido: hay una inyeccion/compilacion en curso.").catch(() => {});
    return { overlayPath: "" };
  }
  const sidecarPath = await resolveHitoriEngineExecutable(payload?.sidecarPath);
  const gamePath = String(payload?.gamePath || "");
  const skinEntries = payload?.skinEntries || [];

  if (!gamePath.toLowerCase().endsWith("league of legends.exe")) {
    return { overlayPath: "" };
  }
  if (!skinEntries.length) {
    return { overlayPath: "" };
  }

  const runToken = createOverlayRunToken();
  activeOverlayRun = runToken;
  const overlayCacheDir = path.join(getAppDataDir(), "cslol-overlay-cache");

  try {
    await appendOverlayLog("=== PRE-BUILD BASE OVERLAY (mods custom) ===");
    const skinPaths = [];
    for (const [index, entry] of skinEntries.entries()) {
      throwIfOverlayRunCanceled(runToken);
      await appendOverlayLog(`Base mod #${index + 1}/${skinEntries.length}: ${entry.champion || ""} - ${entry.skin || entry.name || ""}`);
      const modPath = await generateFantomeFromLeagueWad({ sidecarPath, gamePath, skin: entry });
      skinPaths.push(modPath);
    }
    await appendOverlayLog(`Base mods finales: ${skinPaths.join(" | ")}`);
    throwIfOverlayRunCanceled(runToken);

    const gameFolder = path.dirname(gamePath);
    const toolsDir = path.dirname(sidecarPath);
    const profilesDir = path.join(getAppDataDir(), "cslol-profiles");
    const overlayStateDir = path.join(profilesDir, ".mkoverlay-state");
    const overlayCacheKey = await getOverlayCacheKey({ gamePath, skinPaths });
    const overlayPath = path.join(overlayCacheDir, overlayCacheKey);
    await appendOverlayLog(`Base overlay cacheKey=${overlayCacheKey} path=${overlayPath}`);

    const overlayCacheHit = await isUsableOverlayPath(overlayPath);
    if (overlayCacheHit) {
      await appendOverlayLog(`Base overlay cache HIT: ${overlayPath}. Se salta mkoverlay.`);
    } else {
      await appendOverlayLog(`Base overlay cache MISS. Ejecutando mkoverlay...`);
      await fs.rm(overlayPath, { recursive: true, force: true }).catch(() => { });
      await fs.mkdir(profilesDir, { recursive: true });
      await fs.mkdir(overlayCacheDir, { recursive: true });
      await fs.rm(overlayStateDir, { recursive: true, force: true }).catch(() => { });
      await fs.mkdir(overlayStateDir, { recursive: true });

      await execMkoverlayWithFallback({
        sidecarPath,
        toolsDir,
        gameFolder,
        overlayPath,
        statePath: overlayStateDir,
        modPaths: skinPaths,
        runToken,
        label: "mkoverlay base"
      });
      throwIfOverlayRunCanceled(runToken);

      const overlayFiles = await fs.readdir(overlayPath).catch(() => []);
      if (!overlayFiles.length) throw new Error("mkoverlay no genero archivos");
      await appendOverlayLog(`Base overlay generado: ${overlayFiles.length} archivos`);
    }

    await markOverlayCachePolicy(overlayPath);
    await pruneOverlayCache({ protectedPaths: [overlayPath] }).catch(() => {});
    return { overlayPath };
  } catch (error) {
    await appendOverlayLog(`Base overlay error: ${error.message}`);
    return { overlayPath: "" };
  } finally {
    await runToken.suspensionGuard?.release?.("fin-prebuild").catch(() => {});
    runToken.suspensionGuard = null;
    if (activeOverlayRun === runToken) activeOverlayRun = null;
  }
});

ipcMain.handle("ltk:download-and-install", async () => {
  const { release, asset } = await getLatestLtkSetupAsset();

  const downloadDir = path.join(getAppDataDir(), "ltk-download");
  await fs.mkdir(downloadDir, { recursive: true });
  const setupPath = path.join(downloadDir, asset.name);

  await downloadFile(asset.browser_download_url, setupPath);

  return {
    setupPath,
    dllPath: "",
    version: release.tag_name || release.name,
    assetName: asset.name
  };
});

let runningOverlayProcess = null;
let currentProfilePath = "";
let currentOverlayLog = "";
let currentOverlayError = "";
let activeOverlayRun = null;

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

const createOverlayRunToken = () => ({
  canceled: false,
  processes: new Set(),
  suspensionGuard: null
});

const cancelOverlayRun = async (reason = "Cancelado por el usuario.") => {
  const token = activeOverlayRun;
  if (!token) return false;
  token.canceled = true;
  token.reason = reason;
  for (const proc of token.processes) {
    proc.stdin?.write("\n");
    proc.kill();
  }
  token.processes.clear();
  await token.suspensionGuard?.release?.("cancelacion").catch(() => {});
  token.suspensionGuard = null;
  activeOverlayRun = null;
  await appendOverlayLog(`Cancelacion solicitada: ${reason}`);
  return true;
};

const throwIfOverlayRunCanceled = (token = activeOverlayRun) => {
  if (token?.canceled) {
    throw new Error(token.reason || "Ejecucion cancelada por el usuario.");
  }
};

const waitForProcessExit = (proc, timeoutMs = 2500) => new Promise((resolve) => {
  if (!proc || proc.exitCode !== null) {
    resolve(false);
    return;
  }
  let settled = false;
  const done = (exited) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    proc.off?.("exit", onExit);
    proc.off?.("error", onExit);
    resolve(exited);
  };
  const onExit = () => done(true);
  const timer = setTimeout(() => done(false), timeoutMs);
  proc.once("exit", onExit);
  proc.once("error", onExit);
});

const runPowerShellJson = (script, args = [], timeout = 5000) => new Promise((resolve, reject) => {
  const env = { ...process.env };
  args.forEach((arg, index) => {
    env[`RIFT_ATLAS_PS_ARG_${index}`] = String(arg);
  });
  execFile("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", `& {\n${script}\n}`
  ], { windowsHide: true, timeout, env }, (error, stdout, stderr) => {
    if (error) {
      reject(new Error(String(stderr || error.message).trim() || "PowerShell fallo."));
      return;
    }
    const text = String(stdout || "").trim();
    if (!text) {
      resolve(null);
      return;
    }
    try {
      resolve(JSON.parse(text));
    } catch {
      resolve(text);
    }
  });
});

const getLeagueGameProcessPids = async (gamePath = "") => {
  if (process.platform !== "win32") return [];
  const script = `
$target = [System.IO.Path]::GetFullPath($env:RIFT_ATLAS_PS_ARG_0).ToLowerInvariant()
$items = Get-CimInstance Win32_Process -Filter "Name = 'League of Legends.exe'" |
  Where-Object {
    $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath).ToLowerInvariant() -eq $target)
  } |
  Select-Object -ExpandProperty ProcessId
@($items) | ConvertTo-Json -Compress
`;
  const result = await runPowerShellJson(script, [gamePath], 5000);
  return (Array.isArray(result) ? result : (result ? [result] : []))
    .map((pid) => Number(pid))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
};

const setProcessSuspended = async (pid, suspend = true) => {
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NtProc {
  [DllImport("ntdll.dll")] public static extern uint NtSuspendProcess(IntPtr hProcess);
  [DllImport("ntdll.dll")] public static extern uint NtResumeProcess(IntPtr hProcess);
}
"@
$pidValue = [int]$env:RIFT_ATLAS_PS_ARG_0
$mode = $env:RIFT_ATLAS_PS_ARG_1
$proc = [System.Diagnostics.Process]::GetProcessById($pidValue)
try {
  if ($mode -eq "suspend") {
    [NtProc]::NtSuspendProcess($proc.Handle) | Out-Null
  } else {
    for ($i = 0; $i -lt 4; $i++) {
      [NtProc]::NtResumeProcess($proc.Handle) | Out-Null
    }
  }
  @{ ok = $true; pid = $pidValue; mode = $mode } | ConvertTo-Json -Compress
} finally {
  $proc.Dispose()
}
`;
  await runPowerShellJson(script, [pid, suspend ? "suspend" : "resume"], 5000);
};

const createGameSuspensionGuard = ({ gamePath = "", runToken = null } = {}) => {
  if (process.platform !== "win32" || !gamePath) {
    return { release: async () => {}, markPatcherActive: async () => {} };
  }

  let active = true;
  let released = false;
  let timer = null;
  let suspendedPid = 0;
  let suspendStartedAt = 0;
  let busy = false;

  const release = async (reason = "release") => {
    active = false;
    released = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    const pid = suspendedPid;
    suspendedPid = 0;
    if (pid) {
      try {
        await setProcessSuspended(pid, false);
        await appendOverlayLog(`[GameSuspend] League reanudado pid=${pid} reason=${reason}`);
      } catch (error) {
        await appendOverlayLog(`[GameSuspend] ERROR al reanudar pid=${pid}: ${error.message}`);
      }
    }
  };

  const tick = async () => {
    if (!active || released || busy || runToken?.canceled) return;
    busy = true;
    try {
      if (suspendedPid) {
        if (Date.now() - suspendStartedAt >= GAME_SUSPEND_AUTO_RESUME_MS) {
          await appendOverlayLog(`[GameSuspend] Auto-resume tras ${Math.round(GAME_SUSPEND_AUTO_RESUME_MS / 1000)}s.`);
          await release("auto-timeout");
        }
        return;
      }
      const pids = await getLeagueGameProcessPids(gamePath).catch((error) => {
        appendOverlayLog(`[GameSuspend] No pude buscar proceso League: ${error.message}`).catch(() => {});
        return [];
      });
      const pid = pids[0];
      if (!pid || !active || released || runToken?.canceled) return;
      try {
        await setProcessSuspended(pid, true);
        suspendedPid = pid;
        suspendStartedAt = Date.now();
        await appendOverlayLog(`[GameSuspend] League suspendido pid=${pid}. Auto-resume=${Math.round(GAME_SUSPEND_AUTO_RESUME_MS / 1000)}s`);
      } catch (error) {
        await appendOverlayLog(`[GameSuspend] ERROR suspendiendo pid=${pid}: ${error.message}`);
        await release("suspend-error");
      }
    } finally {
      busy = false;
    }
  };

  timer = setInterval(() => tick().catch(() => {}), GAME_SUSPEND_MONITOR_INTERVAL_MS);
  tick().catch(() => {});

  return {
    release,
    markPatcherActive: () => release("patcher-activo")
  };
};

const appendOverlayLog = async (line) => {
  const text = String(line || "").trim();
  if (!text) return;
  currentOverlayLog = `${currentOverlayLog}${text}\n`.slice(-30000);
  await fs.appendFile(path.join(getAppDataDir(), "last-overlay-log.txt"), `${new Date().toISOString()} ${text}\n`).catch(() => { });
};

const testCslolDllLoad = async ({ enginePath, dllPath }) => {
  const tempRoot = path.join(app.getPath("temp"), "rift-atlas-dll-check");
  const overlayRoot = path.join(tempRoot, "overlay");
  await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => { });
  await fs.mkdir(path.join(overlayRoot, "DATA"), { recursive: true });

  return new Promise((resolve) => {
    let done = false;
    let output = "";
    const finish = async (result) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      child?.stdin?.write("\n");
      child?.kill();
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => { });
      resolve(result);
    };

    let child = null;
    const timeout = setTimeout(() => {
      const text = output.trim();
      if (/end of life reached|EOL_TIMESTAMP|timestamp\s*>\s*EOL/i.test(text)) {
        finish({ ok: false, message: `DLL vencida detectada: ${text.slice(-220)}` });
        return;
      }
      if (/Initialized\. Waiting for game/i.test(text)) {
        finish({ ok: true, message: "Carga inicial OK; el patcher quedo esperando el juego. El EOL final solo se confirma al entrar a partida." });
        return;
      }
      finish({ ok: true, message: text ? `Sin error inmediato: ${text.slice(-220)}` : "Sin error inmediato al cargar el patcher." });
    }, 3500);

    try {
      child = spawn(enginePath, [
        "patcher",
        "--dll",
        dllPath,
        "--overlay-root",
        `${path.normalize(overlayRoot)}\\`,
        "--flags",
        "0"
      ], {
        cwd: path.dirname(enginePath),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (error) {
      finish({ ok: false, message: `No pude iniciar el patcher: ${error.message}` });
      return;
    }

    const handleOutput = (data) => {
      output = `${output}${String(data)}`.slice(-4000);
      if (/end of life reached|EOL_TIMESTAMP|timestamp\s*>\s*EOL/i.test(output)) {
        finish({ ok: false, message: `DLL vencida detectada: ${output.trim().slice(-220)}` });
      }
    };

    child.stdout?.on("data", handleOutput);
    child.stderr?.on("data", handleOutput);
    child.on("error", (error) => {
      finish({ ok: false, message: `Error del patcher: ${error.message}` });
    });
    child.on("exit", (code) => {
      if (!done) {
        finish({
          ok: false,
          message: `El patcher salio durante el chequeo (code=${code ?? "null"}): ${output.trim().slice(-220) || "sin salida"}`
        });
      }
    });
  });
};

ipcMain.handle("mods:stop-overlay", async () => {
  const canceledRun = await cancelOverlayRun("Detenido manualmente desde la UI.");
  if (runningOverlayProcess) {
    const processToStop = runningOverlayProcess;
    const stoppedProfilePath = currentProfilePath;
    await appendOverlayLog(`STOP solicitado desde UI. PID=${processToStop.pid} profile=${currentProfilePath}`);
    processToStop.stdin?.write("\n");
    processToStop.kill();
    await waitForProcessExit(processToStop, 2500);
    if (runningOverlayProcess === processToStop) {
      runningOverlayProcess = null;
      currentProfilePath = "";
    }
    currentOverlayError = "";
    await cleanupNoCacheOverlay(stoppedProfilePath).catch(() => false);
    await pruneOverlayCache().catch(() => {});
    await appendOverlayLog("STOP completado: proceso marcado como detenido.");
    return { stopped: true };
  }
  if (canceledRun) {
    const stoppedProfilePath = currentProfilePath;
    currentProfilePath = "";
    currentOverlayError = "";
    await cleanupNoCacheOverlay(stoppedProfilePath).catch(() => false);
    await pruneOverlayCache().catch(() => {});
    await appendOverlayLog("STOP completado: ejecucion en preparacion cancelada.");
    return { stopped: true };
  }
  await appendOverlayLog("STOP solicitado desde UI, pero no habia patcher activo.");
  return { stopped: false };
});

ipcMain.handle("mods:overlay-status", async () => {
  const status = { running: runningOverlayProcess !== null && !currentOverlayError, profilePath: currentProfilePath, error: currentOverlayError };
  if (!status.running && currentProfilePath) {
    await appendOverlayLog(`Estado inconsistente: no hay proceso pero profilePath=${currentProfilePath}`);
  }
  return status;
});

ipcMain.handle("mods:is-league-game-running", async (_event, gamePath = "") => {
  const pids = await getLeagueGameProcessPids(gamePath).catch(() => []);
  const pid = pids[0] || 0;
  return {
    running: pid > 0,
    pid
  };
});

ipcMain.handle("mods:append-overlay-log", async (_event, message) => {
  await appendOverlayLog(String(message || ""));
});

ipcMain.handle("mods:diagnose-overlay", async (_event, payload = {}) => {
  const checks = [];
  const addPathCheck = async ({ id, label, filePath, matcher }) => {
    const value = String(filePath || "");
    const okName = value && (!matcher || matcher.test(value));
    let exists = false;
    try {
      if (okName) {
        await fs.access(value);
        exists = true;
      }
    } catch {
      exists = false;
    }
    checks.push({
      id,
      label,
      ok: Boolean(okName && exists),
      value,
      message: okName ? (exists ? "OK" : "No se encontro el archivo") : "Ruta no configurada o no valida"
    });
  };

  await addPathCheck({
    id: "engine",
    label: "Engine",
    filePath: payload.enginePath,
    matcher: /(^|[\\/])ltk-manager\.exe$/i
  });
  await addPathCheck({
    id: "dll",
    label: "DLL",
    filePath: payload.dllPath,
    matcher: /\.dll$/i
  });
  await addPathCheck({
    id: "league",
    label: "League",
    filePath: payload.leagueGamePath,
    matcher: /(^|[\\/])League of Legends\.exe$/i
  });

  const engineCheck = checks.find((check) => check.id === "engine");
  const dllCheck = checks.find((check) => check.id === "dll");
  const dllSourceMetadata = await readDllSourceMetadata();
  checks.push({
    id: "dll-source",
    label: "Fuente DLL",
    ok: Boolean(dllSourceMetadata),
    value: dllSourceMetadata?.installedPath || "",
    message: dllSourceMetadata
      ? `${dllSourceMetadata.sourceLabel || "desconocida"} ${dllSourceMetadata.version || ""} (${dllSourceMetadata.assetName || "sin asset"})`
      : "Sin metadata; coloca el DLL manualmente en la carpeta engine"
  });

  if (engineCheck?.ok && dllCheck?.ok) {
    const testResult = await testCslolDllLoad({
      enginePath: engineCheck.value,
      dllPath: dllCheck.value
    });
    checks.push({
      id: "dll-runtime",
      label: "Prueba DLL",
      ok: testResult.ok,
      value: dllCheck.value,
      message: testResult.message
    });
  } else {
    checks.push({
      id: "dll-runtime",
      label: "Prueba DLL",
      ok: false,
      value: "",
      message: "No se puede probar hasta tener Engine y DLL validos"
    });
  }

  checks.push({
    id: "overlay",
    label: "Overlay",
    ok: runningOverlayProcess !== null,
    value: currentProfilePath || "",
    message: runningOverlayProcess ? "Activo" : "Detenido"
  });

  return {
    ok: checks.filter((check) => !["overlay", "dll-source"].includes(check.id)).every((check) => check.ok),
    checks
  };
});

const getP2PMimeType = (filePath = "") => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".wad.client") || lower.endsWith(".wad")) return "application/x-wad";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".fantome")) return "application/x-fantome";
  return "application/octet-stream";
};

const getP2PPackageExtension = (filePath = "") => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".wad.client")) return ".wad.client";
  return path.extname(filePath).toLowerCase() || ".fantome";
};

const hashFileSha256 = async (filePath) => {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
};

ipcMain.handle("party:get-file-info", async (_event, filePath) => {
  const resolvedPath = String(filePath || "");
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) {
    throw new Error("No es un archivo valido.");
  }
  return {
    fileName: path.basename(resolvedPath),
    size: stat.size,
    hash: await hashFileSha256(resolvedPath),
    mimeType: getP2PMimeType(resolvedPath)
  };
});

ipcMain.handle("party:read-file-chunk", async (_event, payload = {}) => {
  const filePath = String(payload.filePath || "");
  const offset = Number(payload.offset || 0);
  const length = Math.max(0, Math.min(Number(payload.length || 0), 256 * 1024));
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    const chunk = buffer.subarray(0, bytesRead);
    return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
  } finally {
    await handle.close();
  }
});

ipcMain.handle("party:write-file", async (_event, payload = {}) => {
  const fileName = sanitizeFileName(path.basename(String(payload.fileName || "party-mod.fantome")));
  const expectedHash = String(payload.hash || "");
  const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];
  const skin = payload.skin || {};
  const outputDir = path.join(getAppDataDir(), "p2p");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${Date.now()}-${fileName}`);
  const buffers = chunks.map((chunk) => Buffer.from(chunk));
  await fs.writeFile(outputPath, Buffer.concat(buffers));
  const actualHash = await hashFileSha256(outputPath);
  if (expectedHash && actualHash !== expectedHash) {
    await fs.rm(outputPath, { force: true }).catch(() => { });
    throw new Error("Hash mismatch al recibir archivo P2P.");
  }
  const stat = await fs.stat(outputPath);
  const extension = getP2PPackageExtension(outputPath);
  return {
    path: outputPath,
    relativePath: path.basename(outputPath),
    name: skin.name || path.basename(outputPath),
    champion: skin.champion || "Party",
    skin: skin.name || path.basename(outputPath),
    variant: `P2P ${skin.source || ""}`.trim(),
    extension,
    size: stat.size,
    source: "p2p",
    custom: true,
    importedAt: new Date().toISOString()
  };
});

ipcMain.handle("party:delete-file", async (_event, filePath) => {
  const target = path.resolve(String(filePath || ""));
  const p2pDir = path.resolve(path.join(getAppDataDir(), "p2p"));
  const oldP2pDir = path.resolve(path.join(getAppDataDir(), "party-transfers"));
  if (!target.startsWith(`${p2pDir}${path.sep}`) && !target.startsWith(`${oldP2pDir}${path.sep}`)) {
    throw new Error("Solo se pueden borrar archivos P2P recibidos por Rift Atlas.");
  }
  await fs.rm(target, { force: true }).catch(() => { });
  return true;
});

ipcMain.handle("party:clear-p2p-files", async () => {
  const outputDir = path.join(getAppDataDir(), "p2p");
  const oldOutputDir = path.join(getAppDataDir(), "party-transfers");
  await fs.rm(outputDir, { recursive: true, force: true }).catch(() => { });
  await fs.rm(oldOutputDir, { recursive: true, force: true }).catch(() => { });
  await fs.mkdir(outputDir, { recursive: true });
  return { folderPath: outputDir };
});

const execToolWithTimeout = (command, args, timeout, options = {}) => {
  return new Promise((resolve, reject) => {
    const { input, runToken, ...spawnOptions } = options;
    if (runToken?.canceled) {
      reject(new Error(runToken.reason || "Ejecucion cancelada por el usuario."));
      return;
    }
    const spawnEnv = { ...process.env, ...spawnOptions.env };
    // mod-tools.exe (Rose/cslol-manager) hardcodes its data dir under
    // %LOCALAPPDATA%\Rose. By pointing LOCALAPPDATA at Rift Atlas we force it
    // to use Rift Atlas\Rose and avoid creating a second Rose folder.
    if (path.basename(command).toLowerCase() === "mod-tools.exe") {
      spawnEnv.LOCALAPPDATA = path.join(process.env.LOCALAPPDATA || "", "Rift Atlas");
    }
    const proc = spawn(command, args, { windowsHide: true, ...spawnOptions, env: spawnEnv });
    runToken?.processes?.add(proc);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      runToken?.processes?.delete(proc);
      callback();
    };
    const timer = setTimeout(() => {
      proc.kill();
      const detail = [stderr, stdout].filter(Boolean).join("\n").slice(-1000);
      finish(() => reject(new Error(`Process timed out after ${Math.round(timeout / 1000)}s${detail ? `: ${detail}` : ""}`)));
    }, timeout);
    proc.stdout?.on("data", (d) => { stdout += String(d); });
    proc.stderr?.on("data", (d) => { stderr += String(d); });
    if (input !== undefined) {
      proc.stdin?.write(input);
      proc.stdin?.end();
    }
    proc.on("close", (code) => {
      finish(() => {
        if (runToken?.canceled) {
          reject(new Error(runToken.reason || "Ejecucion cancelada por el usuario."));
        } else if (code === 0) {
          resolve(stdout);
        } else {
          const detail = [stderr, stdout].filter(Boolean).join("\n").slice(-4000);
          reject(new Error(detail || `exit code ${code}`));
        }
      });
    });
    proc.on("error", (err) => {
      finish(() => reject(runToken?.canceled ? new Error(runToken.reason || "Ejecucion cancelada por el usuario.") : err));
    });
  });
};

ipcMain.handle("mods:select-skin-library", async () => {
  const result = await dialog.showOpenDialog({
    title: "Seleccionar carpeta LeagueSkins",
    properties: ["openDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  const folderPath = result.filePaths[0];
  return {
    folderPath,
    skins: await indexSkinLibrary(folderPath)
  };
});

ipcMain.handle("mods:index-skin-library", async (_event, folderPath) => {
  const target = String(folderPath || "");
  if (!target) {
    throw new Error("Ruta de LeagueSkins vacia.");
  }

  await fs.access(target);
  return {
    folderPath: target,
    skins: await indexSkinLibrary(target)
  };
});

ipcMain.handle("mods:download-league-skins", async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return downloadAndIndexLeagueSkins(window);
});

ipcMain.handle("mods:get-downloaded-league-skins-path", () => getDownloadedLeagueSkinsPath());

ipcMain.handle("mods:index-downloaded-league-skins", async () => {
  const folderPath = await getDownloadedLeagueSkinsPath();
  if (!folderPath) {
    throw new Error("LeagueSkins descargado no encontrado.");
  }

  return {
    folderPath,
    skins: await indexSkinLibrary(folderPath)
  };
});

ipcMain.handle("tiers:get-lane", (_event, payload) => getChampionTierLane(String(payload?.lane || "top"), String(payload?.version || "")));
ipcMain.handle("data:get-champions", () => getDataDragonChampionData());
ipcMain.handle("builds:get-champion", (_event, payload) => fetchUggChampionBuild({
  championId: String(payload?.championId || ""),
  championName: String(payload?.championName || ""),
  version: String(payload?.version || "")
}));

const createApplicationTray = (mainWindow, appIcon) => {
  if (appTray || process.platform !== "win32") return;
  appTray = new Tray(appIcon);
  appTray.setToolTip("Rift Atlas");

  const showWindow = () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  };

  const updateMenu = () => {
    appTray.setContextMenu(Menu.buildFromTemplate([
      { label: "Mostrar Rift Atlas", click: showWindow },
      {
        label: "Detener overlay",
        click: () => {
          cancelOverlayRun("Detenido desde bandeja.").catch(() => {});
          if (runningOverlayProcess) {
            appendOverlayLog(`STOP solicitado desde bandeja. PID=${runningOverlayProcess.pid} profile=${currentProfilePath}`).catch(() => {});
            runningOverlayProcess.stdin?.write("\n");
            runningOverlayProcess.kill();
            runningOverlayProcess = null;
            const stoppedProfilePath = currentProfilePath;
            currentProfilePath = "";
            currentOverlayError = "";
            cleanupNoCacheOverlay(stoppedProfilePath).then(() => pruneOverlayCache()).catch(() => {});
          }
        }
      },
      { type: "separator" },
      {
        label: "Salir",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]));
  };

  appTray.on("click", showWindow);
  updateMenu();
};

const createWindow = () => {
  const appIcon = nativeImage.createFromPath(process.platform === "win32" ? APP_ICON : APP_ICON_PNG);
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "Rift Atlas",
    icon: appIcon,
    backgroundColor: "#081018",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setIcon(appIcon);
  createApplicationTray(mainWindow, appIcon);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
  mainWindow.webContents.once("did-finish-load", () => {
    const flags = {
      ...startupFlags,
      firstRun: isFirstRun()
    };
    if (flags.showTutorial || flags.firstRun) {
      setTimeout(() => {
        if (mainWindow.isDestroyed()) return;
        mainWindow.webContents.send("app:start-tutorial", flags);
      }, 1200);
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow.maximize());

  let penguCleanupDone = false;
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    if (penguCleanupDone) return;
    event.preventDefault();
    penguCleanupDone = true;
    const modFilesDir = path.join(getAppDataDir(), "mod-files");
    const CLOSE_TIMEOUT_MS = 8000;
    const cleanup = async () => {
      await Promise.race([
        deactivatePenguLoader({ allowElevation: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), CLOSE_TIMEOUT_MS))
      ]).catch(() => {});
      await terminatePenguLoaderUi().catch(() => {});
      await fs.rm(modFilesDir, { recursive: true, force: true }).catch(() => { });
      app.quit();
    };
    cleanup();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
};

const sendPenguBridgeToWindows = (channel, payload = {}) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  });
};

const sendPenguBridgeMessage = (payload = {}) => {
  const outbound = {
    source: "rift-atlas-app",
    at: new Date().toISOString(),
    ...payload
  };
  if (outbound.type === "skin-catalog" || outbound.type === "skin-apply-result") {
    const compact = {
      ...outbound,
      skins: Array.isArray(outbound.skins) ? `count=${outbound.skins.length}` : outbound.skins,
      queued: Array.isArray(outbound.queued) ? outbound.queued.slice(0, 8) : outbound.queued
    };
    appendOverlayLog(`[Pengu App] ${JSON.stringify(compact).slice(0, 1200)}`).catch(() => { });
  }
  const message = JSON.stringify(outbound);
  let sent = 0;
  penguBridgeClients.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
      sent += 1;
    }
  });
  return sent;
};

const getImageMimeType = (filePath = "") => {
  const ext = path.extname(String(filePath)).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
};

const findLeagueSkinsPreviewFile = async ({ championId, skinId, chromaId }) => {
  const root = await getDownloadedLeagueSkinsPath();
  if (!root) return "";
  const safeChampionId = String(Number(championId) || "");
  const skinIds = getLeagueSkinIdCandidates(safeChampionId, skinId);
  const chromaIds = getLeagueSkinIdCandidates(safeChampionId, chromaId);
  if (!safeChampionId || !skinIds.length || !chromaIds.length) return "";

  for (const candidateSkinId of skinIds) {
    for (const candidateChromaId of chromaIds) {
      const dirs = [
        path.join(root, "skins", safeChampionId, candidateSkinId, candidateChromaId),
        path.join(root, "skins", safeChampionId, candidateSkinId)
      ];
      const names = [...new Set([candidateChromaId, candidateSkinId, String(Number(chromaId) || ""), String(Number(skinId) || "")].filter(Boolean))];
      for (const dir of dirs) {
        for (const name of names) {
          for (const ext of LOCAL_PREVIEW_EXTENSIONS) {
            const candidate = path.join(dir, `${name}${ext}`);
            if (await fileExists(candidate)) return candidate;
          }
        }
      }
    }
  }

  const championDir = path.join(root, "skins", safeChampionId);
  const skinDirs = await fs.readdir(championDir, { withFileTypes: true }).catch(() => []);
  for (const entry of skinDirs) {
    if (!entry.isDirectory()) continue;
    for (const candidateChromaId of chromaIds) {
      const chromaDir = path.join(championDir, entry.name, candidateChromaId);
      for (const name of [...new Set([candidateChromaId, String(Number(chromaId) || "")].filter(Boolean))]) {
        for (const ext of LOCAL_PREVIEW_EXTENSIONS) {
          const candidate = path.join(chromaDir, `${name}${ext}`);
          if (await fileExists(candidate)) return candidate;
        }
      }
    }
  }
  return "";
};

const findIndexedPreviewFile = async ({ championId, skinId, chromaId }) => {
  const safeChampionId = String(Number(championId) || "");
  const skinIds = new Set(getLeagueSkinIdCandidates(safeChampionId, skinId));
  const chromaIds = new Set(getLeagueSkinIdCandidates(safeChampionId, chromaId));
  if (!safeChampionId || !skinIds.size || !chromaIds.size) return "";

  try {
    const payload = JSON.parse(await fs.readFile(getSkinIndexCachePath(), "utf8"));
    const skins = Array.isArray(payload.skins) ? payload.skins : [];
    const match = skins.find((entry) => {
      const entryChampion = String(entry.championId || entry.rawChampion || "");
      if (entryChampion !== safeChampionId) return false;
      const entryBaseValues = [
        entry.rawSkin,
        entry.baseSkinId,
        entry.baseImageSkinNum,
        entry.imageSkinNum,
        entry.skinNum
      ].flatMap((value) => getLeagueSkinIdCandidates(safeChampionId, value));
      const entryVariantValues = [
        entry.rawVariant,
        entry.fileBaseId,
        entry.skinNum,
        entry.imageSkinNum
      ].flatMap((value) => getLeagueSkinIdCandidates(safeChampionId, value));
      return entry.localPreviewPath &&
        entryBaseValues.some((value) => skinIds.has(value)) &&
        entryVariantValues.some((value) => chromaIds.has(value));
    });
    if (match?.localPreviewPath && await fileExists(match.localPreviewPath)) {
      return match.localPreviewPath;
    }
  } catch {}

  return "";
};

const getPenguAssetUrl = (routePath) => `http://127.0.0.1:${PENGU_ASSET_PORT}${routePath}`;

const writeHttpResponse = (response, statusCode, headers = {}, body = "") => {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "https://127.0.0.1:65236",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "public, max-age=3600",
    ...headers
  });
  response.end(body);
};

const serveFileResponse = async (response, filePath) => {
  const fileBuffer = await fs.readFile(filePath);
  writeHttpResponse(response, 200, { "Content-Type": getImageMimeType(filePath) }, fileBuffer);
};

const getLocalAssetFile = async (assetPath = "") => {
  const normalized = String(assetPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return "";
  const candidates = [
    getPackagedAssetPath("assets", normalized),
    path.join(getAppDataDir(), "downloaded-libraries", "LeagueSkins", normalized)
  ];
  return findExistingPath(candidates);
};

const startPenguAssetServer = () => {
  if (penguAssetServer) return;
  penguAssetServer = http.createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") {
        writeHttpResponse(response, 204);
        return;
      }
      if (request.method !== "GET") {
        writeHttpResponse(response, 405, { "Content-Type": "text/plain" }, "Method Not Allowed");
        return;
      }

      const requestUrl = new URL(request.url || "/", `http://127.0.0.1:${PENGU_ASSET_PORT}`);
      const parts = requestUrl.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (parts[0] === "preview" && parts.length >= 5) {
        const previewPath = await findIndexedPreviewFile({
          championId: parts[1],
          skinId: parts[2],
          chromaId: parts[3]
        }) || await findLeagueSkinsPreviewFile({
          championId: parts[1],
          skinId: parts[2],
          chromaId: parts[3]
        });
        if (previewPath) {
          await serveFileResponse(response, previewPath);
          return;
        }
      }

      if (parts[0] === "asset" && parts.length >= 2) {
        const assetPath = parts.slice(1).join("/");
        const found = await getLocalAssetFile(assetPath);
        if (found) {
          await serveFileResponse(response, found);
          return;
        }
      }

      writeHttpResponse(response, 404, { "Content-Type": "text/plain" }, "Not Found");
    } catch (error) {
      appendOverlayLog(`[Pengu Preview] HTTP asset error: ${error.message}`).catch(() => {});
      writeHttpResponse(response, 500, { "Content-Type": "text/plain" }, "Internal Server Error");
    }
  });

  penguAssetServer.listen(PENGU_ASSET_PORT, "127.0.0.1");
  penguAssetServer.on("error", (error) => {
    console.warn("[Pengu asset server] error", error.message);
  });
};

const handleLocalPreviewRequest = async (message, socket) => {
  const chromaId = Number(message.chromaId || 0);
  try {
    const previewPath = await findIndexedPreviewFile({
      championId: message.championId,
      skinId: message.skinId,
      chromaId
    }) || await findLeagueSkinsPreviewFile({
      championId: message.championId,
      skinId: message.skinId,
      chromaId
    });
    if (!previewPath) return;
    const url = getPenguAssetUrl(`/preview/${encodeURIComponent(String(message.championId || ""))}/${encodeURIComponent(String(message.skinId || ""))}/${encodeURIComponent(String(chromaId))}/${encodeURIComponent(path.basename(previewPath))}`);
    const previewBuffer = await fs.readFile(previewPath);
    const dataUrl = `data:${getImageMimeType(previewPath)};base64,${previewBuffer.toString("base64")}`;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "local-preview-url",
        championId: Number(message.championId || 0),
        skinId: Number(message.skinId || 0),
        chromaId,
        url,
        dataUrl
      }));
    }
  } catch (error) {
    appendOverlayLog(`[Pengu Preview] No pude servir preview local ${chromaId}: ${error.message}`).catch(() => {});
  }
};

const handleLocalAssetRequest = async (message, socket) => {
  const chromaId = Number(message.chromaId || 0);
  try {
    const assetPath = String(message.assetPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
    const found = await getLocalAssetFile(assetPath);
    if (!found) return;
    const url = getPenguAssetUrl(`/asset/${assetPath.split("/").map(encodeURIComponent).join("/")}`);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "local-asset-url",
        assetPath,
        chromaId,
        url
      }));
    }
  } catch (error) {
    appendOverlayLog(`[Pengu Preview] No pude servir asset local ${chromaId}: ${error.message}`).catch(() => {});
  }
};

const startPenguBridgeServer = () => {
  if (penguBridgeServer) return;
  penguBridgeServer = new WebSocketServer({
    host: "127.0.0.1",
    port: PENGU_BRIDGE_PORT,
    maxPayload: 1024 * 1024
  });

  penguBridgeServer.on("connection", (socket, request) => {
    penguBridgeClients.add(socket);
    penguAutoActivationCompleted = true;
    penguLastBridgeConnectedAt = Date.now();
    sendPenguBridgeToWindows("pengu:bridge-status", {
      connected: true,
      clients: penguBridgeClients.size,
      remote: request.socket.remoteAddress || "local"
    });

    socket.on("message", (rawMessage) => {
      const text = rawMessage.toString("utf8");
      try {
        const message = JSON.parse(text);
        sendPenguBridgeToWindows("pengu:message", {
          ...message,
          receivedAt: Date.now()
        });
        if (message?.type === "carousel-status") {
          appendOverlayLog(`[Pengu Carousel] ${JSON.stringify(message).slice(0, 1200)}`).catch(() => { });
        }
        if (
          message?.type === "skin-sync" ||
          message?.type === "skin-apply" ||
          message?.type === "skin-apply-result"
        ) {
          appendOverlayLog(
            `[Pengu Skin] ${JSON.stringify(message, null, 2)}`
          ).catch(() => { });
        }
        if (message?.type === "lobby-state") {
          sendPenguBridgeToWindows("pengu:lobby-state", {
            ...message,
            receivedAt: Date.now()
          });
        }
        if (message?.type === "request-chroma-data") {
          handleChromaDataRequest(message, socket);
        }
        if (message?.type === "request-local-preview") {
          handleLocalPreviewRequest(message, socket);
        }
        if (message?.type === "request-local-asset") {
          handleLocalAssetRequest(message, socket);
        }
      } catch (error) {
        console.warn("[Pengu bridge] invalid message", error.message);
      }
    });

    socket.on("close", () => {
      penguBridgeClients.delete(socket);
      if (penguBridgeClients.size === 0) {
        penguAutoActivationCompleted = false;
      }
      sendPenguBridgeToWindows("pengu:bridge-status", {
        connected: penguBridgeClients.size > 0,
        clients: penguBridgeClients.size
      });
    });

    socket.on("error", (error) => {
      console.warn("[Pengu bridge] socket error", error.message);
    });
  });

  penguBridgeServer.on("error", (error) => {
    // If port is already in use, the Rust bridge server is handling it — skip
    if (error.code === "EADDRINUSE" || error.message?.includes("EADDRINUSE")) return;
    console.warn("[Pengu bridge] server error", error.message);
    sendPenguBridgeToWindows("pengu:bridge-status", {
      connected: false,
      error: error.message
    });
  });
};

const resetOverlayLogForSession = async () => {
  const logPath = path.join(getAppDataDir(), "last-overlay-log.txt");
  const previousLogPath = path.join(getAppDataDir(), "last-overlay-log.previous.txt");
  const header = [
    `Rift Atlas overlay log`,
    `Sesion iniciada: ${new Date().toISOString()}`,
    `userData: ${getAppDataDir()}`,
    `platform: ${process.platform} ${os.release()}`,
    "============================================================",
    ""
  ].join("\n");

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.rm(previousLogPath, { force: true }).catch(() => { });
  await fs.rename(logPath, previousLogPath).catch(() => { });
  currentOverlayLog = header;
  await fs.writeFile(logPath, header).catch(() => { });
};

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await cleanupUpdateInstallers();
  await fs.rm(path.join(getAppDataDir(), "mod-files"), { recursive: true, force: true }).catch(() => {});
  await resetOverlayLogForSession();
  pruneOverlayCache();
  pruneModStagingCache();
  startPenguAssetServer();
  startPenguBridgeServer();
  createWindow();

  // Cleanup leftover d3d9.dll de sesiones anteriores (no tocamos IFEO, lo decidira ensurePenguProxyInstalled)
  const leagueClientPathAtBoot = await getPenguLeagueClientPath().catch(() => "");
  if (leagueClientPathAtBoot) {
    const removed = await removePenguProxyIfManaged("", leagueClientPathAtBoot).catch(() => ({}));
    if (removed.proxyExisted) {
      await appendOverlayLog("[Pengu Loader] Se limpio d3d9.dll izquierdo de sesion anterior.").catch(() => {});
    }
  }

  // Auto-activar Pengu inmediatamente como Rose (solo CLI, sin IFEO)
  try {
    const penguPrepared = await preparePenguRuntime();
    if (penguPrepared.prepared) {
      const leagueRunning = await isLeagueClientRunning();
      await appendOverlayLog(`[Pengu Loader] Auto-activacion inmediata estilo Rose. leagueRunning=${leagueRunning}`).catch(() => { });
      if (leagueRunning) {
        try {
          const exePath = penguPrepared.executablePath;
          if (exePath) {
            await runPenguLoaderCli(exePath, ["--restart-client", "--silent"]);
            await appendOverlayLog("[Pengu Loader] League Client reiniciado post-activacion inmediata.").catch(() => { });
          }
        } catch (restartErr) {
          await appendOverlayLog(`[Pengu Loader] No se pudo reiniciar League post-activacion: ${restartErr.message}`).catch(() => { });
        }
      }
    } else {
      await appendOverlayLog(`[Pengu Loader] Activacion inmediata omitida: ${penguPrepared.proxyError || "Pengu no disponible"}`).catch(() => { });
    }
  } catch (startupErr) {
    await appendOverlayLog(`[Pengu Loader] Error en activacion inmediata: ${startupErr.message}`).catch(() => { });
  }

  // Watcher por si League no estaba instalado y aparece despues
  startPenguAutoActivationWatcher();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  activeOverlayRun?.suspensionGuard?.release?.("app-quit").catch(() => {});
  if (penguAutoActivationTimer) {
    clearInterval(penguAutoActivationTimer);
    penguAutoActivationTimer = null;
  }
  if (appTray) {
    appTray.destroy();
    appTray = null;
  }
  penguBridgeClients.forEach((socket) => socket.close());
  penguBridgeClients.clear();
  if (penguBridgeServer) {
    penguBridgeServer.close();
    penguBridgeServer = null;
  }
  if (penguAssetServer) {
    penguAssetServer.close();
    penguAssetServer = null;
  }
  if (runningOverlayProcess) {
    runningOverlayProcess.stdin?.write("\n");
    runningOverlayProcess.kill();
    runningOverlayProcess = null;
  }
  fs.rm(path.join(getAppDataDir(), "mod-files"), { recursive: true, force: true }).catch(() => {});
  // Cleanup leftover d3d9.dll on quit
  getPenguLeagueClientPath().then((path) => {
    if (path) removePenguProxyIfManaged("", path).catch(() => {});
  }).catch(() => {});
});

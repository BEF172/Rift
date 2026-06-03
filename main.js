const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, shell } = require("electron");
const { execFile, spawn } = require("node:child_process");
const { createWriteStream } = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { once } = require("node:events");
const extractZip = require("extract-zip");
const SevenZipWasm = require("7z-wasm");
const yauzl = require("yauzl");

app.commandLine.appendSwitch("disk-cache-dir", path.join(os.tmpdir(), "rift-atlas-cache"));
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

const APP_ID = "com.riftatlas.desktop";
const APP_ICON = path.join(__dirname, "assets", "icon.ico");
const APP_ICON_PNG = path.join(__dirname, "assets", "icon.png");

app.setAppUserModelId(APP_ID);
app.setName("Rift Atlas");

const PLATFORM_TO_REGION = {
  br1: "americas",
  la1: "americas",
  la2: "americas",
  na1: "americas",
  oc1: "sea",
  eun1: "europe",
  euw1: "europe",
  tr1: "europe",
  ru: "europe",
  jp1: "asia",
  kr: "asia",
  ph2: "sea",
  sg2: "sea",
  th2: "sea",
  tw2: "sea",
  vn2: "sea"
};

let sessionRiotApiKey = "";
const tierLaneCache = new Map();
let skinMetadataCache = null;

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
const SKIN_INDEX_CACHE_VERSION = 7;

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
  }
  return total;
};

const getMkoverlayTimeoutMs = (bytes = 0) => {
  const extra = Math.ceil((Number(bytes) || 0) / (1024 * 1024)) * MKOVERLAY_PER_MB_TIMEOUT_MS;
  return Math.min(MKOVERLAY_MAX_TIMEOUT_MS, Math.max(MKOVERLAY_BASE_TIMEOUT_MS, MKOVERLAY_BASE_TIMEOUT_MS + extra));
};

const getOverlayCacheKey = async ({ gamePath, skinPaths = [] }) => {
  const hash = crypto.createHash("sha256");
  hash.update("rift-atlas-overlay-cache-v2");
  const gameStat = await fs.stat(gamePath).catch(() => null);
  hash.update(path.normalize(gamePath).toLowerCase());
  hash.update(`:${gameStat?.size || 0}:${Math.trunc(gameStat?.mtimeMs || 0)}`);

  for (const skinPath of [...skinPaths].sort((a, b) => String(a).localeCompare(String(b)))) {
    const stat = await fs.stat(skinPath).catch(() => null);
    hash.update("|");
    hash.update(path.normalize(skinPath).toLowerCase());
    hash.update(`:${stat?.size || 0}:${Math.trunc(stat?.mtimeMs || 0)}`);
  }

  return hash.digest("hex").slice(0, 24);
};

const isUsableOverlayPath = async (overlayPath) => {
  try {
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

const riotRequest = async (host, pathName) => {
  const apiKey = sessionRiotApiKey || process.env.RIOT_API_KEY;
  if (!apiKey) {
    const error = new Error("Falta la API key de Riot. Pegala en la sesion antes de buscar jugadores.");
    error.status = 401;
    throw error;
  }

  const response = await fetch(`https://${host}${pathName}`, {
    headers: {
      "X-Riot-Token": apiKey
    }
  });

  if (!response.ok) {
    const error = new Error(`Riot API respondio ${response.status}.`);
    error.status = response.status;
    throw error;
  }

  return response.json();
};

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

const mapParticipant = (participant) => ({
  puuid: participant.puuid,
  riotIdGameName: participant.riotIdGameName || participant.summonerName || "Jugador",
  riotIdTagLine: participant.riotIdTagline || participant.riotIdTagLine || "",
  summonerName: participant.summonerName,
  teamId: participant.teamId,
  teamPosition: participant.teamPosition || participant.individualPosition || "UTILITY",
  championName: participant.championName,
  championId: participant.championId,
  kills: participant.kills ?? 0,
  deaths: participant.deaths ?? 0,
  assists: participant.assists ?? 0,
  creepScore: (participant.totalMinionsKilled ?? 0) + (participant.neutralMinionsKilled ?? 0),
  goldEarned: participant.goldEarned ?? 0,
  totalMinionsKilled: participant.totalMinionsKilled ?? 0,
  neutralMinionsKilled: participant.neutralMinionsKilled ?? 0,
  visionScore: participant.visionScore ?? 0,
  itemIds: [participant.item0, participant.item1, participant.item2, participant.item3, participant.item4, participant.item5, participant.item6].filter(Boolean),
  win: Boolean(participant.win)
});

const getTimelineForParticipant = async (region, matchId, puuid) => {
  try {
    const timeline = await riotRequest(`${region}.api.riotgames.com`, `/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`);
    const participant = timeline.info.participants.find((item) => item.puuid === puuid);
    if (!participant) {
      return [];
    }

    return timeline.info.frames
      .flatMap((frame) => frame.events)
      .filter((event) => event.participantId === participant.participantId && ["ITEM_PURCHASED", "ITEM_SOLD", "ITEM_DESTROYED", "ITEM_UNDO"].includes(event.type))
      .map((event) => ({
        type: event.type,
        itemId: event.itemId || event.beforeId || event.afterId,
        beforeId: event.beforeId,
        afterId: event.afterId,
        timestamp: event.timestamp
      }))
      .filter((event) => event.itemId);
  } catch {
    return [];
  }
};

const parseRiotId = (riotId) => {
  const [gameName, tagLine] = String(riotId).split("#");
  if (!gameName || !tagLine) {
    throw new Error("Usa el formato Riot ID: Nombre#TAG.");
  }

  return {
    gameName: encodeURIComponent(gameName.trim()),
    tagLine: encodeURIComponent(tagLine.trim())
  };
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
  return {
    name: path.basename(filePath),
    extension,
    path: filePath,
    relativePath: path.relative(rootPath, filePath) || path.basename(filePath),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    custom: true
  };
};

const getSkinIndexCachePath = () => path.join(app.getPath("userData"), "cache", "skin-library-index.json");

const readSkinIndexCache = async (folderPath) => {
  try {
    const payload = JSON.parse(await fs.readFile(getSkinIndexCachePath(), "utf8"));
    if (payload.version !== SKIN_INDEX_CACHE_VERSION || payload.folderPath !== folderPath || !Array.isArray(payload.skins)) {
      return new Map();
    }

    return new Map(payload.skins.map((skin) => [skin.path, skin]));
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

const inspectArchivePackage = (filePath) => new Promise((resolve) => {
  const extension = filePath.toLowerCase().endsWith(".wad.client") ? ".wad.client" : path.extname(filePath).toLowerCase();
  if ([".wad", ".wad.client"].includes(extension)) {
    fs.stat(filePath)
      .then((stat) => {
        const suspicious = stat.size > 0 && stat.size < SUSPICIOUS_WAD_SIZE;
        resolve({
          wadCount: 1,
          maxWadSize: stat.size,
          suspicious
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
    zipfile.readEntry();
    zipfile.on("entry", (entry) => {
      const entryName = entry.fileName.toLowerCase();
      if (entryName === "meta/info.json") hasMetaInfo = true;
      if (entryName === "meta/details.json") hasMetaDetails = true;
      if (entryName.startsWith("wad/")) hasWadFolder = true;
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
        hasWadFolder
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
    const rawVariant = repoParts.length > 3 ? repoParts[2] : "";
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
    let skinNum = null;
    let imageSkinNum = null;
    let baseImageSkinNum = null;
    let numericSource = isNumericId(rawChampion) || isNumericId(rawSkin) || isNumericId(fileBaseId);

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
      champion,
      championKey,
      skin,
      skinNum,
      imageSkinNum,
      baseImageSkinNum,
      imageUrl: getSkinImageUrl(championKey, imageSkinNum),
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
    rawVariant: repoParts.length > 3 ? repoParts[2] : "",
    champion: repoParts[0] || "Sin campeon",
    championKey: "",
    skin: repoParts[1] || stripModExtension(item.name),
    skinNum: null,
    imageSkinNum: null,
    baseImageSkinNum: null,
    imageUrl: "",
    variant: repoParts.length > 3 ? repoParts[2] : "",
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
  await writeSkinIndexCache(folderPath, skins).catch(() => {});
  return skins;
};

const downloadFile = async (url, destinationPath, onProgress = () => {}) => {
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
  const installRoot = path.join(app.getPath("userData"), "downloaded-libraries");
  const targetDir = path.join(installRoot, "LeagueSkins");
  const tempDir = path.join(installRoot, "LeagueSkins.download");
  const zipPath = path.join(tempDir, "LeagueSkins.zip");

  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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

  await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
  await fs.rename(extractedRoot, targetDir);
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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
  const targetDir = path.join(app.getPath("userData"), "downloaded-libraries", "LeagueSkins");
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

ipcMain.handle("riot:has-api-key", () => Boolean(sessionRiotApiKey || process.env.RIOT_API_KEY));

ipcMain.handle("riot:set-api-key", (_event, apiKey) => {
  const normalizedKey = String(apiKey || "").trim();
  if (!normalizedKey.startsWith("RGAPI-")) {
    throw new Error("La API key debe empezar con RGAPI-.");
  }

  sessionRiotApiKey = normalizedKey;
  return true;
});

ipcMain.handle("riot:clear-api-key", () => {
  sessionRiotApiKey = "";
  return Boolean(process.env.RIOT_API_KEY);
});

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
  const downloadUrl = setupAsset?.browser_download_url || release.html_url || "";

  return {
    currentVersion,
    latestVersion,
    releaseName: release.name || release.tag_name || latestVersion,
    releaseUrl: release.html_url || "",
    downloadUrl,
    assetName: setupAsset?.name || "",
    publishedAt: release.published_at || "",
    notes: String(release.body || "").slice(0, 1200),
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0
  };
});

ipcMain.handle("app:open-external", (_event, url) => {
  const target = String(url || "");
  if (!target.startsWith("https://github.com/") && !target.startsWith("https://u.gg/") && !target.startsWith("https://www.metasrc.com/") && !target.startsWith("https://op.gg/") && !target.startsWith("https://developer.riotgames.com/")) {
    throw new Error("URL externa no permitida.");
  }

  shell.openExternal(target);
  return true;
});

ipcMain.handle("app:get-user-data-path", () => app.getPath("userData"));

ipcMain.handle("app:open-user-data-path", async () => {
  const targetPath = app.getPath("userData");
  await fs.mkdir(targetPath, { recursive: true });
  const error = await shell.openPath(targetPath);
  if (error) {
    throw new Error(error);
  }
  return targetPath;
});

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
    packages: (await listModPackages(folderPath)).map((item) => ({ ...item, custom: true }))
  };
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

const LTK_DATA_DIR = path.join(app.getPath("appData"), "ltk-manager");

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
    } catch {}
  }
  return null;
});

ipcMain.handle("ltk:get-status", async (_event, payload) => {
  const exePath = String(payload?.exePath || "");
  let exeExists = false;
  try { await fs.access(exePath); exeExists = true; } catch {}

  const dataDir = LTK_DATA_DIR;
  let dataDirExists = false;
  try { await fs.access(dataDir); dataDirExists = true; } catch {}

  let library = null;
  try {
    const content = await fs.readFile(path.join(dataDir, "library.json"), "utf8");
    library = JSON.parse(content);
  } catch {}

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
  } catch {}

  try {
    const archContent = await fs.readFile(archivesMetaPath, "utf8");
    archivesMeta = JSON.parse(archContent);
    if (!archivesMeta.archives) archivesMeta.archives = [];
  } catch {}

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
  const installedDllPath = path.join(app.getPath("userData"), "engine", "cslol-dll.dll");
  try {
    await fs.access(installedDllPath);
    return installedDllPath;
  } catch {
    throw new Error("La DLL ya no se selecciona manualmente. Descarga el engine desde Rift Atlas para instalarla.");
  }
});

const findExistingPath = async (candidates) => {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
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
  } catch {}
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

const normalizeDllSource = (source) => {
  if (source === "bundled" || source === "ltk") return source;
  return "cslol";
};
const getBundledCslolDllPath = () => getUnpackedAssetPath("assets", "cslol-dll.dll");
const getDllSourceMetadataPath = () => path.join(app.getPath("userData"), "engine", "dll-source.json");

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
  if (first === "bundled") return [sources.bundled];
  const fallback = first === "cslol" ? "ltk" : "cslol";
  return [sources[first], sources[fallback]];
};

const downloadAndExtractLtkDll = async (window = null, { forceDownload = false, dllSource = "cslol" } = {}) => {
  const targetDir = path.join(app.getPath("userData"), "ltk-dll");
  const installedDllPath = path.join(targetDir, "cslol-dll.dll");

  if (forceDownload) {
    await fs.rm(installedDllPath, { force: true }).catch(() => {});
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
    } catch {}
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
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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
          await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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

    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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

    const targetDir = path.join(app.getPath("userData"), "engine");
    const tempDir = path.join(app.getPath("temp"), "rift-atlas-hitori-download");
    const setupExtractPath = path.join(tempDir, "setup");
    const appExtractPath = path.join(setupExtractPath, "$PLUGINSDIR", "app");
    const downloadPath = path.join(tempDir, asset.name);

    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(tempDir, { recursive: true });
    sendDownloadProgress(window, {
      type: "engine",
      message: "Instalando engine limpio; no se buscan DLLs locales."
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

    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(targetDir, { recursive: true });
    const installedEnginePath = path.join(targetDir, "ltk-manager.exe");
    await fs.copyFile(sourceEnginePath, installedEnginePath);

    const installedDllPath = path.join(targetDir, "cslol-dll.dll");
    const dllResult = await downloadAndExtractLtkDll(window, {
      forceDownload: true,
      dllSource: options.dllSource
    }).catch(() => null);
    const extractedDllPath = dllResult?.path || "";
    if (extractedDllPath) {
      await fs.copyFile(extractedDllPath, installedDllPath);
      await writeDllSourceMetadata({
        sourceId: dllResult?.sourceId || "unknown",
        sourceLabel: dllResult?.sourceLabel || "LeagueToolkit",
        version: dllResult?.version || "",
        assetName: dllResult?.assetName || "",
        cachePath: extractedDllPath,
        installedPath: installedDllPath
      });
      sendDownloadProgress(window, {
        type: "engine",
        message: `DLL descargada por Rift Atlas: ${extractedDllPath} -> ${installedDllPath}`
      });
    } else {
      throw new Error("No pude descargar cslol-dll.dll durante la instalacion del engine.");
    }

    await fs.access(installedEnginePath);
    await fs.writeFile(path.join(app.getPath("userData"), "engine-version.txt"), release.tag_name || release.name || "");
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

    return {
      version: release.tag_name || release.name,
      assetName: asset.name,
      toolsDir: targetDir,
      enginePath: installedEnginePath,
      dllPath: await findExistingPath([installedDllPath]),
      dllSourcePath: extractedDllPath,
      dllSourceLabel: dllResult?.sourceLabel || "LeagueToolkit descargado por Rift Atlas",
      dllInstallMessage: `DLL descargada desde ${dllResult?.sourceLabel || "LeagueToolkit"} ${dllResult?.version || ""} (${dllResult?.assetName || "asset desconocido"}): ${extractedDllPath} -> ${installedDllPath}`.trim()
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
    path.join(app.getPath("userData"), "engine", "ltk-manager.exe"),
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
  path.join(app.getPath("userData"), "engine", "cslol-dll.dll")
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
  } catch {}

  for (const candidate of getLeagueCandidates(selectedPath)) {
    try {
      return await resolveLeagueGameExecutable(candidate);
    } catch {}
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
  if (!dllPath) warnings.push("No encontre cslol-dll.dll junto al engine. Descarga el engine desde Rift Atlas.");
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
  const bundledDllPath = path.join(app.getPath("userData"), "engine", "cslol-dll.dll");

  try {
    await fs.access(bundledDllPath);
    await appendOverlayLog(`DLL instalada por Rift Atlas: ${bundledDllPath}`).catch(() => {});
    return bundledDllPath;
  } catch {}
  await appendOverlayLog(`ERROR DLL no encontrada junto al engine: ${bundledDllPath}. No se buscan DLLs locales.`).catch(() => {});
  throw new Error("cslol-dll.dll no esta junto al engine. Descarga el engine desde Rift Atlas para instalar una DLL limpia.");
};

const ensureGameHashtable = async () => {
  const hashtablePath = path.join(app.getPath("userData"), "hashtable", "hashes.game.txt");
  try {
    const stat = await fs.stat(hashtablePath);
    if (stat.size > 1024 * 1024 * 10) {
      return hashtablePath;
    }
  } catch {}

  await fs.mkdir(path.dirname(hashtablePath), { recursive: true });

  const bocchiHashtable = path.join(app.getPath("appData"), "bocchi", "hashtable", "hashes.game.txt");
  try {
    const stat = await fs.stat(bocchiHashtable);
    if (stat.size > 1024 * 1024 * 10) {
      await fs.copyFile(bocchiHashtable, hashtablePath);
      return hashtablePath;
    }
  } catch {}

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
  } catch {}
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
  const outputDir = path.join(app.getPath("userData"), "mod-files", "normalized");
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
  } catch {}

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

    await fs.rm(outputPath, { force: true }).catch(() => {});
    const tempOutputPath = path.join(tempRoot, "out", path.basename(outputPath));
    await createZipArchiveFromPackageDir({ sourceDir: extractDir, outputPath: tempOutputPath });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.copyFile(tempOutputPath, outputPath);
    await appendOverlayLog(`ZIP normalizado a .fantome: ${sourcePath} -> ${outputPath}`);
    await appendFileLogInfo(".fantome normalizado escrito", outputPath);
    return outputPath;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
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

  const outputDir = path.join(app.getPath("userData"), "mod-files");
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
  } catch {}

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
  await appendOverlayLog(`Preparando mod para overlay: extension=${extension || "sin extension"} display=${skin.champion || ""} - ${skin.skin || skin.name || ""}`);
  await appendFileLogInfo("Mod origen", sourcePath);
  if (extension === ".zip") {
    const resolvedSkin = await resolveFantonizeSkinEntry(skin);
    if (resolvedSkin?.needsFantonize) {
      await appendOverlayLog("ZIP con WAD mini resuelto; se genera .fantome local en vez de usar el WAD mini directo.");
      return generateResolvedFantonizePackage({ sidecarPath, gamePath, resolvedSkin });
    }
    const archiveInfo = resolvedSkin?.archiveInfo || skin.archiveInfo || {};
    if (archiveInfo.suspicious) {
      await appendOverlayLog("ERROR ZIP miniatura no resuelto; se cancela para evitar aplicar un WAD incompleto/bug visual.");
      throw new Error(`No pude resolver ${skin.skin || skin.name || path.basename(sourcePath)} a una skin de League. Reindexa LeagueSkins o revisa el paquete; no lo aplico directo para evitar modelos/VFX rotos.`);
    }
    return normalizeZipPackageForOverlay({ ...skin, archiveInfo: resolvedSkin?.archiveInfo || skin.archiveInfo });
  }
  if (extension === ".fantome") {
    await appendOverlayLog(`Usando paquete directo: ${sourcePath}`);
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

ipcMain.handle("mods:run-bocchi-overlay", async (_event, payload) => {
  const sidecarPath = await resolveHitoriEngineExecutable(payload?.sidecarPath);
  const dllPath = String(payload?.dllPath || "");
  const gamePath = String(payload?.gamePath || "");
  const skinEntries = Array.isArray(payload?.skinEntries)
    ? payload.skinEntries
    : (payload?.skinPaths || []).map((skinPath) => ({ path: skinPath }));

  await appendOverlayLog("============================================================");
  await appendOverlayLog(`INICIO OVERLAY runId=${Date.now()} appUserData=${app.getPath("userData")}`);
  await appendOverlayLog(`Payload: skins=${skinEntries.length} sidecar=${sidecarPath} dllConfigurada=${dllPath || "no configurada"} game=${gamePath}`);

  if (!gamePath.toLowerCase().endsWith("league of legends.exe")) {
    await appendOverlayLog(`ERROR configuracion League invalida: ${gamePath}`);
    throw new Error("League of Legends.exe no configurado.");
  }
  if (!skinEntries.length) {
    await appendOverlayLog("ERROR no hay skins seleccionadas.");
    throw new Error("No hay skins seleccionadas.");
  }

  const ensuredDllPath = await ensureCslolDll(sidecarPath, dllPath);
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
    console.log('[DEBUG] generateFantomeFromLeagueWad for:', entry?.path);
    await appendOverlayLog(`Procesando skin #${index + 1}/${skinEntries.length}`);
    const modPath = await generateFantomeFromLeagueWad({ sidecarPath, gamePath, skin: entry });
    console.log('[DEBUG] result path:', modPath);
    await appendFileLogInfo(`Mod final #${index + 1}`, modPath);
    skinPaths.push(modPath);
  }
  await appendOverlayLog(`Mods finales para mkoverlay: ${skinPaths.join(" | ")}`);

  const gameFolder = path.dirname(gamePath);
  const toolsDir = path.dirname(sidecarPath);
  const profilesDir = path.join(app.getPath("userData"), "cslol-profiles");
  const overlayCacheDir = path.join(app.getPath("userData"), "cslol-overlay-cache");
  const overlayStateDir = path.join(profilesDir, ".mkoverlay-state");
  const overlayCacheKey = await getOverlayCacheKey({ gamePath, skinPaths });
  const overlayPath = path.join(overlayCacheDir, overlayCacheKey);
  const statePath = overlayStateDir;
  await appendOverlayLog(`Rutas overlay: gameFolder=${gameFolder} toolsDir=${toolsDir} profilesDir=${profilesDir} overlayCache=${overlayPath} statePath=${statePath} cacheKey=${overlayCacheKey}`);

  await fs.mkdir(profilesDir, { recursive: true });
  await fs.mkdir(overlayCacheDir, { recursive: true });
  const oldProfiles = await fs.readdir(profilesDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(oldProfiles
    .filter((entry) => entry.name !== ".mkoverlay-state")
    .map((entry) => fs.rm(path.join(profilesDir, entry.name), { recursive: true, force: true }).catch(() => {})));
  await fs.mkdir(profilesDir, { recursive: true });
  await fs.mkdir(overlayStateDir, { recursive: true });
  await appendOverlayLog("Directorio de perfiles limpiado para nueva ejecucion; cache mkoverlay conservada.");

  const overlayCacheHit = await isUsableOverlayPath(overlayPath);
  if (overlayCacheHit) {
    await appendOverlayLog(`Overlay cache HIT: ${overlayPath}. Se salta mkoverlay.`);
    await appendDirectoryLogInfo("Overlay cache reutilizado", overlayPath);
  } else {
    await appendOverlayLog(`Overlay cache MISS: ${overlayPath}. Construyendo por partes con mkoverlay.`);
    await fs.rm(overlayPath, { recursive: true, force: true }).catch(() => {});
  }

  const mkoverlayArgs = [
    "mkoverlay",
    "--game",
    path.normalize(gameFolder),
    "--overlay",
    path.normalize(overlayPath),
    "--state",
    path.normalize(statePath)
  ];
  for (const skinPath of skinPaths) {
    mkoverlayArgs.push("--mod", path.normalize(skinPath));
  }

  if (!overlayCacheHit) {
    await appendOverlayLog(`Ejecutando mkoverlay en: ${overlayPath}`);
    await appendOverlayLog(`mkoverlay args: ${mkoverlayArgs.join(" ")}`);
    const mkoverlayInputBytes = await getFilesTotalSize(skinPaths);
    const mkoverlayTimeoutMs = getMkoverlayTimeoutMs(mkoverlayInputBytes);
    await appendOverlayLog(`mkoverlay timeout: ${Math.round(mkoverlayTimeoutMs / 1000)}s para ${formatLogBytes(mkoverlayInputBytes)} de mods.`);
    let mkoverlayStdout = "";
    try {
      mkoverlayStdout = await execToolWithTimeout(sidecarPath, mkoverlayArgs, mkoverlayTimeoutMs, { cwd: toolsDir });
    } catch (error) {
      await appendOverlayLog(`mkoverlay fallo: ${error.message}`);
      throw new Error(`mkoverlay fallo: ${error.message}`);
    }
    await appendOverlayLog(`mkoverlay OK${mkoverlayStdout ? `: ${mkoverlayStdout.slice(0, 500)}` : ""}`);
    console.log('[DEBUG] mkoverlay stdout:', mkoverlayStdout.slice(0, 2000));
  }

  // Verificar que el overlay tenga archivos
  const overlayFiles = await fs.readdir(overlayPath).catch(() => []);
  await appendOverlayLog(`Archivos generados por overlay: ${overlayFiles.length}${overlayFiles.length ? ` (${overlayFiles.slice(0, 8).join(", ")})` : ""}`);
  await appendDirectoryLogInfo("Overlay generado detalle", overlayPath);
  await appendFileLogInfo("Overlay state detalle", statePath);
  console.log('[DEBUG] overlay files:', overlayFiles);
  if (overlayFiles.length === 0) {
    await appendOverlayLog(`mkoverlay no genero archivos en ${overlayPath}`);
    throw new Error(`mkoverlay no genero archivos en ${overlayPath}`);
  }

  if (runningOverlayProcess) {
    await appendOverlayLog(`Deteniendo patcher anterior antes de iniciar uno nuevo. PID=${runningOverlayProcess.pid}`);
    runningOverlayProcess.stdin?.write("\n");
    runningOverlayProcess.kill();
    runningOverlayProcess = null;
  }
  currentOverlayError = "";

  const bundledDll = ensuredDllPath;
  try {
    await fs.access(bundledDll);
  } catch {
    await appendOverlayLog(`ERROR DLL de Rift Atlas no encontrada: ${bundledDll}`);
    throw new Error(`cslol-dll.dll no encontrada en ${bundledDll}. Descarga el engine desde Rift Atlas.`);
  }
  await appendFileLogInfo("DLL usada por patcher", bundledDll);

  const runoverlayArgs = [
    "patcher",
    "--dll",
    bundledDll,
    "--overlay-root",
    path.normalize(overlayPath),
    "--flags",
    "0"
  ];

  await appendOverlayLog(`Iniciando patcher con overlay: ${overlayPath}`);
  await appendOverlayLog(`patcher args: ${runoverlayArgs.join(" ")}`);
  runningOverlayProcess = spawn(sidecarPath, runoverlayArgs, {
    cwd: toolsDir,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });

  currentProfilePath = overlayPath;
  let patcherExited = false;
  const handlePatcherOutput = (label, data) => {
    const text = String(data).trim();
    console.log(`[${label}]: ${String(data)}`);
    if (text) appendOverlayLog(`[${label}] ${text}`);
    if (/end of life reached|EOL_TIMESTAMP|timestamp\s*>\s*EOL/i.test(text)) {
      const sourceText = dllSourceMetadata?.sourceLabel
        ? ` Fuente usada: ${dllSourceMetadata.sourceLabel} ${dllSourceMetadata.version || ""}.`
        : "";
      currentOverlayError = `La DLL del engine esta vencida (End of life reached).${sourceText} En Descargas cambia la fuente del DLL y descarga engine + DLL otra vez; si ambas fuentes fallan, hay que esperar un release nuevo.`;
      appendOverlayLog(`ERROR DLL vencida detectada: ${currentOverlayError}`);
      runningOverlayProcess?.stdin?.write("\n");
      runningOverlayProcess?.kill();
    }
  };
  runningOverlayProcess.stdout?.on("data", (d) => handlePatcherOutput("PATCHER STDOUT", d));
  runningOverlayProcess.stderr?.on("data", (d) => handlePatcherOutput("PATCHER STDERR", d));
  runningOverlayProcess.on("exit", (code) => {
    patcherExited = true;
    runningOverlayProcess = null;
    currentProfilePath = "";
    console.log(`[DEBUG] Patcher exit code: ${code}`);
    appendOverlayLog(`[DEBUG] Patcher exit code: ${code}`);
  });
  runningOverlayProcess.on("error", (err) => {
    patcherExited = true;
    runningOverlayProcess = null;
    currentProfilePath = "";
    console.log(`[DEBUG] Patcher error: ${err.message}`);
    appendOverlayLog(`[DEBUG] Patcher error: ${err.message}`);
  });

  await sleepMs(2000);

  if (patcherExited || !runningOverlayProcess) {
    await appendOverlayLog("El patcher fallo al iniciar (salio antes de tiempo).");
    throw new Error("El patcher fallo al iniciar (salio antes de tiempo).");
  }

  await appendOverlayLog(`Patcher activo. PID: ${runningOverlayProcess.pid}`);
  await appendOverlayLog("FIN INICIO OVERLAY: patcher sigue corriendo; entra a partida para validar skins.");
  return { success: true, pid: runningOverlayProcess.pid, profilePath: overlayPath, enginePath: sidecarPath };
});

ipcMain.handle("ltk:download-and-install", async () => {
  const { release, asset } = await getLatestLtkSetupAsset();

  const downloadDir = path.join(app.getPath("userData"), "ltk-download");
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

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

const appendOverlayLog = async (line) => {
  const text = String(line || "").trim();
  if (!text) return;
  currentOverlayLog = `${currentOverlayLog}${text}\n`.slice(-30000);
  await fs.appendFile(path.join(app.getPath("userData"), "last-overlay-log.txt"), `${new Date().toISOString()} ${text}\n`).catch(() => {});
};

const testCslolDllLoad = async ({ enginePath, dllPath }) => {
  const tempRoot = path.join(app.getPath("temp"), "rift-atlas-dll-check");
  const overlayRoot = path.join(tempRoot, "overlay");
  await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
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
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
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
  if (runningOverlayProcess) {
    await appendOverlayLog(`STOP solicitado desde UI. PID=${runningOverlayProcess.pid} profile=${currentProfilePath}`);
    runningOverlayProcess.stdin?.write("\n");
    runningOverlayProcess.kill();
    runningOverlayProcess = null;
    currentProfilePath = "";
    currentOverlayError = "";
    await appendOverlayLog("STOP completado: proceso marcado como detenido.");
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
      : "Sin metadata; descarga engine + DLL otra vez para registrar la fuente"
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
  const outputDir = path.join(app.getPath("userData"), "p2p");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${Date.now()}-${fileName}`);
  const buffers = chunks.map((chunk) => Buffer.from(chunk));
  await fs.writeFile(outputPath, Buffer.concat(buffers));
  const actualHash = await hashFileSha256(outputPath);
  if (expectedHash && actualHash !== expectedHash) {
    await fs.rm(outputPath, { force: true }).catch(() => {});
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

ipcMain.handle("party:clear-p2p-files", async () => {
  const outputDir = path.join(app.getPath("userData"), "p2p");
  const oldOutputDir = path.join(app.getPath("userData"), "party-transfers");
  await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  await fs.rm(oldOutputDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(outputDir, { recursive: true });
  return { folderPath: outputDir };
});

const execToolWithTimeout = (command, args, timeout, options = {}) => {
  return new Promise((resolve, reject) => {
    const { input, ...spawnOptions } = options;
    const proc = spawn(command, args, { windowsHide: true, ...spawnOptions });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      const detail = [stderr, stdout].filter(Boolean).join("\n").slice(-1000);
      reject(new Error(`Process timed out after ${Math.round(timeout / 1000)}s${detail ? `: ${detail}` : ""}`));
    }, timeout);
    proc.stdout?.on("data", (d) => { stdout += String(d); });
    proc.stderr?.on("data", (d) => { stderr += String(d); });
    if (input !== undefined) {
      proc.stdin?.write(input);
      proc.stdin?.end();
    }
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.slice(0, 500) || `exit code ${code}`));
    });
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
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

ipcMain.handle("riot:lookup-player", async (_event, payload) => {
  const platform = String(payload.platform || "la2").toLowerCase();
  const region = PLATFORM_TO_REGION[platform];
  if (!region) {
    throw new Error("Region de League no soportada.");
  }

  const { gameName, tagLine } = parseRiotId(payload.riotId);
  const account = await riotRequest(`${region}.api.riotgames.com`, `/riot/account/v1/accounts/by-riot-id/${gameName}/${tagLine}`);
  const summoner = await riotRequest(`${platform}.api.riotgames.com`, `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(account.puuid)}`);

  const [ranked, matchIds, activeGameResult] = await Promise.all([
    riotRequest(`${platform}.api.riotgames.com`, `/lol/league/v4/entries/by-summoner/${encodeURIComponent(summoner.id)}`).catch(() => []),
    riotRequest(`${region}.api.riotgames.com`, `/lol/match/v5/matches/by-puuid/${encodeURIComponent(account.puuid)}/ids?start=0&count=8`),
    riotRequest(`${platform}.api.riotgames.com`, `/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(account.puuid)}`).catch((error) => {
      if (error.status === 404) {
        return null;
      }
      throw error;
    })
  ]);

  const matches = await Promise.all(
    matchIds.map(async (matchId) => {
      const match = await riotRequest(`${region}.api.riotgames.com`, `/lol/match/v5/matches/${encodeURIComponent(matchId)}`);
      const participant = match.info.participants.find((item) => item.puuid === account.puuid);
      const teamId = participant?.teamId;
      const allyTeam = match.info.participants.filter((item) => item.teamId === teamId).map(mapParticipant);
      const enemyTeam = match.info.participants.filter((item) => item.teamId !== teamId).map(mapParticipant);
      const itemTimeline = participant ? await getTimelineForParticipant(region, matchId, account.puuid) : [];
      const creepScore = (participant?.totalMinionsKilled ?? 0) + (participant?.neutralMinionsKilled ?? 0);
      const durationMinutes = Math.max(1, match.info.gameDuration / 60);
      return {
        id: match.metadata.matchId,
        queueId: match.info.queueId,
        gameCreation: match.info.gameCreation,
        gameDuration: match.info.gameDuration,
        gameMode: match.info.gameMode,
        championName: participant?.championName || "Desconocido",
        championId: participant?.championId,
        kills: participant?.kills ?? 0,
        deaths: participant?.deaths ?? 0,
        assists: participant?.assists ?? 0,
        creepScore,
        creepScorePerMinute: creepScore / durationMinutes,
        goldEarned: participant?.goldEarned ?? 0,
        visionScore: participant?.visionScore ?? 0,
        itemIds: [participant?.item0, participant?.item1, participant?.item2, participant?.item3, participant?.item4, participant?.item5, participant?.item6].filter(Boolean),
        itemTimeline,
        win: Boolean(participant?.win),
        playerPuuid: account.puuid,
        teamPosition: participant?.teamPosition || participant?.individualPosition || "",
        allyTeam,
        enemyTeam
      };
    })
  );

  return {
    account,
    summoner,
    ranked,
    activeGame: activeGameResult,
    matches
  };
});

ipcMain.handle("tiers:get-lane", (_event, payload) => getChampionTierLane(String(payload?.lane || "top"), String(payload?.version || "")));
ipcMain.handle("data:get-champions", () => getDataDragonChampionData());
ipcMain.handle("builds:get-champion", (_event, payload) => fetchUggChampionBuild({
  championId: String(payload?.championId || ""),
  championName: String(payload?.championName || ""),
  version: String(payload?.version || "")
}));

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
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.maximize());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
};

const resetOverlayLogForSession = async () => {
  const logPath = path.join(app.getPath("userData"), "last-overlay-log.txt");
  const previousLogPath = path.join(app.getPath("userData"), "last-overlay-log.previous.txt");
  const header = [
    `Rift Atlas overlay log`,
    `Sesion iniciada: ${new Date().toISOString()}`,
    `userData: ${app.getPath("userData")}`,
    `platform: ${process.platform} ${os.release()}`,
    "============================================================",
    ""
  ].join("\n");

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.rm(previousLogPath, { force: true }).catch(() => {});
  await fs.rename(logPath, previousLogPath).catch(() => {});
  currentOverlayLog = header;
  await fs.writeFile(logPath, header).catch(() => {});
};

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await resetOverlayLogForSession();
  createWindow();

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

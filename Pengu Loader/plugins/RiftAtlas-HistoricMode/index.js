/**
 * @name RiftAtlas-HistoricMode
 * @author Rift Atlas
 * @description Rose-style historic skin indicator with local restore fallback.
 */

(function initHistoricMode() {
  const LOG_PREFIX = "[RiftAtlas-HistoricMode]";
  const STORAGE_KEY = "rift-atlas:historic-mode:v2";
  const HISTORIC_FLAG_ASSET_PATH = "historic_flag.png";
  const REWARDS_SELECTOR = ".skin-selection-item-information.loyalty-reward-icon--rewards";
  const POPUP_ID = "rift-atlas-historic-popup-layer";
  const STYLE_ID = "rift-atlas-historic-mode-styles";
  const RESTORE_COOLDOWN_MS = 2500;
  const POLL_MS = 1000;

  let bridge = null;
  let history = loadHistory();
  let historicModeActive = false;
  let historicSkinId = null;
  let historicSkinName = null;
  let customModPopupActive = false;
  let customModTargetSkinId = null;
  let currentRewardsElement = null;
  let historicFlagImageUrl = null;
  let isInChampSelect = false;
  let currentChampionId = null;
  let currentSkinId = null;
  let lastRestoreKey = "";
  let lastRestoreAt = 0;

  function log(level, message, data = null) {
    const method = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    method(`${LOG_PREFIX} ${message}`, data || "");
    try {
      bridge?.send?.({
        type: "chroma-log",
        source: "RiftAtlas-HistoricMode",
        level,
        message,
        data: data || undefined,
        timestamp: Date.now(),
      });
    } catch { /* best effort */ }
  }

  function waitForBridge() {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (window.__roseBridge) {
          clearInterval(timer);
          resolve(window.__roseBridge);
          return;
        }
        if (Date.now() - startedAt > 10000) {
          clearInterval(timer);
          reject(new Error("Bridge not available"));
        }
      }, 50);
    });
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .skin-selection-item-information.loyalty-reward-icon--rewards.rift-atlas-historic-flag-active {
        background-repeat: no-repeat !important;
        background-size: contain !important;
        display: block !important;
        height: 32px !important;
        width: 32px !important;
        position: absolute !important;
        right: -14px !important;
        top: -14px !important;
        pointer-events: none !important;
        cursor: default !important;
        -webkit-user-select: none !important;
        list-style-type: none !important;
        content: " " !important;
        opacity: 1 !important;
        visibility: visible !important;
      }

      #${POPUP_ID} {
        position: fixed;
        bottom: calc(10% + 215px);
        left: 50%;
        transform: translate(-50%, 0);
        z-index: 0;
        background: transparent;
        color: #b2a580;
        padding: 0;
        margin: 0;
        font-size: 14px;
        line-height: 1.4;
        display: flex;
        align-items: center;
        justify-content: center;
        max-width: 300px;
        width: auto;
        box-sizing: border-box;
        pointer-events: none;
        font-family: "LoL Display", "Times New Roman", serif;
        text-align: center;
        text-shadow: 0 1px 3px #010a13, 0 0 8px rgba(200, 170, 110, 0.45);
      }

      #${POPUP_ID} .toast-body {
        display: flex;
        flex-direction: column;
        width: auto;
        margin: 0 auto;
      }

      #${POPUP_ID} .toast-content {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
      }

      #${POPUP_ID} .rift-atlas-historic-popup-frame {
        position: relative;
        display: inline-block;
        background: #010a13;
        box-shadow: 0 0 0 1px rgba(1, 10, 19, 0.48);
        border: none;
        padding: 0;
      }

      #${POPUP_ID} .rift-atlas-historic-popup-frame::before {
        content: '';
        position: absolute;
        width: calc(100% + 4px);
        height: calc(100% + 4px);
        top: -2px;
        left: -2px;
        box-shadow: 0 0 10px 1px rgba(0, 0, 0, 0.5);
        pointer-events: none;
      }

      #${POPUP_ID} .rift-atlas-historic-popup-content {
        background: transparent;
        padding: 6px 25px 6px 25px;
        min-height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      #${POPUP_ID} .rift-atlas-historic-popup-content p {
        margin: 0;
        padding: 0;
        color: #b2a580;
        font-size: 14px;
        line-height: 1.4;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #${POPUP_ID} .rift-atlas-historic-popup-close {
        display: block;
        height: 16px;
        width: 16px;
        position: absolute;
        top: 2px;
        right: 2px;
        background: url("/fe/lol-uikit/images/close.png"), rgba(0, 0, 0, 0.7);
        cursor: pointer;
        border-radius: 50%;
        background-size: 70% 70%, 100% 100%;
        background-position: center;
        background-repeat: no-repeat;
        z-index: 10;
        pointer-events: auto;
        border: none;
        padding: 0;
      }

      #${POPUP_ID} .rift-atlas-historic-popup-close:hover {
        background: url("/fe/lol-uikit/images/close.png"), rgba(200, 50, 50, 0.8);
        background-size: 70% 70%, 100% 100%;
        background-position: center;
        background-repeat: no-repeat;
      }

      #${POPUP_ID} .rift-atlas-historic-popup-sub-border {
        position: absolute;
        top: -6px;
        left: 12px;
        right: 12px;
        height: 0;
        border-width: 4px 4px 0 4px;
        border-image-width: 4px 4px 0 4px;
        border-image-slice: 4 4 0 4;
        border-image-repeat: stretch;
        border-style: solid;
        border-image-source: url("/fe/lol-uikit/images/sub-border-primary-horizontal.png");
        pointer-events: none;
      }

      #${POPUP_ID} .rift-atlas-historic-popup-sub-border-bottom {
        position: absolute;
        bottom: -6px;
        left: 12px;
        right: 12px;
        height: 0;
        border-width: 4px 4px 0 4px;
        border-image-width: 4px 4px 0 4px;
        border-image-slice: 4 4 0 4;
        border-image-repeat: stretch;
        border-style: solid;
        border-image-source: url("/fe/lol-uikit/images/sub-border-secondary-horizontal.png");
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (error) {
      log("warn", "Failed to save history", error);
    }
  }

  function normalizeId(value) {
    const id = Number(value || 0);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  function inferChampionIdFromSkin(skinId) {
    const id = normalizeId(skinId);
    return id ? Math.floor(id / 1000) || null : null;
  }

  function getBaseSkinId(championId) {
    const id = normalizeId(championId);
    return id ? id * 1000 : null;
  }

  function getStoredEntry(championId) {
    const entry = history[String(championId)] || null;
    if (!entry) return null;
    if (typeof entry === "number") return { championId, skinId: entry };
    return entry;
  }

  function getStoredSkinId(championId) {
    return normalizeId(getStoredEntry(championId)?.skinId);
  }

  function rememberSkin(championId, skinId, source = "selection", name = null) {
    const champId = normalizeId(championId) || inferChampionIdFromSkin(skinId);
    const selectedSkinId = normalizeId(skinId);
    if (!champId || !selectedSkinId) return;

    history[String(champId)] = {
      championId: champId,
      skinId: selectedSkinId,
      name: name || history[String(champId)]?.name || null,
      updatedAt: Date.now(),
      source,
    };
    saveHistory();
  }

  async function readSelectorInfo() {
    if (!window.fetch) return null;
    const response = await window.fetch("/lol-champ-select/v1/skin-selector-info", {
      credentials: "include",
    });
    return response.ok ? response.json() : null;
  }

  async function readSession() {
    if (!window.fetch) return null;
    const response = await window.fetch("/lol-champ-select/v1/session", {
      credentials: "include",
    });
    return response.ok ? response.json() : null;
  }

  function getMyTeamSelection(session = {}) {
    const myCellId = session.localPlayerCellId;
    return session.myTeam?.find((player) => player.cellId === myCellId) || null;
  }

  function getMyPickAction(session = {}) {
    const myCellId = session.localPlayerCellId;
    return session.actions?.flat?.().find(
      (action) => action.actorCellId === myCellId && action.type === "pick"
    ) || null;
  }

  async function patchSelection(selectedSkinId) {
    const session = await readSession().catch(() => null);
    const action = session ? getMyPickAction(session) : null;

    if (action?.id != null && !action.completed) {
      const actionResponse = await window.fetch(`/lol-champ-select/v1/session/actions/${action.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedSkinId }),
      });
      if (actionResponse.ok) return true;
    }

    const response = await window.fetch("/lol-champ-select/v1/session/my-selection", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedSkinId }),
    });
    return response.ok;
  }

  async function verifySelection(expectedSkinId) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 180));
      const [selectorInfo, session] = await Promise.all([
        readSelectorInfo().catch(() => null),
        readSession().catch(() => null),
      ]);
      const verified = normalizeId(
        getMyTeamSelection(session || {})?.selectedSkinId ||
        selectorInfo?.selectedSkinId
      );
      if (verified === expectedSkinId) return true;
    }
    return false;
  }

  function setHistoricState(active, payload = {}) {
    historicModeActive = active === true;
    historicSkinId = normalizeId(payload.historicSkinId || payload.skinId) || null;
    historicSkinName = payload.historicSkinName || payload.name || null;

    if (historicModeActive && historicSkinName) {
      showSkinName(historicSkinName);
    } else if (!customModPopupActive) {
      removeSkinName();
    }

    updateHistoricFlag();
  }

  async function restoreSkin(championId, selectedSkinId, name = null) {
    const champId = normalizeId(championId);
    const targetSkinId = normalizeId(selectedSkinId);
    if (!champId || !targetSkinId || !window.fetch) return false;

    const key = `${champId}:${targetSkinId}`;
    if (key === lastRestoreKey && Date.now() - lastRestoreAt < RESTORE_COOLDOWN_MS) return false;
    lastRestoreKey = key;
    lastRestoreAt = Date.now();

    setHistoricState(true, {
      historicSkinId: targetSkinId,
      historicSkinName: name || `Skin ${targetSkinId}`,
    });

    try {
      const accepted = await patchSelection(targetSkinId);
      const verified = accepted && await verifySelection(targetSkinId);
      if (verified) {
        currentChampionId = champId;
        currentSkinId = targetSkinId;
        rememberSkin(champId, targetSkinId, "restore", name);
        log("info", "Restored historic skin", { championId: champId, skinId: targetSkinId });
      } else {
        log("warn", "Historic restore was not confirmed by LCU", { championId: champId, skinId: targetSkinId });
      }
      return verified;
    } catch (error) {
      log("warn", "Historic restore failed", error);
      return false;
    }
  }

  function shouldRestore(championId, selectedSkinId, storedSkinId) {
    if (!championId || !storedSkinId || storedSkinId === selectedSkinId) return false;
    const baseSkinId = getBaseSkinId(championId);
    return selectedSkinId === baseSkinId;
  }

  function handleSelectionState(detail = {}) {
    const championId = normalizeId(detail.championId) || inferChampionIdFromSkin(detail.selectedSkinId || detail.skinId);
    const selectedSkinId = normalizeId(detail.selectedSkinId || detail.skinId);
    if (!championId || !selectedSkinId) return;

    const championChanged = championId !== currentChampionId;
    currentChampionId = championId;
    currentSkinId = selectedSkinId;

    const storedEntry = getStoredEntry(championId);
    const storedSkinId = normalizeId(storedEntry?.skinId);
    if (championChanged && shouldRestore(championId, selectedSkinId, storedSkinId)) {
      restoreSkin(championId, storedSkinId, storedEntry?.name || null);
      return;
    }

    if (selectedSkinId !== getBaseSkinId(championId)) {
      setHistoricState(false);
    }
    rememberSkin(championId, selectedSkinId, "selection", detail.name || null);
  }

  async function pollSelectionState() {
    try {
      const [selectorInfo, session] = await Promise.all([
        readSelectorInfo().catch(() => null),
        readSession().catch(() => null),
      ]);
      const teamSelection = getMyTeamSelection(session || {});
      const championId = normalizeId(
        selectorInfo?.championId ||
        teamSelection?.championId ||
        getMyPickAction(session || {})?.championId
      );
      const selectedSkinId = normalizeId(
        teamSelection?.selectedSkinId ||
        selectorInfo?.selectedSkinId ||
        teamSelection?.skinId
      );
      handleSelectionState({ championId, selectedSkinId, source: "poll" });
    } catch {
      currentChampionId = null;
      currentSkinId = null;
      setHistoricState(false);
    }
  }

  function handleHistoricStateUpdate(data = {}) {
    setHistoricState(data.active === true, data);
  }

  function getCustomModName(data = {}) {
    return String(data.modName || data.mod_name || data.name || data.mod?.mod_name || "").trim();
  }

  function getVisibleSkinId(data = {}) {
    return normalizeId(
      data.skinId ||
      data.selectedSkinId ||
      data.currentSkinId ||
      window.__riftAtlasSkinState?.skinId ||
      window.__roseSkinState?.skinId
    );
  }

  function handleCustomModStateUpdate(data = {}) {
    const modName = getCustomModName(data);
    const modSkinId = normalizeId(data.skinId || data.selectedSkinId || data.requestedSkinId);

    if (data.active && modName) {
      customModPopupActive = true;
      customModTargetSkinId = modSkinId || null;
      showSkinName(modName);
      if (modSkinId) {
        setTimeout(() => {
          const visibleSkinId = getVisibleSkinId();
          if (!customModPopupActive || customModTargetSkinId !== modSkinId) return;
          if (visibleSkinId && visibleSkinId !== modSkinId) {
            customModPopupActive = false;
            customModTargetSkinId = null;
            removeSkinName();
          }
        }, 250);
      }
      return;
    }
    customModPopupActive = false;
    customModTargetSkinId = null;
    if (!historicModeActive) removeSkinName();
  }

  function handleSkinStateUpdate(data = {}) {
    handleSelectionState(data);
    if (!customModPopupActive) return;

    const visibleSkinId = getVisibleSkinId(data);
    if (!customModTargetSkinId || !visibleSkinId || visibleSkinId === customModTargetSkinId) return;

    customModPopupActive = false;
    customModTargetSkinId = null;
    removeSkinName();
  }

  function handlePhaseChange(data = {}) {
    const wasInChampSelect = isInChampSelect;
    isInChampSelect = data.phase === "ChampSelect" || data.phase === "FINALIZATION";
    if (isInChampSelect && !wasInChampSelect) {
      if (historicModeActive) setTimeout(updateHistoricFlag, 100);
      pollSelectionState();
      setTimeout(() => {
        if (window.__riftAtlasCustomModState?.active) handleCustomModStateUpdate(window.__riftAtlasCustomModState);
      }, 150);
      return;
    }
    if (!isInChampSelect && wasInChampSelect) {
      customModPopupActive = false;
      customModTargetSkinId = null;
      removeSkinName();
      hideFlagOnElement(currentRewardsElement);
      currentRewardsElement = null;
      currentChampionId = null;
      currentSkinId = null;
    }
  }

  function handleLocalAssetUrl(data = {}) {
    if (data.assetPath !== HISTORIC_FLAG_ASSET_PATH || !data.url) return;
    historicFlagImageUrl = String(data.url).replace("localhost", "127.0.0.1");
    if (historicModeActive) updateHistoricFlag();
  }

  function requestHistoricFlagImage() {
    if (historicFlagImageUrl) return;
    bridge?.send?.({
      type: "request-local-asset",
      assetPath: HISTORIC_FLAG_ASSET_PATH,
      timestamp: Date.now(),
    });
  }

  function findRewardsElement() {
    const selectedItem = document.querySelector(".skin-selection-item.skin-selection-item-selected");
    const selectedInfo = selectedItem?.querySelector(REWARDS_SELECTOR);
    if (selectedInfo) return selectedInfo;
    return document.querySelector(REWARDS_SELECTOR);
  }

  function updateHistoricFlag() {
    if (!isInChampSelect && !document.querySelector(".champion-select")) return;
    const element = findRewardsElement();
    if (!element) {
      if (historicModeActive) setTimeout(updateHistoricFlag, 500);
      return;
    }

    if (currentRewardsElement && currentRewardsElement !== element) {
      hideFlagOnElement(currentRewardsElement);
    }
    currentRewardsElement = element;

    if (!historicModeActive) {
      hideFlagOnElement(element);
      return;
    }

    if (!historicFlagImageUrl) {
      requestHistoricFlagImage();
      return;
    }

    element.classList.add("rift-atlas-historic-flag-active");
    element.classList.add("lu-historic-flag-active");
    element.style.setProperty("background-image", `url("${historicFlagImageUrl}")`, "important");
  }

  function hideFlagOnElement(element) {
    if (!element) return;
    element.classList.remove("rift-atlas-historic-flag-active");
    element.classList.remove("lu-historic-flag-active");
    if (!element.classList.contains("lu-random-flag-active")) {
      element.style.removeProperty("background-image");
    }
  }

  function removeSkinName() {
    document.getElementById(POPUP_ID)?.remove();
  }

  function showSkinName(skinName) {
    const text = String(skinName || "").trim();
    if (!text) {
      removeSkinName();
      return;
    }

    let popup = document.getElementById(POPUP_ID);
    if (popup) {
      const pTag = popup.querySelector("p");
      if (pTag) pTag.textContent = text;
      resetTimer(popup);
      return;
    }

    popup = document.createElement("div");
    popup.id = POPUP_ID;
    popup.innerHTML = `
      <div class="toast-body">
        <div class="toast-content">
          <div class="rift-atlas-historic-popup-frame">
            <div class="rift-atlas-historic-popup-content">
              <p></p>
            </div>
            <div class="rift-atlas-historic-popup-sub-border"></div>
            <div class="rift-atlas-historic-popup-sub-border-bottom"></div>
            <button class="rift-atlas-historic-popup-close" type="button" aria-label="Dismiss"></button>
          </div>
        </div>
      </div>
    `;
    popup.querySelector("button")?.addEventListener("click", dismissActivePopup);

    const pTag = popup.querySelector("p");
    if (pTag) pTag.textContent = text;

    document.body.appendChild(popup);
    resetTimer(popup);
  }

  function resetTimer(el) {
    if (el._timer) clearTimeout(el._timer);
    el._timer = setTimeout(() => el.remove(), 125000);
  }

  function dismissActivePopup() {
    const msgType = customModPopupActive ? "dismiss-custom-mod" : "dismiss-historic";
    customModPopupActive = false;
    setHistoricState(false);
    bridge?.send?.({ type: msgType, timestamp: Date.now() });
  }

  async function init() {
    injectStyles();
    bridge = await waitForBridge();

    bridge.subscribe?.("historic-state", handleHistoricStateUpdate);
    bridge.subscribe?.("custom-mod-state", handleCustomModStateUpdate);
    bridge.subscribe?.("skin-state", handleSkinStateUpdate);
    bridge.subscribe?.("local-asset-url", handleLocalAssetUrl);
    bridge.subscribe?.("phase-change", handlePhaseChange);
    bridge.onReady?.(requestHistoricFlagImage);

    window.addEventListener("rift-atlas-lcu-selection-state", (event) => {
      handleSelectionState(event.detail || {});
    });

    if (window.__riftAtlasLcuSelectionState) handleSelectionState(window.__riftAtlasLcuSelectionState);
    if (window.__riftAtlasSkinState) handleSkinStateUpdate(window.__riftAtlasSkinState);
    if (window.__riftAtlasHistoricState) handleHistoricStateUpdate(window.__riftAtlasHistoricState);
    if (window.__riftAtlasCustomModState) handleCustomModStateUpdate(window.__riftAtlasCustomModState);

    const observer = new MutationObserver(() => {
      if (historicModeActive) updateHistoricFlag();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    window.__riftAtlasHistoricMode = {
      getHistory: () => ({ ...history }),
      clearHistory: () => {
        history = {};
        saveHistory();
      },
      restoreSkin,
      setHistoricState,
    };

    setInterval(pollSelectionState, POLL_MS);
    requestHistoricFlagImage();
    pollSelectionState();
    log("info", "Initialized");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init().catch((error) => log("warn", "Init failed", error)));
  } else {
    init().catch((error) => log("warn", "Init failed", error));
  }
})();

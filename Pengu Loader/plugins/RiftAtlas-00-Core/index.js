/**
 * @name RiftAtlas-00-Core
 * @author Rift Atlas
 * @description Rose-style UI unlocker, bridge, skin monitor and loadout detector.
 */

(function enableLockedSkinPreview() {
  const LOG_PREFIX = "[RiftAtlasRoseUI]";
  const INLINE_ID = "rift-atlas-rose-ui-unlock";
  const BORDER_CLASS = "rift-atlas-rose-skin-border";
  const HIDDEN_CLASS = "rift-atlas-rose-skin-hidden";
  const CHROMA_CONTAINER_CLASS = "rift-atlas-rose-chroma-container";
  const VISIBLE_OFFSETS = new Set([0, 1, 2, 3, 4]);

  function injectInlineRules() {
    if (document.getElementById(INLINE_ID)) return;

    const style = document.createElement("style");
    style.id = INLINE_ID;
    style.textContent = `
      .skin-selection-carousel .skin-selection-item {
        position: relative;
        z-index: 1;
      }

      .skin-selection-carousel .skin-selection-item .skin-selection-item-information {
        position: relative;
        z-index: 2;
      }

      .skin-selection-carousel .skin-selection-item.disabled,
      .skin-selection-carousel .skin-selection-item[aria-disabled="true"] {
        filter: grayscale(0) saturate(1.1) contrast(1.05) !important;
        -webkit-filter: grayscale(0) saturate(1.1) contrast(1.05) !important;
        pointer-events: auto !important;
        cursor: pointer !important;
      }

      .skin-selection-carousel .skin-selection-item.disabled .skin-selection-thumbnail,
      .skin-selection-carousel .skin-selection-item[aria-disabled="true"] .skin-selection-thumbnail {
        filter: grayscale(0) saturate(1.15) contrast(1.05) !important;
        -webkit-filter: grayscale(0) saturate(1.15) contrast(1.05) !important;
        transition: filter 0.25s ease;
      }

      .skin-selection-carousel .skin-selection-item:not(.disabled):not([aria-disabled="true"]):not(.skin-selection-item-selected):hover .skin-selection-thumbnail,
      .skin-selection-carousel .skin-selection-item.disabled:not(.skin-selection-item-selected):hover .skin-selection-thumbnail,
      .skin-selection-carousel .skin-selection-item[aria-disabled="true"]:not(.skin-selection-item-selected):hover .skin-selection-thumbnail {
        filter: brightness(1.2) saturate(1.1) !important;
        -webkit-filter: brightness(1.2) saturate(1.1) !important;
        transition: filter 0.25s ease;
      }

      .skin-selection-carousel .skin-selection-item.disabled::before,
      .skin-selection-carousel .skin-selection-item.disabled::after,
      .skin-selection-carousel .skin-selection-item[aria-disabled="true"]::before,
      .skin-selection-carousel .skin-selection-item[aria-disabled="true"]::after,
      .skin-selection-carousel .skin-selection-item.disabled .skin-selection-thumbnail::before,
      .skin-selection-carousel .skin-selection-item.disabled .skin-selection-thumbnail::after,
      .skin-selection-carousel .skin-selection-item[aria-disabled="true"] .skin-selection-thumbnail::before,
      .skin-selection-carousel .skin-selection-item[aria-disabled="true"] .skin-selection-thumbnail::after,
      .skin-selection-carousel .skin-selection-item.disabled .locked-state,
      .skin-selection-carousel .skin-selection-item[aria-disabled="true"] .locked-state,
      .locked-state {
        display: none !important;
      }

      .skin-selection-carousel .skin-selection-item.${HIDDEN_CLASS} {
        pointer-events: none !important;
      }

      .champion-select .uikit-background-switcher.locked:after {
        background: none !important;
      }

      .unlock-skin-hit-area {
        display: none !important;
        pointer-events: none !important;
      }

      .unlock-skin-hit-area .locked-state {
        display: none !important;
      }

      .skin-selection-carousel-container .skin-selection-carousel .skin-selection-item .skin-selection-thumbnail {
        height: 100% !important;
        margin: 0 !important;
        transition: filter 0.25s ease !important;
        transform: none !important;
      }

      .skin-selection-carousel-container .skin-selection-carousel .skin-selection-item.skin-selection-item-selected {
        background: #3c3c41 !important;
      }

      .skin-selection-carousel-container .skin-selection-carousel .skin-selection-item.skin-selection-item-selected .skin-selection-thumbnail {
        height: 100% !important;
        margin: 0 !important;
      }

      .skin-selection-carousel .skin-selection-item .${BORDER_CLASS} {
        position: absolute;
        inset: -2px;
        border: 2px solid transparent;
        border-image-source: linear-gradient(0deg, #4f4f54 0%, #3c3c41 50%, #29272b 100%);
        border-image-slice: 1;
        border-radius: inherit;
        box-sizing: border-box;
        pointer-events: none;
        z-index: 0;
      }

      .skin-selection-carousel .skin-selection-item.skin-carousel-offset-2 .${BORDER_CLASS},
      .skin-selection-carousel .skin-selection-item:not(.skin-selection-item-selected):hover .${BORDER_CLASS} {
        border: 2px solid transparent;
        border-image-source: linear-gradient(0deg, #c8aa6e 0%, #c89b3c 44%, #a07b32 59%, #785a28 100%);
        border-image-slice: 1;
        box-shadow: inset 0 0 0 1px rgba(1, 10, 19, 0.6);
      }

      .skin-selection-carousel .skin-selection-item .${CHROMA_CONTAINER_CLASS} {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        pointer-events: none;
        z-index: 4;
        overflow: hidden;
      }

      .skin-selection-carousel .skin-selection-item .${CHROMA_CONTAINER_CLASS} .chroma-button {
        pointer-events: auto;
      }

      .chroma-button.chroma-selection {
        display: none !important;
      }

      .thumbnail-wrapper,
      .skin-thumbnail-img,
      .thumbnail-wrapper.unowned {
        filter: grayscale(0) saturate(1) contrast(1) !important;
        -webkit-filter: grayscale(0) saturate(1) contrast(1) !important;
      }

      .skin-selection-carousel-container {
        clip-path: inset(-200px -9999px -9999px -9999px) !important;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureBorderFrame(skinItem) {
    if (!skinItem) return;

    let border = skinItem.querySelector(`.${BORDER_CLASS}`);
    if (!border) {
      border = document.createElement("div");
      border.className = BORDER_CLASS;
      border.setAttribute("aria-hidden", "true");
    }

    const chromaContainer = skinItem.querySelector(`.${CHROMA_CONTAINER_CLASS}`);
    if (chromaContainer && border.nextSibling !== chromaContainer) {
      skinItem.insertBefore(border, chromaContainer);
      return;
    }

    if (border.parentElement !== skinItem || border !== skinItem.firstChild) {
      skinItem.insertBefore(border, skinItem.firstChild || null);
    }
  }

  function ensureChromaContainer(skinItem) {
    if (!skinItem) return;

    const chromaButton = skinItem.querySelector(".outer-mask .chroma-button");
    if (!chromaButton) return;

    let container = skinItem.querySelector(`.${CHROMA_CONTAINER_CLASS}`);
    if (!container) {
      container = document.createElement("div");
      container.className = CHROMA_CONTAINER_CLASS;
      container.setAttribute("aria-hidden", "true");
      skinItem.appendChild(container);
    } else if (container.parentElement !== skinItem) {
      skinItem.appendChild(container);
    }

    if (chromaButton.parentElement !== container) {
      container.appendChild(chromaButton);
    }
  }

  function parseCarouselOffset(skinItem) {
    const offsetClass = Array.from(skinItem.classList).find((cls) => cls.startsWith("skin-carousel-offset"));
    const match = offsetClass?.match(/skin-carousel-offset-(-?\d+)/);
    if (!match) return null;
    const value = Number.parseInt(match[1], 10);
    return Number.isNaN(value) ? null : value;
  }

  function applyOffsetVisibility(skinItem) {
    if (!skinItem) return;

    const offset = parseCarouselOffset(skinItem);
    const visible = offset === null || VISIBLE_OFFSETS.has(offset);
    skinItem.classList.toggle(HIDDEN_CLASS, !visible);
    if (visible) {
      skinItem.style.removeProperty("pointer-events");
    } else {
      skinItem.style.setProperty("pointer-events", "none", "important");
    }
  }

  function markSkinsAsOwned() {
    document.querySelectorAll(".thumbnail-wrapper.unowned").forEach((wrapper) => {
      wrapper.classList.remove("unowned");
      wrapper.classList.add("owned");
    });

    document.querySelectorAll(".purchase-available").forEach((element) => {
      element.classList.remove("purchase-available");
      element.classList.add("active");
    });

    document.querySelectorAll(".purchase-disabled").forEach((element) => {
      element.classList.remove("purchase-disabled");
    });
  }

  function removeAgeRatingInChampSelect() {
    if (!document.querySelector(".champion-select") && !document.querySelector(".skin-selection-carousel")) {
      return;
    }

    document.querySelectorAll(".vng-age-rating, .vng-age-rating-container").forEach((element) => element.remove());
  }

  function scanSkinSelection() {
    injectInlineRules();

    document.querySelectorAll(".skin-selection-item").forEach((skinItem) => {
      ensureChromaContainer(skinItem);
      ensureBorderFrame(skinItem);
      applyOffsetVisibility(skinItem);
    });

    markSkinsAsOwned();
    removeAgeRatingInChampSelect();
  }

  function setupSkinObserver() {
    const observer = new MutationObserver(() => {
      scanSkinSelection();
      markSkinsAsOwned();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "aria-disabled"]
    });

    setInterval(() => {
      scanSkinSelection();
      markSkinsAsOwned();
    }, 500);

    window.addEventListener("resize", scanSkinSelection, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scanSkinSelection();
    });

    scanSkinSelection();
    console.log(`${LOG_PREFIX} skin preview overrides active`);
  }

  function whenReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
      return;
    }
    callback();
  }

  whenReady(() => {
    if (!document.body) {
      setTimeout(() => setupSkinObserver(), 250);
      return;
    }
    setupSkinObserver();
  });
})();

(function startRiftAtlasCore() {
  const LOG_PREFIX = "[RiftAtlas]";
  let debugMode = false;
  const DEBUG_BOX_ID = "rift-atlas-debug-box";
  const DEBUG_BUTTON_CLASS = "rift-atlas-debug-toggle";
  let debugBoxVisible = false;
  let debugButtonInjected = false;
  let debugButtonObserver = null;
  const SKIN_SELECTORS = [
    ".skin-selection-item.skin-carousel-offset-2 .skin-name-text",
    ".skin-selection-item.skin-carousel-offset-2 .skin-name",
    ".skin-selection-item.skin-carousel-offset-2 .skin-selection-item-name",
    ".skin-selection-item.skin-carousel-offset-2 .skin-selection-name",
    ".champion-select .skin-name-text",
    ".champion-select .skin-name",
    ".skin-selection-item.skin-carousel-offset-2 [class*='skin-name']",
    ".skin-selection-item.skin-carousel-offset-2 [class*='SkinName']",
    ".skin-name-text",
    ".skin-name"
  ];
  const SKIN_ALT_SELECTORS = [
    ".skin-selection-item.skin-carousel-offset-2 .skin-selection-item-name",
    ".skin-selection-item.skin-carousel-offset-2 .skin-selection-name",
    ".skin-selection-item.skin-carousel-offset-2 [class*='skin-selection'] [class*='name']",
    ".skin-selection-item.skin-carousel-offset-2 [class*='skin-selection'] [class*='Name']"
  ];
  const POLL_INTERVAL_MS = 250;
  // Rose resynchronizes the FINALIZATION timer every 200 ms.
  const FLOW_POLL_INTERVAL_MS = 200;
  const RETRY_BASE_MS = 1000;
  const RETRY_MAX_MS = 30000;
  const DISCOVERY_START_PORT = 50000;
  const DISCOVERY_END_PORT = 50010;
  const BRIDGE_PORT_STORAGE_KEY = "rift_atlas_bridge_port";
  let lastLoggedSkin = null;
  let championLockAnnounced = false;
  let lastChampionExchangeSignature = "";
  let lastChampionExchangeAt = 0;
  let pollTimer = null;
  let observer = null;
  let bridgeSocket = null;
  let bridgeReady = false;
  let bridgeQueue = [];
  let retryTimer = null;
  let stopped = false;
  let retryDelay = RETRY_BASE_MS;
  let monitoring = false;
  let sendCount = 0;
  let lastSentPayload = null;
  let lastError = "";
  let lastEvent = "-";
  let lastDebugUpdate = 0;
  let bridgePort = 0;
  let bridgeDiscoveryPromise = null;
  let lastWsSkinId = null;
  let lastWsChampId = null;
  let flowPollTimer = null;
  let lastGameflowPhase = "";
  let lastAuthoritativePhaseAt = Date.now();
  let ownedSkinIds = new Set();
  let ownedSkinFetchAt = 0;
  let forcedBaseSyncSuppression = null;
  const subscribers = new Map();
  const readyCallbacks = new Set();

  function subscribe(type, cb) {
    if (!subscribers.has(type)) subscribers.set(type, new Set());
    subscribers.get(type).add(cb);
  }

  function unsubscribe(type, cb) {
    const s = subscribers.get(type);
    if (s) s.delete(cb);
  }

  function onReady(cb) {
    readyCallbacks.add(cb);
    if (bridgeReady) cb();
  }

  function notifySubscribers(data) {
    if (!data || !data.type) return;
    const s = subscribers.get(data.type);
    if (!s) return;
    for (const cb of s) {
      try { cb(data); } catch (e) { console.warn(`${LOG_PREFIX} subscriber error:`, e); }
    }
  }

  function publishCachedBridgeState(data) {
    if (!data || !data.type) return;
    if (data.type === "custom-mod-state") {
      window.__riftAtlasCustomModState = data;
      window.dispatchEvent(new CustomEvent("rift-atlas-custom-mod-state", { detail: data }));
      return;
    }
    if (data.type === "historic-state") {
      window.__riftAtlasHistoricState = data;
      window.dispatchEvent(new CustomEvent("rift-atlas-historic-state", { detail: data }));
    }
  }

  function notifyReady() {
    for (const cb of readyCallbacks) {
      try { cb(); } catch (e) { console.warn(`${LOG_PREFIX} onReady error:`, e); }
    }
  }

  function ensureBridgeApi() {
    if (!window.__roseBridge) {
      window.__roseBridge = {
        send: (payload) => _sendRaw(payload),
        subscribe,
        unsubscribe,
        onReady,
        get port() { return bridgePort; },
        get ready() { return bridgeReady; },
      };
      console.log(`${LOG_PREFIX} Created window.__roseBridge (standalone mode, port=${bridgePort})`);
    }

    window.__roseBridge.send = (payload) => _sendRaw(payload);
  }

  function _sendRaw(payload) {
    const raw = JSON.stringify(payload);
    if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
      bridgeQueue.push(raw);
      connectBridge();
      return;
    }
    bridgeSocket.send(raw);
  }

  function toggleDebugBox() {
    if (!debugMode) return;
    debugBoxVisible = !debugBoxVisible;
    const box = ensureDebugBox();
    if (!box) return;
    box.style.display = debugBoxVisible ? "" : "none";
  }

  function removeDebugUi() {
    if (debugButtonObserver) {
      debugButtonObserver.disconnect();
      debugButtonObserver = null;
    }
    document.querySelector("." + DEBUG_BUTTON_CLASS)?.remove();
    document.getElementById(DEBUG_BOX_ID)?.remove();
    debugButtonInjected = false;
    debugBoxVisible = false;
  }

  function setDebugMode(enabled) {
    debugMode = Boolean(enabled);
    if (!debugMode) {
      removeDebugUi();
      return;
    }
    injectDebugButton();
    if (debugBoxVisible) updateDebugBox();
  }

  function injectDebugButton() {
    if (!debugMode || debugButtonInjected || debugButtonObserver) return;
    const tryInject = () => {
      if (!debugMode) return true;
      const cs = document.querySelector(".champion-select");
      if (!cs) return false;
      if (document.querySelector("." + DEBUG_BUTTON_CLASS)) { debugButtonInjected = true; return true; }
      const btn = document.createElement("div");
      btn.className = DEBUG_BUTTON_CLASS;
      btn.textContent = "DBG";
      btn.title = "Toggle Rift Atlas debug overlay";
      btn.style.cssText = [
        "position:fixed","right:18px","bottom:18px","z-index:2147483647",
        "display:flex","align-items:center","justify-content:center",
        "width:36px","height:36px",
        "background:rgba(7,18,25,0.9)","border:1px solid #c89b3c",
        "border-radius:6px","color:#c89b3c","font:13px/1 monospace","font-weight:700",
        "cursor:pointer","user-select:none","transition:background 0.2s,transform 0.15s",
        "box-shadow:0 2px 8px rgba(0,0,0,0.5)"
      ].join(";");
      btn.addEventListener("mouseenter", () => { btn.style.background = "rgba(200,155,60,0.25)"; btn.style.transform = "scale(1.1)"; });
      btn.addEventListener("mouseleave", () => { btn.style.background = "rgba(7,18,25,0.9)"; btn.style.transform = "scale(1)"; });
      btn.addEventListener("click", (e) => { e.stopPropagation(); toggleDebugBox(); });
      document.body?.appendChild(btn);
      debugButtonInjected = true;
      return true;
    };
    if (tryInject()) return;
    debugButtonObserver = new MutationObserver(() => {
      if (tryInject()) {
        debugButtonObserver?.disconnect();
        debugButtonObserver = null;
      }
    });
    debugButtonObserver.observe(document.body, { childList: true, subtree: true });
  }

  function ensureDebugBox() {
    if (!debugMode) return null;
    let box = document.getElementById(DEBUG_BOX_ID);
    if (box) return box;
    box = document.createElement("div");
    box.id = DEBUG_BOX_ID;
    box.style.cssText = [
      "position:fixed","left:18px","bottom:18px","z-index:2147483647",
      "width:360px","max-height:260px","overflow:auto",
      "padding:10px 12px","border:1px solid #c89b3c",
      "background:rgba(7,18,25,0.96)","color:#f0e6d2",
      "font:12px/1.35 Consolas,monospace",
      "box-shadow:0 0 0 1px rgba(1,10,19,.85),0 8px 22px rgba(0,0,0,.55)",
      "pointer-events:none","white-space:normal",
      "display:none"
    ].join(";");
    document.body?.appendChild(box);
    return box;
  }

  function dbg(event, error) {
    if (!debugMode) return;
    lastEvent = event;
    if (error) lastError = String(error);
    updateDebugBox();
  }

  function updateDebugBox() {
    const now = Date.now();
    if (now - lastDebugUpdate < 400) return;
    lastDebugUpdate = now;
    const box = ensureDebugBox();
    if (!box) return;
    const currentSkin = readCurrentSkin() || "";
    const lastPayload = lastSentPayload ? JSON.stringify(lastSentPayload).slice(0, 300) : "";
    const escape = (v) => String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const champId = lastWsChampId;
    const skId = lastWsSkinId;
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;color:#f2d36b;font-weight:700;">
        <span>Rift Atlas</span>
        <span>${escape(new Date().toLocaleTimeString())}</span>
      </div>
      <div><b>monitor:</b> ${monitoring?"on":"off"} | <b>bridge:</b> ${bridgeReady?"ok":"wait("+bridgeQueue.length+")"} | <b>sent:</b> ${sendCount}</div>
      <div><b>skin:</b> ${escape(currentSkin||"-")} | <b>champ:</b> ${champId??"-"} | <b>skinId:</b> ${skId??"-"}</div>
      <div><b>event:</b> ${escape(lastEvent)}</div>
      <div><b>error:</b> ${escape(lastError||"-")}</div>
      <div style="margin-top:4px;word-break:break-word;font-size:11px;color:#9bd9f5;">${escape(lastPayload)}</div>`;
  }

  function isVisible(element) {
    if (typeof element.offsetParent === "undefined") return true;
    return element.offsetParent !== null;
  }

  function readCurrentSkin() {
    // Rose reads the visible skin label directly. Do this before relying on
    // carousel offset classes, which can lag while the carousel animates.
    for (const selector of [".skin-name-text", ".skin-name"]) {
      const nodes = document.querySelectorAll(selector);
      if (!nodes.length) continue;
      let candidate = null;
      nodes.forEach((node) => {
        const name = node.textContent.trim();
        if (!name) return;
        if (isVisible(node)) {
          candidate = name;
        } else if (!candidate) {
          candidate = name;
        }
      });
      if (candidate) return candidate;
    }

    const centerItem = document.querySelector(".skin-selection-item.skin-carousel-offset-2");
    if (centerItem) {
      const centerSelectors = [
        ".skin-name-text",
        ".skin-name",
        ".skin-selection-item-name",
        ".skin-selection-name",
        "[class*='skin-name']",
        "[class*='SkinName']",
        "[class*='name']",
        "[class*='Name']"
      ];
      for (const selector of centerSelectors) {
        const nodes = centerItem.querySelectorAll(selector);
        for (const node of nodes) {
          const name = node.textContent.trim();
          if (name && name.length > 1 && isVisible(node)) return name;
        }
      }
    }

    for (const selector of SKIN_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      if (nodes.length) {
        let candidate = null;
        nodes.forEach((node) => {
          const name = node.textContent.trim();
          if (!name) return;
          if (isVisible(node)) {
            candidate = name;
          } else if (!candidate) {
            candidate = name;
          }
        });
        if (candidate) return candidate;
      }
    }

    for (const selector of SKIN_ALT_SELECTORS) {
      const node = document.querySelector(selector);
      if (node) {
        const name = node.textContent.trim();
        if (name && name.length > 1) return name;
      }
    }

    if (centerItem) {
      const dataSkinId = centerItem.getAttribute("data-skin-id");
      const thumb = centerItem.querySelector(".skin-selection-thumbnail");
      if (thumb) {
        const bg = thumb.style.backgroundImage || window.getComputedStyle(thumb).backgroundImage;
        const m = bg.match(/champion-splashes\/(\d+)\/(\d+)\.jpg/);
        if (m) {
          if (dataSkinId && Number(dataSkinId) > 0) return `champion-${m[1]}-skin-${dataSkinId}`;
          return `champion-${m[1]}-skin-${m[2]}`;
        }
      }

      const els = centerItem.querySelectorAll("*");
      const texts = [];
      els.forEach((el) => {
        const t = (el.textContent || "").trim();
        if (t.length > 3 && !/^[\d\s%]+$/.test(t) && !el.closest("script,style")) texts.push(t);
      });
      if (texts.length) {
        return texts.sort((a, b) => b.length - a.length)[0];
      }

      const splashEl = centerItem.querySelector("[class*='splash'], [class*='Splash'], .skin-selection-thumbnail");
      if (splashEl) {
        const bg = splashEl.style.backgroundImage || window.getComputedStyle(splashEl).backgroundImage;
        const m = bg.match(/champion-splashes\/(\d+)\/(\d+)\.jpg/);
        if (m) return `champion-${m[1]}-skin-${dataSkinId || m[2]}`;
      }
    }

    const anySelected = document.querySelector(".skin-selection-item.skin-selection-item-selected");
    if (anySelected) {
      const txtEl = anySelected.querySelector("[class*='name'], [class*='Name']");
      if (txtEl) {
        const name = txtEl.textContent.trim();
        if (name) return name;
      }
    }

    return null;
  }

  let logHoverDebounceTimer = null;
  let logHoverLastSkin = "";
  function scheduleStableSkinSync(skinName = "") {
    const cleanName = String(skinName || readCurrentSkin() || logHoverLastSkin || "").trim();
    if (cleanName) logHoverLastSkin = cleanName;
    if (logHoverDebounceTimer) {
      clearTimeout(logHoverDebounceTimer);
      logHoverDebounceTimer = null;
    }
    if (lastGameflowPhase && lastGameflowPhase !== "ChampSelect") return;
    const stableName = String(cleanName || readCurrentSkin() || logHoverLastSkin || "").trim();
    if (!stableName) return;
    if (forcedBaseSyncSuppression && Date.now() > forcedBaseSyncSuppression.until) {
      forcedBaseSyncSuppression = null;
    }
    if (
      forcedBaseSyncSuppression &&
      Number(lastWsChampId || 0) === forcedBaseSyncSuppression.championId &&
      Number(lastWsSkinId || 0) === forcedBaseSyncSuppression.baseSkinId
    ) {
      dbg(`skin-sync-base-suppressed:${forcedBaseSyncSuppression.baseSkinId}`);
      return;
    }
    // Rose-style: enviar solo el nombre textual del DOM. El backend resuelve
    // la skin a partir de este nombre usando el catalogo LCU. NO enviamos
    // championId ni selectedSkinId aqui, porque si el LCU aun no actualizo el
    // ID (skin no owned / animacion del carrusel), esos IDs pueden ser stale y
    // sobrescribir el nombre correcto.
    // Usamos un debounce muy corto (100ms) para no saturar con frames intermedios.
    const debounceMs = 100;
    const captureName = String(skinName || "").trim();
    logHoverDebounceTimer = setTimeout(() => {
      logHoverDebounceTimer = null;
      const currentName = String(readCurrentSkin() || "").trim();
      const explicitName = captureName || logHoverLastSkin || stableName;
      // Rose treats the visible carousel text as the authoritative skin. If
      // the DOM changed during the debounce window, send that latest value
      // instead of the stale name captured by an older event.
      const finalName = currentName || explicitName;
      if (!finalName) return;
      logHoverLastSkin = finalName;
      sendBridgePayload({
        type: "skin-sync",
        skin: finalName,
        originalName: finalName,
        timestamp: Date.now()
      });
    }, debounceMs);
  }

  function logHover(skinName) {
    const cleanName = String(skinName || "").trim();
    if (!cleanName) return;
    console.log(`${LOG_PREFIX} Hovered skin: ${cleanName}`);
    dbg("skin:" + cleanName);
    logHoverLastSkin = cleanName;
    // Rose never couples the DOM name with selectedSkinId: the LCU ID can still
    // describe the previously equipped owned skin. The desktop resolves this
    // name and publishes the canonical skin-state afterwards.
    scheduleStableSkinSync(cleanName);
  }

  function sendBridgePayload(obj) {
    try {
      const payload = { source: "rift-atlas-core", ...obj };
      lastSentPayload = payload;
      sendCount++;
      dbg("send:" + (obj.type || "data"));

      // Rose's Python backend republishes state to every UI plugin. All Rift
      // Atlas plugins share this bridge in one LeagueClient window, so publish
      // locally once and send upstream once—no second monitor/socket required.
      notifySubscribers(payload);
      _sendRaw(payload);
    } catch (e) {
      lastError = e.message;
      dbg("send-error");
    }
  }

  function publishLocalSkinState(state) {
    window.__riftAtlasSkinState = state;
    window.dispatchEvent(new CustomEvent("rift-atlas-skin-state", { detail: state }));
    window.__roseSkinState = state;
    window.dispatchEvent(new CustomEvent("lu-skin-monitor-state", { detail: state }));
  }

  function dispatchSkinState(state) {
    publishLocalSkinState(state);
    sendBridgePayload({
      type: "skin-state",
      championId: state.championId,
      skinId: state.skinId,
      name: state.name,
      owned: Number(state.skinId || 0) > 0 ? ownedSkinIds.has(Number(state.skinId)) : false,
      ownedCount: ownedSkinIds.size
    });
  }

  async function discoverBridgePort() {
    const cached = Number(localStorage.getItem(BRIDGE_PORT_STORAGE_KEY) || 0);
    const candidates = [cached, ...Array.from(
      { length: DISCOVERY_END_PORT - DISCOVERY_START_PORT + 1 },
      (_, index) => DISCOVERY_START_PORT + index
    )].filter((port, index, list) => port && list.indexOf(port) === index);
    for (const port of candidates) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/bridge-port`, {
          signal: AbortSignal.timeout(150),
          cache: "no-store",
        });
        if (!response.ok) continue;
        const discovered = Number((await response.text()).trim());
        if (discovered < DISCOVERY_START_PORT || discovered > DISCOVERY_END_PORT) continue;
        localStorage.setItem(BRIDGE_PORT_STORAGE_KEY, String(discovered));
        return discovered;
      } catch { /* try next local port */ }
    }
    localStorage.removeItem(BRIDGE_PORT_STORAGE_KEY);
    return 0;
  }

  async function connectBridge() {
    if (stopped || bridgeSocket?.readyState === WebSocket.OPEN || bridgeSocket?.readyState === WebSocket.CONNECTING) return;
    if (!bridgePort) {
      bridgeDiscoveryPromise ||= discoverBridgePort().finally(() => { bridgeDiscoveryPromise = null; });
      bridgePort = await bridgeDiscoveryPromise;
      if (!bridgePort) {
        scheduleRetry();
        return;
      }
    }
    try {
      bridgeSocket = new WebSocket(`ws://127.0.0.1:${bridgePort}`);
    } catch (e) {
      dbg("ws-error", e);
      scheduleRetry();
      return;
    }
    bridgeSocket.addEventListener("open", () => {
      bridgeReady = true;
      retryDelay = RETRY_BASE_MS;
      dbg("bridge-open");
      console.log(`[RiftAtlas Bridge] ✅ WebSocket CONECTADO a ws://127.0.0.1:${bridgePort}`);
      while (bridgeQueue.length) {
        const p = bridgeQueue.shift();
        try { bridgeSocket.send(p); } catch (e) { bridgeQueue.unshift(p); break; }
      }
      notifyReady();
    });
    bridgeSocket.addEventListener("close", () => {
      bridgeReady = false;
      bridgeSocket = null;
      bridgePort = 0;
      dbg("bridge-close");
      console.warn(`[RiftAtlas Bridge] ❌ WebSocket CERRADO, reintentando en ${retryDelay}ms`);
      scheduleRetry();
    });
    bridgeSocket.addEventListener("error", (e) => {
      lastError = e?.message || "ws-error";
      bridgeReady = false;
      dbg("bridge-err");
      console.error(`[RiftAtlas Bridge] ⚠️ WebSocket ERROR: ${lastError}`);
    });
    bridgeSocket.addEventListener("message", (e) => {
      dbg("recv");
      try {
        const data = JSON.parse(e.data);
        publishCachedBridgeState(data);
        if (data?.type === "skin-state" && data?.source === "rift-atlas-app") {
          publishLocalSkinState({
            championId: Number(data.championId || 0) || null,
            skinId: Number(data.skinId || 0) || null,
            name: data.name || null,
            hasChromas: Boolean(data.hasChromas),
            owned: data.owned === true,
            canonical: true,
          });
        }
        notifySubscribers(data);
      } catch { /* ignore */ }
    });
  }

  function scheduleRetry() {
    if (bridgeReady || stopped || retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; connectBridge(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  }

  function attachObservers() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(reportSkinIfChanged);
    observer.observe(document.body, { childList: true, subtree: true });
    document.querySelectorAll("*").forEach((n) => {
      if (n.shadowRoot && n.shadowRoot instanceof Node) {
        try { observer.observe(n.shadowRoot, { childList: true, subtree: true }); } catch (e) {}
      }
    });
    if (!pollTimer) pollTimer = setInterval(reportSkinIfChanged, POLL_INTERVAL_MS);
  }

  function startMonitoring() {
    if (monitoring) return;
    monitoring = true;
    console.log(`${LOG_PREFIX} Starting skin monitoring`);
    dbg("monitor-on");
    attachObservers();
    reportSkinIfChanged();
  }

  function stopMonitoring() {
    if (!monitoring) return;
    monitoring = false;
    console.log(`${LOG_PREFIX} Stopping skin monitoring`);
    dbg("monitor-off");
    if (observer) { observer.disconnect(); observer = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    lastLoggedSkin = null;
  }

  function reportSkinIfChanged() {
    const name = readCurrentSkin();
    if (!name || name === lastLoggedSkin) return;
    lastLoggedSkin = name;
    logHover(name);

  }

  function dispatchLcuSelectionState(championId, selectedSkinId, extra = {}) {
    const detail = {
      championId: Number(championId || 0) || null,
      selectedSkinId: Number(selectedSkinId || 0) || null,
      ...extra,
    };
    window.__riftAtlasLcuSelectionState = detail;
    window.dispatchEvent(new CustomEvent("rift-atlas-lcu-selection-state", { detail }));
    sendBridgePayload({ type: "lcu-selection-state", ...detail });
  }

  function handleSkinSelectorInfo(data) {
    if (!data || typeof data.selectedSkinId !== "number") return;
    const skinId = data.selectedSkinId > 0 ? data.selectedSkinId : null;

    let championId = data.championId || null;
    if (!championId && skinId > 0) championId = Math.floor(skinId / 1000);
    if (!skinId && !championId) return;

    const skinChanged = skinId !== lastWsSkinId;
    const champChanged = championId !== lastWsChampId;
    if (!skinChanged && !champChanged) return;

    const oldChampionId = Number(lastWsChampId || 0);
    if (champChanged && oldChampionId && championId && oldChampionId !== championId) {
      sendChampionExchange(oldChampionId, championId, "skin-selector-info");
      championLockAnnounced = false;
    }

    lastWsSkinId = skinId;
    lastWsChampId = championId;

    if (!championLockAnnounced && skinId) {
      championLockAnnounced = true;
      sendBridgePayload({ type: "champion-locked", locked: true, championId, selectedSkinId: skinId, name: readCurrentSkin() || null });
      fetchOwnedSkinIds({ force: true }).catch(() => null);
    }

    const name = readCurrentSkin() || null;
    console.log(`${LOG_PREFIX} WS skin: id=${skinId}, champ=${championId}, name="${name}"`);

    dispatchLcuSelectionState(championId, skinId, { name });

    if (name && name !== lastLoggedSkin) {
      lastLoggedSkin = name;
      logHover(name);
    }
  }

  function sendChampionExchange(oldChampionId, newChampionId, source = "unknown") {
    const signature = `${oldChampionId}->${newChampionId}`;
    const now = Date.now();
    if (signature === lastChampionExchangeSignature && now - lastChampionExchangeAt < 3000) return;
    lastChampionExchangeSignature = signature;
    lastChampionExchangeAt = now;
    sendBridgePayload({
      type: "champion-exchange",
      oldChampionId,
      newChampionId,
      source,
      timestamp: now
    });
    dbg(`champion-exchange:${signature}:${source}`);
  }

  function interceptChampSelectWs() {
    if (typeof window.rcp?.postInit === "function") {
      window.rcp.postInit("rcp-fe-lol-champ-select", (api) => {
        try {
          let ws = null;
          try { ws = api.champSelectBinding?.socket?._websocket; } catch {}
          if (!ws && api.champSelectBinding?.socket?.readyState !== undefined) {
            try { ws = api.champSelectBinding.socket; } catch {}
          }
          if (!ws) {
            try {
              const desc = Object.getOwnPropertyDescriptor(api.champSelectBinding, "socket");
              if (desc?.get) {
                const socket = desc.get.call(api.champSelectBinding);
                if (socket?._websocket) ws = socket._websocket;
                else if (socket?.readyState !== undefined) ws = socket;
              }
            } catch {}
          }
          if (!ws || typeof ws.addEventListener !== "function") {
            console.warn(`${LOG_PREFIX} No ChampSelect WebSocket found, trying to fetch session directly`);
            return;
          }
          const orig = ws.onmessage || null;
          ws.onmessage = function (event) {
            try {
              const payload = JSON.parse(event.data);
              if (payload?.[1] === "OnJsonApiEvent") {
                const ed = payload[2];
                if (ed?.uri === "/lol-champ-select/v1/skin-selector-info") {
                  handleSkinSelectorInfo(ed.data);
                }
              }
            } catch { /* ignore */ }
            if (typeof orig === "function") return orig.call(this, event);
          };
          console.log(`${LOG_PREFIX} ChampSelect WS intercepted`);
        } catch (e) {
          console.warn(`${LOG_PREFIX} Failed to intercept ChampSelect WS:`, e);
        }
      });
    } else {
      console.warn(`${LOG_PREFIX} rcp.postInit not available, will rely on session fetch only`);
    }
  }

  async function readChampSelectSession() {
    const resp = await window.fetch("/lol-champ-select/v1/session", { credentials: "include" });
    if (!resp.ok) return null;
    return resp.json();
  }

  async function readGameflowPhase() {
    const resp = await window.fetch("/lol-gameflow/v1/gameflow-phase", { credentials: "include" });
    if (!resp.ok) return "";
    const text = await resp.text();
    return text.replace(/^"|"$/g, "").trim();
  }

  async function readSkinSelectorInfo() {
    const resp = await window.fetch("/lol-champ-select/v1/skin-selector-info", { credentials: "include" });
    if (!resp.ok) return null;
    return resp.json();
  }

  function getMyPickAction(session = {}) {
    const myCellId = session.localPlayerCellId;
    return session.actions?.flat()?.find(
      (a) => a.actorCellId === myCellId && a.type === "pick"
    ) || null;
  }

  function getMyTeamSelection(session = {}) {
    const myCellId = session.localPlayerCellId;
    return session.myTeam?.find((player) => player.cellId === myCellId) || null;
  }

  function extractInventorySkinId(item) {
    if (!item || typeof item !== "object") return 0;
    return Number(item.itemId || item.skinId || item.id || item.inventoryTypeItemId || 0);
  }

  async function fetchOwnedSkinIds(options = {}) {
    if (stopped || !window.fetch) return ownedSkinIds;
    const now = Date.now();
    if (!options.force && ownedSkinIds.size && now - ownedSkinFetchAt < 60000) {
      return ownedSkinIds;
    }
    try {
      const resp = await window.fetch("/lol-inventory/v2/inventory/CHAMPION_SKIN", { credentials: "include" });
      if (!resp.ok) {
        if (resp.status !== 404) dbg("owned-http", `${resp.status}`);
        return ownedSkinIds;
      }
      const data = await resp.json();
      if (!Array.isArray(data)) return ownedSkinIds;
      ownedSkinIds = new Set(
        data.map(extractInventorySkinId)
          .filter((id) => Number.isFinite(id) && id > 0)
      );
      ownedSkinFetchAt = now;
      sendBridgePayload({
        type: "owned-skins",
        ownedSkinIds: [...ownedSkinIds],
        count: ownedSkinIds.size,
        timestamp: Date.now()
      });
      dbg("owned:" + ownedSkinIds.size);
    } catch (err) {
      dbg("owned-err", err);
    }
    return ownedSkinIds;
  }

  async function fetchSessionSkin() {
    if (stopped) return;
    try {
      const [session, selectorInfo] = await Promise.all([
        readChampSelectSession().catch(() => null),
        readSkinSelectorInfo().catch(() => null)
      ]);
      if (!session) return;
      const myAction = getMyPickAction(session);
      const mySelection = getMyTeamSelection(session);
      const championId = Number(selectorInfo?.championId || myAction?.championId || mySelection?.championId || 0);
      if (!championId) return;

      const rawSkinId = Number(
        selectorInfo?.selectedSkinId ||
        mySelection?.selectedSkinId ||
        myAction?.skinId ||
        0
      );
      if (rawSkinId === 0) return;
      const skinId = rawSkinId > 0 ? rawSkinId : null;

      const skinChanged = skinId && skinId !== lastWsSkinId;
      const champChanged = championId !== lastWsChampId;
      if (!skinChanged && !champChanged) return;

      const oldChampionId = Number(lastWsChampId || 0);
      if (champChanged && oldChampionId && championId && oldChampionId !== championId) {
        sendChampionExchange(oldChampionId, championId, "session-poll");
        championLockAnnounced = false;
      }

      lastWsSkinId = skinId;
      lastWsChampId = championId;

      if (!championLockAnnounced && skinId) {
        championLockAnnounced = true;
        sendBridgePayload({ type: "champion-locked", locked: true, championId, selectedSkinId: skinId, name: readCurrentSkin() || null });
        fetchOwnedSkinIds({ force: true }).catch(() => null);
      }

      const name = readCurrentSkin() || null;
      if (skinChanged || champChanged) {
        console.log(`${LOG_PREFIX} Session skin: id=${skinId}, champ=${championId}, name="${name}"`);
      }

      dispatchLcuSelectionState(championId, skinId, { name });

      if (name && name !== lastLoggedSkin) {
        lastLoggedSkin = name;
        logHover(name);
      }
    } catch (fetchErr) {
      dbg("session-err", fetchErr);
    }
  }

  async function pollGameflowPhase() {
    if (stopped || !window.fetch) return;
    try {
      const phase = await readGameflowPhase().catch(() => "");
      if (phase && phase !== lastGameflowPhase && Date.now() - lastAuthoritativePhaseAt > 5000) {
        const previousPhase = lastGameflowPhase || "";
        lastGameflowPhase = phase;
        sendBridgePayload({
          type: "phase-change",
          phase,
          previousPhase,
          source: "pengu-phase-fallback",
          timestamp: Date.now()
        });
      }
    } catch (err) {
      dbg("flow-poll-err", err);
    }
  }

  async function forceSelectedSkinId(payload = {}) {
    const selectedSkinId = Number(payload.selectedSkinId || payload.skinId || 0);
    if (!selectedSkinId || !window.fetch) return;
    const targetSkinId = Number(payload.targetSkinId || 0);
    const championId = Number(payload.championId || lastWsChampId || 0);
    if (championId && targetSkinId && targetSkinId !== selectedSkinId) {
      // Rose broadcasts "skip-base-skin" before forcing an unowned target to
      // champion base. Keep the visible target authoritative for five seconds
      // so the forced LCU echo cannot replace the package queued for injection.
      forcedBaseSyncSuppression = {
        championId,
        baseSkinId: selectedSkinId,
        targetSkinId,
        skinName: String(readCurrentSkin() || logHoverLastSkin || "").trim(),
        until: Date.now() + 15000,
      };
    }
    let forceOk = false;
    let requestAccepted = false;
    let method = "";
    let verifiedSkinId = 0;
    let forceError = "";
    const forceRequestId = String(payload.forceRequestId || "");
    const readResponseText = async (resp) => {
      try {
        return (await resp.text()).slice(0, 240);
      } catch {
        return "";
      }
    };
    try {
      const verifySelection = async (attempt = 1) => {
        for (let poll = 0; poll < 5; poll += 1) {
          await new Promise((resolve) => setTimeout(resolve, 120 + attempt * 80));
          const verifySession = await readChampSelectSession().catch(() => null);
          const verifySelector = await readSkinSelectorInfo().catch(() => null);
          // Rose treats myTeam.selectedSkinId as the authority. SelectorInfo can
          // briefly retain the previous owned skin while the DOM shows a new one.
          verifiedSkinId = Number(
            getMyTeamSelection(verifySession || {})?.selectedSkinId ||
            verifySelector?.selectedSkinId ||
            0
          );
          if (verifiedSkinId === selectedSkinId) return true;
        }
        return false;
      };

      for (let attempt = 1; attempt <= 3 && !forceOk; attempt += 1) {
        const session = await readChampSelectSession().catch(() => null);
        const action = session ? getMyPickAction(session) : null;

        if (action?.id != null && !action.completed) {
          const actionResp = await window.fetch(`/lol-champ-select/v1/session/actions/${action.id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ selectedSkinId }),
          });
          if (actionResp.ok) {
            requestAccepted = true;
            method = "action";
            forceOk = await verifySelection(attempt);
          } else {
            forceError = `action ${actionResp.status} ${await readResponseText(actionResp)}`;
            dbg("force-action-http", forceError);
          }
        } else {
          forceError = "sin pick action";
        }

        // A 2xx action response only means the request was accepted. Rose falls
        // back to my-selection whenever myTeam does not confirm the desired ID.
        if (!forceOk) {
          const resp = await window.fetch("/lol-champ-select/v1/session/my-selection", {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ selectedSkinId }),
          });
          if (resp.ok) {
            requestAccepted = true;
            method = "my-selection";
            forceOk = await verifySelection(attempt);
          } else {
            forceError = `my-selection ${resp.status} ${await readResponseText(resp)}`;
            dbg("force-skin-http", forceError);
          }
        }

        if (!forceOk) {
          forceError = `LCU no confirmo ${selectedSkinId}; actual=${verifiedSkinId || "?"}`;
          dbg("force-skin-unconfirmed", forceError);
        }
      }

      if (forceOk) forceError = "";
      if (!forceOk) forcedBaseSyncSuppression = null;
      if (verifiedSkinId === selectedSkinId) {
        lastWsSkinId = selectedSkinId;
      }
      if (payload.championId) lastWsChampId = Number(payload.championId);
      dispatchLcuSelectionState(lastWsChampId, lastWsSkinId, { forced: true });
      sendBridgePayload({
        type: "force-skin-result",
        championId: lastWsChampId,
        skinId: lastWsSkinId,
        name: readCurrentSkin() || payload.name || null,
        forced: true,
        forceOk,
        requestAccepted,
        forceMethod: method,
        forceError,
        verifiedSkinId,
        forceRequestId,
        owned: ownedSkinIds.has(selectedSkinId),
        ownedCount: ownedSkinIds.size
      });
    } catch (err) {
      dbg("force-skin-err", err);
      forcedBaseSyncSuppression = null;
      sendBridgePayload({
        type: "force-skin-result",
        championId: championId || lastWsChampId,
        skinId: lastWsSkinId,
        name: readCurrentSkin() || payload.name || null,
        forced: true,
        forceOk: false,
        requestAccepted,
        forceMethod: method,
        forceError: err?.message || String(err),
        verifiedSkinId,
        forceRequestId,
        owned: ownedSkinIds.has(selectedSkinId),
        ownedCount: ownedSkinIds.size
      });
    }
  }

  function start() {
    if (!document.body) { setTimeout(start, 250); return; }
    stopped = false;
    retryDelay = RETRY_BASE_MS;
    ensureBridgeApi();
    connectBridge();
    subscribe("debug-mode", (payload = {}) => setDebugMode(payload.enabled));
    subscribe("debug-toggle", () => toggleDebugBox());
    subscribe("skip-base-skin", (payload = {}) => {
      const championId = Number(payload.championId || lastWsChampId || 0);
      const baseSkinId = Number(payload.baseSkinId || 0);
      const targetSkinId = Number(payload.targetSkinId || 0);
      if (!championId || !baseSkinId || !targetSkinId) return;
      forcedBaseSyncSuppression = {
        championId,
        baseSkinId,
        targetSkinId,
        skinName: String(payload.skinName || readCurrentSkin() || logHoverLastSkin || "").trim(),
        until: Date.now() + Math.max(1000, Number(payload.durationMs || 15000)),
      };
      dbg(`skip-base-skin:${baseSkinId}->${targetSkinId}`);
    });
    subscribe("skip-base-skin-clear", () => {
      forcedBaseSyncSuppression = null;
      dbg("skip-base-skin-clear");
    });
    subscribe("force-skin", forceSelectedSkinId);
    subscribe("phase-change", (payload = {}) => {
      const phase = String(payload.phase || "");
      if (!phase) return;
      if (payload.source === "lcu-gameflow-monitor") {
        lastAuthoritativePhaseAt = Date.now();
      }
      lastGameflowPhase = phase;
      if (phase === "InProgress") stopMonitoring();
      else startMonitoring();
      if (["Lobby", "ChampSelect"].includes(phase)) {
        lastLoggedSkin = null;
        championLockAnnounced = false;
      }
      if (!["ChampSelect", "FINALIZATION"].includes(phase)) {
        forcedBaseSyncSuppression = null;
      }
    });
    startMonitoring();
    interceptChampSelectWs();
    fetchOwnedSkinIds({ force: true }).catch(() => null);
    setInterval(fetchSessionSkin, 3000);
    if (!flowPollTimer) {
      flowPollTimer = setInterval(pollGameflowPhase, FLOW_POLL_INTERVAL_MS);
      pollGameflowPhase().catch(() => null);
    }
  }

  function stop() {
    stopped = true;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (flowPollTimer) { clearInterval(flowPollTimer); flowPollTimer = null; }
    stopMonitoring();
    if (bridgeSocket) { bridgeSocket.close(); bridgeSocket = null; }
  }

  function whenReady(cb) {
    if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", cb, { once: true }); return; }
    cb();
  }

  whenReady(start);
  window.addEventListener("beforeunload", stop);
})();

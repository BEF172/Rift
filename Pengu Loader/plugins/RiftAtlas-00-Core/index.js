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
    ".skin-name-text",
    ".skin-name",
  ];
  const POLL_INTERVAL_MS = 250;
  const RETRY_BASE_MS = 1000;
  const RETRY_MAX_MS = 30000;
  const DISCOVERY_START_PORT = 50000;
  const DISCOVERY_END_PORT = 50010;
  const BRIDGE_PORT_STORAGE_KEY = "rift_atlas_bridge_port";
  let lastLoggedSkin = null;
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
  let lastGameflowPhase = "";
  let lastBaseSkinSkipRequest = 0;
  const BASE_SKIN_SKIP_REQUEST_TIME_WINDOW_MS = 5000;
  const subscribers = new Map();
  const readyCallbacks = new Set();
  let bridgeErrorLogged = false;
  let bridgeSetupWarned = false;

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

  // Rose parity: sanitize skin name (dedicated function like Rose's sanitizeSkinName)
  function sanitizeSkinName(name) {
    return String(name || "").trim();
  }

  // Rose parity: dedicated flush function
  function flushBridgeQueue() {
    while (bridgeQueue.length) {
      const raw = bridgeQueue.shift();
      try { bridgeSocket.send(raw); } catch (e) {
        console.warn(`${LOG_PREFIX} flush failed, re-queuing`, e);
        bridgeQueue.unshift(raw);
        resetBridgeSocket();
        break;
      }
    }
  }

  // Rose parity: dedicated reset function
  function resetBridgeSocket() {
    try {
      if (bridgeSocket) bridgeSocket.close();
    } catch (e) {
      console.warn(`${LOG_PREFIX} resetBridgeSocket error`, e);
    }
    bridgeSocket = null;
    bridgeReady = false;
  }

  function ensureBridgeApi() {
    if (!window.__roseBridge) {
      window.__roseBridge = {
        send: (payload) => sendBridgePayload(payload),
        subscribe,
        unsubscribe,
        onReady,
        get port() { return bridgePort; },
        get ready() { return bridgeReady; },
      };
      console.log(`${LOG_PREFIX} Created window.__roseBridge (standalone mode, port=${bridgePort})`);
    }
    // Rose parity: expose bridgeEmit early so consumer plugins can find it before bridge connects
    window.__roseBridgeEmit = (payload) => sendBridgePayload(payload);
    window.__roseBridge.send = (payload) => sendBridgePayload(payload);
  }

  function _sendRaw(payload) {
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (!bridgeSocket || bridgeSocket.readyState === WebSocket.CLOSING || bridgeSocket.readyState === WebSocket.CLOSED) {
      bridgeQueue.push(raw);
      connectBridge();
      return;
    }
    if (bridgeSocket.readyState === WebSocket.CONNECTING) {
      bridgeQueue.push(raw);
      return;
    }
    try {
      bridgeSocket.send(raw);
    } catch (error) {
      console.warn(`${LOG_PREFIX} Bridge send failed`, error);
      bridgeQueue.push(raw);
      resetBridgeSocket();
    }
  }

  function resetBridgeSocket() {
    if (bridgeSocket) {
      try { bridgeSocket.close(); } catch (_) { /* ignore */ }
    }
    bridgeSocket = null;
    bridgeReady = false;
  }

  function toggleDebugBox() {
    if (!debugMode) return;
    debugBoxVisible = !debugBoxVisible;
    const box = ensureDebugBox();
    if (!box) return;
    box.style.display = debugBoxVisible ? "" : "none";
  }

  function handleSkipBaseSkin() {
    lastBaseSkinSkipRequest = Date.now();
    console.log(`${LOG_PREFIX} received base skin skip request`);
    window.dispatchEvent(new CustomEvent("rift-atlas-hide-ui"));
  }

  function interceptChampSelectWebsocket() {
    window.rcp?.postInit?.("rcp-fe-lol-champ-select", (api) => {
      try {
        const ws = api?.champSelectBinding?.socket?._websocket;
        if (!ws || ws.__riftAtlasBaseSkipPatched) return;
        const parentOnMessage = ws.onmessage;
        ws.onmessage = function (event) {
          try {
            const payload = JSON.parse(event.data);
            if (payload?.[1] === "OnJsonApiEvent") {
              const eventData = payload[2];
              if (
                eventData?.uri === "/lol-champ-select/v1/skin-selector-info" &&
                eventData?.data?.selectedSkinId &&
                Date.now() - lastBaseSkinSkipRequest < BASE_SKIN_SKIP_REQUEST_TIME_WINDOW_MS
              ) {
                console.log(`${LOG_PREFIX} skipping visual base skin update`);
                return;
              }
            }
          } catch (error) {
            console.warn(`${LOG_PREFIX} champ-select ws intercept error`, error);
          }
          return parentOnMessage?.call(this, event);
        };
        ws.__riftAtlasBaseSkipPatched = true;
        console.log(`${LOG_PREFIX} champ-select websocket interception active`);
      } catch (error) {
        console.warn(`${LOG_PREFIX} failed champ-select websocket interception`, error);
      }
    });
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
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;color:#f2d36b;font-weight:700;">
        <span>Rift Atlas</span>
        <span>${escape(new Date().toLocaleTimeString())}</span>
      </div>
      <div><b>monitor:</b> ${monitoring?"on":"off"} | <b>bridge:</b> ${bridgeReady?"ok":"wait("+bridgeQueue.length+")"} | <b>sent:</b> ${sendCount}</div>
      <div><b>skin:</b> ${escape(currentSkin||"-")}</div>
      <div><b>event:</b> ${escape(lastEvent)}</div>
      <div><b>error:</b> ${escape(lastError||"-")}</div>
      <div style="margin-top:4px;word-break:break-word;font-size:11px;color:#9bd9f5;">${escape(lastPayload)}</div>`;
  }

  function isVisible(element) {
    if (typeof element.offsetParent === "undefined") return true;
    return element.offsetParent !== null;
  }

  function readCurrentSkin() {
    // Rose parity: the visible global skin label is the source of truth.
    // Do not read selected/center carousel items; those can still represent
    // the owned LCU skin while the main label already shows the hovered skin.
    for (const selector of SKIN_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      if (!nodes.length) continue;

      let candidate = null;

      nodes.forEach((node) => {
        const name = node.textContent.trim();
        if (!name) return;

        if (isVisible(node)) candidate = name;
        else if (!candidate) candidate = name;
      });

      if (candidate) return candidate;
    }

    return null;
  }

  let logHoverLastSkin = "";

  // Rose-style minimal skin-sync: the visible DOM name is the only source of
  // truth. We send it WITHOUT a "type" field because Rose's renderer treats a
  // payload with only {skin, originalName, timestamp} as a skin-sync and does
  // NOT require a prior champion-locked event. Rift Atlas previously tagged it
  // with type/source, which activated a strict lock gate and broke injection
  // when the lock event was late or missing.
  function sendRoseSkinSync(name, extra = {}) {
    const cleanName = sanitizeSkinName(name);
    if (!cleanName) return;
    logHoverLastSkin = cleanName;
    const localPayload = {
      type: "skin-sync",
      skin: cleanName,
      originalName: name,
      timestamp: Date.now(),
      ...extra
    };
    notifySubscribers(localPayload);
    const bridgePayload = {
      skin: cleanName,
      originalName: name,
      timestamp: localPayload.timestamp,
      ...extra
    };
    _sendRaw(bridgePayload);
    sendCount++;
    dbg("send:skin-sync");
  }

  function scheduleStableSkinSync(skinName = "") {
    const cleanName = sanitizeSkinName(skinName || readCurrentSkin() || logHoverLastSkin);
    if (!cleanName) return;
    sendRoseSkinSync(cleanName);
  }

  function logHover(skinName) {
    const cleanName = sanitizeSkinName(skinName);
    if (!cleanName) return;
    console.log(`${LOG_PREFIX} Hovered skin: ${cleanName}`);
    dbg("skin:" + cleanName);
    sendRoseSkinSync(cleanName);
  }

  function resyncSkinAfterConnect() {
    try {
      const current = readCurrentSkin();
      const name = sanitizeSkinName(current || logHoverLastSkin || lastLoggedSkin);
      if (!name) return;
      sendRoseSkinSync(name, { reconnect: true });
      dbg("skin-resync");
    } catch {
      // best-effort Rose parity
    }
  }

  function sendBridgePayload(obj) {
    try {
      const payload = { source: "rift-atlas-core", ...obj };
      lastSentPayload = payload;
      sendCount++;
      dbg("send:" + (obj.type || "data"));

      // Rose parity: only notify subscribers for INCOMING bridge messages, not outgoing.
      // Subscribers are notified when the bridge delivers data TO us, not when we send data out.
      _sendRaw(payload);
    } catch (e) {
      lastError = e.message;
      dbg("send-error");
    }
  }

  function publishLocalSkinState(state) {
    const detail = {
      name: state?.name || lastLoggedSkin || null,
      skinId: Number.isFinite(state?.skinId) ? state.skinId : null,
      championId: Number.isFinite(state?.championId) ? state.championId : null,
      hasChromas: Boolean(state?.hasChromas),
      owned: state?.owned === true,
      updatedAt: Date.now(),
      canonical: state?.canonical === true,
    };
    window.__riftAtlasSkinState = detail;
    window.dispatchEvent(new CustomEvent("rift-atlas-skin-state", { detail }));
    window.__roseSkinState = detail;
    if (detail?.name) window.__roseCurrentSkin = detail.name;
    window.dispatchEvent(new CustomEvent("lu-skin-monitor-state", { detail }));
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
      bridgeErrorLogged = false;
      bridgeSetupWarned = false;
      dbg("bridge-open");
      console.log(`[RiftAtlas Bridge] ✅ WebSocket CONECTADO a ws://127.0.0.1:${bridgePort}`);
      // Rose parity: expose bridgeEmit on open (like Rose's start() handler)
      window.__roseBridgeEmit = (payload) => sendBridgePayload(payload);
      flushBridgeQueue();
      resyncSkinAfterConnect();
      notifyReady();
    });
    bridgeSocket.addEventListener("close", () => {
      // Rose parity: keep port (don't reset to 0), just mark disconnected
      bridgeReady = false;
      bridgeSocket = null;
      dbg("bridge-close");
      if (!bridgeErrorLogged) {
        console.warn(`[RiftAtlas Bridge] ❌ WebSocket CERRADO, reintentando en ${retryDelay}ms`);
        bridgeErrorLogged = true;
      }
      scheduleRetry();
    });
    bridgeSocket.addEventListener("error", (e) => {
      lastError = e?.message || "ws-error";
      bridgeReady = false;
      dbg("bridge-err");
      if (!bridgeSetupWarned) {
        console.error(`[RiftAtlas Bridge] ⚠️ WebSocket ERROR: ${lastError}`);
        bridgeSetupWarned = true;
      }
    });
    bridgeSocket.addEventListener("message", (e) => {
      dbg("recv");
      try {
        const data = JSON.parse(e.data);
        publishCachedBridgeState(data);
        // Rose-style: accept skin-state from bridge (source="rift-atlas-bridge") OR
        // from renderer (source="rift-atlas-app"). The bridge generates skin-state
        // directly after receiving skin-sync, just like Rose's Python backend.
        if (data?.type === "skin-state") {
            const skinName = data.skinName || data.name || null;
            if (skinName) lastLoggedSkin = skinName;
            publishLocalSkinState({
              championId: Number.isFinite(data.championId) ? data.championId : null,
              skinId: Number.isFinite(data.skinId) ? data.skinId : null,
              name: skinName,
              hasChromas: Boolean(data.hasChromas),
              owned: data.isOwned?.status === "owned" || data.owned === true,
              canonical: true,
            });
        }
        // Rose-style: dispatch custom event for champion-locked (CustomWheel compatibility)
        if (data?.type === "champion-locked") {
          window.dispatchEvent(
            new CustomEvent("rose-custom-wheel-champion-locked", { detail: data })
          );
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
    // Rose-style: force re-report on monitoring restart. The DOM may still show
    // the previous skin name, but we need to send skin-sync so downstream plugins
    // (ChromaWheel) re-initialize after a phase transition reset.
    lastLoggedSkin = null;
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

  function installFindMatchObserver() {
    try {
      const performanceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name && entry.name.includes("sfx-lobby-button-find-match-hover")) {
            sendBridgePayload({ type: "find-match-hover", timestamp: Date.now() });
            dbg("find-match-hover");
          }
        }
      });
      performanceObserver.observe({ type: "resource", buffered: false });
      dbg("find-match-observer");
    } catch (err) {
      dbg("find-match-observer-err", err);
    }
  }

  function start() {
    if (!document.body) { setTimeout(start, 250); return; }
    stopped = false;
    retryDelay = RETRY_BASE_MS;
    ensureBridgeApi();
    connectBridge();
    installFindMatchObserver();
    subscribe("debug-mode", (payload = {}) => setDebugMode(payload.enabled));
    subscribe("debug-toggle", () => toggleDebugBox());
    subscribe("skip-base-skin", handleSkipBaseSkin);
    subscribe("phase-change", (payload = {}) => {
      const phase = String(payload.phase || "");
      if (!phase) return;
      lastGameflowPhase = phase;
      if (phase === "InProgress") stopMonitoring();
      else startMonitoring();
      // Rose-style: only reset on Lobby (not ChampSelect), dispatch custom event
      if (phase === "Lobby") {
        lastLoggedSkin = null;
        window.dispatchEvent(new CustomEvent("rose-custom-wheel-reset"));
      }
    });
    interceptChampSelectWebsocket();
    startMonitoring();
  }

  function stop() {
    stopped = true;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
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

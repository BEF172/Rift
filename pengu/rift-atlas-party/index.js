/**
 * @name Rift Atlas Rose Copy
 * @author Rift Atlas
 * @description Rose-style UI unlocker + skin monitor for Pengu Loader.
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

(function startRiftAtlasSkinMonitor() {
  const LOG_PREFIX = "[RiftAtlas]";
  const DEBUG = true;
  const DEBUG_BOX_ID = "rift-atlas-debug-box";
  const SKIN_SELECTORS = [
    ".skin-name-text",
    ".skin-name"
  ];
  const POLL_INTERVAL_MS = 250;
  const RETRY_BASE_MS = 1000;
  const RETRY_MAX_MS = 30000;
  const FALLBACK_PORT = 45731;

  let lastLoggedSkin = null;
  let championLockAnnounced = false;
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
  let bridgePort = FALLBACK_PORT;
  let lastWsSkinId = null;
  let lastWsChampId = null;
  let useExternalBridge = false; // true when SkinMonitor owns window.__roseBridge

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

  function notifyReady() {
    for (const cb of readyCallbacks) {
      try { cb(); } catch (e) { console.warn(`${LOG_PREFIX} onReady error:`, e); }
    }
  }

  function ensureBridgeApi() {
    if (window.__roseBridge) {
      useExternalBridge = true;
      bridgeReady = true;
      notifyReady();
      console.log(`${LOG_PREFIX} Using existing window.__roseBridge (SkinMonitor mode)`);
      return;
    }

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

  function _sendRaw(payload) {
    const raw = JSON.stringify(payload);
    if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
      bridgeQueue.push(raw);
      connectBridge();
      return;
    }
    bridgeSocket.send(raw);
  }

  function ensureDebugBox() {
    if (!DEBUG) return null;
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
      "pointer-events:none","white-space:normal"
    ].join(";");
    document.body?.appendChild(box);
    return box;
  }

  function dbg(event, error) {
    if (!DEBUG) return;
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

    const centerItem = document.querySelector(".skin-selection-item.skin-carousel-offset-2");
    if (centerItem) {
      const els = centerItem.querySelectorAll("*");
      const texts = [];
      els.forEach((el) => {
        const t = (el.textContent || "").trim();
        if (t.length > 3 && !/^[\d\s%]+$/.test(t) && !el.closest("script,style")) texts.push(t);
      });
      if (texts.length) {
        return texts.sort((a, b) => b.length - a.length)[0];
      }

      const dataSkinId = centerItem.getAttribute("data-skin-id");
      const thumb = centerItem.querySelector(".skin-selection-thumbnail");
      if (thumb) {
        const bg = thumb.style.backgroundImage || window.getComputedStyle(thumb).backgroundImage;
        const m = bg.match(/champion-splashes\/(\d+)\/(\d+)\.jpg/);
        if (m) return `champion-${m[1]}-skin-${dataSkinId || m[2]}`;
      }
    }

    return null;
  }

  function logHover(skinName) {
    const cleanName = String(skinName || "").trim();
    if (!cleanName) return;
    console.log(`${LOG_PREFIX} Hovered skin: ${cleanName}`);
    dbg("skin:" + cleanName);
    sendBridgePayload({ type: "skin-sync", skin: cleanName, timestamp: Date.now() });
  }

  function sendBridgePayload(obj) {
    try {
      const payload = { source: "rift-atlas-party", ...obj };
      lastSentPayload = payload;
      sendCount++;
      dbg("send:" + (obj.type || "data"));

      if (useExternalBridge && window.__roseBridge?.send) {
        window.__roseBridge.send(payload);
        return;
      }

      _sendRaw(payload);
    } catch (e) {
      lastError = e.message;
      dbg("send-error");
    }
  }

  function connectBridge() {
    if (useExternalBridge) return;
    if (stopped || bridgeSocket?.readyState === WebSocket.OPEN || bridgeSocket?.readyState === WebSocket.CONNECTING) return;
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
      while (bridgeQueue.length) {
        const p = bridgeQueue.shift();
        try { bridgeSocket.send(p); } catch (e) { bridgeQueue.unshift(p); break; }
      }
      notifyReady();
    });
    bridgeSocket.addEventListener("close", () => { bridgeReady = false; dbg("bridge-close"); scheduleRetry(); });
    bridgeSocket.addEventListener("error", (e) => { lastError = e?.message || "ws-error"; bridgeReady = false; dbg("bridge-err"); });
    bridgeSocket.addEventListener("message", (e) => {
      dbg("recv");
      try {
        const data = JSON.parse(e.data);
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

  function handleSkinSelectorInfo(data) {
    if (!data || typeof data.selectedSkinId !== "number") return;
    const skinId = data.selectedSkinId > 0 ? data.selectedSkinId : null;

    let championId = data.championId || null;
    if (!championId && skinId > 0) championId = Math.floor(skinId / 1000);
    if (!skinId && !championId) return;

    const skinChanged = skinId !== lastWsSkinId;
    const champChanged = championId !== lastWsChampId;
    if (!skinChanged && !champChanged) return;

    lastWsSkinId = skinId;
    lastWsChampId = championId;

    if (!championLockAnnounced && skinId) {
      championLockAnnounced = true;
      sendBridgePayload({ type: "champion-locked", locked: true });
    }

    const name = readCurrentSkin() || null;
    console.log(`${LOG_PREFIX} WS skin: id=${skinId}, champ=${championId}, name="${name}"`);

    const state = { championId, skinId, name };
    window.__riftAtlasSkinState = state;
    window.dispatchEvent(new CustomEvent("rift-atlas-skin-state", { detail: state }));
    window.__roseSkinState = state;
    window.dispatchEvent(new CustomEvent("lu-skin-monitor-state", { detail: state }));
    sendBridgePayload({ type: "skin-state", championId, skinId, name });

    if (name && name !== lastLoggedSkin) {
      lastLoggedSkin = name;
      logHover(name);
    }
  }

  function interceptChampSelectWs() {
    if (typeof window.rcp?.postInit !== "function") {
      console.warn(`${LOG_PREFIX} rcp.postInit not available`);
      return;
    }
    window.rcp.postInit("rcp-fe-lol-champ-select", (api) => {
      try {
        const ws = api.champSelectBinding.socket._websocket;
        const orig = ws.onmessage;
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
          return orig.call(this, event);
        };
        console.log(`${LOG_PREFIX} ChampSelect WS intercepted`);
      } catch (e) {
        console.warn(`${LOG_PREFIX} Failed to intercept ChampSelect WS:`, e);
      }
    });
  }

  async function fetchSessionSkin() {
    if (stopped) return;
    try {
      const resp = await window.fetch("/lol-champ-select/v1/session", { credentials: "include" });
      if (!resp.ok) return;
      const session = await resp.json();
      const myCellId = session.localPlayerCellId;
      const myAction = session.actions?.flat()?.find(
        (a) => a.actorCellId === myCellId && a.type === "pick"
      );
      if (!myAction || !myAction.championId) return;

      const championId = myAction.championId;
      const rawSkinId = myAction.skinId || 0;
      if (rawSkinId === 0) return;
      const skinId = rawSkinId > 0 ? rawSkinId : null;

      const skinChanged = skinId && skinId !== lastWsSkinId;
      const champChanged = championId !== lastWsChampId;
      if (!skinChanged && !champChanged) return;

      lastWsSkinId = skinId;
      lastWsChampId = championId;

      if (!championLockAnnounced && skinId) {
        championLockAnnounced = true;
        sendBridgePayload({ type: "champion-locked", locked: true });
      }

      const name = readCurrentSkin() || null;
      if (skinChanged || champChanged) {
        console.log(`${LOG_PREFIX} Session skin: id=${skinId}, champ=${championId}, name="${name}"`);
      }

      const state = { championId, skinId, name };
      window.__riftAtlasSkinState = state;
      window.dispatchEvent(new CustomEvent("rift-atlas-skin-state", { detail: state }));
      window.__roseSkinState = state;
      window.dispatchEvent(new CustomEvent("lu-skin-monitor-state", { detail: state }));
      sendBridgePayload({ type: "skin-state", championId, skinId, name });

      if (name && name !== lastLoggedSkin) {
        lastLoggedSkin = name;
        logHover(name);
      }
    } catch { /* ignore */ }
  }

  function start() {
    if (!document.body) { setTimeout(start, 250); return; }
    stopped = false;
    retryDelay = RETRY_BASE_MS;
    if (window.__roseBridge && window.__roseBridge.port) {
      bridgePort = window.__roseBridge.port;
    }
    ensureBridgeApi();
    connectBridge();
    startMonitoring();
    interceptChampSelectWs();
    setInterval(fetchSessionSkin, 3000);
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

# Plan: Fix Intermittent DLL Injection Failure

## Bug A: Rust ticker corrupts phase after game starts

**File:** `src/renderer.js`, lines 926-927

**Problem:** When Rust ticker resolves AFTER GameStart, it unconditionally overwrites `penguGameflowPhase = "FINALIZATION"`.

**Change:** Replace lines 926-927:
OLD:
```js
      if (generation !== roseLocalTickerGeneration || !result?.ready) return;
      state.penguGameflowPhase = "FINALIZATION";
```
NEW:
```js
      if (generation !== roseLocalTickerGeneration || !result?.ready) return;
      const tickerPhase = String(state.penguGameflowPhase || "");
      if (tickerPhase && !["ChampSelect", "FINALIZATION"].includes(tickerPhase)) {
        window.riftAtlas.appendOverlayLog(`[RoseTicker] ticker resuelto DEMASIADO TARDE; fase=${tickerPhase}. Abortando.`).catch(() => { });
        return;
      }
      state.penguGameflowPhase = "FINALIZATION";
```

---

## Bug D: No game-running detection before injection

**File:** `src/renderer.js`, after line 871

**Change:** Add after `if (state.lastHoverWritten || state.roseFinalizationCommitted || state.roseFinalizationApplyStarted || state.importingQueue || state.overlayRunning) return false;`:
```js
  const injectPhase = String(state.penguGameflowPhase || "");
  if (injectPhase && !["ChampSelect", "FINALIZATION"].includes(injectPhase)) {
    window.riftAtlas.appendOverlayLog(`[Rose] FINALIZATION apply saltado: fase=${injectPhase} (${reason}).`).catch(() => { });
    return false;
  }
```

---

## Fix 3: Move 300ms delay AFTER resume

**File:** `src-tauri/src/rose_overlay.rs`, lines 500-514

**Problem:** Sleep is BEFORE resume. Game frozen → DLL cant execute. Delay useless.

**Change:** Replace lines 500-514:
OLD:
```rust
            // ... old comment ...
            std::thread::sleep(Duration::from_millis(300));
            overlay::stop_early_monitor(&state.early_monitor_active, &state.early_monitor_pid, &state.early_monitor_runoverlay_started);
            overlay::append_overlay_log("[Engine] runoverlay started; early monitor stopped (resume_game equivalent).");
```
NEW:
```rust
            // Resume the frozen game first, then sleep to give the DLL time
            // to install CreateFileA hooks before League loads WADs.
            // DllMain runs when process is RESUMED, not while suspended.
            overlay::stop_early_monitor(&state.early_monitor_active, &state.early_monitor_pid, &state.early_monitor_runoverlay_started);
            overlay::append_overlay_log("[Engine] game resumed; esperando DLL hook (300ms).");
            std::thread::sleep(Duration::from_millis(300));
```

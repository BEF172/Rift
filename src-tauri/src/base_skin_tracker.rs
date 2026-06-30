//! Base Skin Confirmation Tracker
//!
//! Tracks the time between forcing a base skin (LCU PATCH) and receiving
//! the WebSocket confirmation that the skin was applied. Persists samples
//! to disk so the UI can recommend a threshold value based on real data.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use serde::{Deserialize, Serialize};

const MAX_SAMPLES: usize = 50;
const MAX_CONFIRMATION_S: f64 = 10.0;

struct TrackerState {
    pending_skin_id: Option<u64>,
    pending_start: Option<Instant>,
}

static STATE: Mutex<TrackerState> = Mutex::new(TrackerState {
    pending_skin_id: None,
    pending_start: None,
});

#[derive(Serialize, Deserialize, Clone)]
struct Sample {
    elapsed_ms: u64,
    confirmed: bool,
    ts: u64,
}

fn data_path() -> PathBuf {
    let dir = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    dir.join("Rift Atlas").join("base_skin_samples.json")
}

fn load_samples() -> Vec<Sample> {
    let path = data_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(samples) = serde_json::from_str::<Vec<Sample>>(&content) {
            return samples.into_iter().rev().take(MAX_SAMPLES).collect();
        }
    }
    Vec::new()
}

fn save_samples(samples: &[Sample]) {
    let path = data_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let recent: Vec<&Sample> = samples.iter().rev().take(MAX_SAMPLES).collect();
    let _ = std::fs::write(&path, serde_json::to_string(&recent).unwrap_or_default());
}

pub fn start_tracking(target_skin_id: u64) {
    let mut state = STATE.lock().unwrap();
    state.pending_skin_id = Some(target_skin_id);
    state.pending_start = Some(Instant::now());
    eprintln!("[TRACKER] Tracking base skin confirmation for skinId={}", target_skin_id);
}

pub fn on_skin_confirmed(skin_id: u64) -> Option<f64> {
    let mut state = STATE.lock().unwrap();
    if state.pending_skin_id != Some(skin_id) {
        return None;
    }

    let elapsed = state.pending_start.map(|s| s.elapsed().as_secs_f64()).unwrap_or(0.0);
    let target = state.pending_skin_id.unwrap_or(0);
    state.pending_skin_id = None;
    state.pending_start = None;

    if elapsed > MAX_CONFIRMATION_S {
        eprintln!(
            "[TRACKER] Discarding stale confirmation (skinId={}) after {:.1}s (>{}s)",
            target, elapsed, MAX_CONFIRMATION_S
        );
        return None;
    }

    eprintln!(
        "[TRACKER] Base skin confirmed (skinId={}) in {:.3}s",
        target, elapsed
    );

    let sample = Sample {
        elapsed_ms: (elapsed * 1000.0) as u64,
        confirmed: true,
        ts: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    };

    let mut samples = load_samples();
    samples.push(sample);
    save_samples(&samples);

    Some(elapsed)
}

pub fn on_champ_select_exit() -> Option<f64> {
    let mut state = STATE.lock().unwrap();
    if state.pending_skin_id.is_none() {
        return None;
    }

    let elapsed = state.pending_start.map(|s| s.elapsed().as_secs_f64()).unwrap_or(0.0);
    let target = state.pending_skin_id.unwrap_or(0);

    // If the PATCH was sent less than 200ms ago, the forceLcuSkinSelection is
    // likely still in-flight.  Don't clobber pending — let on_skin_confirmed
    // record the real sample instead.
    if elapsed < 0.2 {
        eprintln!(
            "[TRACKER] on_champ_select_exit deferring (skinId={}) — PATCH only {:.0}ms old, waiting for confirmation.",
            target, elapsed * 1000.0
        );
        return None;
    }

    state.pending_skin_id = None;
    state.pending_start = None;

    eprintln!(
        "[TRACKER] Base skin confirmation TIMED OUT (skinId={}) after {:.3}s",
        target, elapsed
    );

    let sample = Sample {
        elapsed_ms: (elapsed * 1000.0) as u64,
        confirmed: false,
        ts: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    };

    let mut samples = load_samples();
    samples.push(sample);
    save_samples(&samples);

    Some(elapsed)
}

#[derive(Serialize)]
pub struct TrackerStats {
    pub total_samples: usize,
    pub confirmed_count: usize,
    pub timeout_count: usize,
    pub avg_ms: Option<u64>,
    pub p90_ms: Option<u64>,
    pub max_ms: Option<u64>,
    pub recommended_threshold_ms: Option<u64>,
}

pub fn get_stats() -> serde_json::Value {
    let samples = load_samples();
    let confirmed: Vec<&Sample> = samples.iter().filter(|s| s.confirmed).collect();
    let timeouts: Vec<&Sample> = samples.iter().filter(|s| !s.confirmed).collect();

    if confirmed.is_empty() {
        return serde_json::json!({
            "total_samples": samples.len(),
            "confirmed_count": 0,
            "timeout_count": timeouts.len(),
            "avg_ms": null,
            "p90_ms": null,
            "max_ms": null,
            "recommended_threshold_ms": null,
        });
    }

    let mut times: Vec<u64> = confirmed.iter().map(|s| s.elapsed_ms).collect();
    times.sort();

    let avg = times.iter().sum::<u64>() / times.len() as u64;
    let p90_idx = ((times.len() as f64 * 0.9) as usize).saturating_sub(1);
    let p90 = times[p90_idx];
    let max_ms = *times.last().unwrap_or(&0);

    // Recommended = p90 + 30% buffer, floored at 300ms, capped at 2000ms
    let recommended = ((p90 as f64 * 1.3) as u64).max(300).min(2000);

    serde_json::json!({
        "total_samples": samples.len(),
        "confirmed_count": confirmed.len(),
        "timeout_count": timeouts.len(),
        "avg_ms": avg,
        "p90_ms": p90,
        "max_ms": max_ms,
        "recommended_threshold_ms": recommended,
    })
}

pub fn clear_samples() {
    let path = data_path();
    if path.exists() {
        let _ = std::fs::write(&path, "[]");
    }
    eprintln!("[TRACKER] Samples cleared");
}

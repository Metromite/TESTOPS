#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Dispatch OPS desktop shell.
//
// PERMANENT ARCHITECTURE (Supabase migration): this app has no login, no
// "Live Connection" concept, no user-facing API URL configuration, and -
// as of this migration - no local backend process at all. The Tauri
// window loads the frontend, and the frontend talks directly to Supabase
// over HTTPS/WSS using the anon key baked in at build time (see
// frontend/src/lib/supabase.ts). This file's only remaining job is:
//
//   1. Open the window. Nothing gates this - no backend to wait for,
//      spawn, or diagnose (the previous version of this file spawned
//      a bundled application-server executable as a managed child process; that entire
//      mechanism - backend_candidates(), find_backend_exe(),
//      backend_diagnostics, the stdout/stderr pump threads, the
//      on_window_event kill-on-close handler - is deleted, not disabled,
//      because there is no longer a child process to manage).
//   2. Expose read_local_config/write_local_config: a small local JSON
//      file for genuinely local-only preferences (e.g. last window
//      size/position, cached last-known-good data for the offline view -
//      architecture brief section 13). This has NOTHING to do with
//      OneDrive/shared-folder sync anymore - that entire concept is
//      gone, replaced by Supabase Realtime. Kept as a generic local
//      key/value file because it's still a reasonable place for
//      genuinely local settings to live, with zero dependency on
//      anything being reachable.
//
// NOTE: this file could not be compiled or run in the sandbox this
// project was assembled in (no Rust/Cargo/Windows toolchain available
// there). It is written to compile against Tauri v2's documented APIs,
// but it has not been build-verified. Treat the first `cargo tauri
// build` on a real Windows/Rust machine as the first real test of this
// file - same caveat as before, just a much smaller file to go wrong in
// now that the backend-sidecar logic is gone entirely.

use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use serde_json::{json, Map, Value};

fn dirs_home() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(PathBuf::from)
}

/// Same resolution rule the old version of this file used (override env
/// var, then %LOCALAPPDATA%, then %APPDATA%, then the user's home dir,
/// then a `DispatchOPS` subfolder) - kept identical so an existing
/// install's local prefs aren't orphaned by this migration.
fn app_data_dir() -> PathBuf {
    let base = std::env::var("DISPATCHOPS_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let root = std::env::var("LOCALAPPDATA")
                .or_else(|_| std::env::var("APPDATA"))
                .ok()
                .map(PathBuf::from)
                .or_else(dirs_home)
                .unwrap_or_else(|| PathBuf::from("."));
            root.join("DispatchOPS")
        });
    let _ = std::fs::create_dir_all(&base);
    base
}

fn local_config_path() -> PathBuf {
    app_data_dir().join("local_config.json")
}

/// Reads the local config file, returning an empty JSON object if it
/// doesn't exist yet or can't be parsed - never an error, since this is
/// meant to be safe to call before anything has ever been written.
#[tauri::command]
fn read_local_config() -> Value {
    match std::fs::read_to_string(local_config_path()) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| Value::Object(Map::new())),
        Err(_) => Value::Object(Map::new()),
    }
}

/// Merges `patch` into the existing local config and writes it back
/// atomically (write to a temp file, then rename - so a crash or power
/// loss mid-write can never leave a half-written, unparsable config file
/// behind). Every key in `patch` overwrites the same key in the existing
/// file; every other existing key is kept.
#[tauri::command]
fn write_local_config(patch: Value) -> Result<Value, String> {
    let mut current = match std::fs::read_to_string(local_config_path()) {
        Ok(text) => serde_json::from_str::<Value>(&text).unwrap_or_else(|_| Value::Object(Map::new())),
        Err(_) => Value::Object(Map::new()),
    };
    let current_obj = current.as_object_mut().ok_or("local config is not a JSON object")?;
    if let Some(patch_obj) = patch.as_object() {
        for (k, v) in patch_obj {
            current_obj.insert(k.clone(), v.clone());
        }
    } else {
        return Err("patch must be a JSON object".to_string());
    }

    let path = local_config_path();
    let tmp_path = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&current).map_err(|e| e.to_string())?;
    std::fs::write(&tmp_path, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &path).map_err(|e| e.to_string())?;
    Ok(current)
}


#[derive(Deserialize)]
struct ExportPayload {
    filename: String,
    base64_data: String,
}

fn export_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("DISPATCHOPS_EXPORT_DIR") {
        let path = PathBuf::from(custom);
        let _ = std::fs::create_dir_all(&path);
        return path;
    }
    // Keep exports beside the running DispatchOPS executable. This makes the
    // export folder portable with the app and avoids writing into Downloads.
    // If the executable location is unavailable (dev/test), fall back to the
    // current working directory.
    let path = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."));
    let _ = std::fs::create_dir_all(&path);
    path
}

fn safe_export_filename(name: &str) -> String {
    Path::new(name)
        .file_name()
        .and_then(|x| x.to_str())
        .unwrap_or("DispatchOPS_Export.xlsx")
        .chars()
        .map(|c| if r#"<>:\\|?*\""#.contains(c) { '_' } else { c })
        .collect()
}

fn collision_safe_path(dir: &Path, filename: &str) -> PathBuf {
    let first = dir.join(filename);
    if !first.exists() { return first; }
    let p = Path::new(filename);
    let stem = p.file_stem().and_then(|x| x.to_str()).unwrap_or("DispatchOPS_Export");
    let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("xlsx");
    for i in 2..10_000 {
        let candidate = dir.join(format!("{} ({i}).{}", stem, ext));
        if !candidate.exists() { return candidate; }
    }
    dir.join(format!("{}_{}.{}", stem, std::process::id(), ext))
}

#[tauri::command]
fn get_export_folder() -> String {
    export_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn save_export_file(payload: ExportPayload) -> Result<Value, String> {
    let bytes = STANDARD.decode(payload.base64_data.as_bytes()).map_err(|e| format!("Invalid export data: {e}"))?;
    let dir = export_dir();
    let filename = safe_export_filename(&payload.filename);
    let path = collision_safe_path(&dir, &filename);
    std::fs::write(&path, &bytes).map_err(|e| format!("Could not save export: {e}"))?;
    Ok(json!({ "path": path.to_string_lossy(), "bytes": bytes.len() }))
}

#[derive(Deserialize)]
struct ExportAttachment {
    filename: String,
    base64_data: String,
}

#[derive(Deserialize)]
struct ExportBundlePayload {
    filename: String,
    base64_data: String,
    attachments_dir: String,
    attachments: Vec<ExportAttachment>,
}

#[tauri::command]
fn save_export_bundle(payload: ExportBundlePayload) -> Result<Value, String> {
    let bytes = STANDARD.decode(payload.base64_data.as_bytes()).map_err(|e| format!("Invalid Excel data: {e}"))?;
    let dir = export_dir();
    let filename = safe_export_filename(&payload.filename);
    let path = collision_safe_path(&dir, &filename);
    std::fs::write(&path, &bytes).map_err(|e| format!("Could not save Excel export: {e}"))?;
    let attachment_folder_name = payload.attachments_dir.chars().map(|c| if r#"<>:\\|?*\""#.contains(c) { '_' } else { c }).collect::<String>();
    let attachment_dir = dir.join(attachment_folder_name);
    std::fs::create_dir_all(&attachment_dir).map_err(|e| format!("Could not create attachment folder: {e}"))?;
    let mut saved = 0usize;
    for a in payload.attachments {
        let safe = safe_export_filename(&a.filename);
        let ap = collision_safe_path(&attachment_dir, &safe);
        let ab = STANDARD.decode(a.base64_data.as_bytes()).map_err(|e| format!("Invalid attachment data: {e}"))?;
        std::fs::write(ap, ab).map_err(|e| format!("Could not save attachment: {e}"))?;
        saved += 1;
    }
    Ok(json!({"path": path.to_string_lossy(), "bytes": bytes.len(), "attachments": saved, "attachments_dir": attachment_dir.to_string_lossy()}))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_local_config, write_local_config, get_export_folder, save_export_file, save_export_bundle])
        .run(tauri::generate_context!())
        .expect("error while running Dispatch OPS");
}

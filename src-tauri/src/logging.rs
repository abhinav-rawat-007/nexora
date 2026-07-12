use std::fs::{self, OpenOptions};
use std::io::Write;
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager};

static LOG_FILE: OnceLock<Mutex<std::fs::File>> = OnceLock::new();

/// Opens (or creates) `controller-debug.log` in the app data dir and keeps a handle around for
/// `log()` to append to. Writing to a file (rather than just `println!`) matters here because a
/// release build has no attached console, so stdout is otherwise unrecoverable - the player needs
/// to be able to find and send this file back to us.
pub fn init(app: &AppHandle) {
  let Ok(dir) = app.path().app_data_dir() else { return };
  if fs::create_dir_all(&dir).is_err() {
    return;
  }
  let path = dir.join("controller-debug.log");
  // The file appends for the app's whole life and nothing else ever cleans it up; roll it
  // aside once it gets big so long-lived installs don't accumulate an ever-growing log while
  // still keeping one previous generation around for diagnostics.
  const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
  if fs::metadata(&path).map(|meta| meta.len() > MAX_LOG_BYTES).unwrap_or(false) {
    let rolled = dir.join("controller-debug.log.old");
    let _ = fs::remove_file(&rolled);
    let _ = fs::rename(&path, &rolled);
  }
  if let Ok(file) = OpenOptions::new().create(true).append(true).open(&path) {
    let _ = LOG_FILE.set(Mutex::new(file));
    log(&format!("=== Nexora starting, logging controller diagnostics to {} ===", path.display()));
  }
}

pub fn log(msg: &str) {
  let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S%.3f");
  let line = format!("[{now}] {msg}");
  println!("{line}");
  if let Some(mutex) = LOG_FILE.get() {
    if let Ok(mut file) = mutex.lock() {
      let _ = writeln!(file, "{line}");
      let _ = file.flush();
    }
  }
}

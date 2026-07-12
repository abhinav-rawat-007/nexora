use chrono::Utc;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{
  collections::{HashSet, VecDeque},
  path::{Path, PathBuf},
  process::Child,
  sync::{Arc, Mutex},
  thread,
  time::{Duration, Instant},
};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

use crate::logging::log;
use crate::models::AppState;

const POLL_INTERVAL: Duration = Duration::from_secs(3);
/// How long the tracked process(es) have to stay gone before a session is considered over -
/// smooths over a brief helper/crash-handler window between the real game exiting and the
/// player being "done", without inflating playtime for a genuinely closed game.
const END_DEBOUNCE: Duration = Duration::from_secs(10);
/// How long we'll wait for a launcher stub to hand off to the real game process (Riot Client,
/// Epic's protocol handler) before giving up on tracking this particular launch.
const START_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSession {
  pub game_id: String,
  pub started_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionStartedEvent {
  game_id: String,
  started_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionEndedEvent {
  game_id: String,
  playtime_minutes: i64,
  last_played_at: String,
}

fn begin_session(app: &AppHandle, state: &AppState, game_id: &str) -> chrono::DateTime<Utc> {
  let started = Utc::now();
  if let Ok(mut sessions) = state.sessions.lock() {
    sessions.insert(game_id.to_string(), started);
  }
  log(&format!("playtime: session started game_id={game_id}"));
  let _ = app.emit(
    "game-session-started",
    SessionStartedEvent { game_id: game_id.into(), started_at: started.to_rfc3339() },
  );
  started
}

/// `accumulate` is false for Steam games: they still get the live "Playing" indicator (this
/// function starting/ending a session either way), but never a playtime write, since Steam's own
/// localconfig.vdf (see sync_steam) is the authoritative total and a re-sync would otherwise
/// disagree with whatever we added here.
fn end_session(
  app: &AppHandle,
  db: &Arc<Mutex<Connection>>,
  state: &AppState,
  game_id: &str,
  started: chrono::DateTime<Utc>,
  accumulate: bool,
) {
  let ended = Utc::now();
  let minutes = (ended - started).num_minutes().max(0);
  if let Ok(mut sessions) = state.sessions.lock() {
    sessions.remove(game_id);
  }
  let (playtime_minutes, last_played_at) = match db.lock() {
    Ok(conn) => {
      if accumulate {
        let _ = conn.execute(
          "update games set playtime_minutes = coalesce(playtime_minutes, 0) + ?2, last_played_at = ?3,
           updated_at = datetime('now') where id = ?1",
          params![game_id, minutes, ended.to_rfc3339()],
        );
      }
      conn
        .query_row("select playtime_minutes, last_played_at from games where id = ?1", params![game_id], |row| {
          Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .ok()
        .unwrap_or((None, None))
    }
    Err(_) => (None, None),
  };
  let playtime_minutes = playtime_minutes.unwrap_or(minutes);
  let last_played_at = last_played_at.unwrap_or_else(|| ended.to_rfc3339());
  log(&format!(
    "playtime: session ended game_id={game_id} minutes={minutes} accumulate={accumulate} total={playtime_minutes}"
  ));
  let _ = app.emit(
    "game-session-ended",
    SessionEndedEvent { game_id: game_id.into(), playtime_minutes, last_played_at },
  );
}

/// The folder any process belonging to this game should live under, so playtime tracking never
/// needs the player to name anything. Prefers the game's own install folder (works even when the
/// process Nexora spawned is a shared launcher stub elsewhere, e.g. Riot Client) and falls back to
/// the directory of a direct exe launch when no install path was recorded.
pub fn install_root(install_path: Option<&str>, exe_launch_target: Option<&str>) -> Option<PathBuf> {
  let install_path = install_path.map(str::trim).filter(|value| !value.is_empty());
  if let Some(install_path) = install_path {
    let path = Path::new(install_path);
    // A stored "install path" is sometimes actually the exe itself (manual games typed directly
    // into the field rather than browsed) rather than its containing folder.
    return if path.extension().is_some() { path.parent().map(PathBuf::from) } else { Some(path.to_path_buf()) };
  }
  exe_launch_target.map(str::trim).filter(|value| !value.is_empty()).and_then(|target| Path::new(target).parent().map(PathBuf::from))
}

fn under_root(exe: &Path, root: &Path) -> bool {
  let exe = exe.to_string_lossy().to_lowercase();
  let root = root.to_string_lossy().to_lowercase();
  !root.is_empty() && exe.starts_with(&root)
}

/// How long a one-off directory walk is allowed to run before giving up on finding more .exe
/// names - keeps a launch with a huge or slow (network/external drive) install folder from
/// blocking tracking indefinitely, at the cost of possibly missing an exe buried deep past the
/// budget on those installs.
const SCAN_BUDGET: Duration = Duration::from_secs(5);

/// Every .exe filename found anywhere under `root`, lowercased. Used instead of (or alongside)
/// matching a live process's own reported path, because some anti-cheat drivers (Riot's
/// Vanguard, for Valorant/League) block third-party processes - including Nexora - from reading
/// a protected process's full image path even though its name is still visible to every process
/// on the system, so path-based matching alone silently never fires for those titles.
fn executable_names_under(root: &Path) -> HashSet<String> {
  let mut names = HashSet::new();
  let mut queue = VecDeque::new();
  queue.push_back(root.to_path_buf());
  let deadline = Instant::now() + SCAN_BUDGET;

  while let Some(dir) = queue.pop_front() {
    if Instant::now() >= deadline {
      break;
    }
    let Ok(entries) = std::fs::read_dir(&dir) else { continue };
    for entry in entries.flatten() {
      let path = entry.path();
      if path.is_dir() {
        queue.push_back(path);
      } else if path.extension().map(|ext| ext.eq_ignore_ascii_case("exe")).unwrap_or(false) {
        if let Some(name) = path.file_name() {
          names.insert(name.to_string_lossy().to_lowercase());
        }
      }
    }
  }
  names
}

/// Tracks a play session automatically, with nothing for the player to configure: any process
/// whose executable lives under the game's install folder counts as "the game", which covers
/// both a directly-spawned exe (manual games, GOG, Battle.net) and titles launched through a
/// shared client that hands off to (and often outlives) a separate real game process - Riot
/// Client for Valorant/League, Epic's protocol launch, Xbox's shell:appsFolder, and Steam's own
/// steam:// URIs. Falls back to simply following the spawned process itself when there's no
/// install path to scope by. `accumulate` controls whether the session's length gets added to
/// `playtime_minutes` on exit - see `end_session`.
pub fn track_launch(
  app: AppHandle,
  state: AppState,
  game_id: String,
  install_path: Option<String>,
  exe_launch_target: Option<String>,
  initial_child: Option<Child>,
  accumulate: bool,
) {
  thread::spawn(move || {
    let root = install_root(install_path.as_deref(), exe_launch_target.as_deref());
    if root.is_none() && initial_child.is_none() {
      log(&format!("playtime: nothing to track for game_id={game_id} (no install path, no spawned process)"));
      return;
    }
    let executable_names = root.as_deref().map(executable_names_under).unwrap_or_default();

    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let before: HashSet<Pid> = system.processes().keys().copied().collect();

    let mut child = initial_child;
    let mut tracked: HashSet<Pid> = HashSet::new();
    // Seed with the process we spawned ourselves, regardless of the "new since launch" check
    // below - by the time this thread takes its first snapshot, that process has already been
    // running for a moment and would otherwise be wrongly filtered out as "not new".
    if let Some(current) = &child {
      tracked.insert(Pid::from_u32(current.id()));
    }
    let mut started: Option<chrono::DateTime<Utc>> = None;
    let mut empty_since: Option<Instant> = None;
    let mut waited = Duration::ZERO;

    loop {
      thread::sleep(POLL_INTERVAL);

      if let Some(current) = child.as_mut() {
        if matches!(current.try_wait(), Ok(Some(_))) {
          child = None;
        }
      }

      system.refresh_processes(ProcessesToUpdate::All, true);
      tracked.retain(|pid| system.process(*pid).is_some());

      match &root {
        Some(root) => {
          for (pid, process) in system.processes() {
            if before.contains(pid) || tracked.contains(pid) {
              continue;
            }
            let name_matches = executable_names.contains(&process.name().to_string_lossy().to_lowercase());
            let path_matches = process.exe().map(|exe| under_root(exe, root)).unwrap_or(false);
            if name_matches || path_matches {
              tracked.insert(*pid);
            }
          }
        }
        None => {
          // No install path recorded at all - the only thing we can follow is the process we
          // spawned directly.
          if let Some(current) = &child {
            tracked.insert(Pid::from_u32(current.id()));
          }
        }
      }

      if !tracked.is_empty() {
        empty_since = None;
        if started.is_none() {
          started = Some(begin_session(&app, &state, &game_id));
        }
        continue;
      }

      if let Some(session_start) = started {
        let empty_start = *empty_since.get_or_insert_with(Instant::now);
        if empty_start.elapsed() >= END_DEBOUNCE {
          end_session(&app, &state.db, &state, &game_id, session_start, accumulate);
          return;
        }
      } else {
        waited += POLL_INTERVAL;
        if waited >= START_TIMEOUT {
          log(&format!("playtime: no trackable process ever appeared for game_id={game_id}, giving up"));
          return;
        }
      }
    }
  });
}

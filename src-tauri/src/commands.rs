use chrono::Utc;
use rusqlite::{params, Connection};
use std::sync::{Arc, Mutex};
use std::{fs, path::Path, process::Command};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::State;
use uuid::Uuid;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use crate::battlenet::discover_battlenet_games;
use crate::controller::trigger_test_vibration;
use crate::db::{
  delete_synced_game, get_game, list_games, read_settings, reconcile_source, set_favorite, steam_details_cache,
  upsert_synced_game,
};
use crate::epic::discover_epic_games;
use crate::error::{NexoraError, Result};
use crate::gog::discover_gog_games;
use crate::logging::log;
use crate::models::{
  AppSettings, AppState, Game, GameMetadataLookup, ManualGamePayload, SourceSyncSummary, SteamDetails, SyncResult,
  SyncedGame,
};
use crate::playtime::{track_launch, ActiveSession};
use crate::riot::discover_riot_games;
use crate::steam::{
  build_steam_game, discover_steam, discover_steam_libraries, ensure_steam_running,
  fetch_steam_details_bulk, lookup_store_details_by_title, parse_local_manifest, read_steam_playtimes,
};
use crate::steamgriddb::{fetch_artwork, fetch_artwork_bulk};
use crate::util::{empty_option_to_none, empty_to_none, split_args};
use crate::xbox::discover_xbox_games;

#[tauri::command]
pub fn get_games(state: State<AppState>) -> Result<Vec<Game>> {
  let db = state.db.lock().map_err(|_| NexoraError::Message("Database lock failed".into()))?;
  list_games(&db)
}

fn lock_db(db: &Arc<Mutex<Connection>>) -> Result<std::sync::MutexGuard<'_, Connection>> {
  db.lock().map_err(|_| NexoraError::Message("Database lock failed".into()))
}

/// Gathers every installed Steam app's manifest (cheap, local-disk only), then resolves store
/// details for just the appids that don't already have a cached copy from a previous sync -
/// in parallel, across a worker pool (see `fetch_steam_details_bulk`). The DB mutex is only
/// taken for the initial cache read and the final per-game upserts - both fast, local
/// operations - and is released while the (potentially slow) network requests are in flight,
/// so a sync no longer holds up every other command for its full duration.
fn sync_steam(db: &Arc<Mutex<Connection>>) -> Result<usize> {
  let steam = discover_steam()?;
  let libraries = discover_steam_libraries(&steam);
  let playtimes = read_steam_playtimes(&steam);

  let mut locals = Vec::new();
  for library in libraries {
    let steamapps = library.join("steamapps");
    if !steamapps.exists() {
      continue;
    }

    for entry in fs::read_dir(&steamapps)? {
      let entry = entry?;
      let path = entry.path();
      let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        continue;
      };
      if !name.starts_with("appmanifest_") || !name.ends_with(".acf") {
        continue;
      }
      if let Some(local) = parse_local_manifest(&path, &steamapps, &playtimes)? {
        locals.push(local);
      }
    }
  }

  let cached = {
    let conn = lock_db(db)?;
    steam_details_cache(&conn)?
  };
  let appids: Vec<String> = locals.iter().map(|local| local.appid.clone()).collect();
  let fetched = fetch_steam_details_bulk(&appids, &cached);

  let conn = lock_db(db)?;
  let mut imported = 0;
  for local in locals {
    // `details_synced_at` only advances when this run actually confirmed details against the
    // store - a reused cache hit or a failed lookup both leave the existing timestamp alone
    // (see `upsert_synced_game`'s coalesce), so a failed fetch gets retried on the next sync
    // instead of being treated as freshly checked.
    let (details, details_synced_at) = match fetched.get(&local.appid) {
      Some(Ok(Some(details))) => (details.clone(), Some(Utc::now().to_rfc3339())),
      Some(Ok(None)) => {
        delete_synced_game(&conn, "steam", &local.appid)?;
        continue;
      }
      Some(Err(_)) => (SteamDetails::default(), None),
      // Not in `fetched` means it was already cached from a previous sync - reuse it as-is.
      None => (cached.get(&local.appid).cloned().unwrap_or_default(), None),
    };
    upsert_synced_game(&conn, "steam", SyncedGame::from(build_steam_game(local, details, details_synced_at)))?;
    imported += 1;
  }

  Ok(imported)
}

/// Imports every launcher's games into `games` via the shared `SyncedGame` upsert, then
/// reconciles (drops rows no longer detected) since - unlike Steam's per-manifest
/// not-a-game/skip signal - "what we found this run" is the whole truth for these sources.
/// Unlike Steam, these launchers don't expose their own artwork, so any game missing both
/// images gets a SteamGridDB lookup by title first (no-op if `api_key` is blank). Lookups run
/// in parallel across a worker pool, with the DB mutex released for their entire duration.
fn sync_simple_source(db: &Arc<Mutex<Connection>>, source: &str, games: Vec<SyncedGame>, api_key: &str) -> Result<usize> {
  let seen_ids: Vec<String> = games.iter().map(|game| game.source_game_id.clone()).collect();
  let imported = games.len();
  let titles: Vec<String> = games
    .iter()
    .filter(|game| game.cover_image.is_none() && game.hero_image.is_none())
    .map(|game| game.title.clone())
    .collect();
  let artwork = fetch_artwork_bulk(api_key, &titles);

  let conn = lock_db(db)?;
  for mut game in games {
    if game.cover_image.is_none() && game.hero_image.is_none() {
      if let Some(Some(artwork)) = artwork.get(&game.title) {
        game.cover_image = artwork.cover_image.clone();
        game.hero_image = artwork.hero_image.clone();
        game.header_image = artwork.hero_image.clone();
      }
    }
    upsert_synced_game(&conn, source, game)?;
  }
  reconcile_source(&conn, source, &seen_ids)?;
  Ok(imported)
}

#[tauri::command]
pub fn sync_steam_library(state: State<AppState>) -> Result<Vec<Game>> {
  let imported = sync_steam(&state.db)?;
  if imported == 0 {
    return Err(NexoraError::Message("Steam was found, but no installed games were imported.".into()));
  }
  let conn = lock_db(&state.db)?;
  list_games(&conn)
}

/// Runs Steam's sync plus every other launcher detector behind one button. Each source is
/// isolated: a launcher that isn't installed (or whose scan errors) is reported as
/// `found: false` in the summary rather than failing the whole sync - only Steam's total
/// absence is treated as an outright error today, matching the previous single-launcher
/// behavior when nothing at all was found.
/// Runs every launcher detector back-to-back. Each `sync_*` call below only takes the DB
/// mutex for its own brief local reads/writes and releases it while its network requests are
/// in flight (see `sync_steam`/`sync_simple_source`), so `get_games`, `launch_game`, and
/// friends stay responsive from another window/command for the whole sync instead of queuing
/// up behind a single long-held lock.
#[tauri::command]
pub fn sync_all_libraries(state: State<AppState>) -> Result<SyncResult> {
  // The "other" detector is disabled (see mod declaration in lib.rs); clear out anything it
  // already imported during earlier testing so disabling it actually removes the junk entries.
  let api_key = {
    let db = lock_db(&state.db)?;
    db.execute("delete from games where source = 'other'", [])?;
    read_settings(&db)?.steam_grid_db_api_key
  };
  let mut summary = Vec::new();

  match sync_steam(&state.db) {
    Ok(imported) => summary.push(SourceSyncSummary { source: "steam".into(), imported, found: imported > 0 }),
    Err(_) => summary.push(SourceSyncSummary { source: "steam".into(), imported: 0, found: false }),
  }

  let epic_games = discover_epic_games();
  let epic_found = !epic_games.is_empty();
  let epic_imported = sync_simple_source(&state.db, "epic", epic_games, &api_key)?;
  summary.push(SourceSyncSummary { source: "epic".into(), imported: epic_imported, found: epic_found });

  let gog_games = discover_gog_games();
  let gog_found = !gog_games.is_empty();
  let gog_imported = sync_simple_source(&state.db, "gog", gog_games, &api_key)?;
  summary.push(SourceSyncSummary { source: "gog".into(), imported: gog_imported, found: gog_found });

  let riot_games = discover_riot_games();
  let riot_found = !riot_games.is_empty();
  let riot_imported = sync_simple_source(&state.db, "riot", riot_games, &api_key)?;
  summary.push(SourceSyncSummary { source: "riot".into(), imported: riot_imported, found: riot_found });

  let battlenet_games = discover_battlenet_games();
  let battlenet_found = !battlenet_games.is_empty();
  let battlenet_imported = sync_simple_source(&state.db, "battlenet", battlenet_games, &api_key)?;
  summary.push(SourceSyncSummary { source: "battlenet".into(), imported: battlenet_imported, found: battlenet_found });

  let xbox_games = discover_xbox_games();
  let xbox_found = !xbox_games.is_empty();
  let xbox_imported = sync_simple_source(&state.db, "xbox", xbox_games, &api_key)?;
  summary.push(SourceSyncSummary { source: "xbox".into(), imported: xbox_imported, found: xbox_found });

  // The generic "other" detector (installed-programs registry scan) is disabled for now -
  // its heuristics were flagging non-game utilities too often. See other.rs.

  let games = {
    let conn = lock_db(&state.db)?;
    list_games(&conn)?
  };
  Ok(SyncResult { games, summary })
}

/// Lets the "Add Game" form fetch cover/hero art and descriptive metadata for a title once the
/// user saves a new manual entry. SteamGridDB (needs the user's own API key) supplies the art,
/// the same way sync_simple_source looks up art for launcher-imported games - just for a single
/// title instead of a bulk batch. The Steam storefront search has no such key requirement, so it
/// runs unconditionally and fills in description/genres/developers/release date when a matching
/// store page exists.
#[tauri::command]
pub fn fetch_game_metadata(state: State<AppState>, title: String) -> Result<GameMetadataLookup> {
  let api_key = {
    let db = state.db.lock().map_err(|_| NexoraError::Message("Database lock failed".into()))?;
    read_settings(&db)?.steam_grid_db_api_key
  };
  let artwork = fetch_artwork(&api_key, &title);
  let store_details = lookup_store_details_by_title(&title);
  Ok(GameMetadataLookup {
    cover_image: artwork.as_ref().and_then(|artwork| artwork.cover_image.clone()),
    hero_image: artwork.as_ref().and_then(|artwork| artwork.hero_image.clone()),
    description: store_details.as_ref().and_then(|details| details.description.clone()),
    developers: store_details.as_ref().and_then(|details| details.developers.clone()),
    genres: store_details.as_ref().and_then(|details| details.genres.clone()),
    release_date: store_details.and_then(|details| details.release_date),
  })
}

#[tauri::command]
pub fn add_manual_game(state: State<AppState>, payload: ManualGamePayload) -> Result<Game> {
  let db = state.db.lock().map_err(|_| NexoraError::Message("Database lock failed".into()))?;
  let id = payload.id.unwrap_or_else(|| Uuid::new_v4().to_string());
  let description = empty_option_to_none(payload.description).unwrap_or_else(|| "Manually added game.".into());
  db.execute(
    "insert into games (
      id, source, source_game_id, title, install_path, launch_type, launch_target,
      launch_args, hero_image, cover_image, header_image, description, playtime_minutes, is_installed,
      developers, genres, release_date
    ) values (?1, 'manual', null, ?2, ?3, 'exe', ?4, ?5, ?6, ?7, ?6, ?8, 0, 1, ?9, ?10, ?11)",
    params![
      id,
      payload.title.trim(),
      empty_to_none(payload.install_path),
      payload.launch_target.trim(),
      empty_option_to_none(payload.launch_args),
      empty_option_to_none(payload.hero_image),
      empty_option_to_none(payload.cover_image),
      description,
      empty_option_to_none(payload.developers),
      empty_option_to_none(payload.genres),
      empty_option_to_none(payload.release_date),
    ],
  )?;
  get_game(&db, &id)
}

#[tauri::command]
pub fn update_game(state: State<AppState>, payload: ManualGamePayload) -> Result<Game> {
  let id = payload
    .id
    .clone()
    .ok_or_else(|| NexoraError::Message("Manual game id is required for update.".into()))?;
  let db = state.db.lock().map_err(|_| NexoraError::Message("Database lock failed".into()))?;

  // description/developers/genres/releaseDate need three-way handling, not just "empty means
  // clear": the auto-fetch-on-save flow (App.tsx) omits whichever fields it couldn't find a
  // match for, and that omission (Option::None here) must leave the existing value alone -
  // otherwise saving a game whose Steam store lookup missed would blank out fields a later,
  // successful lookup (or the user's own edit) had already filled in. An explicit edit that
  // clears a field on purpose sends Some("") instead, which does overwrite to null.
  let current = get_game(&db, &id)?;
  let description = match payload.description {
    Some(value) => empty_to_none(value),
    None => current.description,
  };
  let developers = match payload.developers {
    Some(value) => empty_to_none(value),
    None => current.developers,
  };
  let genres = match payload.genres {
    Some(value) => empty_to_none(value),
    None => current.genres,
  };
  let release_date = match payload.release_date {
    Some(value) => empty_to_none(value),
    None => current.release_date,
  };

  db.execute(
    "update games set
      title = ?2,
      install_path = ?3,
      launch_target = ?4,
      launch_args = ?5,
      hero_image = ?6,
      cover_image = ?7,
      header_image = ?6,
      description = ?8,
      developers = ?9,
      genres = ?10,
      release_date = ?11,
      updated_at = datetime('now')
    where id = ?1 and source = 'manual'",
    params![
      id,
      payload.title.trim(),
      empty_to_none(payload.install_path),
      payload.launch_target.trim(),
      empty_option_to_none(payload.launch_args),
      empty_option_to_none(payload.hero_image),
      empty_option_to_none(payload.cover_image),
      description,
      developers,
      genres,
      release_date,
    ],
  )?;
  get_game(&db, &id)
}

#[tauri::command]
pub fn remove_game(state: State<AppState>, game_id: String) -> Result<()> {
  let db = state.db.lock().map_err(|_| NexoraError::Message("Database lock failed".into()))?;
  db.execute("delete from games where id = ?1 and source = 'manual'", params![game_id])?;
  Ok(())
}

#[tauri::command]
pub fn set_game_favorite(state: State<AppState>, game_id: String, favorite: bool) -> Result<Game> {
  let db = state.db.lock().map_err(|_| NexoraError::Message("Database lock failed".into()))?;
  set_favorite(&db, &game_id, favorite)
}

#[tauri::command]
pub fn set_game_order(state: State<AppState>, game_ids: Vec<String>) -> Result<Vec<Game>> {
  let db = state.db.lock().map_err(|_| NexoraError::Message("Database lock failed".into()))?;
  crate::db::set_game_order(&db, &game_ids)
}

#[tauri::command]
pub fn launch_game(state: State<AppState>, app: tauri::AppHandle, game_id: String) -> Result<()> {
  let db = state.db.lock().map_err(|_| NexoraError::Message("Database lock failed".into()))?;
  let game = get_game(&db, &game_id)?;
  log(&format!(
    "launch_game: id={} title={:?} launch_type={} target={:?}",
    game_id, game.title, game.launch_type, game.launch_target
  ));
  let mut spawned_child: Option<std::process::Child> = None;
  match game.launch_type.as_str() {
    // "uri" covers every protocol-style launch (Epic's com.epicgames.launcher://, Xbox's
    // shell:appsFolder\...) the same way "steam_uri" already does - `cmd /C start` opens any
    // of them identically, so no per-launcher branch is needed here.
    "steam_uri" | "uri" => {
      if game.launch_type == "steam_uri" {
        // Firing steam://run/<appid> while Steam is closed does start Steam, but Windows can
        // drop the pending run request if it arrives before Steam's protocol handler is ready,
        // leaving the player stuck until they manually open Steam themselves. Make sure Steam
        // is up (and given a moment to finish booting) before we send the request.
        if let Err(err) = ensure_steam_running() {
          log(&format!("launch_game: ensure_steam_running failed, launching URI anyway: {err:?}"));
        }
      }
      let mut command = Command::new("cmd");
      command.args(["/C", "start", "", &game.launch_target]);
      #[cfg(windows)]
      command.creation_flags(CREATE_NO_WINDOW);
      match command.spawn() {
        // This "cmd /C start" shim exits the instant it hands off to the real launcher/game, so
        // its child handle is useless for playtime (see playtime::track_launch, which finds the
        // real game process by install folder instead).
        Ok(child) => log(&format!("launch_game: uri shim spawned, pid={}", child.id())),
        Err(err) => {
          log(&format!("launch_game: uri shim failed to spawn: {err}"));
          return Err(err.into());
        }
      }
    }
    "exe" => {
      if game.launch_target.trim().is_empty() {
        return Err(NexoraError::Message("This game does not have a launch target.".into()));
      }
      let mut command = Command::new(&game.launch_target);
      if let Some(args) = &game.launch_args {
        for arg in split_args(args) {
          command.arg(arg);
        }
      }
      if let Some(install_path) = &game.install_path {
        let path = Path::new(install_path);
        if let Some(parent) = path.parent() {
          command.current_dir(parent);
        }
      }
      #[cfg(windows)]
      command.creation_flags(CREATE_NO_WINDOW);
      match command.spawn() {
        Ok(child) => {
          log(&format!("launch_game: exe spawned, pid={}", child.id()));
          spawned_child = Some(child);
        }
        Err(err) => {
          log(&format!("launch_game: exe failed to spawn: {err}"));
          return Err(err.into());
        }
      }
    }
    _ => return Err(NexoraError::Message("Unknown launch type.".into())),
  };
  db.execute(
    "update games set last_played_at = ?2, updated_at = datetime('now') where id = ?1",
    params![game_id, Utc::now().to_rfc3339()],
  )?;
  drop(db);

  // Every source gets the live "Playing" indicator via the same automatic detection (see
  // playtime::track_launch). Steam is the one exception for the playtime *number* itself: it
  // already reports its own total via localconfig.vdf (see sync_steam), so accumulating our own
  // count on top would just drift out of sync with the next Steam sync.
  let exe_target = if game.launch_type == "exe" { Some(game.launch_target.clone()) } else { None };
  let accumulate = game.source != "steam";
  track_launch(app, state.inner().clone(), game_id.clone(), game.install_path.clone(), exe_target, spawned_child, accumulate);
  // Deliberately not minimizing/restoring Nexora's window around the launch: doing so was
  // stealing focus from the game (and, via the gilrs refresh tied to window-focus events in
  // lib.rs, disrupting controller input). Let the player switch windows themselves.
  Ok(())
}

#[tauri::command]
pub fn get_active_sessions(state: State<AppState>) -> Result<Vec<ActiveSession>> {
  let sessions = state.sessions.lock().map_err(|_| NexoraError::Message("Session lock failed".into()))?;
  Ok(
    sessions
      .iter()
      .map(|(game_id, started_at)| ActiveSession { game_id: game_id.clone(), started_at: started_at.to_rfc3339() })
      .collect(),
  )
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<AppSettings> {
  let db = state.db.lock().map_err(|_| NexoraError::Message("Database lock failed".into()))?;
  read_settings(&db)
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: String) -> Result<AppSettings> {
  let allowed = [
    "steamGridDbApiKey",
    "consoleMode",
    "launchOnLogin",
    "soundVolume",
    "colorTheme",
    "reduceMotion",
    "controllerDeadzone",
    "controllerVibration",
    "controllerLayout",
    "controllerBindings",
  ];
  if !allowed.contains(&key.as_str()) {
    return Err(NexoraError::Message("Unknown setting.".into()));
  }
  let db = state.db.lock().map_err(|_| NexoraError::Message("Database lock failed".into()))?;
  db.execute(
    "insert into settings (key, value) values (?1, ?2)
     on conflict(key) do update set value = excluded.value",
    params![key, value],
  )?;
  read_settings(&db)
}

#[tauri::command]
pub fn test_vibration(state: State<AppState>) -> Result<()> {
  trigger_test_vibration(&state)
}

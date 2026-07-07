use chrono::{DateTime, Utc};
use gilrs::Gilrs;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct AppState {
  pub db: Arc<Mutex<rusqlite::Connection>>,
  pub gilrs: Option<Arc<Mutex<Gilrs>>>,
  /// Games currently being tracked as "in a play session", keyed by game id, with the session's
  /// start time - populated by playtime.rs's watcher threads and read back by
  /// `get_active_sessions` so the frontend can rebuild its live timers after a reload.
  pub sessions: Arc<Mutex<HashMap<String, DateTime<Utc>>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
  pub id: String,
  pub source: String,
  pub source_game_id: Option<String>,
  pub title: String,
  pub install_path: Option<String>,
  pub launch_type: String,
  pub launch_target: String,
  pub launch_args: Option<String>,
  pub hero_image: Option<String>,
  pub cover_image: Option<String>,
  pub header_image: Option<String>,
  pub description: Option<String>,
  pub last_played_at: Option<String>,
  pub playtime_minutes: Option<i64>,
  pub is_installed: bool,
  pub developers: Option<String>,
  pub genres: Option<String>,
  pub release_date: Option<String>,
  pub is_favorite: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualGamePayload {
  pub id: Option<String>,
  pub title: String,
  pub install_path: String,
  pub launch_target: String,
  pub launch_args: Option<String>,
  pub hero_image: Option<String>,
  pub cover_image: Option<String>,
  pub description: Option<String>,
  pub developers: Option<String>,
  pub genres: Option<String>,
  pub release_date: Option<String>,
}

/// What the "Add Game" form fetches once the user saves a new manual entry: box art from
/// SteamGridDB (needs the user's own API key) plus whatever description/genres/developers the
/// Steam store has for a matching title (no key required, since it's Steam's public storefront
/// API) - the two sources are independent, so either half can be present without the other.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameMetadataLookup {
  pub cover_image: Option<String>,
  pub hero_image: Option<String>,
  pub description: Option<String>,
  pub developers: Option<String>,
  pub genres: Option<String>,
  pub release_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
  pub steam_grid_db_api_key: String,
  pub console_mode: bool,
  pub launch_on_login: bool,
  pub sound_volume: String,
  pub color_theme: String,
  pub reduce_motion: bool,
  pub controller_deadzone: String,
  pub controller_vibration: bool,
  pub controller_layout: String,
  pub controller_bindings: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ControllerButtonEvent {
  pub button: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ControllerConnectionEvent {
  pub name: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ControllerBatteryEvent {
  /// 0-100, `None` when the backend couldn't determine a level (includes wired controllers,
  /// which don't report one).
  pub level: Option<u8>,
  pub charging: bool,
  pub wired: bool,
}

#[derive(Debug)]
pub struct SteamGame {
  pub appid: String,
  pub title: String,
  pub install_path: String,
  pub playtime_minutes: i64,
  pub last_played_at: Option<String>,
  pub hero_image: String,
  pub cover_image: String,
  pub header_image: String,
  pub description: Option<String>,
  pub developers: Option<String>,
  pub genres: Option<String>,
  pub release_date: Option<String>,
  /// Set only when this run actually fetched fresh store details (as opposed to reusing a
  /// cached copy, or falling back to defaults after a failed lookup) - see
  /// `db::steam_details_cache` and `db::upsert_synced_game`.
  pub details_synced_at: Option<String>,
}

#[derive(Default, Clone)]
pub struct SteamDetails {
  pub header_image: Option<String>,
  pub description: Option<String>,
  pub developers: Option<String>,
  pub genres: Option<String>,
  pub release_date: Option<String>,
}

/// A game discovered by any non-Steam launcher detector (epic.rs, gog.rs, riot.rs,
/// battlenet.rs, xbox.rs, other.rs), destined for the generic `upsert_synced_game`/
/// `reconcile_source` pair in db.rs. Steam keeps using `SteamGame` above because its sync
/// path needs the extra `NotAGame`/`Skip` distinction that the other launchers don't.
#[derive(Debug, Clone)]
pub struct SyncedGame {
  pub source_game_id: String,
  pub title: String,
  pub install_path: Option<String>,
  pub launch_type: String,
  pub launch_target: String,
  pub launch_args: Option<String>,
  pub hero_image: Option<String>,
  pub cover_image: Option<String>,
  pub header_image: Option<String>,
  pub description: Option<String>,
  pub playtime_minutes: Option<i64>,
  pub last_played_at: Option<String>,
  pub developers: Option<String>,
  pub genres: Option<String>,
  pub release_date: Option<String>,
  pub details_synced_at: Option<String>,
}

impl From<SteamGame> for SyncedGame {
  fn from(game: SteamGame) -> Self {
    SyncedGame {
      source_game_id: game.appid.clone(),
      title: game.title,
      install_path: Some(game.install_path),
      launch_type: "steam_uri".into(),
      launch_target: format!("steam://run/{}", game.appid),
      launch_args: None,
      hero_image: Some(game.hero_image),
      cover_image: Some(game.cover_image),
      header_image: Some(game.header_image),
      description: game.description,
      playtime_minutes: Some(game.playtime_minutes),
      last_played_at: game.last_played_at,
      developers: game.developers,
      genres: game.genres,
      release_date: game.release_date,
      details_synced_at: game.details_synced_at,
    }
  }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSyncSummary {
  pub source: String,
  pub imported: usize,
  pub found: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
  pub games: Vec<Game>,
  pub summary: Vec<SourceSyncSummary>,
}

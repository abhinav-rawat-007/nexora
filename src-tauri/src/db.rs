use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{NexoraError, Result};
use crate::models::{AppSettings, Game, SteamDetails, SyncedGame};
use std::collections::HashMap;

pub fn init_db(db: &Connection) -> Result<()> {
  db.execute_batch(
    "
    create table if not exists games (
      id text primary key,
      source text not null,
      source_game_id text,
      title text not null,
      install_path text,
      launch_type text not null,
      launch_target text not null,
      launch_args text,
      hero_image text,
      cover_image text,
      header_image text,
      description text,
      last_played_at text,
      playtime_minutes integer,
      is_installed integer not null default 1,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now')),
      unique(source, source_game_id)
    );

    create table if not exists settings (
      key text primary key,
      value text not null
    );
    ",
  )?;
  add_column_if_missing(db, "games", "header_image", "text")?;
  add_column_if_missing(db, "games", "description", "text")?;
  add_column_if_missing(db, "games", "developers", "text")?;
  add_column_if_missing(db, "games", "genres", "text")?;
  add_column_if_missing(db, "games", "release_date", "text")?;
  // Distinct from `updated_at`, which every sync bumps for local-only fields (playtime,
  // install path) whether or not the store lookup actually ran. Only set when `sync_steam`
  // truly fetches fresh details, so `steam_details_cache`'s TTL check reflects when the data
  // was last confirmed against the store, not just when the row was last touched.
  add_column_if_missing(db, "games", "details_synced_at", "text")?;
  add_column_if_missing(db, "games", "is_favorite", "integer not null default 0")?;
  // Null until the user drags a game in the library rail at least once; list_games() puts
  // null-order games after ordered ones (alphabetically among themselves) so newly synced or
  // added games land at the end instead of jumping into the middle of a hand-arranged layout.
  add_column_if_missing(db, "games", "sort_order", "integer")?;
  Ok(())
}

fn add_column_if_missing(db: &Connection, table: &str, column: &str, kind: &str) -> Result<()> {
  let mut stmt = db.prepare(&format!("pragma table_info({})", table))?;
  let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
  for name in rows {
    if name? == column {
      return Ok(());
    }
  }
  db.execute(&format!("alter table {} add column {} {}", table, column, kind), [])?;
  Ok(())
}

pub fn seed_settings(db: &Connection) -> Result<()> {
  for (key, value) in [
    ("consoleMode", "true"),
    ("launchOnLogin", "false"),
    ("steamGridDbApiKey", ""),
    ("soundVolume", "80"),
    ("colorTheme", "nexora"),
    ("reduceMotion", "false"),
    ("controllerDeadzone", "55"),
    ("controllerVibration", "true"),
    ("controllerLayout", "auto"),
    (
      "controllerBindings",
      r#"{"up":"DPadUp","down":"DPadDown","left":"DPadLeft","right":"DPadRight","confirm":"South","back":"East","pageUp":"LB","pageDown":"RB","menu":"Start"}"#,
    ),
  ] {
    db.execute(
      "insert or ignore into settings (key, value) values (?1, ?2)",
      params![key, value],
    )?;
  }
  Ok(())
}

pub fn list_games(db: &Connection) -> Result<Vec<Game>> {
  let mut stmt = db.prepare(
    "select id, source, source_game_id, title, install_path, launch_type, launch_target,
      launch_args, hero_image, cover_image, header_image, description, last_played_at, playtime_minutes, is_installed,
      developers, genres, release_date, is_favorite
     from games
     where is_installed = 1
     order by case when sort_order is null then 1 else 0 end, sort_order, lower(title)",
  )?;
  let rows = stmt.query_map([], map_game)?;
  let mut games = Vec::new();
  for game in rows {
    games.push(game?);
  }
  Ok(games)
}

pub fn get_game(db: &Connection, id: &str) -> Result<Game> {
  db
    .query_row(
      "select id, source, source_game_id, title, install_path, launch_type, launch_target,
        launch_args, hero_image, cover_image, header_image, description, last_played_at, playtime_minutes, is_installed,
        developers, genres, release_date, is_favorite
       from games where id = ?1",
      params![id],
      map_game,
    )
    .optional()?
    .ok_or_else(|| NexoraError::Message("Game not found.".into()))
}

fn map_game(row: &rusqlite::Row) -> rusqlite::Result<Game> {
  Ok(Game {
    id: row.get(0)?,
    source: row.get(1)?,
    source_game_id: row.get(2)?,
    title: row.get(3)?,
    install_path: row.get(4)?,
    launch_type: row.get(5)?,
    launch_target: row.get(6)?,
    launch_args: row.get(7)?,
    hero_image: row.get(8)?,
    cover_image: row.get(9)?,
    header_image: row.get(10)?,
    description: row.get(11)?,
    last_played_at: row.get(12)?,
    playtime_minutes: row.get(13)?,
    is_installed: row.get::<_, i64>(14)? == 1,
    developers: row.get(15)?,
    genres: row.get(16)?,
    release_date: row.get(17)?,
    is_favorite: row.get::<_, i64>(18)? == 1,
  })
}

pub fn set_favorite(db: &Connection, id: &str, favorite: bool) -> Result<Game> {
  db.execute(
    "update games set is_favorite = ?2, updated_at = datetime('now') where id = ?1",
    params![id, favorite as i64],
  )?;
  get_game(db, id)
}

/// Persists a drag-and-drop reorder of the library rail: `game_ids` is the full new front-to-back
/// order, so each id's index becomes its `sort_order`. Games left out (shouldn't normally happen,
/// since the frontend always sends its full library array) keep whatever order they already had.
pub fn set_game_order(db: &Connection, game_ids: &[String]) -> Result<Vec<Game>> {
  // One transaction instead of one implicit commit (and fsync) per game - a reorder of a large
  // library is otherwise hundreds of disk syncs, and a crash mid-loop can't leave a half-applied
  // order.
  let tx = db.unchecked_transaction()?;
  for (index, id) in game_ids.iter().enumerate() {
    tx.execute(
      "update games set sort_order = ?2, updated_at = datetime('now') where id = ?1",
      params![id, index as i64],
    )?;
  }
  tx.commit()?;
  list_games(db)
}

pub fn read_settings(db: &Connection) -> Result<AppSettings> {
  let mut stmt = db.prepare("select key, value from settings")?;
  let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
  let mut settings = HashMap::new();
  for row in rows {
    let (key, value) = row?;
    settings.insert(key, value);
  }
  Ok(AppSettings {
    steam_grid_db_api_key: settings.get("steamGridDbApiKey").cloned().unwrap_or_default(),
    console_mode: settings.get("consoleMode").map(|value| value == "true").unwrap_or(true),
    launch_on_login: settings.get("launchOnLogin").map(|value| value == "true").unwrap_or(false),
    sound_volume: settings.get("soundVolume").cloned().unwrap_or_else(|| "80".into()),
    color_theme: settings.get("colorTheme").cloned().unwrap_or_else(|| "nexora".into()),
    reduce_motion: settings.get("reduceMotion").map(|value| value == "true").unwrap_or(false),
    controller_deadzone: settings.get("controllerDeadzone").cloned().unwrap_or_else(|| "55".into()),
    controller_vibration: settings.get("controllerVibration").map(|value| value == "true").unwrap_or(true),
    controller_layout: settings.get("controllerLayout").cloned().unwrap_or_else(|| "auto".into()),
    controller_bindings: settings.get("controllerBindings").cloned().unwrap_or_else(|| {
      r#"{"up":"DPadUp","down":"DPadDown","left":"DPadLeft","right":"DPadRight","confirm":"South","back":"East","pageUp":"LB","pageDown":"RB","menu":"Start"}"#.into()
    }),
  })
}

/// How long a Steam store lookup is trusted before `sync_steam` will fetch it again, even
/// though the game is already in the DB. Balances the whole point of caching (skip the slow
/// network round-trip on routine re-syncs) against details drifting out of date (genres,
/// description, header art can all change after this first sync, especially for early-access
/// titles) - long enough that a normal "sync every so often" workflow rarely refetches
/// anything, short enough that stale data doesn't linger indefinitely.
const STEAM_DETAILS_TTL_DAYS: i64 = 14;

/// Store details already captured from a previous sync, keyed by Steam appid, excluding any
/// whose last confirmed fetch is older than `STEAM_DETAILS_TTL_DAYS`. Lets `sync_steam` skip
/// the store lookup for games it has already classified *recently*, so a re-sync only pays
/// the network cost for genuinely new appids and details that are due for a refresh.
pub fn steam_details_cache(db: &Connection) -> Result<HashMap<String, SteamDetails>> {
  let mut stmt = db.prepare(&format!(
    "select source_game_id, header_image, description, developers, genres, release_date
     from games where source = 'steam' and source_game_id is not null
       and details_synced_at is not null
       and details_synced_at >= datetime('now', '-{STEAM_DETAILS_TTL_DAYS} days')"
  ))?;
  let rows = stmt.query_map([], |row| {
    Ok((
      row.get::<_, String>(0)?,
      SteamDetails {
        header_image: row.get(1)?,
        description: row.get(2)?,
        developers: row.get(3)?,
        genres: row.get(4)?,
        release_date: row.get(5)?,
      },
    ))
  })?;
  let mut cache = HashMap::new();
  for row in rows {
    let (appid, details) = row?;
    cache.insert(appid, details);
  }
  Ok(cache)
}

/// Generic upsert used by every launcher detector (Steam included, via a `SteamGame` ->
/// `SyncedGame` conversion in commands.rs). Keyed on the `unique(source, source_game_id)`
/// constraint from init_db, so re-syncing only updates rows instead of duplicating them.
pub fn upsert_synced_game(db: &Connection, source: &str, game: SyncedGame) -> Result<()> {
  let id = format!("{}-{}", source, game.source_game_id);
  db.execute(
    "insert into games (
      id, source, source_game_id, title, install_path, launch_type, launch_target, launch_args,
      hero_image, cover_image, header_image, description, playtime_minutes, last_played_at,
      developers, genres, release_date, details_synced_at, is_installed
    ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, 1)
    on conflict(source, source_game_id) do update set
      title = excluded.title,
      install_path = excluded.install_path,
      launch_type = excluded.launch_type,
      launch_target = excluded.launch_target,
      launch_args = excluded.launch_args,
      hero_image = excluded.hero_image,
      cover_image = excluded.cover_image,
      header_image = excluded.header_image,
      description = excluded.description,
      -- Only Steam's SyncedGame ever carries a real playtime_minutes (Steam's own localconfig.vdf
      -- is authoritative for it); every other launcher detector always passes None here because
      -- Nexora's own session tracking (see playtime.rs) is the source of truth for those sources.
      -- Overwriting unconditionally on every resync wiped non-Steam games' tracked playtime back
      -- to null each time the library was resynced (e.g. after an app restart).
      playtime_minutes = coalesce(excluded.playtime_minutes, games.playtime_minutes),
      developers = excluded.developers,
      genres = excluded.genres,
      release_date = excluded.release_date,
      last_played_at = case
        when excluded.last_played_at is null then games.last_played_at
        when games.last_played_at is null then excluded.last_played_at
        when excluded.last_played_at > games.last_played_at then excluded.last_played_at
        else games.last_played_at
      end,
      -- A null here means this sync reused cached details (or the store lookup failed) rather
      -- than fetching fresh ones, so keep whatever timestamp was already recorded.
      details_synced_at = coalesce(excluded.details_synced_at, games.details_synced_at),
      is_installed = 1,
      updated_at = datetime('now')",
    params![
      id,
      source,
      game.source_game_id,
      game.title,
      game.install_path,
      game.launch_type,
      game.launch_target,
      game.launch_args,
      game.hero_image,
      game.cover_image,
      game.header_image,
      game.description,
      game.playtime_minutes,
      game.last_played_at,
      game.developers,
      game.genres,
      game.release_date,
      game.details_synced_at,
    ],
  )?;
  Ok(())
}

pub fn delete_synced_game(db: &Connection, source: &str, source_game_id: &str) -> Result<()> {
  db.execute(
    "delete from games where source = ?1 and source_game_id = ?2",
    params![source, source_game_id],
  )?;
  Ok(())
}

/// Whatever the detector found this run *is* the truth for a source, so anything else
/// previously stored under it was uninstalled/renamed. Rows are soft-hidden
/// (`is_installed = 0`, filtered out by `list_games`) rather than deleted, so the player's
/// state on them - favorite flag, custom sort position, Nexora-tracked playtime - survives a
/// reinstall: the next sync's upsert flips the same row back to `is_installed = 1`.
pub fn reconcile_source(db: &Connection, source: &str, seen_ids: &[String]) -> Result<()> {
  let seen: std::collections::HashSet<&String> = seen_ids.iter().collect();
  let mut stmt = db.prepare("select source_game_id from games where source = ?1 and is_installed = 1")?;
  let existing: Vec<String> = stmt
    .query_map(params![source], |row| row.get::<_, Option<String>>(0))?
    .filter_map(|value| value.ok().flatten())
    .collect();
  for id in existing {
    if !seen.contains(&id) {
      db.execute(
        "update games set is_installed = 0, updated_at = datetime('now') where source = ?1 and source_game_id = ?2",
        params![source, id],
      )?;
    }
  }
  Ok(())
}

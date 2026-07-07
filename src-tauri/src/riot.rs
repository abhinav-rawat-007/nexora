use serde_json::Value;
use std::{fs, path::PathBuf};

use crate::models::SyncedGame;

/// Riot Client writes this file to record every product it has installed and where. The real
/// shape (confirmed against a live install) is:
///   { "associated_client": { "<install path>": "<RiotClientServices.exe path>" }, ... }
/// The install path is wherever the player chose to install it (any drive/folder) - there is
/// no separate "product name" field, so the product/patchline are read back out of the path
/// itself (".../Riot Games/<Product>/<patchline>/"), never assumed from a fixed drive or a
/// hardcoded product list.
fn installs_json_path() -> PathBuf {
  PathBuf::from("C:\\ProgramData\\Riot Games\\RiotClientInstalls.json")
}

pub fn discover_riot_games() -> Vec<SyncedGame> {
  let Ok(content) = fs::read_to_string(installs_json_path()) else {
    return Vec::new();
  };
  let Ok(root) = serde_json::from_str::<Value>(&content) else {
    return Vec::new();
  };

  let riot_client_path = root
    .get("rc_live")
    .or_else(|| root.get("rc_default"))
    .and_then(|value| value.as_str())
    .map(PathBuf::from);
  let Some(riot_client) = riot_client_path.filter(|path| path.exists()) else {
    return Vec::new();
  };

  let Some(Value::Object(associated)) = root.get("associated_client") else {
    return Vec::new();
  };

  let mut games = Vec::new();
  for install_path in associated.keys() {
    let path = PathBuf::from(install_path);
    if !path.exists() {
      continue;
    }
    let Some((product, patchline)) = product_and_patchline(&path) else { continue };

    games.push(SyncedGame {
      source_game_id: format!("{}-{}", product.to_lowercase(), patchline.to_lowercase()),
      title: product.clone(),
      install_path: Some(path.to_string_lossy().to_string()),
      launch_type: "exe".into(),
      launch_target: riot_client.to_string_lossy().to_string(),
      // Riot games must be launched through the Riot Client rather than their own exe
      // directly (VALORANT's Vanguard anti-cheat in particular requires this). The
      // launch-product id Riot Client expects is the product folder name, lowercased with
      // spaces turned into underscores - e.g. "VALORANT" -> "valorant",
      // "League of Legends" -> "league_of_legends" - derived from the path, not hardcoded.
      launch_args: Some(format!(
        "--launch-product={} --launch-patchline={}",
        product.to_lowercase().replace(' ', "_"),
        patchline.to_lowercase()
      )),
      hero_image: None,
      cover_image: None,
      header_image: None,
      description: None,
      playtime_minutes: None,
      last_played_at: None,
      developers: Some("Riot Games".into()),
      genres: None,
      release_date: None,
      details_synced_at: None,
    });
  }
  games
}

/// Pulls "<Product>"/"<patchline>" out of a path shaped like ".../Riot Games/<Product>/<patchline>/"
/// by locating the "Riot Games" path segment and reading the two segments after it - works no
/// matter which drive or parent folder the player installed to.
fn product_and_patchline(path: &std::path::Path) -> Option<(String, String)> {
  let components: Vec<String> = path
    .components()
    .filter_map(|component| component.as_os_str().to_str().map(str::to_string))
    .collect();
  let riot_games_index = components
    .iter()
    .position(|segment| segment.eq_ignore_ascii_case("Riot Games"))?;
  let product = components.get(riot_games_index + 1)?.clone();
  let patchline = components
    .get(riot_games_index + 2)
    .cloned()
    .unwrap_or_else(|| "live".to_string());
  Some((product, patchline))
}

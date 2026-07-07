use crate::models::SyncedGame;

/// GOG Galaxy writes one registry subkey per installed game under this fixed path - reliable
/// and documented, unlike the Xbox/Riot/Battle.net heuristics elsewhere in this file set.
#[cfg(windows)]
pub fn discover_gog_games() -> Vec<SyncedGame> {
  use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY};
  use winreg::RegKey;

  let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
  let Ok(games_key) = hklm.open_subkey_with_flags(
    "SOFTWARE\\WOW6432Node\\GOG.com\\Games",
    KEY_READ | KEY_WOW64_32KEY,
  ) else {
    return Vec::new();
  };

  let mut games = Vec::new();
  for name in games_key.enum_keys().flatten() {
    let Ok(entry) = games_key.open_subkey(&name) else { continue };
    let title: String = match entry.get_value("gameName") {
      Ok(value) => value,
      Err(_) => continue,
    };
    let exe: String = match entry.get_value("exe") {
      Ok(value) => value,
      Err(_) => continue,
    };
    let path: Option<String> = entry.get_value("path").ok();
    let game_id: String = entry.get_value("gameID").unwrap_or_else(|_| name.clone());

    games.push(SyncedGame {
      source_game_id: game_id,
      title,
      install_path: path,
      launch_type: "exe".into(),
      launch_target: exe,
      launch_args: None,
      hero_image: None,
      cover_image: None,
      header_image: None,
      description: None,
      playtime_minutes: None,
      last_played_at: None,
      developers: None,
      genres: None,
      release_date: None,
      details_synced_at: None,
    });
  }
  games
}

#[cfg(not(windows))]
pub fn discover_gog_games() -> Vec<SyncedGame> {
  Vec::new()
}

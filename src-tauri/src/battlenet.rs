use std::path::PathBuf;

use crate::models::SyncedGame;

/// Every Blizzard/Battle.net-managed game install writes a `.build.info` marker file at the
/// root of its install folder. There is no public local API listing installed Battle.net
/// games, so this scans the default install roots' immediate subfolders for that marker and
/// matches known titles - games installed to a custom drive/path won't be found.
const KNOWN_BATTLENET_GAMES: [(&str, &str, &str); 5] = [
  ("World of Warcraft", "World of Warcraft", "_retail_\\Wow.exe"),
  ("Overwatch 2", "Overwatch", "Overwatch.exe"),
  ("Diablo IV", "Diablo IV", "Diablo IV.exe"),
  ("Hearthstone", "Hearthstone", "Hearthstone.exe"),
  ("StarCraft II", "StarCraft II", "StarCraft II.exe"),
];

pub fn discover_battlenet_games() -> Vec<SyncedGame> {
  let mut games = Vec::new();
  let roots = [
    PathBuf::from("C:\\Program Files (x86)"),
    PathBuf::from("C:\\Program Files"),
  ];

  for (title, folder, relative_exe) in KNOWN_BATTLENET_GAMES {
    for root in &roots {
      let install_path = root.join(folder);
      if !install_path.join(".build.info").exists() {
        continue;
      }
      let exe_path = install_path.join(relative_exe);
      if !exe_path.exists() {
        continue;
      }
      games.push(SyncedGame {
        source_game_id: folder.to_string(),
        title: title.to_string(),
        install_path: Some(install_path.to_string_lossy().to_string()),
        launch_type: "exe".into(),
        launch_target: exe_path.to_string_lossy().to_string(),
        launch_args: None,
        hero_image: None,
        cover_image: None,
        header_image: None,
        description: None,
        playtime_minutes: None,
        last_played_at: None,
        developers: Some("Blizzard Entertainment".into()),
        genres: None,
        release_date: None,
        details_synced_at: None,
      });
      break;
    }
  }
  games
}

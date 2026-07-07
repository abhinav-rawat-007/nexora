use serde::Deserialize;
use std::{env, fs, path::PathBuf};

use crate::models::SyncedGame;

/// Epic Games Launcher writes one `.item` JSON file per installed app under this ProgramData
/// path - no registry lookup needed, unlike Steam. `%ProgramData%` is used instead of a
/// hardcoded `C:\` so this still resolves on machines where ProgramData has been redirected
/// to another drive.
fn manifests_dir() -> PathBuf {
  let program_data = env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".into());
  PathBuf::from(program_data).join("Epic\\EpicGamesLauncher\\Data\\Manifests")
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct EpicManifest {
  display_name: String,
  install_location: Option<String>,
  catalog_namespace: Option<String>,
  catalog_item_id: Option<String>,
  app_name: Option<String>,
  // Epic's manifests follow Unreal Engine's `b`-prefixed boolean naming convention
  // (`bIsApplication`), not plain PascalCase - `rename_all` alone would map this to
  // `IsApplication` and silently default to `false` via `#[serde(default)]`, filtering out
  // every real game without any visible error.
  #[serde(rename = "bIsApplication", default)]
  is_application: bool,
}

/// Returns an empty list (not an error) when Epic isn't installed - a missing launcher is a
/// normal outcome, not a sync failure, so `sync_all_libraries` can skip it silently. Manifests
/// that exist but fail to parse or are missing required fields are logged to stderr instead of
/// being swallowed, so a future field/schema mismatch shows up immediately instead of just
/// producing a quietly-empty sync.
pub fn discover_epic_games() -> Vec<SyncedGame> {
  let dir = manifests_dir();
  let Ok(entries) = fs::read_dir(&dir) else {
    return Vec::new();
  };

  let mut games = Vec::new();
  for entry in entries.flatten() {
    let path = entry.path();
    if path.extension().and_then(|ext| ext.to_str()) != Some("item") {
      continue;
    }
    let content = match fs::read_to_string(&path) {
      Ok(content) => content,
      Err(err) => {
        eprintln!("epic: failed to read manifest {}: {err}", path.display());
        continue;
      }
    };
    let manifest = match serde_json::from_str::<EpicManifest>(&content) {
      Ok(manifest) => manifest,
      Err(err) => {
        eprintln!("epic: failed to parse manifest {}: {err}", path.display());
        continue;
      }
    };
    if !manifest.is_application {
      continue;
    }
    let (Some(namespace), Some(item_id), Some(app_name)) =
      (manifest.catalog_namespace.clone(), manifest.catalog_item_id.clone(), manifest.app_name.clone())
    else {
      eprintln!(
        "epic: skipping '{}' ({}) - missing catalog_namespace/catalog_item_id/app_name",
        manifest.display_name,
        path.display()
      );
      continue;
    };

    let launch_target = format!(
      "com.epicgames.launcher://apps/{}%3A{}%3A{}?action=launch&silent=true",
      namespace, item_id, app_name
    );

    games.push(SyncedGame {
      source_game_id: app_name,
      title: manifest.display_name,
      install_path: manifest.install_location,
      launch_type: "uri".into(),
      launch_target,
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

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_real_manifest_with_bis_application() {
    let json = r#"{
      "DisplayName": "Vampire Survivors",
      "InstallLocation": "D:/Games/VampireSurvivors",
      "CatalogNamespace": "a4e77bc04aa440a096962c14b63a41e8",
      "CatalogItemId": "9cc0c39d76354bd79d78f405e09cdb51",
      "AppName": "1136763135c0482cbbb4b2d45e978156",
      "bIsApplication": true
    }"#;
    let manifest: EpicManifest = serde_json::from_str(json).unwrap();
    assert!(manifest.is_application);
  }
}

use std::{fs, path::PathBuf};

use crate::models::SyncedGame;

/// `WindowsApps` holds every installed UWP/Store package (system apps included) and is
/// ACL-locked to the OS/TrustedInstaller account on most machines, so this frequently reads
/// as empty/permission-denied - that's an expected outcome here, not a bug, since Nexora has
/// no WinRT package-manager access. When it *can* read the folder, `MicrosoftGame.config` is
/// used as the "this is a game, not a system app" signal: GDK/Xbox-on-PC titles ship that file
/// at their package root, so this only catches those, not plain-UWP Store games.
fn windows_apps_dir() -> PathBuf {
  PathBuf::from("C:\\Program Files\\WindowsApps")
}

pub fn discover_xbox_games() -> Vec<SyncedGame> {
  let Ok(entries) = fs::read_dir(windows_apps_dir()) else {
    return Vec::new();
  };

  let mut games = Vec::new();
  for entry in entries.flatten() {
    let path = entry.path();
    if !path.is_dir() || !path.join("MicrosoftGame.config").exists() {
      continue;
    }
    let Some(folder_name) = path.file_name().and_then(|name| name.to_str()) else { continue };
    let package_family = folder_name.split('_').next().unwrap_or(folder_name);

    let manifest_path = path.join("AppxManifest.xml");
    let Some(manifest_xml) = fs::read_to_string(&manifest_path).ok() else { continue };
    if extract_attribute(&manifest_xml, "Executable").is_none() {
      continue;
    }
    let display_name = extract_tag_text(&manifest_xml, "DisplayName")
      .filter(|name| !name.starts_with("ms-resource:"))
      .unwrap_or_else(|| title_from_package_name(package_family));
    let app_id = extract_attribute(&manifest_xml, "Id").unwrap_or_else(|| "App".into());

    games.push(SyncedGame {
      source_game_id: package_family.to_string(),
      title: display_name,
      install_path: Some(path.to_string_lossy().to_string()),
      launch_type: "uri".into(),
      launch_target: format!("shell:appsFolder\\{}!{}", package_family, app_id),
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

fn extract_tag_text(xml: &str, tag: &str) -> Option<String> {
  let open = format!("<{}>", tag);
  let close = format!("</{}>", tag);
  let start = xml.find(&open)? + open.len();
  let end = xml[start..].find(&close)? + start;
  Some(xml[start..end].trim().to_string())
}

fn extract_attribute(xml: &str, attribute: &str) -> Option<String> {
  let needle = format!("{}=\"", attribute);
  let start = xml.find(&needle)? + needle.len();
  let end = xml[start..].find('"')? + start;
  Some(xml[start..end].to_string())
}

fn title_from_package_name(package_family: &str) -> String {
  let name = package_family.split('.').last().unwrap_or(package_family);
  let mut result = String::new();
  for (index, ch) in name.chars().enumerate() {
    if index > 0 && ch.is_uppercase() {
      result.push(' ');
    }
    result.push(ch);
  }
  result
}

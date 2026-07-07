use std::{fs, path::Path};

use crate::models::SyncedGame;

/// Titles/publishers containing any of these (case-insensitive) are almost never a game the
/// player would want in their library - they're the redistributables, drivers, and SDKs that
/// clutter "Programs and Features" alongside real installs.
const DENY_KEYWORDS: [&str; 39] = [
  "redistributable",
  "runtime",
  "sdk",
  "update for",
  "security update",
  "hotfix",
  "driver",
  "codec",
  "framework",
  "visual c++",
  "visual studio",
  ".net ",
  "directx",
  "uninstall",
  "service pack",
  "7-zip",
  "7zip",
  "winrar",
  "peazip",
  "notepad++",
  "vlc media player",
  "google chrome",
  "chromium",
  "firefox",
  "microsoft edge",
  "adobe",
  "java ",
  "python",
  "node.js",
  "git for windows",
  "putty",
  "winscp",
  "teamviewer",
  "anydesk",
  "zoom",
  "ccleaner",
  "malwarebytes",
  "antivirus",
  "vc_redist",
];

/// Exact publisher matches (case-insensitive) known to never publish games - large software
/// vendors, hardware/driver makers, and utility authors whose installers otherwise slip past
/// the keyword list above (their product names don't always contain an obvious giveaway word).
const DENY_PUBLISHERS: [&str; 22] = [
  "igor pavlov",
  "rarlab",
  "google llc",
  "google inc.",
  "mozilla",
  "microsoft corporation",
  "apple inc.",
  "oracle corporation",
  "nvidia corporation",
  "advanced micro devices, inc.",
  "intel corporation",
  "realtek semiconductor corp.",
  "logitech",
  "razer inc.",
  "corsair",
  "asustek computer inc.",
  "discord inc.",
  "valve corporation",
  "piriform software ltd",
  "malwarebytes",
  "teamviewer germany gmbh",
  "videolan",
];

/// Launcher/storefront clients themselves (as opposed to the games they run) show up as their
/// own "Programs and Features" entry - these are already synced via their dedicated detector
/// modules, so the client shortcut itself shouldn't also appear as an "other" game.
const DENY_TITLES_EXACT: [&str; 8] =
  ["steam", "epic games launcher", "gog galaxy", "battle.net", "riot client", "xbox", "ea app", "ubisoft connect"];

/// Generic fallback for anything installed that isn't covered by a dedicated detector
/// (Steam/Epic/GOG/Xbox/Riot/Battle.net): scans the same "installed programs" registry list
/// Windows' own Settings > Apps page reads from, and keeps only entries that look like a real
/// standalone game install. `claimed_paths` are install paths already found by the other
/// detectors this run, so a Steam game that also shows up in Programs & Features isn't listed
/// twice under two different sources.
#[cfg(windows)]
pub fn discover_other_games(claimed_paths: &[String]) -> Vec<SyncedGame> {
  use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
  use winreg::RegKey;

  let roots: [(winreg::HKEY, u32); 3] = [
    (HKEY_LOCAL_MACHINE, KEY_WOW64_64KEY),
    (HKEY_LOCAL_MACHINE, KEY_WOW64_32KEY),
    (HKEY_CURRENT_USER, KEY_WOW64_64KEY),
  ];

  let mut games = Vec::new();
  let mut seen_ids = std::collections::HashSet::new();

  for (hive, view) in roots {
    let root = RegKey::predef(hive);
    let Ok(uninstall) =
      root.open_subkey_with_flags("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall", KEY_READ | view)
    else {
      continue;
    };
    for name in uninstall.enum_keys().flatten() {
      let Ok(entry) = uninstall.open_subkey(&name) else { continue };
      if let Some(game) = evaluate_entry(&entry, claimed_paths) {
        if seen_ids.insert(game.source_game_id.clone()) {
          games.push(game);
        }
      }
    }
  }
  games
}

#[cfg(windows)]
fn evaluate_entry(entry: &winreg::RegKey, claimed_paths: &[String]) -> Option<SyncedGame> {
  let system_component: u32 = entry.get_value("SystemComponent").unwrap_or(0);
  if system_component == 1 {
    return None;
  }
  let title: String = entry.get_value("DisplayName").ok()?;
  if title.trim().is_empty() {
    return None;
  }
  let publisher: Option<String> = entry.get_value("Publisher").ok();
  let lower_title = title.to_lowercase();
  let lower_publisher = publisher.clone().unwrap_or_default().to_lowercase();
  if DENY_TITLES_EXACT.contains(&lower_title.as_str()) {
    return None;
  }
  if DENY_PUBLISHERS.iter().any(|publisher| lower_publisher == *publisher) {
    return None;
  }
  if DENY_KEYWORDS
    .iter()
    .any(|keyword| lower_title.contains(keyword) || lower_publisher.contains(keyword))
  {
    return None;
  }

  let install_location: String = entry.get_value("InstallLocation").ok()?;
  let install_dir = Path::new(install_location.trim_end_matches(['\\', '/']));
  if install_location.trim().is_empty() || !install_dir.is_dir() {
    return None;
  }
  let install_location = install_dir.to_string_lossy().to_string();
  if claimed_paths.iter().any(|claimed| paths_overlap(claimed, &install_location)) {
    return None;
  }

  let display_icon: Option<String> = entry.get_value("DisplayIcon").ok();
  let launch_target = display_icon
    .and_then(|icon| strip_icon_index(&icon))
    .filter(|path| Path::new(path).is_file())
    .or_else(|| largest_exe_in(install_dir))?;

  Some(SyncedGame {
    source_game_id: slugify(&title),
    title,
    install_path: Some(install_location),
    launch_type: "exe".into(),
    launch_target,
    launch_args: None,
    hero_image: None,
    cover_image: None,
    header_image: None,
    description: None,
    playtime_minutes: None,
    last_played_at: None,
    developers: publisher,
    genres: None,
    release_date: None,
    details_synced_at: None,
  })
}

fn paths_overlap(claimed: &str, candidate: &str) -> bool {
  let claimed = claimed.to_lowercase();
  let candidate = candidate.to_lowercase();
  claimed == candidate || claimed.starts_with(&candidate) || candidate.starts_with(&claimed)
}

fn strip_icon_index(display_icon: &str) -> Option<String> {
  let path = display_icon.rsplit_once(',').map(|(path, _)| path).unwrap_or(display_icon);
  let trimmed = path.trim().trim_matches('"');
  if trimmed.is_empty() {
    None
  } else {
    Some(trimmed.to_string())
  }
}

fn largest_exe_in(dir: &Path) -> Option<String> {
  let entries = fs::read_dir(dir).ok()?;
  entries
    .flatten()
    .map(|entry| entry.path())
    .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("exe"))
    .max_by_key(|path| fs::metadata(path).map(|meta| meta.len()).unwrap_or(0))
    .map(|path| path.to_string_lossy().to_string())
}

fn slugify(title: &str) -> String {
  let mut slug = String::new();
  let mut last_was_dash = false;
  for ch in title.to_lowercase().chars() {
    if ch.is_ascii_alphanumeric() {
      slug.push(ch);
      last_was_dash = false;
    } else if !last_was_dash {
      slug.push('-');
      last_was_dash = true;
    }
  }
  slug.trim_matches('-').to_string()
}

#[cfg(not(windows))]
pub fn discover_other_games(_claimed_paths: &[String]) -> Vec<SyncedGame> {
  Vec::new()
}

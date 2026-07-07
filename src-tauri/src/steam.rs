use serde_json::Value;
use std::{
  collections::HashMap,
  fs,
  path::{Path, PathBuf},
  time::Duration,
};

use crate::error::{NexoraError, Result};
use crate::models::{SteamDetails, SteamGame};
use crate::vdf::{get_direct_ci, parse_vdf_object, parse_vdf_values};

/// Everything about an installed Steam app that can be read straight off disk, with no
/// network round-trip. Cheap to (re)collect on every sync; `fetch_steam_details` is the
/// only part that costs a request per app, so callers gather these first and decide
/// afterwards which appids actually still need a store lookup.
pub struct LocalManifest {
  pub appid: String,
  pub title: String,
  pub install_path: String,
  pub playtime_minutes: i64,
  pub last_played_at: Option<String>,
  pub hero_image: String,
  pub cover_image: String,
}

/// Parses one appmanifest_*.acf file into its local-only fields. Returns `Ok(None)` for
/// manifests that are missing an appid/name (not `ManifestOutcome::Skip` - that variant is
/// reserved for the caller, which also has to fold in the store-lookup outcome).
pub fn parse_local_manifest(
  path: &Path,
  steamapps: &Path,
  playtimes: &HashMap<String, (i64, Option<String>)>,
) -> Result<Option<LocalManifest>> {
  let content = fs::read_to_string(path)?;
  let Some(appid) = parse_vdf_values(&content, "appid").into_iter().next() else { return Ok(None) };
  let Some(title) = parse_vdf_values(&content, "name").into_iter().next() else { return Ok(None) };
  let install_dir = parse_vdf_values(&content, "installdir").into_iter().next();
  let install_path = install_dir
    .map(|dir| steamapps.join("common").join(dir).to_string_lossy().to_string())
    .unwrap_or_else(|| steamapps.join("common").to_string_lossy().to_string());

  let (playtime_minutes, last_played_at) = playtimes.get(&appid).cloned().unwrap_or((0, None));

  Ok(Some(LocalManifest {
    hero_image: steam_library_image(&appid, "library_hero.jpg"),
    cover_image: steam_library_image(&appid, "library_600x900.jpg"),
    appid,
    title,
    install_path,
    playtime_minutes,
    last_played_at,
  }))
}

/// `details_synced_at` should be `Some(now)` only when `details` was just fetched fresh from
/// the store this run - pass `None` when reusing a cached copy or falling back after a failed
/// lookup, so `upsert_synced_game` leaves the previously recorded timestamp alone.
pub fn build_steam_game(local: LocalManifest, details: SteamDetails, details_synced_at: Option<String>) -> SteamGame {
  SteamGame {
    header_image: details
      .header_image
      .unwrap_or_else(|| steam_library_image(&local.appid, "header.jpg")),
    description: details.description,
    developers: details.developers,
    genres: details.genres,
    release_date: details.release_date,
    appid: local.appid,
    title: local.title,
    install_path: local.install_path,
    playtime_minutes: local.playtime_minutes,
    last_played_at: local.last_played_at,
    hero_image: local.hero_image,
    cover_image: local.cover_image,
    details_synced_at,
  }
}

/// Number of worker threads used to fan out Steam store lookups. The store API is the slow
/// part of a sync (one HTTP round-trip per app with no batch endpoint), so a handful of
/// threads turns what used to be a fully serial O(n) wait into roughly O(n / WORKERS).
const DETAIL_FETCH_WORKERS: usize = 8;

/// Looks up store details for every appid in `appids` that isn't already in `cached`, in
/// parallel across a small worker pool. Returns one entry per input appid: `Ok(None)` means
/// the store confirmed it isn't a launchable game, `Err` means the network/lookup failed
/// (caller should fall back to permissive defaults, same as the old serial behavior).
pub fn fetch_steam_details_bulk(
  appids: &[String],
  cached: &HashMap<String, SteamDetails>,
) -> HashMap<String, Result<Option<SteamDetails>>> {
  let pending: Vec<&String> = appids.iter().filter(|id| !cached.contains_key(id.as_str())).collect();
  if pending.is_empty() {
    return HashMap::new();
  }

  let chunk_count = DETAIL_FETCH_WORKERS.min(pending.len()).max(1);
  let chunk_size = pending.len().div_ceil(chunk_count);

  std::thread::scope(|scope| {
    let handles: Vec<_> = pending
      .chunks(chunk_size)
      .map(|chunk| {
        scope.spawn(move || {
          chunk
            .iter()
            .map(|appid| ((*appid).clone(), fetch_steam_details(appid)))
            .collect::<Vec<_>>()
        })
      })
      .collect();

    handles
      .into_iter()
      .flat_map(|handle| handle.join().unwrap_or_default())
      .collect()
  })
}

pub fn discover_steam() -> Result<PathBuf> {
  #[cfg(windows)]
  {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey("Software\\Valve\\Steam") {
      if let Ok(path) = key.get_value::<String, _>("SteamPath") {
        let path = PathBuf::from(path.replace('/', "\\"));
        if path.exists() {
          return Ok(path);
        }
      }
    }
  }

  for path in [
    PathBuf::from("C:\\Program Files (x86)\\Steam"),
    PathBuf::from("C:\\Program Files\\Steam"),
  ] {
    if path.exists() {
      return Ok(path);
    }
  }

  Err(NexoraError::Message("Steam installation was not found on this PC.".into()))
}

/// Whether Steam's client process is currently running. Used to decide whether
/// `steam://run/<appid>` needs a hand-launched `steam.exe` first - firing the URI while Steam
/// is closed still opens Steam, but Windows can drop the pending "run" request if it arrives
/// before Steam's own protocol-handler IPC server is up, silently leaving the game unlaunched.
pub fn is_steam_running() -> bool {
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let output = std::process::Command::new("tasklist")
      .args(["/FI", "IMAGENAME eq steam.exe", "/NH"])
      .creation_flags(CREATE_NO_WINDOW)
      .output();
    return match output {
      Ok(output) => String::from_utf8_lossy(&output.stdout).to_lowercase().contains("steam.exe"),
      Err(_) => false,
    };
  }
  #[cfg(not(windows))]
  false
}

/// Makes sure Steam is up and its protocol handler is ready to accept `steam://` requests
/// before we fire one at it. No-ops immediately if Steam is already running. Otherwise starts
/// `steam.exe` and polls for it to appear, plus a short grace period for its IPC server to
/// finish initializing, so the caller's subsequent `steam://run/<appid>` isn't dropped.
pub fn ensure_steam_running() -> Result<()> {
  if is_steam_running() {
    return Ok(());
  }

  let steam_path = discover_steam()?;
  let exe = steam_path.join("steam.exe");
  let mut command = std::process::Command::new(&exe);
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
  }
  command
    .spawn()
    .map_err(|err| NexoraError::Message(format!("Failed to start Steam: {err}")))?;

  for _ in 0..40 {
    std::thread::sleep(Duration::from_millis(500));
    if is_steam_running() {
      // Steam reports its process as running before its steam:// IPC handler is actually
      // ready to accept requests; give it a moment to finish booting.
      std::thread::sleep(Duration::from_secs(3));
      return Ok(());
    }
  }

  Err(NexoraError::Message("Timed out waiting for Steam to start.".into()))
}

pub fn discover_steam_libraries(steam_path: &Path) -> Vec<PathBuf> {
  let mut libraries = vec![steam_path.to_path_buf()];
  let library_file = steam_path.join("steamapps").join("libraryfolders.vdf");
  let Ok(content) = fs::read_to_string(library_file) else {
    return libraries;
  };

  for value in parse_vdf_values(&content, "path") {
    let path = PathBuf::from(value.replace("\\\\", "\\"));
    if path.exists() && !libraries.contains(&path) {
      libraries.push(path);
    }
  }
  libraries
}

/// Steam app types that are installed alongside real games (redistributables, tools,
/// wallpaper/streaming utilities, soundtracks) but are not themselves games to launch.
const NON_GAME_APP_TYPES: [&str; 6] = ["tool", "application", "config", "media", "music", "dlc"];

/// Looks up a title on the Steam store (no API key needed, unlike SteamGridDB) and returns
/// whatever description/genres/developers/release date the matched app has - used to fill in
/// metadata for manually-added games, which have no appid of their own to look up directly.
/// Takes the first search hit on the assumption that the exact title the user typed/picked
/// is specific enough to avoid false matches; `fetch_steam_details` below still filters out
/// non-game app types even if the search returns one.
pub fn lookup_store_details_by_title(title: &str) -> Option<SteamDetails> {
  let appid = find_appid_by_title(title)?;
  fetch_steam_details(&appid).ok().flatten()
}

fn find_appid_by_title(title: &str) -> Option<String> {
  let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(5)).build().ok()?;
  let mut url = reqwest::Url::parse("https://store.steampowered.com/api/storesearch/").ok()?;
  url.query_pairs_mut().append_pair("term", title).append_pair("cc", "us").append_pair("l", "english");
  let value: Value = client.get(url).send().ok()?.json().ok()?;
  value
    .get("items")
    .and_then(|items| items.as_array())
    .and_then(|items| items.first())
    .and_then(|item| item.get("id"))
    .map(|id| id.to_string())
}

/// Returns `Ok(None)` when the Steam store confirms this app is not a launchable game
/// (no store page, or a known non-game type), `Ok(Some(details))` for a real game, and
/// `Err` only on network/parse failure so an offline sync doesn't wrongly drop real games.
fn fetch_steam_details(appid: &str) -> Result<Option<SteamDetails>> {
  let url = format!("https://store.steampowered.com/api/appdetails?appids={}&filters=basic", appid);
  let client = reqwest::blocking::Client::builder()
    .timeout(Duration::from_secs(5))
    .build()?;
  let value: Value = client.get(url).send()?.json()?;
  let entry = value.get(appid);
  let success = entry
    .and_then(|entry| entry.get("success"))
    .and_then(|value| value.as_bool())
    .unwrap_or(false);
  if !success {
    return Ok(None);
  }
  let Some(data) = entry.and_then(|entry| entry.get("data")) else {
    return Ok(None);
  };
  let app_type = data.get("type").and_then(|value| value.as_str()).unwrap_or("game").to_lowercase();
  if NON_GAME_APP_TYPES.contains(&app_type.as_str()) {
    return Ok(None);
  }
  let developers = data.get("developers").and_then(|value| value.as_array()).map(|list| {
    list
      .iter()
      .filter_map(|entry| entry.as_str())
      .collect::<Vec<_>>()
      .join(", ")
  });
  let genres = data.get("genres").and_then(|value| value.as_array()).map(|list| {
    list
      .iter()
      .filter_map(|entry| entry.get("description").and_then(|d| d.as_str()))
      .collect::<Vec<_>>()
      .join(", ")
  });
  let release_date = data
    .get("release_date")
    .and_then(|value| value.get("date"))
    .and_then(|value| value.as_str())
    .map(str::to_string)
    .filter(|value| !value.trim().is_empty());
  Ok(Some(SteamDetails {
    header_image: data
      .get("header_image")
      .and_then(|value| value.as_str())
      .map(str::to_string),
    description: data
      .get("short_description")
      .and_then(|value| value.as_str())
      .map(strip_html)
      .filter(|value| !value.trim().is_empty()),
    developers: developers.filter(|value| !value.trim().is_empty()),
    genres: genres.filter(|value| !value.trim().is_empty()),
    release_date,
  }))
}

/// Steam only writes playtime into userdata/<id>/config/localconfig.vdf, not into
/// the appmanifest .acf files, so it has to be read from there separately.
pub fn read_steam_playtimes(steam_path: &Path) -> HashMap<String, (i64, Option<String>)> {
  let mut result: HashMap<String, (i64, Option<String>)> = HashMap::new();
  let userdata = steam_path.join("userdata");
  let Ok(entries) = fs::read_dir(&userdata) else {
    return result;
  };
  for entry in entries.flatten() {
    let config_path = entry.path().join("config").join("localconfig.vdf");
    let Ok(content) = fs::read_to_string(&config_path) else {
      continue;
    };
    let root = parse_vdf_object(&content);
    // Walk the exact path: localconfig.vdf has more than one "apps" key (e.g. a
    // controller-config "apps" directly under the root), so an unscoped search for
    // any "apps" key can match the wrong one. Only Software > Valve > Steam > apps
    // holds per-game Playtime/LastPlayed data.
    let apps = get_direct_ci(&root, "UserLocalConfigStore")
      .and_then(|value| get_direct_ci(value, "Software"))
      .and_then(|value| get_direct_ci(value, "Valve"))
      .and_then(|value| get_direct_ci(value, "Steam"))
      .and_then(|value| get_direct_ci(value, "apps"));
    let Some(Value::Object(apps_map)) = apps else {
      continue;
    };
    for (appid, entry_value) in apps_map {
      let Value::Object(fields) = entry_value else {
        continue;
      };
      // Steam's local config stores lifetime minutes under "Playtime" (older/alternate
      // client builds have used "PlaytimeForever"), never in the appmanifest .acf files.
      let playtime = fields
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("Playtime"))
        .or_else(|| fields.iter().find(|(key, _)| key.eq_ignore_ascii_case("PlaytimeForever")))
        .and_then(|(_, value)| value.as_str())
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
      let last_played = fields
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("LastPlayed"))
        .and_then(|(_, value)| value.as_str())
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|&seconds| seconds > 0)
        .and_then(|seconds| chrono::DateTime::from_timestamp(seconds, 0))
        .map(|dt| dt.to_rfc3339());

      let merged = result.entry(appid.clone()).or_insert((0, None));
      if playtime > merged.0 {
        merged.0 = playtime;
      }
      if last_played.is_some() {
        merged.1 = last_played;
      }
    }
  }
  result
}

fn steam_library_image(appid: &str, file: &str) -> String {
  format!("https://cdn.akamai.steamstatic.com/steam/apps/{}/{}", appid, file)
}

fn strip_html(value: &str) -> String {
  let mut output = String::new();
  let mut in_tag = false;
  for ch in value.chars() {
    match ch {
      '<' => in_tag = true,
      '>' => in_tag = false,
      _ if !in_tag => output.push(ch),
      _ => {}
    }
  }
  output
    .replace("&amp;", "&")
    .replace("&quot;", "\"")
    .replace("&#39;", "'")
    .trim()
    .to_string()
}

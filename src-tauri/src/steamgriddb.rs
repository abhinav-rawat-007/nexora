use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;

use crate::logging::log;

/// Non-Steam launchers (Epic, GOG, Riot, Battle.net, Xbox) don't expose any local artwork the
/// way Steam's CDN does, so for those sources we look the title up on SteamGridDB instead -
/// same idea as steam.rs's fetch_steam_details, different provider. Requires the user's own
/// free API key (Settings > Library > SteamGridDB API key); silently does nothing without one
/// rather than failing the sync.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artwork {
  pub cover_image: Option<String>,
  pub hero_image: Option<String>,
}

/// Same worker-pool approach as `steam::fetch_steam_details_bulk`: each title needs up to
/// three sequential SteamGridDB requests (search + grid + hero) with no batch endpoint, so
/// fanning titles out across threads is what turns a sync of many uncovered games from
/// "one at a time" into "a handful at a time".
const ARTWORK_FETCH_WORKERS: usize = 6;

pub fn fetch_artwork_bulk(api_key: &str, titles: &[String]) -> HashMap<String, Option<Artwork>> {
  if api_key.trim().is_empty() || titles.is_empty() {
    return HashMap::new();
  }

  let chunk_count = ARTWORK_FETCH_WORKERS.min(titles.len()).max(1);
  let chunk_size = titles.len().div_ceil(chunk_count);

  std::thread::scope(|scope| {
    let handles: Vec<_> = titles
      .chunks(chunk_size)
      .map(|chunk| {
        scope.spawn(move || {
          chunk
            .iter()
            .map(|title| (title.clone(), fetch_artwork(api_key, title)))
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

pub fn fetch_artwork(api_key: &str, title: &str) -> Option<Artwork> {
  if api_key.trim().is_empty() {
    return None;
  }
  // .http1_only(): SteamGridDB's Cloudflare front-end serves its SPA fallback page (HTTP 404,
  // no JSON) for HTTP/2 requests - confirmed by testing the identical request over h1 vs h2 -
  // while curl and browsers negotiating h1 get a normal API response. Forcing h1 here avoids
  // the ALPN negotiation that triggers it.
  let client = match reqwest::blocking::Client::builder().http1_only().timeout(Duration::from_secs(6)).build() {
    Ok(client) => client,
    Err(err) => {
      log(&format!("steamgriddb: failed to build http client: {err}"));
      return None;
    }
  };

  // No trailing slash on the base: path_segments_mut().push() appends *after* the current
  // last segment, and a URL ending in "/" already has an empty last segment - pushing onto
  // that produces "autocomplete//VALORANT" (double slash), which SteamGridDB's edge 404s (and
  // then caches the 404 for that exact malformed path).
  let mut search_url = reqwest::Url::parse("https://www.steamgriddb.com/api/v2/search/autocomplete").ok()?;
  search_url.path_segments_mut().ok()?.push(title);
  // Deliberately nothing about the API key here - this log file is exactly what users get
  // asked to share when reporting issues, so even a key prefix doesn't belong in it.
  log(&format!("steamgriddb: requesting {search_url}"));

  let response = match client.get(search_url).bearer_auth(api_key).send() {
    Ok(response) => response,
    Err(err) => {
      log(&format!("steamgriddb: search request for {title:?} failed: {err}"));
      return None;
    }
  };
  let status = response.status();
  let headers = response
    .headers()
    .iter()
    .map(|(name, value)| format!("{}={:?}", name, value.to_str().unwrap_or("<binary>")))
    .collect::<Vec<_>>()
    .join(", ");
  let body = response.text().unwrap_or_default();
  if !status.is_success() {
    log(&format!("steamgriddb: search for {title:?} returned {status}. headers: [{headers}]. body: {body}"));
    return None;
  }
  let search: Value = match serde_json::from_str(&body) {
    Ok(value) => value,
    Err(err) => {
      log(&format!("steamgriddb: search response for {title:?} was not valid JSON: {err} (body: {body})"));
      return None;
    }
  };
  let Some(game_id) = search.get("data").and_then(|data| data.as_array()).and_then(|list| list.first()).and_then(|entry| entry.get("id")).and_then(|id| id.as_u64()) else {
    log(&format!("steamgriddb: no search results for {title:?} (response: {body})"));
    return None;
  };
  log(&format!("steamgriddb: matched {title:?} to SteamGridDB game id {game_id}"));

  // "grid" is SteamGridDB's name for the tall box-art image (matches Steam's library_600x900),
  // "hero" is the wide banner (matches Steam's library_hero).
  let cover_image = fetch_first_image(
    &client,
    api_key,
    &format!("https://www.steamgriddb.com/api/v2/grids/game/{}?dimensions=600x900", game_id),
    "grid",
  );
  let hero_image = fetch_first_image(
    &client,
    api_key,
    &format!("https://www.steamgriddb.com/api/v2/heroes/game/{}", game_id),
    "hero",
  );

  if cover_image.is_none() && hero_image.is_none() {
    log(&format!("steamgriddb: game id {game_id} ({title:?}) had no grid or hero images available"));
    return None;
  }
  Some(Artwork { cover_image, hero_image })
}

fn fetch_first_image(client: &reqwest::blocking::Client, api_key: &str, url: &str, kind: &str) -> Option<String> {
  let response = match client.get(url).bearer_auth(api_key).send() {
    Ok(response) => response,
    Err(err) => {
      log(&format!("steamgriddb: {kind} request failed: {err}"));
      return None;
    }
  };
  let status = response.status();
  let body = response.text().unwrap_or_default();
  if !status.is_success() {
    log(&format!("steamgriddb: {kind} request returned {status}: {body}"));
    return None;
  }
  let value: Value = match serde_json::from_str(&body) {
    Ok(value) => value,
    Err(err) => {
      log(&format!("steamgriddb: {kind} response was not valid JSON: {err} (body: {body})"));
      return None;
    }
  };
  value.get("data").and_then(|data| data.as_array()).and_then(|list| list.first()).and_then(|entry| entry.get("url")).and_then(|url| url.as_str()).map(str::to_string)
}

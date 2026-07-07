mod battlenet;
mod commands;
mod controller;
mod db;
mod epic;
mod error;
mod gog;
mod logging;
mod models;
// mod other; - disabled for now, see commands.rs sync_all_libraries
mod playtime;
mod riot;
mod steam;
mod steamgriddb;
mod util;
mod vdf;
mod xbox;

use rusqlite::Connection;
use std::{fs, sync::{Arc, Mutex}};
use tauri::Manager;

use commands::{
  add_manual_game, fetch_game_metadata, get_active_sessions, get_games, get_settings, launch_game, remove_game,
  set_game_favorite, set_game_order, set_setting, sync_all_libraries, sync_steam_library, test_vibration, update_game,
};
use controller::start_controller_thread;
use db::{init_db, seed_settings};
use error::NexoraError;
use models::AppState;

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      let db_path = app
        .path()
        .app_data_dir()
        .map_err(|err| NexoraError::Message(err.to_string()))?
        .join("nexora.sqlite");
      if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)?;
      }
      let connection = Connection::open(db_path)?;
      init_db(&connection)?;
      seed_settings(&connection)?;

      logging::init(app.handle());

      let gilrs = gilrs::Gilrs::new()
        .map_err(|err| logging::log(&format!("gilrs::Gilrs::new() failed: {err}")))
        .ok()
        .map(|instance| Arc::new(Mutex::new(instance)));
      let state = AppState {
        db: Arc::new(Mutex::new(connection)),
        gilrs: gilrs.clone(),
        sessions: Arc::new(Mutex::new(std::collections::HashMap::new())),
      };
      app.manage(state.clone());
      if let Some(gilrs) = gilrs {
        start_controller_thread(app.handle().clone(), gilrs.clone());

        // While a game is running, some launchers/games take exclusive ownership of the
        // controller's HID device (Steam Input's virtual-device layer is the common case) and
        // never release it cleanly, leaving gilrs holding a dead handle it never retries on its
        // own - previously the only fix was physically unplugging/replugging the controller.
        // Recreating the Gilrs instance re-enumerates every connected device, which has the same
        // effect as a replug, so do that whenever Nexora's window regains focus (e.g. the player
        // alt-tabs back from the game).
        if let Some(window) = app.get_webview_window("main") {
          window.on_window_event(move |event| {
            match event {
              tauri::WindowEvent::Focused(focused) => {
                logging::log(&format!("window focus changed: focused={focused}"));
                if *focused {
                  if let Ok(mut gilrs) = gilrs.lock() {
                    let before: Vec<String> = gilrs.gamepads().map(|(_, pad)| pad.name().to_string()).collect();
                    match gilrs::Gilrs::new() {
                      Ok(fresh) => {
                        *gilrs = fresh;
                        let after: Vec<String> = gilrs.gamepads().map(|(_, pad)| pad.name().to_string()).collect();
                        logging::log(&format!(
                          "gilrs refreshed on refocus: before={before:?} after={after:?}"
                        ));
                      }
                      Err(err) => logging::log(&format!("gilrs refresh on refocus failed: {err}")),
                    }
                  }
                }
              }
              _ => {}
            }
          });
        }
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_games,
      sync_steam_library,
      sync_all_libraries,
      add_manual_game,
      fetch_game_metadata,
      update_game,
      remove_game,
      set_game_favorite,
      set_game_order,
      launch_game,
      get_active_sessions,
      get_settings,
      set_setting,
      test_vibration
    ])
    .run(tauri::generate_context!())
    .expect("error while running Nexora");
}

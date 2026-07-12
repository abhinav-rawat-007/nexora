use gilrs::ff::{BaseEffect, BaseEffectType, EffectBuilder, Replay, Ticks};
use gilrs::{Axis, Button, Event, EventType, Gilrs, PowerInfo};
use std::sync::{Arc, Mutex};
use std::{
  thread,
  time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

use crate::db::read_settings;
use crate::error::{NexoraError, Result};
use crate::logging::log;
use crate::models::{AppState, ControllerBatteryEvent, ControllerButtonEvent, ControllerConnectionEvent};

const SONY_VID: u16 = 0x054C;
const DUALSENSE_PID: u16 = 0x0CE6;

/// Byte offset of the status field (battery capacity + charging state) within DualSense input
/// reports, counting from the start of the buffer hidapi hands back (which includes the report
/// ID at index 0). Bluetooth reports (id 0x31) carry two extra header bytes versus USB (id
/// 0x01), so the offset differs between the two. Layout reverse-engineered by the community
/// (see Linux's hid-playstation driver, dualsensectl, pydualsense).
const DS_STATUS_OFFSET_USB: usize = 53;
const DS_STATUS_OFFSET_BT: usize = 54;

/// Reads the DualSense's battery directly from its raw HID input report, bypassing gilrs.
/// Needed because Windows binds the generic HID class driver to DualSense over Bluetooth (no
/// Sony driver, and Windows.Gaming.Input has no built-in recognition for Sony pads), so
/// `gilrs::Gamepad::power_info()` always reports `Unknown` on that path - see the comment on
/// `battery_event` below for the USB/wired case, which gilrs handles fine.
fn read_dualsense_raw_battery() -> Option<ControllerBatteryEvent> {
  let api = hidapi::HidApi::new().ok()?;
  let device_info = api
    .device_list()
    .find(|d| d.vendor_id() == SONY_VID && d.product_id() == DUALSENSE_PID && d.usage_page() == 0x01 && d.usage() == 0x05)
    .or_else(|| api.device_list().find(|d| d.vendor_id() == SONY_VID && d.product_id() == DUALSENSE_PID))?;
  let device = device_info.open_device(&api).ok()?;

  let mut buf = [0u8; 128];
  let bytes_read = device.read_timeout(&mut buf, 300).ok()?;
  if bytes_read == 0 {
    return None;
  }

  let report_id = buf[0];
  let status_offset = match report_id {
    0x01 => DS_STATUS_OFFSET_USB,
    0x31 => DS_STATUS_OFFSET_BT,
    _ => return None,
  };
  if bytes_read <= status_offset {
    return None;
  }

  let status = buf[status_offset];
  let battery_data = (status & 0x0F) as u32;
  let charging_status = (status >> 4) & 0x0F;
  match charging_status {
    0x0 => Some(ControllerBatteryEvent { level: Some((battery_data * 10 + 5).min(100) as u8), charging: false, wired: false }),
    0x1 => Some(ControllerBatteryEvent { level: Some((battery_data * 10 + 5).min(100) as u8), charging: true, wired: false }),
    0x2 => Some(ControllerBatteryEvent { level: Some(100), charging: false, wired: false }),
    _ => None,
  }
}

/// Maps gilrs' power state (backed by Windows.Gaming.Input's battery report, which works for
/// Xbox, DualShock/DualSense, and most other wireless pads Windows recognizes - not just
/// XInput devices) to the event the frontend badge renders.
fn battery_event(info: PowerInfo) -> ControllerBatteryEvent {
  match info {
    PowerInfo::Wired => ControllerBatteryEvent { level: None, charging: false, wired: true },
    PowerInfo::Charged => ControllerBatteryEvent { level: Some(100), charging: false, wired: false },
    PowerInfo::Charging(pct) => ControllerBatteryEvent { level: Some(pct), charging: true, wired: false },
    PowerInfo::Discharging(pct) => ControllerBatteryEvent { level: Some(pct), charging: false, wired: false },
    _ => ControllerBatteryEvent { level: None, charging: false, wired: false },
  }
}

/// Battery reading to actually emit: gilrs' result, unless it came back as the "couldn't tell"
/// shape (not wired, not charging, no level), in which case try reading the DualSense's raw
/// HID report directly (see `read_dualsense_raw_battery`) before giving up.
fn resolve_battery(info: PowerInfo) -> ControllerBatteryEvent {
  let event = battery_event(info);
  if event.level.is_none() && !event.charging && !event.wired {
    if let Some(raw) = read_dualsense_raw_battery() {
      log(&format!("gilrs battery unknown, raw DualSense HID report gave: {raw:?}"));
      return raw;
    }
  }
  event
}

/// Canonical button name shared with the frontend's ControllerButton type, so remapping
/// configured in Settings applies the same way whether the button came from gilrs or the
/// browser Gamepad API fallback.
fn canonical_button(button: Button) -> Option<&'static str> {
  match button {
    Button::South => Some("South"),
    Button::East => Some("East"),
    Button::North => Some("North"),
    Button::West => Some("West"),
    Button::LeftTrigger => Some("LB"),
    Button::RightTrigger => Some("RB"),
    Button::LeftTrigger2 => Some("LT"),
    Button::RightTrigger2 => Some("RT"),
    Button::Select => Some("Select"),
    Button::Start => Some("Start"),
    Button::DPadUp => Some("DPadUp"),
    Button::DPadDown => Some("DPadDown"),
    Button::DPadLeft => Some("DPadLeft"),
    Button::DPadRight => Some("DPadRight"),
    _ => None,
  }
}

/// Fallback stick deadzone (as a fraction of the axis's -1.0..1.0 range) when the user's
/// "controllerDeadzone" setting can't be read - matches its seeded default (55%), so native
/// and browser-driven navigation feel consistent.
const DEFAULT_STICK_DEADZONE: f32 = 0.55;

/// The user's configured stick deadzone (Settings > Controller, stored as a 0-100 percent
/// string), as the 0-1 fraction `stick_direction` compares against. Clamped so a bad value
/// can't make the stick fire constantly (0) or never (1).
fn read_stick_deadzone(state: &AppState) -> f32 {
  let Ok(db) = state.db.lock() else { return DEFAULT_STICK_DEADZONE };
  let Ok(settings) = read_settings(&db) else { return DEFAULT_STICK_DEADZONE };
  settings
    .controller_deadzone
    .trim()
    .parse::<f32>()
    .map(|percent| (percent / 100.0).clamp(0.1, 0.95))
    .unwrap_or(DEFAULT_STICK_DEADZONE)
}

/// Collapses the left stick's (x, y) position into a single D-pad-style direction, so stick
/// navigation can be emitted through the same "controller-button" channel the physical D-pad
/// uses. The larger-magnitude axis wins to avoid firing two directions on a diagonal push.
/// gilrs reports up as a positive Y value on Windows (raw XInput sThumbLY is unmodified).
fn stick_direction(x: f32, y: f32, deadzone: f32) -> Option<&'static str> {
  if x.abs() < deadzone && y.abs() < deadzone {
    return None;
  }
  if x.abs() >= y.abs() {
    if x > deadzone {
      Some("DPadRight")
    } else if x < -deadzone {
      Some("DPadLeft")
    } else {
      None
    }
  } else if y > deadzone {
    Some("DPadUp")
  } else if y < -deadzone {
    Some("DPadDown")
  } else {
    None
  }
}

pub fn start_controller_thread(app: AppHandle, gilrs: Arc<Mutex<Gilrs>>) {
  thread::spawn(move || {
    // AppState is managed before this thread starts (see lib.rs setup); try_state keeps a
    // future ordering change from panicking the whole thread over a missing deadzone source.
    let state: Option<AppState> = app.try_state::<AppState>().map(|state| state.inner().clone());
    if let Ok(gilrs) = gilrs.lock() {
      let seen: Vec<String> = gilrs.gamepads().map(|(_, pad)| pad.name().to_string()).collect();
      log(&format!("gilrs sees {} gamepad(s) at startup: {:?}", seen.len(), seen));
      if let Some((_, gamepad)) = gilrs.gamepads().next() {
        let _ = app.emit("controller-connected", ControllerConnectionEvent { name: gamepad.name().to_string() });
        let _ = app.emit("controller-battery", resolve_battery(gamepad.power_info()));
      }
    } else {
      log("failed to lock gilrs at startup");
    }

    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let mut stick_x = 0f32;
    let mut stick_y = 0f32;
    let mut stick_dir: Option<&'static str> = None;
    // Re-read the user's deadzone setting on a timer (not per axis event - that would hit the
    // DB hundreds of times a second while the stick moves) so Settings changes apply without
    // an app restart.
    let mut deadzone = state.as_ref().map(read_stick_deadzone).unwrap_or(DEFAULT_STICK_DEADZONE);
    let mut last_deadzone_check = Instant::now();
    // Battery level changes slowly - poll it on a timer instead of on every event/tick, since
    // each check is a real WinRT call (TryGetBatteryReport), not a free read.
    let mut last_battery_check = Instant::now();
    // Heartbeat, independent of Connected/Disconnected events: gilrs doesn't always fire a
    // Disconnected event when a device stops responding (e.g. another process grabbing exclusive
    // access can just make polling go silent), so log the gamepad list on a timer too - if the
    // last heartbeat before the controller "dies" in-game still shows it connected, that rules out
    // gilrs losing the device and points at something downstream (event delivery, frontend, etc).
    let mut last_heartbeat = Instant::now();
    loop {
      let events: Vec<EventType> = {
        let Ok(mut gilrs) = gilrs.lock() else { break };
        let mut pending = Vec::new();
        while let Some(Event { event, .. }) = gilrs.next_event() {
          pending.push(event);
        }
        pending
      };

      if last_deadzone_check.elapsed() > Duration::from_secs(3) {
        last_deadzone_check = Instant::now();
        if let Some(state) = &state {
          deadzone = read_stick_deadzone(state);
        }
      }

      // 30s is frequent enough to bracket a controller "dying" in-game for diagnostics without
      // flooding the log - at the previous 2s cadence this single line was ~40k lines per day
      // of the log file's growth.
      if last_heartbeat.elapsed() > Duration::from_secs(30) {
        last_heartbeat = Instant::now();
        if let Ok(gilrs) = gilrs.lock() {
          let seen: Vec<(String, bool)> = gilrs
            .gamepads()
            .map(|(_, pad)| (pad.name().to_string(), pad.is_connected()))
            .collect();
          log(&format!("heartbeat: {seen:?}"));
        }
      }

      if last_battery_check.elapsed() > Duration::from_secs(20) {
        last_battery_check = Instant::now();
        if let Ok(gilrs) = gilrs.lock() {
          if let Some((_, gamepad)) = gilrs.gamepads().next() {
            let _ = app.emit("controller-battery", resolve_battery(gamepad.power_info()));
          }
        }
      }

      for event in events {
        match event {
          EventType::Connected => {
            if let Ok(gilrs) = gilrs.lock() {
              if let Some((_, gamepad)) = gilrs.gamepads().next() {
                log(&format!("Connected event: {}", gamepad.name()));
                let _ = app.emit("controller-connected", ControllerConnectionEvent { name: gamepad.name().to_string() });
                let _ = app.emit("controller-battery", resolve_battery(gamepad.power_info()));
              }
            }
          }
          EventType::Disconnected => {
            log("Disconnected event");
            let _ = app.emit("controller-disconnected", ());
          }
          EventType::ButtonPressed(button, _) => {
            log(&format!("ButtonPressed: {:?} -> {:?}", button, canonical_button(button)));
            if let Some(button) = canonical_button(button) {
              if last_emit.elapsed() > Duration::from_millis(80) {
                let _ = app.emit("controller-button", ControllerButtonEvent { button: button.into() });
                last_emit = Instant::now();
              } else {
                log("throttled (within 80ms of last emit)");
              }
            }
          }
          EventType::AxisChanged(Axis::LeftStickX, value, _) => {
            stick_x = value;
            let dir = stick_direction(stick_x, stick_y, deadzone);
            if dir != stick_dir {
              stick_dir = dir;
              if let Some(button) = dir {
                if last_emit.elapsed() > Duration::from_millis(80) {
                  let _ = app.emit("controller-button", ControllerButtonEvent { button: button.into() });
                  last_emit = Instant::now();
                }
              }
            }
          }
          EventType::AxisChanged(Axis::LeftStickY, value, _) => {
            stick_y = value;
            let dir = stick_direction(stick_x, stick_y, deadzone);
            if dir != stick_dir {
              stick_dir = dir;
              if let Some(button) = dir {
                if last_emit.elapsed() > Duration::from_millis(80) {
                  let _ = app.emit("controller-button", ControllerButtonEvent { button: button.into() });
                  last_emit = Instant::now();
                }
              }
            }
          }
          _ => {}
        }
      }

      thread::sleep(Duration::from_millis(16));
    }
  });
}

pub fn trigger_test_vibration(state: &AppState) -> Result<()> {
  let Some(gilrs) = &state.gilrs else {
    return Err(NexoraError::Message("No controller backend is available.".into()));
  };
  let mut gilrs = gilrs
    .lock()
    .map_err(|_| NexoraError::Message("Controller lock failed.".into()))?;

  let gamepad_id = gilrs
    .gamepads()
    .next()
    .map(|(id, _)| id)
    .ok_or_else(|| NexoraError::Message("No controller is connected.".into()))?;

  let effect = EffectBuilder::new()
    .add_effect(BaseEffect {
      kind: BaseEffectType::Strong { magnitude: 40_000 },
      scheduling: Replay {
        after: Ticks::from_ms(0),
        play_for: Ticks::from_ms(250),
        with_delay: Ticks::from_ms(0),
      },
      ..Default::default()
    })
    .add_gamepad(&gilrs.gamepad(gamepad_id))
    .finish(&mut gilrs)
    .map_err(|err| NexoraError::Message(format!("Vibration is not supported on this controller: {err}")))?;

  effect
    .play()
    .map_err(|err| NexoraError::Message(format!("Could not play vibration: {err}")))?;

  Ok(())
}

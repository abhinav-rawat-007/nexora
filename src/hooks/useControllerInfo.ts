import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ControllerKind } from "@/types";
import { detectControllerKind } from "@/lib/gamepad";

export interface ControllerBattery {
  /** 0-100, or null when the level couldn't be determined (includes wired controllers). */
  level: number | null;
  charging: boolean;
  wired: boolean;
}

export interface ControllerInfo {
  connected: boolean;
  name: string;
  kind: ControllerKind;
  /** Only ever populated in the Tauri build (gilrs/Windows.Gaming.Input) - the browser Gamepad
   * API has no battery field, so this stays null when running the web fallback path. */
  battery: ControllerBattery | null;
}

const DISCONNECTED: ControllerInfo = { connected: false, name: "", kind: "generic", battery: null };

/** Tracks the currently connected controller's name/family, from either the browser Gamepad API or Tauri/gilrs. */
export function useControllerInfo(): ControllerInfo {
  const [info, setInfo] = useState<ControllerInfo>(DISCONNECTED);

  useEffect(() => {
    function scan() {
      const pad = navigator.getGamepads?.().find(Boolean);
      if (pad) {
        setInfo((current) => ({
          connected: true,
          name: pad.id,
          kind: detectControllerKind(pad.id),
          battery: current.name === pad.id ? current.battery : null,
        }));
      } else {
        setInfo((current) => (current.connected && "__TAURI_INTERNALS__" in window ? current : DISCONNECTED));
      }
    }
    scan();
    window.addEventListener("gamepadconnected", scan);
    window.addEventListener("gamepaddisconnected", scan);
    const interval = window.setInterval(scan, 1000);
    return () => {
      window.removeEventListener("gamepadconnected", scan);
      window.removeEventListener("gamepaddisconnected", scan);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    // See the matching comment in useGameControls.ts: `listen()` resolves asynchronously, and
    // StrictMode's double-invoked effects in development can otherwise leak the first
    // subscription (its cleanup runs before `unlisten` is assigned).
    let cancelled = false;
    let unlistenConnect: (() => void) | undefined;
    let unlistenDisconnect: (() => void) | undefined;
    let unlistenBattery: (() => void) | undefined;
    listen<{ name: string }>("controller-connected", (event) => {
      // Battery arrives moments later via its own event (see controller.rs) - reset to null
      // here rather than leaving a stale reading from whatever was previously plugged in.
      setInfo({ connected: true, name: event.payload.name, kind: detectControllerKind(event.payload.name), battery: null });
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else unlistenConnect = cleanup;
    });
    listen("controller-disconnected", () => {
      setInfo(DISCONNECTED);
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else unlistenDisconnect = cleanup;
    });
    listen<{ level: number | null; charging: boolean; wired: boolean }>("controller-battery", (event) => {
      setInfo((current) => (current.connected ? { ...current, battery: event.payload } : current));
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else unlistenBattery = cleanup;
    });
    return () => {
      cancelled = true;
      unlistenConnect?.();
      unlistenDisconnect?.();
      unlistenBattery?.();
    };
  }, []);

  return info;
}

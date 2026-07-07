import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ControllerBindings } from "@/types";
import { ACTION_TO_KEY, STANDARD_BUTTON_INDEX, invertBindings } from "@/lib/gamepad";

const isTauri = () => "__TAURI_INTERNALS__" in window;

/**
 * Settings navigation (App.tsx) dispatches synthetic keydown events onto focused row controls
 * (sliders, select popups) so Radix's own key handlers can apply the change. Those events bubble
 * all the way to `window`, where they'd otherwise be picked up by the listener below as if they
 * were new input and re-run `handleAction` a second time - e.g. every slider nudge would fire its
 * move sound and step twice. Events dispatched via `dispatchSettingsKey` are tagged here so the
 * window listener can ignore them.
 */
const syntheticSettingsEvents = new WeakSet<Event>();

export function dispatchSettingsKey(el: HTMLElement, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  syntheticSettingsEvents.add(event);
  el.dispatchEvent(event);
}

/**
 * Wires keyboard, gamepad polling, and Tauri controller-button events to a single
 * `handleAction(key)` callback so all three input sources drive the same navigation logic.
 * `bindings` maps abstract actions to physical buttons and is user-configurable in Settings.
 *
 * `handleAction` and `suppressed` are read through refs (kept current every render) rather than
 * effect dependencies, so none of the three input effects ever close over a stale `handleAction`
 * from an earlier render - that used to let gamepad input keep driving the home rail even after
 * a dialog opened, since the polling effect only reran when `deadzone`/`bindings`/`suppressed`
 * changed, not when `view` did.
 */
export function useGameControls(
  handleAction: (key: string) => boolean,
  suppressed: boolean,
  deadzone = 0.55,
  bindings: ControllerBindings,
) {
  const handleActionRef = useRef(handleAction);
  const suppressedRef = useRef(suppressed);
  useEffect(() => {
    handleActionRef.current = handleAction;
    suppressedRef.current = suppressed;
  });

  useEffect(() => {
    let lastMove = 0;
    const onKey = (event: KeyboardEvent) => {
      if (syntheticSettingsEvents.has(event)) return;
      if (suppressedRef.current) return;
      if (Date.now() - lastMove < 90) return;
      // Letter shortcuts (search/sync/settings/etc.) would otherwise fire while typing into a
      // Settings text field - view === "settings" isn't in the suppressed list above (arrow-key
      // navigation between sections needs to keep working there), so this has to be checked by
      // event target instead.
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const handled = handleActionRef.current(event.key);
      if (handled) {
        event.preventDefault();
        lastMove = Date.now();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    // Inside the Tauri app, gilrs already delivers buttons and stick-emulated D-pad directions
    // through the "controller-button" event below - polling the browser Gamepad API too would
    // process the same physical input twice (observed as the rail "jumping" past entries).
    if (isTauri()) return;
    const buttonToAction = invertBindings(bindings);
    let frame = 0;
    let lastMove = 0;
    const loop = () => {
      const pad = navigator.getGamepads?.().find(Boolean);
      if (pad && !suppressedRef.current && Date.now() - lastMove > 160) {
        const x = pad.axes[0] ?? 0;
        const y = pad.axes[1] ?? 0;
        let action: string | undefined;
        for (const [index, button] of Object.entries(STANDARD_BUTTON_INDEX)) {
          if (pad.buttons[Number(index)]?.pressed) {
            const mapped = buttonToAction[button];
            if (mapped) {
              action = ACTION_TO_KEY[mapped];
              break;
            }
          }
        }
        if (!action) {
          action =
            x > deadzone ? "ArrowRight" :
            x < -deadzone ? "ArrowLeft" :
            y > deadzone ? "ArrowDown" :
            y < -deadzone ? "ArrowUp" :
            undefined;
        }
        if (action && handleActionRef.current(action)) lastMove = Date.now();
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [deadzone, bindings]);

  useEffect(() => {
    if (!isTauri()) return;
    const buttonToAction = invertBindings(bindings);
    // `listen()` resolves asynchronously, but React 18 StrictMode invokes effects twice in
    // development (mount -> cleanup -> mount) synchronously. Without this guard, the cleanup
    // from the first invocation runs before its `listen()` promise has resolved, so `unlisten`
    // is still undefined and the first subscription never gets torn down - leaving two live
    // listeners that each call `handleAction` for every physical button press (seen as the rail
    // jumping two entries per press).
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<{ button: string }>("controller-button", (event) => {
      if (suppressedRef.current) return;
      const mapped = buttonToAction[event.payload.button as keyof typeof buttonToAction];
      if (mapped) handleActionRef.current(ACTION_TO_KEY[mapped]);
    }).then((cleanup) => {
      if (cancelled) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [bindings]);
}

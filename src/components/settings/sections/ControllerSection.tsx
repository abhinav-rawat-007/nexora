import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { testVibration } from "@/tauri";
import { ButtonGlyph } from "@/components/ButtonGlyph";
import type { AppSettings, ControllerActionName, ControllerButton, ControllerLayout } from "@/types";
import type { ControllerInfo } from "@/hooks/useControllerInfo";
import {
  ACTION_META,
  DEFAULT_BINDINGS,
  STANDARD_BUTTON_INDEX,
  buttonLabel,
  parseBindings,
  resolveLayout,
  serializeBindings,
} from "@/lib/gamepad";

const LAYOUT_OPTIONS: { value: ControllerLayout; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "xbox", label: "Xbox" },
  { value: "playstation", label: "PlayStation" },
];

export function ControllerSection({
  settings,
  onSetting,
  onRemapActiveChange,
  controllerInfo,
}: {
  settings: AppSettings;
  onSetting: (key: keyof AppSettings, value: string | boolean) => void;
  onRemapActiveChange: (active: boolean) => void;
  controllerInfo: ControllerInfo;
}) {
  const deadzone = Number(settings.controllerDeadzone ?? "55");
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [capturing, setCapturing] = useState<ControllerActionName | null>(null);
  const capturingRef = useRef<ControllerActionName | null>(null);

  const layout = settings.controllerLayout ?? "auto";
  const displayKind = resolveLayout(layout, controllerInfo.kind);
  const bindings = parseBindings(settings.controllerBindings);

  useEffect(() => {
    onRemapActiveChange(capturing !== null);
    return () => onRemapActiveChange(false);
  }, [capturing, onRemapActiveChange]);

  function applyBinding(action: ControllerActionName, button: ControllerButton) {
    onSetting("controllerBindings", serializeBindings({ ...bindings, [action]: button }));
    setCapturing(null);
    capturingRef.current = null;
  }

  // Poll the browser Gamepad API for a physical button press while a remap capture is active.
  useEffect(() => {
    if (!capturing) return;
    let frame = 0;
    const loop = () => {
      const pad = navigator.getGamepads?.().find(Boolean);
      if (pad) {
        for (const [index, button] of Object.entries(STANDARD_BUTTON_INDEX)) {
          if (pad.buttons[Number(index)]?.pressed) {
            applyBinding(capturing, button);
            return;
          }
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  // Also listen for the Tauri/gilrs raw button event, for the case where the browser Gamepad API
  // doesn't see the device but the native controller backend does.
  useEffect(() => {
    if (!capturing || !("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    listen<{ button: string }>("controller-button", (event) => {
      if (capturingRef.current) {
        applyBinding(capturingRef.current, event.payload.button as ControllerButton);
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  function startCapture(action: ControllerActionName) {
    setCapturing(action);
    capturingRef.current = action;
  }

  function resetBindings() {
    onSetting("controllerBindings", serializeBindings(DEFAULT_BINDINGS));
  }

  async function runTest() {
    setTesting(true);
    setTestStatus("Testing...");
    try {
      await testVibration();
      setTestStatus("Pulse sent.");
    } catch (err) {
      setTestStatus(err instanceof Error ? err.message : "Vibration is not available.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Controller</h2>

      <div className="settings-field">
        <div className="settings-field-header">
          <Label>Connected controller</Label>
        </div>
        <p className="settings-hint">
          {controllerInfo.connected
            ? `${controllerInfo.name} (detected as ${displayKind === "playstation" ? "PlayStation" : displayKind === "xbox" ? "Xbox" : "generic"})`
            : "No controller connected. Plug in a PlayStation or Xbox controller to test remapping."}
        </p>
      </div>

      <div className="settings-field">
        <div className="settings-field-header">
          <Label>Button layout</Label>
        </div>
        <div className="settings-row" style={{ gap: "0.5rem" }}>
          {LAYOUT_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant={layout === option.value ? "default" : "outline"}
              size="sm"
              onClick={() => onSetting("controllerLayout", option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <p className="settings-hint">
          Auto-detect matches on-screen button icons and labels to whichever controller is plugged in.
        </p>
      </div>

      <div className="settings-field">
        <div className="settings-field-header">
          <Label htmlFor="controller-deadzone">Stick deadzone</Label>
          <span className="settings-value">{deadzone}%</span>
        </div>
        <Slider
          id="controller-deadzone"
          value={[deadzone]}
          min={20}
          max={80}
          step={5}
          onValueChange={([value]) => onSetting("controllerDeadzone", String(value))}
        />
        <p className="settings-hint">
          How far you need to push the stick before it moves the selection. Raise this if the stick drifts on its own.
        </p>
      </div>

      <div className="settings-row">
        <div className="settings-row-copy">
          <Label htmlFor="controller-vibration">Vibration</Label>
          <p>Enables rumble feedback on supported controllers.</p>
        </div>
        <Switch
          id="controller-vibration"
          checked={settings.controllerVibration ?? true}
          onCheckedChange={(checked) => onSetting("controllerVibration", checked)}
        />
      </div>

      <div className="settings-field">
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={!settings.controllerVibration}
          loading={testing}
          onClick={runTest}
        >
          Test vibration
        </Button>
        {testStatus && <p className="settings-hint">{testStatus}</p>}
      </div>

      <div className="settings-field">
        <div className="settings-field-header">
          <Label>Button mapping</Label>
          <Button variant="ghost" size="sm" onClick={resetBindings}>
            Reset to defaults
          </Button>
        </div>
        <p className="settings-hint">
          Click Remap, then press the physical button you want to trigger that action.
        </p>
        <div className="controller-bindings">
          {ACTION_META.map(({ key, label, description }) => {
            const bound = bindings[key];
            const isCapturing = capturing === key;
            return (
              <div className="settings-row" key={key}>
                <div className="settings-row-copy">
                  <Label>{label}</Label>
                  <p>{description}</p>
                </div>
                <Button
                  variant={isCapturing ? "default" : "outline"}
                  size="sm"
                  onClick={() => startCapture(key)}
                >
                  {isCapturing ? (
                    "Press a button…"
                  ) : bound ? (
                    <>
                      <ButtonGlyph button={bound} kind={displayKind} /> {buttonLabel(bound, displayKind)}
                    </>
                  ) : (
                    "Unbound"
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

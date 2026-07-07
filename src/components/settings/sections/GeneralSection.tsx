import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AppSettings } from "@/types";

export function GeneralSection({
  settings,
  onSetting,
  onShowOnboarding,
}: {
  settings: AppSettings;
  onSetting: (key: keyof AppSettings, value: string | boolean) => void;
  onShowOnboarding?: () => void;
}) {
  return (
    <div className="settings-section">
      <h2 className="settings-section-title">General</h2>

      <div className="settings-row">
        <div className="settings-row-copy">
          <Label htmlFor="console-mode">Console mode</Label>
          <p>Hides the cursor and optimizes the layout for gamepad navigation.</p>
        </div>
        <Switch
          id="console-mode"
          checked={settings.consoleMode}
          onCheckedChange={(checked) => onSetting("consoleMode", checked)}
        />
      </div>

      <div className="settings-row">
        <div className="settings-row-copy">
          <Label htmlFor="launch-on-login">Launch on login</Label>
          <p>Start Nexora automatically when you sign in.</p>
        </div>
        <Switch
          id="launch-on-login"
          checked={settings.launchOnLogin}
          onCheckedChange={(checked) => onSetting("launchOnLogin", checked)}
        />
      </div>

      {onShowOnboarding && (
        <div className="settings-row">
          <div className="settings-row-copy">
            <Label>Setup tips</Label>
            <p>Replay the first-run tips, like connecting SteamGridDB for cover art.</p>
          </div>
          <button type="button" className="sync-inline-button settings-action-button" onClick={onShowOnboarding}>
            Show again
          </button>
        </div>
      )}
    </div>
  );
}

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { AppSettings } from "@/types";
import { OnboardingSpotlightTip } from "@/components/Onboarding";

export function LibrarySection({
  settings,
  onSetting,
  spotlight,
  onDismissSpotlight,
}: {
  settings: AppSettings;
  onSetting: (key: keyof AppSettings, value: string | boolean) => void;
  spotlight?: boolean;
  onDismissSpotlight?: () => void;
}) {
  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Library &amp; Sync</h2>

      <div className={`settings-field${spotlight ? " settings-field-spotlight" : ""}`}>
        <Label htmlFor="steamgriddb-key">SteamGridDB API key</Label>
        <Input
          id="steamgriddb-key"
          value={settings.steamGridDbApiKey ?? ""}
          onChange={(event) => {
            onSetting("steamGridDbApiKey", event.target.value);
            if (spotlight) onDismissSpotlight?.();
          }}
          placeholder="Optional"
          autoFocus={spotlight}
        />
        <p className="settings-hint">
          Steam artwork is fetched automatically. Add a free key from steamgriddb.com to also fetch
          cover art and banners for Epic, GOG, Riot, Battle.net, and Xbox games when syncing.
        </p>
        {spotlight && onDismissSpotlight && (
          <OnboardingSpotlightTip reduceMotion={settings.reduceMotion ?? false} onDismiss={onDismissSpotlight} />
        )}
      </div>
    </div>
  );
}

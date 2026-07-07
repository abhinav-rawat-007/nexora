import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { AppSettings } from "@/types";

export function SoundSection({
  settings,
  onSetting,
}: {
  settings: AppSettings;
  onSetting: (key: keyof AppSettings, value: string | boolean) => void;
}) {
  const volume = Number(settings.soundVolume ?? "80");
  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Sound</h2>

      <div className="settings-field">
        <div className="settings-field-header">
          <Label htmlFor="sound-volume">UI sound volume</Label>
          <span className="settings-value">{volume}%</span>
        </div>
        <Slider
          id="sound-volume"
          value={[volume]}
          min={0}
          max={100}
          step={5}
          onValueChange={([value]) => onSetting("soundVolume", String(value))}
        />
        <p className="settings-hint">Controls the volume of navigation, select, and launch sounds.</p>
      </div>
    </div>
  );
}

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AppSettings, AppTheme } from "@/types";

const THEME_OPTIONS: { value: AppTheme; label: string; swatches: string[] }[] = [
  { value: "nexora", label: "Nexora", swatches: ["#05070b", "#4fc4ff", "#f7fbff"] },
  { value: "nord", label: "Nord", swatches: ["#2e3440", "#88c0d0", "#eceff4"] },
  { value: "dracula", label: "Dracula", swatches: ["#282a36", "#bd93f9", "#f8f8f2"] },
  { value: "tokyoNight", label: "Tokyo Night", swatches: ["#1a1b26", "#7aa2f7", "#c0caf5"] },
  { value: "catppuccinMocha", label: "Catppuccin Mocha", swatches: ["#1e1e2e", "#cba6f7", "#cdd6f4"] },
  { value: "rosePine", label: "Rosé Pine", swatches: ["#191724", "#c4a7e7", "#e0def4"] },
];

function ThemeSwatch({ colors }: { colors: string[] }) {
  return (
    <span className="inline-flex shrink-0 -space-x-1">
      {colors.map((color, index) => (
        <span
          key={index}
          className="inline-block size-3 rounded-full ring-1 ring-white/25"
          style={{ background: color }}
        />
      ))}
    </span>
  );
}

export function AppearanceSection({
  settings,
  onSetting,
}: {
  settings: AppSettings;
  onSetting: (key: keyof AppSettings, value: string | boolean) => void;
}) {
  const currentTheme = THEME_OPTIONS.find((option) => option.value === settings.colorTheme) ?? THEME_OPTIONS[0];

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Appearance</h2>

      <div className="settings-row">
        <div className="settings-row-copy">
          <Label htmlFor="color-theme">Theme</Label>
          <p>Changes the background, text, and accent colors used across Nexora.</p>
        </div>
        <Select
          value={settings.colorTheme ?? "nexora"}
          onValueChange={(value) => onSetting("colorTheme", value)}
        >
          <SelectTrigger id="color-theme" className="w-48">
            <SelectValue>
              <ThemeSwatch colors={currentTheme.swatches} />
              {currentTheme.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {THEME_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <ThemeSwatch colors={option.swatches} />
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="settings-row">
        <div className="settings-row-copy">
          <Label htmlFor="reduce-motion">Reduce motion</Label>
          <p>Turns off the boot animation, particle effects, and page transitions.</p>
        </div>
        <Switch
          id="reduce-motion"
          checked={settings.reduceMotion ?? false}
          onCheckedChange={(checked) => onSetting("reduceMotion", checked)}
        />
      </div>
    </div>
  );
}

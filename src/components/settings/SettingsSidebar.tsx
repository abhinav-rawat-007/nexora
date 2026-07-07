import { motion } from "framer-motion";
import { Gamepad2, Info, Library, Palette, Settings as SettingsIcon, Volume2, type LucideIcon } from "lucide-react";

export type SettingsSection = "general" | "appearance" | "sound" | "controller" | "library" | "about";

export const SETTINGS_SECTIONS: SettingsSection[] = [
  "general",
  "appearance",
  "sound",
  "controller",
  "library",
  "about",
];

const SECTION_META: Record<SettingsSection, { label: string; icon: LucideIcon }> = {
  general: { label: "General", icon: SettingsIcon },
  appearance: { label: "Appearance", icon: Palette },
  sound: { label: "Sound", icon: Volume2 },
  controller: { label: "Controller", icon: Gamepad2 },
  library: { label: "Library & Sync", icon: Library },
  about: { label: "About", icon: Info },
};

export function SettingsSidebar({
  active,
  onSelect,
  reduceMotion = false,
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  reduceMotion?: boolean;
}) {
  return (
    <nav className="settings-sidebar">
      {SETTINGS_SECTIONS.map((id) => {
        const { label, icon: Icon } = SECTION_META[id];
        const selected = id === active;
        return (
          <button
            key={id}
            className={`settings-nav-item ${selected ? "active" : ""}`}
            onClick={() => onSelect(id)}
          >
            {selected && (
              <motion.span
                layoutId="settings-active-indicator"
                className="settings-nav-indicator"
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <Icon size={17} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

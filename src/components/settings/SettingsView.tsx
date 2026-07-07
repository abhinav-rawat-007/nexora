import { AnimatePresence, motion } from "framer-motion";
import type { AppSettings } from "@/types";
import type { ControllerInfo } from "@/hooks/useControllerInfo";
import { Drawer } from "@/components/ui/Drawer";
import { SettingsSidebar, type SettingsSection } from "./SettingsSidebar";
import { GeneralSection } from "./sections/GeneralSection";
import { LibrarySection } from "./sections/LibrarySection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { SoundSection } from "./sections/SoundSection";
import { ControllerSection } from "./sections/ControllerSection";
import { AboutSection } from "./sections/AboutSection";

export function SettingsView({
  settings,
  onSetting,
  onBack,
  activeSection,
  onSectionChange,
  onRemapActiveChange,
  controllerInfo,
  librarySpotlight,
  onDismissLibrarySpotlight,
  onShowOnboarding,
}: {
  settings: AppSettings;
  onSetting: (key: keyof AppSettings, value: string | boolean) => void;
  onBack: () => void;
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onRemapActiveChange: (active: boolean) => void;
  controllerInfo: ControllerInfo;
  librarySpotlight?: boolean;
  onDismissLibrarySpotlight?: () => void;
  onShowOnboarding?: () => void;
}) {
  const reduceMotion = settings.reduceMotion ?? false;
  return (
    <Drawer drawerKey="settings" title="Settings" onClose={onBack} reduceMotion={reduceMotion} width="640px">
      <div className="settings-body">
        <SettingsSidebar active={activeSection} onSelect={onSectionChange} reduceMotion={reduceMotion} />
        <div className="settings-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: reduceMotion ? 0 : 0.15 }}
            >
              {activeSection === "general" && (
                <GeneralSection settings={settings} onSetting={onSetting} onShowOnboarding={onShowOnboarding} />
              )}
              {activeSection === "appearance" && <AppearanceSection settings={settings} onSetting={onSetting} />}
              {activeSection === "sound" && <SoundSection settings={settings} onSetting={onSetting} />}
              {activeSection === "controller" && (
                <ControllerSection
                  settings={settings}
                  onSetting={onSetting}
                  onRemapActiveChange={onRemapActiveChange}
                  controllerInfo={controllerInfo}
                />
              )}
              {activeSection === "library" && (
                <LibrarySection
                  settings={settings}
                  onSetting={onSetting}
                  spotlight={librarySpotlight}
                  onDismissSpotlight={onDismissLibrarySpotlight}
                />
              )}
              {activeSection === "about" && <AboutSection />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Drawer>
  );
}

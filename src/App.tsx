import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpDown, Clock3, Gamepad2, RefreshCw, Star, X } from "lucide-react";
import type { AppSettings, AppTheme, Game, ManualGamePayload, View } from "./types";
import {
  addManualGame,
  fetchGameMetadata,
  getGames,
  getSettings,
  launchGame,
  removeGame,
  setGameFavorite,
  setGameOrder,
  setSetting,
  syncLibraries,
  updateGame,
} from "./tauri";
import { playBackSound, playLaunchSound, playMoveSound, playSelectSound, setMasterVolume } from "./sound";
import { readError, formatLivePlaytime } from "./utils/format";
import { dispatchSettingsKey, useGameControls } from "./hooks/useGameControls";
import { useControllerInfo } from "./hooks/useControllerInfo";
import { usePlaytimeTracking } from "./hooks/usePlaytimeTracking";
import { parseBindings, resolveLayout, shortControllerName } from "./lib/gamepad";
import { ButtonGlyph } from "./components/ButtonGlyph";
import { SOURCE_META } from "./lib/sources";
import { TopBar } from "./components/TopBar";
import { GameRail } from "./components/GameRail";
import { ContinueRail } from "./components/ContinueRail";
import { ActionRow } from "./components/ActionRow";
import { GameDialog } from "./components/GameDialog";
import { LaunchOverlay } from "./components/LaunchOverlay";
import { ManualForm } from "./components/ManualForm";
import { SettingsView } from "./components/settings/SettingsView";
import { SETTINGS_SECTIONS, type SettingsSection } from "./components/settings/SettingsSidebar";
import { Splash } from "./components/Splash";
import { OnboardingBanner } from "./components/Onboarding";

const ONBOARDING_SEEN_KEY = "nexora-onboarding-steamgriddb-seen";
const LIBRARY_SORT_KEY = "nexora-library-sort-mode";

type LibrarySortMode = "custom" | "az" | "recent";

const SORT_MODES: LibrarySortMode[] = ["custom", "az", "recent"];

/**
 * Interactive controls (switches, sliders, buttons) inside the active settings section, in DOM
 * order. Controller/keyboard navigation within Settings walks this list, since these rows aren't
 * otherwise reachable - only the sidebar categories had index-based focus state before.
 */
function getSettingsFocusables(): HTMLElement[] {
  const root = document.querySelector(".settings-content");
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [role="slider"]:not([aria-disabled="true"]), input:not(:disabled)',
    ),
  );
}

const SETTINGS_CONTROL_FOCUS_CLASS = "settings-control-focused";

/**
 * Focuses a settings row control and marks it with an explicit class rather than relying on
 * `:focus-visible` - the browser only shows that pseudo-class for focus it attributes to keyboard
 * input, and a controller button press here is a synthetic `.focus()` call (gamepad/Tauri input
 * never dispatches a real trusted KeyboardEvent), so `:focus-visible` was silently not matching.
 */
function focusSettingsControl(el: HTMLElement | undefined) {
  document
    .querySelectorAll(`.${SETTINGS_CONTROL_FOCUS_CLASS}`)
    .forEach((node) => node.classList.remove(SETTINGS_CONTROL_FOCUS_CLASS));
  if (!el) return;
  el.classList.add(SETTINGS_CONTROL_FOCUS_CLASS);
  el.focus();
  el.scrollIntoView({ block: "nearest" });
}

function clearSettingsControlFocus() {
  document
    .querySelectorAll(`.${SETTINGS_CONTROL_FOCUS_CLASS}`)
    .forEach((node) => node.classList.remove(SETTINGS_CONTROL_FOCUS_CLASS));
}

const SORT_LABELS: Record<LibrarySortMode, string> = {
  custom: "Custom order",
  az: "Alphabetical",
  recent: "Recently played",
};

interface ThemePalette {
  bg: string;
  bgDeep: string;
  fg: string;
  accent: string;
  accentDeep: string;
  accentStrong: string;
  danger: string;
  dangerBg: string;
  success: string;
  border: string;
  borderStrong: string;
  surface: string;
  surfaceSolid: string;
}

// Curated full-app color themes (not just an accent swap) - each restyles background, text,
// borders, and surfaces together so the palette stays coherent, not just re-tinted UI chrome.
const THEME_PALETTES: Record<AppTheme, ThemePalette> = {
  nexora: {
    bg: "#05070b",
    bgDeep: "#030509",
    fg: "#f7fbff",
    accent: "#4fc4ff",
    accentDeep: "#00a3ff",
    accentStrong: "#7ad4ff",
    danger: "#ff7486",
    dangerBg: "rgba(100, 16, 30, 0.6)",
    success: "#34e07a",
    border: "rgba(255, 255, 255, 0.16)",
    borderStrong: "rgba(255, 255, 255, 0.22)",
    surface: "rgba(6, 10, 17, 0.78)",
    surfaceSolid: "#0d121b",
  },
  nord: {
    bg: "#2e3440",
    bgDeep: "#242933",
    fg: "#eceff4",
    accent: "#88c0d0",
    accentDeep: "#5e81ac",
    accentStrong: "#8fbcbb",
    danger: "#bf616a",
    dangerBg: "rgba(191, 97, 106, 0.35)",
    success: "#a3be8c",
    border: "rgba(236, 239, 244, 0.14)",
    borderStrong: "rgba(236, 239, 244, 0.2)",
    surface: "rgba(59, 66, 82, 0.75)",
    surfaceSolid: "#3b4252",
  },
  dracula: {
    bg: "#282a36",
    bgDeep: "#1e1f29",
    fg: "#f8f8f2",
    accent: "#bd93f9",
    accentDeep: "#9d65e0",
    accentStrong: "#d6acff",
    danger: "#ff5555",
    dangerBg: "rgba(255, 85, 85, 0.28)",
    success: "#50fa7b",
    border: "rgba(248, 248, 242, 0.14)",
    borderStrong: "rgba(248, 248, 242, 0.2)",
    surface: "rgba(68, 71, 90, 0.75)",
    surfaceSolid: "#44475a",
  },
  tokyoNight: {
    bg: "#1a1b26",
    bgDeep: "#16161e",
    fg: "#c0caf5",
    accent: "#7aa2f7",
    accentDeep: "#3d59a1",
    accentStrong: "#7dcfff",
    danger: "#f7768e",
    dangerBg: "rgba(247, 118, 142, 0.28)",
    success: "#9ece6a",
    border: "rgba(192, 202, 245, 0.14)",
    borderStrong: "rgba(192, 202, 245, 0.2)",
    surface: "rgba(31, 35, 53, 0.78)",
    surfaceSolid: "#1f2335",
  },
  catppuccinMocha: {
    bg: "#1e1e2e",
    bgDeep: "#181825",
    fg: "#cdd6f4",
    accent: "#cba6f7",
    accentDeep: "#a679e8",
    accentStrong: "#e0c9ff",
    danger: "#f38ba8",
    dangerBg: "rgba(243, 139, 168, 0.28)",
    success: "#a6e3a1",
    border: "rgba(205, 214, 244, 0.14)",
    borderStrong: "rgba(205, 214, 244, 0.2)",
    surface: "rgba(49, 50, 68, 0.78)",
    surfaceSolid: "#313244",
  },
  rosePine: {
    bg: "#191724",
    bgDeep: "#14121f",
    fg: "#e0def4",
    accent: "#c4a7e7",
    accentDeep: "#9c6fd1",
    accentStrong: "#e0c3ff",
    danger: "#eb6f92",
    dangerBg: "rgba(235, 111, 146, 0.28)",
    success: "#95c9a0",
    border: "rgba(224, 222, 244, 0.14)",
    borderStrong: "rgba(224, 222, 244, 0.2)",
    surface: "rgba(31, 29, 46, 0.78)",
    surfaceSolid: "#1f1d2e",
  },
};

const emptyManualGame: ManualGamePayload = {
  title: "",
  installPath: "",
  launchTarget: "",
  launchArgs: "",
  heroImage: "",
  coverImage: "",
  description: "",
};

/// Settings driven by a continuous control (slider drag, text typing) fire many times per
/// interaction - persisting on every one of those ticks means dozens of Tauri round-trips (and
/// SQLite writes) for a single drag, plus a real race: since the calls aren't awaited at the
/// call site, an older response can resolve after a newer one and clobber the UI with a stale
/// value. Debouncing these coalesces a whole interaction into one write; everything else
/// (toggles, radio-style selects) already fires once per interaction, so it persists immediately.
const DEBOUNCED_SETTING_DELAY: Partial<Record<keyof AppSettings, number>> = {
  soundVolume: 350,
  controllerDeadzone: 350,
  steamGridDbApiKey: 500,
};

function Toast({
  kind,
  reduceMotion,
  onDismiss,
  children,
}: {
  kind: "error" | "info";
  reduceMotion: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={kind === "info" ? "toast toast-info" : "toast"}
      role={kind === "error" ? "alert" : "status"}
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: reduceMotion ? 0 : 0.2 }}
    >
      <span className="toast-body">{children}</span>
      <button
        type="button"
        className="icon-button ghost toast-dismiss"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <X size={16} />
      </button>
    </motion.div>
  );
}

export function App() {
  const [games, setGames] = useState<Game[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<View>("home");
  const [settings, setSettings] = useState<AppSettings>({
    consoleMode: true,
    launchOnLogin: false,
    steamGridDbApiKey: "",
    soundVolume: "80",
    colorTheme: "nexora",
    reduceMotion: false,
    controllerDeadzone: "55",
    controllerVibration: true,
    controllerLayout: "auto",
    controllerBindings: undefined,
  });
  const [remapping, setRemapping] = useState(false);
  const [manualDraft, setManualDraft] = useState<ManualGamePayload>(emptyManualGame);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ kind: "sync" | "favorite" | "controller"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [clock, setClock] = useState(() => new Date());
  const [dataReady, setDataReady] = useState(false);
  const [booted, setBooted] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [settingsFocusArea, setSettingsFocusArea] = useState<"sidebar" | "content">("sidebar");
  const [settingsRowIndex, setSettingsRowIndex] = useState(0);
  const [dialogFocusIndex, setDialogFocusIndex] = useState(0);
  const [launchingGame, setLaunchingGame] = useState<Game | null>(null);
  const [focusZone, setFocusZone] = useState<"topbar" | "library" | "continue" | "actions">("library");
  const [topbarIndex, setTopbarIndex] = useState(0);
  const [continueIndex, setContinueIndex] = useState(0);
  const [actionsIndex, setActionsIndex] = useState(0);
  const [onboardingStage, setOnboardingStage] = useState<"intro" | "spotlight" | null>(null);
  const [sortMode, setSortModeState] = useState<LibrarySortMode>(() => {
    const stored = window.localStorage.getItem(LIBRARY_SORT_KEY);
    return (SORT_MODES as string[]).includes(stored ?? "") ? (stored as LibrarySortMode) : "custom";
  });
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  const activeSessions = usePlaytimeTracking((payload) => {
    setGames((prev) =>
      prev.map((entry) =>
        entry.id === payload.gameId
          ? { ...entry, playtimeMinutes: payload.playtimeMinutes, lastPlayedAt: payload.lastPlayedAt }
          : entry,
      ),
    );
  });

  function setSortMode(mode: LibrarySortMode) {
    setSortModeState(mode);
    window.localStorage.setItem(LIBRARY_SORT_KEY, mode);
    setSortMenuOpen(false);
  }

  useEffect(() => {
    if (!sortMenuOpen) return;
    const close = () => setSortMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [sortMenuOpen]);

  const visibleGames = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query ? games.filter((game) => game.title.toLowerCase().includes(query)) : games;

    // "custom" keeps whatever order the games arrived in (the DB's sort_order, driven by drag
    // reordering) - the other modes each impose their own order instead, stably, so ties don't
    // needlessly reshuffle.
    const orderWithin = (list: Game[]) => {
      switch (sortMode) {
        case "az":
          return [...list].sort((a, b) => a.title.localeCompare(b.title));
        case "recent":
          return [...list].sort(
            (a, b) => new Date(b.lastPlayedAt ?? 0).getTime() - new Date(a.lastPlayedAt ?? 0).getTime(),
          );
        case "custom":
        default:
          return list;
      }
    };

    // Favourites always float to the front, regardless of sort mode - the chosen mode only
    // decides ordering within the favourite/non-favourite groups.
    const favorites = filtered.filter((game) => game.isFavorite);
    const rest = filtered.filter((game) => !game.isFavorite);
    return [...orderWithin(favorites), ...orderWithin(rest)];
  }, [games, searchQuery, sortMode]);

  const dragEnabled = sortMode === "custom" && !searchQuery.trim();

  const selectedGame = visibleGames[selectedIndex] ?? null;

  const recentGames = useMemo(
    () =>
      games
        .filter((game) => game.lastPlayedAt)
        .sort((a, b) => new Date(b.lastPlayedAt ?? 0).getTime() - new Date(a.lastPlayedAt ?? 0).getTime())
        .slice(0, 8),
    [games],
  );

  const zonesAvailable = useMemo(() => {
    const zones: Array<"topbar" | "library" | "continue" | "actions"> = ["topbar"];
    if (recentGames.length) zones.push("continue");
    if (visibleGames.length) zones.push("library");
    zones.push("actions");
    return zones;
  }, [visibleGames.length, recentGames.length]);

  const load = useCallback(async () => {
    try {
      const [gameList, appSettings] = await Promise.all([getGames(), getSettings()]);
      setGames(gameList);
      setSettings(appSettings);
      setError(null);
    } catch (err) {
      setError(readError(err));
    } finally {
      setDataReady(true);
    }
  }, []);

  const pendingSettingWrites = useRef<
    Partial<Record<keyof AppSettings, { timer: number; value: string | boolean }>>
  >({});

  const commitSetting = useCallback((key: keyof AppSettings, value: string | boolean) => {
    setSetting(key, value)
      .then((next) => setSettings(next))
      .catch((err) => setError(readError(err)));
  }, []);

  const handleSetting = useCallback(
    (key: keyof AppSettings, value: string | boolean) => {
      // Reflect the change immediately so sliders/inputs feel responsive even though the
      // actual write is debounced below.
      setSettings((prev) => ({ ...prev, [key]: value }));

      const pending = pendingSettingWrites.current;
      const existing = pending[key];
      if (existing) window.clearTimeout(existing.timer);

      const delay = DEBOUNCED_SETTING_DELAY[key];
      if (!delay) {
        delete pending[key];
        commitSetting(key, value);
        return;
      }
      pending[key] = {
        value,
        timer: window.setTimeout(() => {
          delete pending[key];
          commitSetting(key, value);
        }, delay),
      };
    },
    [commitSetting],
  );

  useEffect(() => {
    // Flush anything still debounced if the app is torn down mid-interaction.
    return () => {
      for (const [key, entry] of Object.entries(pendingSettingWrites.current) as Array<
        [keyof AppSettings, { timer: number; value: string | boolean }]
      >) {
        window.clearTimeout(entry.timer);
        commitSetting(key, entry.value);
      }
    };
  }, [commitSetting]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setMasterVolume(Number(settings.soundVolume ?? "80"));
  }, [settings.soundVolume]);

  const selectedGameIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedGameIdRef.current = selectedGame?.id ?? null;
  }, [selectedGame]);

  useEffect(() => {
    // Favouriting a game re-sorts visibleGames, which can move the currently selected game to
    // a different index - follow it by id instead of leaving selection pointing at whichever
    // game now sits at the old index.
    const id = selectedGameIdRef.current;
    const idByRef = id ? visibleGames.findIndex((game) => game.id === id) : -1;
    if (idByRef !== -1) {
      setSelectedIndex(idByRef);
      return;
    }
    setSelectedIndex((index) => Math.min(index, Math.max(visibleGames.length - 1, 0)));
  }, [visibleGames]);

  useEffect(() => {
    setDialogFocusIndex(0);
  }, [view, selectedGame?.id]);

  useEffect(() => {
    setContinueIndex((index) => Math.min(index, Math.max(recentGames.length - 1, 0)));
  }, [recentGames.length]);

  useEffect(() => {
    setFocusZone((zone) => (zonesAvailable.includes(zone) ? zone : "topbar"));
  }, [zonesAvailable]);

  useEffect(() => {
    if (!dataReady) return;
    const seen = window.localStorage.getItem(ONBOARDING_SEEN_KEY);
    if (!seen && !settings.steamGridDbApiKey) {
      setOnboardingStage("intro");
    }
    // Only decide once, right after settings first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataReady]);

  useEffect(() => {
    if (view === "settings") setSettingsFocusArea("sidebar");
    clearSettingsControlFocus();
  }, [view]);

  useEffect(() => {
    setSettingsRowIndex(0);
  }, [settingsSection]);

  function dismissOnboarding() {
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    setOnboardingStage(null);
  }

  function restartOnboarding() {
    window.localStorage.removeItem(ONBOARDING_SEEN_KEY);
    setOnboardingStage("intro");
    setView("home");
  }

  const handleAction = (key: string) => {
    if (view === "manual") return false;

    if (view === "detail" && selectedGame) {
      const dialogActionCount = selectedGame.source === "manual" ? 3 : 1;
      if (key === "ArrowLeft" || key === "ArrowUp") {
        setDialogFocusIndex((index) => Math.max(index - 1, 0));
        playMoveSound();
        return true;
      }
      if (key === "ArrowRight" || key === "ArrowDown") {
        setDialogFocusIndex((index) => Math.min(index + 1, dialogActionCount - 1));
        playMoveSound();
        return true;
      }
      if (key === "PageUp" || key === "PageDown") return true;
      if (key === "Enter") {
        playSelectSound();
        if (dialogFocusIndex === 0) launchSelected();
        else if (dialogFocusIndex === 1) editSelected();
        else if (dialogFocusIndex === 2) deleteSelected();
        return true;
      }
      // Escape and "s" fall through to the shared close/settings-toggle handling below.
    }

    if (view === "settings") {
      // A Radix Select dropdown (theme picker) is open and owns real DOM focus on one of its
      // options - forward navigation/selection to it instead of moving between settings rows.
      const activeEl = document.activeElement as HTMLElement | null;
      const inOpenPopup = activeEl?.closest('[data-slot="select-content"], [role="listbox"]');
      if (inOpenPopup && activeEl) {
        if (key === "ArrowUp" || key === "ArrowDown" || key === "Enter" || key === "Escape" || key === "Home" || key === "End") {
          dispatchSettingsKey(activeEl, key);
          if (key !== "Escape") playMoveSound();
          return true;
        }
      }

      if (settingsFocusArea === "sidebar") {
        const currentIndex = SETTINGS_SECTIONS.indexOf(settingsSection);
        if (key === "ArrowDown") {
          setSettingsSection(SETTINGS_SECTIONS[Math.min(currentIndex + 1, SETTINGS_SECTIONS.length - 1)]);
          playMoveSound();
          return true;
        }
        if (key === "ArrowUp") {
          setSettingsSection(SETTINGS_SECTIONS[Math.max(currentIndex - 1, 0)]);
          playMoveSound();
          return true;
        }
        if (key === "ArrowRight" || key === "Enter") {
          const focusables = getSettingsFocusables();
          if (focusables.length > 0) {
            setSettingsFocusArea("content");
            setSettingsRowIndex(0);
            focusSettingsControl(focusables[0]);
            playMoveSound();
          }
          return true;
        }
        if (key === "ArrowLeft" || key === "PageUp" || key === "PageDown") {
          return true;
        }
        // Escape and "s" fall through to the shared back/toggle handling below.
      } else {
        const focusables = getSettingsFocusables();
        const activeIndex = activeEl ? focusables.indexOf(activeEl) : -1;
        const currentIndex = activeIndex >= 0 ? activeIndex : Math.min(settingsRowIndex, focusables.length - 1);

        if (key === "ArrowDown" || key === "ArrowUp") {
          if (focusables.length === 0) return true;
          const nextIndex =
            key === "ArrowDown" ? Math.min(currentIndex + 1, focusables.length - 1) : Math.max(currentIndex - 1, 0);
          setSettingsRowIndex(nextIndex);
          focusSettingsControl(focusables[nextIndex]);
          if (nextIndex !== currentIndex) playMoveSound();
          return true;
        }
        if (key === "ArrowLeft" || key === "ArrowRight") {
          const control = focusables[currentIndex];
          if (control?.getAttribute("role") === "slider") {
            // Sliders use left/right to change value, matching how a real remote's D-pad works
            // once you're "on" a slider - Radix's own keydown handler applies the step.
            dispatchSettingsKey(control, key);
            playMoveSound();
            return true;
          }
          if (key === "ArrowLeft") {
            setSettingsFocusArea("sidebar");
            clearSettingsControlFocus();
            playMoveSound();
          }
          return true;
        }
        if (key === "Enter") {
          // .click() (not a dispatched keydown) so it fires real default actions - toggling a
          // Switch or opening the Select popup both rely on the browser's native Enter-on-button
          // behavior, which only happens for trusted events, not ones we synthesize.
          focusables[currentIndex]?.click();
          playSelectSound();
          return true;
        }
        if (key === "Escape") {
          setSettingsFocusArea("sidebar");
          clearSettingsControlFocus();
          playBackSound();
          return true;
        }
        if (key === "PageUp" || key === "PageDown") return true;
        // "s" falls through to the shared toggle handling below.
      }
    }

    if (view === "home" && (key === "ArrowUp" || key === "ArrowDown")) {
      const currentIndex = zonesAvailable.indexOf(focusZone);
      const nextIndex =
        key === "ArrowDown"
          ? Math.min(currentIndex + 1, zonesAvailable.length - 1)
          : Math.max(currentIndex - 1, 0);
      if (nextIndex !== currentIndex) {
        setFocusZone(zonesAvailable[nextIndex]);
        playMoveSound();
      }
      return true;
    }

    if (view === "home" && focusZone === "topbar" && (key === "ArrowLeft" || key === "ArrowRight")) {
      setTopbarIndex((index) => {
        const next = key === "ArrowRight" ? Math.min(index + 1, 4) : Math.max(index - 1, 0);
        if (next !== index) playMoveSound();
        return next;
      });
      return true;
    }

    if (view === "home" && focusZone === "continue" && (key === "ArrowLeft" || key === "ArrowRight")) {
      setContinueIndex((index) => {
        const next =
          key === "ArrowRight"
            ? Math.min(index + 1, Math.max(recentGames.length - 1, 0))
            : Math.max(index - 1, 0);
        if (next !== index) playMoveSound();
        return next;
      });
      return true;
    }

    if (view === "home" && focusZone === "actions" && (key === "ArrowLeft" || key === "ArrowRight")) {
      setActionsIndex((index) => {
        const next = key === "ArrowRight" ? Math.min(index + 1, 1) : Math.max(index - 1, 0);
        if (next !== index) playMoveSound();
        return next;
      });
      return true;
    }

    if (key === "ArrowRight") {
      setSelectedIndex((index) => {
        const next = Math.min(index + 1, Math.max(visibleGames.length - 1, 0));
        if (next !== index) playMoveSound();
        return next;
      });
      return true;
    }
    if (key === "ArrowLeft") {
      setSelectedIndex((index) => {
        const next = Math.max(index - 1, 0);
        if (next !== index) playMoveSound();
        return next;
      });
      return true;
    }
    if (key === "PageDown") {
      setSelectedIndex((index) => Math.min(index + 4, Math.max(visibleGames.length - 1, 0)));
      playMoveSound();
      return true;
    }
    if (key === "PageUp") {
      setSelectedIndex((index) => Math.max(index - 4, 0));
      playMoveSound();
      return true;
    }
    if (key === "Home" && view === "home" && focusZone === "library") {
      setSelectedIndex(0);
      playMoveSound();
      return true;
    }
    if (key === "End" && view === "home" && focusZone === "library") {
      setSelectedIndex(Math.max(visibleGames.length - 1, 0));
      playMoveSound();
      return true;
    }
    if (key === "/" && view === "home") {
      setSearchOpen(true);
      playSelectSound();
      return true;
    }
    if (key.toLowerCase() === "r" && view === "home") {
      playSelectSound();
      runSync();
      return true;
    }
    if (key.toLowerCase() === "n" && view === "home") {
      playSelectSound();
      setView("manual");
      return true;
    }
    if (key.toLowerCase() === "f" && selectedGame && (view === "home" || view === "detail")) {
      playSelectSound();
      toggleFavorite(selectedGame);
      return true;
    }
    if (key === "Enter" && view === "home" && focusZone === "topbar") {
      playSelectSound();
      if (topbarIndex === 0) runSync();
      else if (topbarIndex === 1) setSearchOpen(true);
      else if (topbarIndex === 2) setView("manual");
      else if (topbarIndex === 3) setView("settings");
      else if (topbarIndex === 4) setView("settings");
      return true;
    }
    if (key === "Enter" && view === "home" && focusZone === "continue" && recentGames[continueIndex]) {
      selectFromAnyList(recentGames[continueIndex]);
      return true;
    }
    if (key === "Enter" && view === "home" && focusZone === "actions") {
      if (actionsIndex === 0) {
        launchSelected();
      } else {
        playSelectSound();
        setView("detail");
      }
      return true;
    }
    if (key === "Enter" && selectedGame) {
      playSelectSound();
      setView(view === "detail" ? "home" : "detail");
      return true;
    }
    if (key === "Escape") {
      if (view !== "home") playBackSound();
      setView("home");
      return true;
    }
    if (key.toLowerCase() === "s") {
      setView(view === "settings" ? "home" : "settings");
      return true;
    }
    return false;
  };

  const bindings = useMemo(() => parseBindings(settings.controllerBindings), [settings.controllerBindings]);
  const controllerInfo = useControllerInfo();
  const controllerKind = resolveLayout(settings.controllerLayout, controllerInfo.kind);

  // Surfaces a toast whenever a controller connects or disconnects, including on app launch if
  // one is already plugged in - matching the topbar badge's "no disabled state" behavior, this
  // only ever announces presence/absence, never a neutral "no controller" state.
  const prevControllerConnected = useRef(false);
  useEffect(() => {
    if (controllerInfo.connected && !prevControllerConnected.current) {
      setNotice({ kind: "controller", text: `${shortControllerName(controllerInfo.name, controllerInfo.kind)} connected.` });
    } else if (!controllerInfo.connected && prevControllerConnected.current) {
      setNotice({ kind: "controller", text: "Controller disconnected." });
    }
    prevControllerConnected.current = controllerInfo.connected;
  }, [controllerInfo.connected, controllerInfo.name, controllerInfo.kind]);

  useGameControls(
    handleAction,
    !booted || searchOpen || view === "manual" || remapping || !!launchingGame,
    Number(settings.controllerDeadzone ?? "55") / 100,
    bindings,
  );

  const reduceMotion = settings.reduceMotion ?? false;
  const motionDuration = (base: number) => (reduceMotion ? 0 : base);

  const heroStyle = useMemo(() => {
    const image = selectedGame?.heroImage || selectedGame?.headerImage || selectedGame?.coverImage;
    if (!image) return undefined;
    return { backgroundImage: `url("${image}")` };
  }, [selectedGame]);

  async function runSync() {
    setSyncing(true);
    setNotice(null);
    try {
      const result = await syncLibraries();
      setGames(result.games);
      setSelectedIndex(0);
      const imported = result.summary.filter((entry) => entry.imported > 0);
      const detected = result.summary.filter((entry) => entry.found);
      if (imported.length) {
        const parts = imported.map((entry) => `${entry.imported} ${SOURCE_META[entry.source].label}`);
        setNotice({ kind: "sync", text: `Synced ${parts.join(" · ")} games into Nexora.` });
      } else if (detected.length) {
        setNotice(null);
        const labels = detected.map((entry) => SOURCE_META[entry.source].label).join(", ");
        setError(`No new games found. Detected launchers (${labels}) had nothing new to import.`);
      } else {
        setNotice(null);
        setError("No supported launchers were detected (Steam, Epic, GOG, Xbox, Riot, Battle.net). Install one or add games manually.");
      }
      if (imported.length) setError(null);
    } catch (err) {
      setError(readError(err));
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 8000);
    return () => window.clearTimeout(timer);
  }, [error]);

  async function saveManualGame() {
    setBusy(true);
    try {
      const isNew = !manualDraft.id;
      let saved = isNew ? await addManualGame(manualDraft) : await updateGame(manualDraft);
      let metadataError: string | null = null;

      if (isNew) {
        const metadata = await fetchGameMetadata(saved.title).catch((err) => {
          metadataError = `Saved "${saved.title}", but couldn't fetch cover art: ${readError(err)}`;
          return null;
        });
        const hasMetadata =
          metadata && (metadata.heroImage || metadata.coverImage || metadata.description || metadata.developers || metadata.genres);
        if (hasMetadata) {
          saved = await updateGame({
            id: saved.id,
            title: saved.title,
            installPath: saved.installPath ?? "",
            launchTarget: saved.launchTarget,
            launchArgs: saved.launchArgs ?? "",
            heroImage: metadata!.heroImage ?? "",
            coverImage: metadata!.coverImage ?? "",
            // Omitted (rather than "") when the Steam store lookup found nothing, so the
            // backend's None-means-unchanged handling leaves the "Manually added game."
            // default/existing value alone instead of blanking it out.
            ...(metadata!.description ? { description: metadata!.description } : {}),
            ...(metadata!.developers ? { developers: metadata!.developers } : {}),
            ...(metadata!.genres ? { genres: metadata!.genres } : {}),
            ...(metadata!.releaseDate ? { releaseDate: metadata!.releaseDate } : {}),
          });
        }
      }

      const next = await getGames();
      setGames(next);
      setSelectedIndex(Math.max(next.findIndex((game) => game.id === saved.id), 0));
      setManualDraft(emptyManualGame);
      setView("home");
      setError(metadataError);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  async function launchSelected() {
    if (!selectedGame) return;
    const game = selectedGame;
    setBusy(true);
    setLaunchingGame(game);
    setSearchOpen(false);
    setView("home");
    playLaunchSound();
    const minDisplay = new Promise((resolve) => window.setTimeout(resolve, reduceMotion ? 400 : 1400));
    try {
      await Promise.all([launchGame(game.id), minDisplay]);
      await load();
      setError(null);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
      setLaunchingGame(null);
    }
  }

  async function deleteSelected() {
    if (!selectedGame || selectedGame.source !== "manual") return;
    setBusy(true);
    try {
      await removeGame(selectedGame.id);
      const next = await getGames();
      setGames(next);
      setSelectedIndex(0);
      setView("home");
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  function editSelected() {
    if (!selectedGame || selectedGame.source !== "manual") return;
    setManualDraft({
      id: selectedGame.id,
      title: selectedGame.title,
      installPath: selectedGame.installPath ?? "",
      launchTarget: selectedGame.launchTarget,
      launchArgs: selectedGame.launchArgs ?? "",
      heroImage: selectedGame.heroImage ?? "",
      coverImage: selectedGame.coverImage ?? "",
      description: selectedGame.description ?? "",
    });
    setView("manual");
  }

  async function toggleFavorite(game: Game) {
    try {
      const updated = await setGameFavorite(game.id, !game.isFavorite);
      setGames((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
      setNotice({
        kind: "favorite",
        text: updated.isFavorite
          ? `Added "${updated.title}" to favourites.`
          : `Removed "${updated.title}" from favourites.`,
      });
    } catch (err) {
      setError(readError(err));
    }
  }

  function handleReorder(orderedGameIds: string[]) {
    setGames((prev) => {
      const byId = new Map(prev.map((game) => [game.id, game]));
      const reordered = orderedGameIds.map((id) => byId.get(id)).filter((game): game is Game => Boolean(game));
      const missing = prev.filter((game) => !orderedGameIds.includes(game.id));
      return [...reordered, ...missing];
    });
    setGameOrder(orderedGameIds).catch((err) => setError(readError(err)));
  }

  function selectFromAnyList(game: Game) {
    setSearchQuery("");
    const index = visibleGames.findIndex((entry) => entry.id === game.id);
    setSelectedIndex(Math.max(index, 0));
    playSelectSound();
    setView("detail");
  }

  return (
    <AnimatePresence mode="wait">
      {!booted ? (
        <Splash key="splash" dataReady={dataReady} reduceMotion={reduceMotion} onDone={() => setBooted(true)} />
      ) : (
        <motion.main
          key="app"
          className="shell"
          style={
            (() => {
              const theme = THEME_PALETTES[settings.colorTheme ?? "nexora"];
              return {
                "--nexora-bg": theme.bg,
                "--nexora-bg-deep": theme.bgDeep,
                "--nexora-fg": theme.fg,
                "--nexora-accent": theme.accent,
                "--nexora-accent-deep": theme.accentDeep,
                "--nexora-accent-strong": theme.accentStrong,
                "--nexora-danger": theme.danger,
                "--nexora-danger-bg": theme.dangerBg,
                "--nexora-success": theme.success,
                "--nexora-border": theme.border,
                "--nexora-border-strong": theme.borderStrong,
                "--nexora-surface": theme.surface,
                "--nexora-surface-solid": theme.surfaceSolid,
                color: theme.fg,
                background: theme.bg,
              } as CSSProperties;
            })()
          }
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: motionDuration(0.4) }}
        >
      <div className="hero" style={heroStyle} />
      <div className="vignette" />

      <div className="topbar-toast-wrap">
        <TopBar
          view={view}
          busy={busy}
          syncing={syncing}
          searchOpen={searchOpen}
          searchQuery={searchQuery}
          clock={clock}
          focusedIndex={view === "home" && focusZone === "topbar" ? topbarIndex : -1}
          onSearchToggle={() => setSearchOpen((open) => !open)}
          onSearchFocus={() => setSearchOpen(true)}
          onSearchQueryChange={setSearchQuery}
          onSync={runSync}
          onAddGame={() => setView("manual")}
          onToggleSettings={() => setView(view === "settings" ? "home" : "settings")}
          onOpenSettings={() => setView("settings")}
        />

        <div className="toast-stack">
        <AnimatePresence>
          {error && (
            <Toast key="error-toast" kind="error" reduceMotion={reduceMotion} onDismiss={() => setError(null)}>
              {error}
            </Toast>
          )}
          {!error && notice && (
            <Toast key="notice-toast" kind="info" reduceMotion={reduceMotion} onDismiss={() => setNotice(null)}>
              {notice.kind === "sync" ? (
                <RefreshCw size={16} />
              ) : notice.kind === "controller" ? (
                <Gamepad2 size={16} />
              ) : (
                <Star size={16} />
              )}{" "}
              {notice.text}
            </Toast>
          )}
          {!error && onboardingStage === "intro" && view === "home" && (
            <OnboardingBanner
              key="onboarding-banner"
              reduceMotion={reduceMotion}
              onSetup={() => {
                setOnboardingStage("spotlight");
                setSettingsSection("library");
                setView("settings");
              }}
              onDismiss={dismissOnboarding}
            />
          )}
        </AnimatePresence>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {(view === "home" || view === "detail" || view === "settings" || view === "manual") && (
          <motion.section
            key="home"
            className="home"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: motionDuration(0.18) }}
          >
            <div className="hero-info">
              <span className="eyebrow">{selectedGame ? SOURCE_META[selectedGame.source].label : "Library"}</span>
              <h1>{selectedGame?.title ?? "Your games, one home."}</h1>
              {selectedGame && (
                <div className="hero-tags">
                  <span
                    className={`tag ${activeSessions[selectedGame.id] ? "tag-live" : ""}`}
                    title={
                      activeSessions[selectedGame.id]
                        ? `Playing since ${new Date(activeSessions[selectedGame.id]!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                        : undefined
                    }
                  >
                    {activeSessions[selectedGame.id] ? (
                      <span className="tag-live-dot" aria-hidden="true" />
                    ) : (
                      <Clock3 size={14} />
                    )}
                    {formatLivePlaytime(selectedGame.playtimeMinutes, activeSessions[selectedGame.id], selectedGame.lastPlayedAt)}
                  </span>
                  {selectedGame.genres && <span className="tag">{selectedGame.genres.split(",")[0]}</span>}
                  <span className="tag tag-strong">{selectedGame.isInstalled ? "Installed" : "Not installed"}</span>
                </div>
              )}
            </div>

            <ContinueRail
              games={recentGames}
              focusedIndex={focusZone === "continue" ? continueIndex : -1}
              activeSessions={activeSessions}
              onSelect={selectFromAnyList}
            />

            <div className="rail-block">
              <div className="rail-header">
                <h2 className="rail-title">Your Library <span>{visibleGames.length} games</span></h2>
                <div className="sort-control">
                  <button
                    className="sort-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSortMenuOpen((open) => !open);
                    }}
                    title="Sort library"
                  >
                    <ArrowUpDown size={14} />
                    {SORT_LABELS[sortMode]}
                  </button>
                  {sortMenuOpen && (
                    <div className="sort-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                      {SORT_MODES.map((mode) => (
                        <button
                          key={mode}
                          role="menuitemradio"
                          aria-checked={sortMode === mode}
                          className={`sort-menu-item ${sortMode === mode ? "active" : ""}`}
                          onClick={() => setSortMode(mode)}
                        >
                          {SORT_LABELS[mode]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <GameRail
                games={visibleGames}
                selectedIndex={selectedIndex}
                active={focusZone === "library"}
                reduceMotion={reduceMotion}
                dragEnabled={dragEnabled}
                loading={!dataReady}
                searchQuery={searchQuery}
                activeSessions={activeSessions}
                onSelect={(index) => {
                  if (index === selectedIndex) {
                    playSelectSound();
                    setView("detail");
                  } else {
                    playMoveSound();
                  }
                  setSelectedIndex(index);
                }}
                onToggleFavorite={toggleFavorite}
                onReorder={handleReorder}
                onSync={runSync}
                onAddManual={() => setView("manual")}
                onClearSearch={() => setSearchQuery("")}
              />
            </div>

            <ActionRow
              selectedGame={selectedGame}
              busy={busy}
              focusedIndex={focusZone === "actions" ? actionsIndex : -1}
              onLaunch={launchSelected}
              onDetails={() => { playSelectSound(); setView("detail"); }}
            />
          </motion.section>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {view === "detail" && selectedGame && (
          <GameDialog
            key="dialog"
            game={selectedGame}
            busy={busy}
            reduceMotion={reduceMotion}
            focusedAction={dialogFocusIndex}
            sessionStartedAt={activeSessions[selectedGame.id]}
            onClose={() => { playBackSound(); setView("home"); }}
            onLaunch={launchSelected}
            onEdit={editSelected}
            onRemove={deleteSelected}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {view === "manual" && (
          <ManualForm
            draft={manualDraft}
            busy={busy}
            reduceMotion={reduceMotion}
            onChange={setManualDraft}
            onSave={saveManualGame}
            onCancel={() => {
              playBackSound();
              setManualDraft(emptyManualGame);
              setView("home");
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {view === "settings" && (
          <SettingsView
            settings={settings}
            onSetting={handleSetting}
            onBack={() => { playBackSound(); setView("home"); }}
            activeSection={settingsSection}
            onSectionChange={setSettingsSection}
            onRemapActiveChange={setRemapping}
            controllerInfo={controllerInfo}
            librarySpotlight={onboardingStage === "spotlight" && settingsSection === "library"}
            onDismissLibrarySpotlight={dismissOnboarding}
            onShowOnboarding={restartOnboarding}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {launchingGame && <LaunchOverlay key="launch-overlay" game={launchingGame} reduceMotion={reduceMotion} />}
      </AnimatePresence>

      <footer className="hints">
        <span>
          <Gamepad2 size={16} />
          {controllerInfo.connected ? " D-pad or stick to browse" : " Keyboard to browse"}
        </span>
        <span>
          <ButtonGlyph button={bindings.confirm ?? "South"} kind={controllerKind} /> Enter select
        </span>
        <span>
          <ButtonGlyph button={bindings.back ?? "East"} kind={controllerKind} /> Esc back
        </span>
        <span>
          <ButtonGlyph button={bindings.favorite ?? "LT"} kind={controllerKind} /> F favorite
        </span>
        <span>
          <ButtonGlyph button={bindings.pageUp ?? "LB"} kind={controllerKind} />/
          <ButtonGlyph button={bindings.pageDown ?? "RB"} kind={controllerKind} /> PageUp/PageDown jump rows
        </span>
        <span>
          <ButtonGlyph button={bindings.search ?? "North"} kind={controllerKind} /> &quot;/&quot; search
        </span>
        <span>
          <ButtonGlyph button={bindings.sync ?? "West"} kind={controllerKind} /> R sync
        </span>
        <span>
          <ButtonGlyph button={bindings.menu ?? "Start"} kind={controllerKind} /> S settings
        </span>
      </footer>
        </motion.main>
      )}
    </AnimatePresence>
  );
}

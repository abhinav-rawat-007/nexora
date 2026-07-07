import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { ActiveSession, AppSettings, Game, ManualGamePayload, SyncResult } from "./types";
import { DEFAULT_BINDINGS } from "./lib/gamepad";

const sampleGames: Game[] = [
  {
    id: "sample-horizon",
    source: "manual",
    title: "Add Your First Game",
    installPath: null,
    launchType: "exe",
    launchTarget: "",
    heroImage: null,
    coverImage: null,
    headerImage: null,
    description: "Add a local executable to Nexora when a game does not belong to Steam yet.",
    playtimeMinutes: 0,
    isInstalled: false,
    isFavorite: false,
  },
  {
    id: "sample-steam",
    source: "steam",
    sourceGameId: "570",
    title: "Steam Sync Preview",
    installPath: null,
    launchType: "steam_uri",
    launchTarget: "steam://run/570",
    heroImage: "https://cdn.akamai.steamstatic.com/steam/apps/570/library_hero.jpg",
    coverImage: "https://cdn.akamai.steamstatic.com/steam/apps/570/library_600x900.jpg",
    headerImage: "https://cdn.akamai.steamstatic.com/steam/apps/570/header.jpg",
    description: "Steam sync will import installed games with playtime, artwork, install paths, and launch links.",
    playtimeMinutes: 312,
    lastPlayedAt: new Date(Date.now() - 86_400_000).toISOString(),
    developers: "Kojima Productions",
    genres: "Action, Adventure",
    releaseDate: "Nov 8, 2016",
    isInstalled: true,
    isFavorite: false,
  },
];

const defaultSettings: AppSettings = {
  consoleMode: true,
  launchOnLogin: false,
  steamGridDbApiKey: "",
  soundVolume: "80",
  colorTheme: "nexora",
  reduceMotion: false,
  controllerDeadzone: "55",
  controllerVibration: true,
  controllerLayout: "auto",
  controllerBindings: JSON.stringify(DEFAULT_BINDINGS),
};

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

export async function getGames(): Promise<Game[]> {
  if (!isTauri()) return sampleGames;
  return invoke<Game[]>("get_games");
}

export async function syncLibraries(): Promise<SyncResult> {
  if (!isTauri()) {
    return { games: sampleGames, summary: [{ source: "steam", imported: sampleGames.length, found: true }] };
  }
  return invoke<SyncResult>("sync_all_libraries");
}

export async function launchGame(gameId: string): Promise<void> {
  if (!isTauri()) {
    console.info("Launch requested", gameId);
    return;
  }
  return invoke("launch_game", { gameId });
}

export async function addManualGame(payload: ManualGamePayload): Promise<Game> {
  if (!isTauri()) {
    return {
      id: payload.id ?? crypto.randomUUID(),
      source: "manual",
      title: payload.title,
      installPath: payload.installPath,
      launchType: "exe",
      launchTarget: payload.launchTarget,
      launchArgs: payload.launchArgs,
      heroImage: payload.heroImage,
      coverImage: payload.coverImage,
      headerImage: payload.heroImage,
      description: "Manually added game.",
      playtimeMinutes: 0,
      isInstalled: true,
      isFavorite: false,
    };
  }
  return invoke<Game>("add_manual_game", { payload });
}

export async function updateGame(payload: ManualGamePayload): Promise<Game> {
  if (!isTauri()) return addManualGame(payload);
  return invoke<Game>("update_game", { payload });
}

export async function removeGame(gameId: string): Promise<void> {
  if (!isTauri()) return;
  return invoke("remove_game", { gameId });
}

export async function setGameFavorite(gameId: string, favorite: boolean): Promise<Game> {
  if (!isTauri()) {
    const game = sampleGames.find((entry) => entry.id === gameId);
    return { ...(game ?? sampleGames[0]), isFavorite: favorite };
  }
  return invoke<Game>("set_game_favorite", { gameId, favorite });
}

export async function setGameOrder(gameIds: string[]): Promise<Game[]> {
  if (!isTauri()) return sampleGames;
  return invoke<Game[]>("set_game_order", { gameIds });
}

export async function getSettings(): Promise<AppSettings> {
  if (!isTauri()) return defaultSettings;
  return invoke<AppSettings>("get_settings");
}

export async function setSetting(key: keyof AppSettings, value: string | boolean): Promise<AppSettings> {
  if (!isTauri()) return { ...defaultSettings, [key]: value };
  return invoke<AppSettings>("set_setting", { key, value: String(value) });
}

export async function pickExecutable(): Promise<string | null> {
  if (!isTauri()) {
    console.info("Executable picker requested (no native dialog in browser preview)");
    return null;
  }
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Executable", extensions: ["exe"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export interface FetchedGameMetadata {
  coverImage?: string | null;
  heroImage?: string | null;
  description?: string | null;
  developers?: string | null;
  genres?: string | null;
  releaseDate?: string | null;
}

export async function fetchGameMetadata(title: string): Promise<FetchedGameMetadata | null> {
  if (!isTauri()) return null;
  return invoke<FetchedGameMetadata>("fetch_game_metadata", { title });
}

export async function getActiveSessions(): Promise<ActiveSession[]> {
  if (!isTauri()) return [];
  return invoke<ActiveSession[]>("get_active_sessions");
}

export interface SessionStartedPayload {
  gameId: string;
  startedAt: string;
}

export interface SessionEndedPayload {
  gameId: string;
  playtimeMinutes: number;
  lastPlayedAt: string;
}

export async function onSessionStarted(handler: (payload: SessionStartedPayload) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<SessionStartedPayload>("game-session-started", (event) => handler(event.payload));
}

export async function onSessionEnded(handler: (payload: SessionEndedPayload) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<SessionEndedPayload>("game-session-ended", (event) => handler(event.payload));
}

export async function testVibration(): Promise<void> {
  if (!isTauri()) {
    console.info("Vibration test requested (no controller backend in browser preview)");
    return;
  }
  return invoke("test_vibration");
}

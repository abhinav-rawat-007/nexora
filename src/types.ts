export type GameSource = "steam" | "epic" | "gog" | "xbox" | "riot" | "battlenet" | "other" | "manual";
export type LaunchType = "steam_uri" | "uri" | "exe";

export interface Game {
  id: string;
  source: GameSource;
  sourceGameId?: string | null;
  title: string;
  installPath?: string | null;
  launchType: LaunchType;
  launchTarget: string;
  launchArgs?: string | null;
  heroImage?: string | null;
  coverImage?: string | null;
  headerImage?: string | null;
  description?: string | null;
  lastPlayedAt?: string | null;
  playtimeMinutes?: number | null;
  isInstalled: boolean;
  developers?: string | null;
  genres?: string | null;
  releaseDate?: string | null;
  isFavorite: boolean;
}

export interface ActiveSession {
  gameId: string;
  startedAt: string;
}

export type AppTheme = "nexora" | "nord" | "dracula" | "tokyoNight" | "catppuccinMocha" | "rosePine";

/** Controller families we render distinct button icons/labels for. "auto" follows the connected device. */
export type ControllerLayout = "auto" | "xbox" | "playstation";
/** A detected physical controller's family, always resolved (never "auto"). */
export type ControllerKind = "xbox" | "playstation" | "generic";

/** Canonical physical buttons, shared between the browser Gamepad API (by index) and gilrs (by enum variant). */
export type ControllerButton =
  | "South"
  | "East"
  | "North"
  | "West"
  | "LB"
  | "RB"
  | "LT"
  | "RT"
  | "Select"
  | "Start"
  | "DPadUp"
  | "DPadDown"
  | "DPadLeft"
  | "DPadRight";

/** Abstract app actions a physical button can be remapped to. */
export type ControllerActionName =
  | "up"
  | "down"
  | "left"
  | "right"
  | "confirm"
  | "back"
  | "pageUp"
  | "pageDown"
  | "menu"
  | "search"
  | "sync"
  | "favorite";

export type ControllerBindings = Partial<Record<ControllerActionName, ControllerButton>>;

export interface AppSettings {
  steamGridDbApiKey?: string;
  consoleMode: boolean;
  launchOnLogin: boolean;
  /** Stored/serialized as a string ("0"-"100"); parse before using as a number. */
  soundVolume?: string;
  colorTheme?: AppTheme;
  reduceMotion?: boolean;
  /** Stored/serialized as a string ("0"-"100"); parse before using as a number. */
  controllerDeadzone?: string;
  controllerVibration?: boolean;
  controllerLayout?: ControllerLayout;
  /** JSON-serialized ControllerBindings; parse with parseBindings() before using. */
  controllerBindings?: string;
}

export interface ManualGamePayload {
  id?: string;
  title: string;
  installPath: string;
  launchTarget: string;
  launchArgs?: string;
  heroImage?: string;
  coverImage?: string;
  description?: string;
  developers?: string;
  genres?: string;
  releaseDate?: string;
}

export type View = "home" | "detail" | "manual" | "settings";

export interface SyncSummaryEntry {
  source: GameSource;
  imported: number;
  found: boolean;
}

export interface SyncResult {
  games: Game[];
  summary: SyncSummaryEntry[];
}

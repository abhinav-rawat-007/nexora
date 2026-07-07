import type { ControllerActionName, ControllerBindings, ControllerButton, ControllerKind, ControllerLayout } from "@/types";

/** Standard Gamepad API button indices, keyed to the same canonical names gilrs reports on the Rust side. */
export const STANDARD_BUTTON_INDEX: Record<number, ControllerButton> = {
  0: "South",
  1: "East",
  2: "West",
  3: "North",
  4: "LB",
  5: "RB",
  6: "LT",
  7: "RT",
  8: "Select",
  9: "Start",
  12: "DPadUp",
  13: "DPadDown",
  14: "DPadLeft",
  15: "DPadRight",
};

export const DEFAULT_BINDINGS: Record<ControllerActionName, ControllerButton> = {
  up: "DPadUp",
  down: "DPadDown",
  left: "DPadLeft",
  right: "DPadRight",
  confirm: "South",
  back: "East",
  pageUp: "LB",
  pageDown: "RB",
  menu: "Start",
  search: "North",
  sync: "West",
  favorite: "LT",
};

export const ACTION_TO_KEY: Record<ControllerActionName, string> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  confirm: "Enter",
  back: "Escape",
  pageUp: "PageUp",
  pageDown: "PageDown",
  menu: "s",
  search: "/",
  sync: "r",
  favorite: "f",
};

export const ACTION_META: { key: ControllerActionName; label: string; description: string }[] = [
  { key: "confirm", label: "Confirm", description: "Opens the highlighted game or confirms a choice." },
  { key: "back", label: "Back", description: "Returns to the previous screen." },
  { key: "favorite", label: "Favorite", description: "Adds or removes the highlighted game from favourites." },
  { key: "menu", label: "Menu", description: "Opens or closes Settings." },
  { key: "search", label: "Search", description: "Opens the library search box." },
  { key: "sync", label: "Sync", description: "Syncs installed launchers into your library." },
  { key: "pageUp", label: "Page up", description: "Jumps up a row of games." },
  { key: "pageDown", label: "Page down", description: "Jumps down a row of games." },
  { key: "up", label: "Navigate up", description: "Moves the highlight up." },
  { key: "down", label: "Navigate down", description: "Moves the highlight down." },
  { key: "left", label: "Navigate left", description: "Moves the highlight left." },
  { key: "right", label: "Navigate right", description: "Moves the highlight right." },
];

const XBOX_LABELS: Record<ControllerButton, string> = {
  South: "A",
  East: "B",
  West: "X",
  North: "Y",
  LB: "LB",
  RB: "RB",
  LT: "LT",
  RT: "RT",
  Select: "View",
  Start: "Menu",
  DPadUp: "D-Pad Up",
  DPadDown: "D-Pad Down",
  DPadLeft: "D-Pad Left",
  DPadRight: "D-Pad Right",
};

const PS_LABELS: Record<ControllerButton, string> = {
  South: "Cross",
  East: "Circle",
  West: "Square",
  North: "Triangle",
  LB: "L1",
  RB: "R1",
  LT: "L2",
  RT: "R2",
  Select: "Share",
  Start: "Options",
  DPadUp: "D-Pad Up",
  DPadDown: "D-Pad Down",
  DPadLeft: "D-Pad Left",
  DPadRight: "D-Pad Right",
};

const GENERIC_LABELS: Record<ControllerButton, string> = {
  South: "A",
  East: "B",
  West: "X",
  North: "Y",
  LB: "L1",
  RB: "R1",
  LT: "L2",
  RT: "R2",
  Select: "Select",
  Start: "Start",
  DPadUp: "D-Pad Up",
  DPadDown: "D-Pad Down",
  DPadLeft: "D-Pad Left",
  DPadRight: "D-Pad Right",
};

const LABELS_BY_KIND: Record<ControllerKind, Record<ControllerButton, string>> = {
  xbox: XBOX_LABELS,
  playstation: PS_LABELS,
  generic: GENERIC_LABELS,
};

/** Identifies controller family from the string the OS/browser reports (gilrs gamepad name or Gamepad.id). */
export function detectControllerKind(name: string): ControllerKind {
  const lower = name.toLowerCase();
  if (lower.includes("xbox") || lower.includes("xinput") || lower.includes("045e")) return "xbox";
  if (
    lower.includes("playstation") ||
    lower.includes("dualshock") ||
    lower.includes("dualsense") ||
    lower.includes("wireless controller") ||
    lower.includes("054c")
  ) {
    return "playstation";
  }
  return "generic";
}

export function resolveLayout(layout: ControllerLayout | undefined, detected: ControllerKind): ControllerKind {
  if (layout === "xbox" || layout === "playstation") return layout;
  return detected;
}

const KIND_FALLBACK_NAME: Record<ControllerKind, string> = {
  xbox: "Xbox Controller",
  playstation: "PlayStation Controller",
  generic: "Controller",
};

/**
 * Shortens the raw name/id reported by the Gamepad API down to something fit for a topbar badge:
 * strips the vendor/product-id parenthetical (e.g. "(STANDARD GAMEPAD Vendor: 045e Product: 02ea)")
 * and generic "Wireless Controller" suffixes that just repeat what the badge icon already implies.
 */
export function shortControllerName(name: string, kind: ControllerKind): string {
  const withoutParens = name.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const withoutSuffix = withoutParens.replace(/\s*(Wireless\s+)?Controller\s*$/i, "").trim();
  return withoutSuffix || withoutParens || KIND_FALLBACK_NAME[kind];
}

export function buttonLabel(button: ControllerButton, kind: ControllerKind): string {
  return LABELS_BY_KIND[kind][button];
}

/** Face-button fill colors, matching each family's real-world button colors. Only South/East/West/North get a colored glyph - the rest render as plain text pills. */
const FACE_BUTTON_COLORS: Record<ControllerKind, Partial<Record<ControllerButton, string>>> = {
  xbox: { South: "#4c9a2a", East: "#d1313e", West: "#2f7cd6", North: "#e0b02c" },
  playstation: { South: "#3a7bd5", East: "#d1414f", West: "#b565d6", North: "#3a9e6f" },
  generic: {},
};

/** Symbol shown inside a face button's colored glyph - PlayStation uses shape glyphs rather than letters. */
const FACE_BUTTON_GLYPH_TEXT: Record<ControllerKind, Partial<Record<ControllerButton, string>>> = {
  xbox: { South: "A", East: "B", West: "X", North: "Y" },
  playstation: { South: "✕", East: "○", West: "□", North: "△" },
  generic: {},
};

export interface ButtonGlyph {
  /** Single glyph character/short label to render inside the badge. */
  text: string;
  /** "circle" for a colored face-button glyph (A/B/X/Y, Cross/Circle/Square/Triangle); "pill" for everything else. */
  shape: "circle" | "pill";
  /** CSS color for a "circle" glyph's fill; undefined for "pill". */
  color?: string;
}

/** Describes how to render a physical button as a small controller-style glyph, e.g. in the footer hint bar. */
export function buttonGlyph(button: ControllerButton, kind: ControllerKind): ButtonGlyph {
  const color = FACE_BUTTON_COLORS[kind][button];
  const glyphText = FACE_BUTTON_GLYPH_TEXT[kind][button];
  if (color && glyphText) {
    return { text: glyphText, shape: "circle", color };
  }
  return { text: LABELS_BY_KIND[kind][button], shape: "pill" };
}

export function parseBindings(json: string | undefined): ControllerBindings {
  if (!json) return { ...DEFAULT_BINDINGS };
  try {
    const parsed = JSON.parse(json) as ControllerBindings;
    return { ...DEFAULT_BINDINGS, ...parsed };
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

export function serializeBindings(bindings: ControllerBindings): string {
  return JSON.stringify(bindings);
}

/** Inverts an action->button map so a pressed button can be looked up to find the action it triggers. */
export function invertBindings(bindings: ControllerBindings): Partial<Record<ControllerButton, ControllerActionName>> {
  const inverted: Partial<Record<ControllerButton, ControllerActionName>> = {};
  for (const [action, button] of Object.entries(bindings) as [ControllerActionName, ControllerButton | undefined][]) {
    if (button) inverted[button] = action;
  }
  return inverted;
}

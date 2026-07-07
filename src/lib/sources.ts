import type { GameSource } from "../types";

export const SOURCE_META: Record<GameSource, { label: string; color: string }> = {
  steam: { label: "Steam", color: "#66c0f4" },
  epic: { label: "Epic Games", color: "#d1d1d1" },
  gog: { label: "GOG", color: "#a53df2" },
  xbox: { label: "Xbox", color: "#107c10" },
  riot: { label: "Riot Games", color: "#ee4351" },
  battlenet: { label: "Battle.net", color: "#00aeff" },
  other: { label: "Other", color: "#8a94a6" },
  manual: { label: "Manual", color: "#ffc266" },
};

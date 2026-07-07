import { Loader2, Play } from "lucide-react";
import type { Game } from "../types";

export function ActionRow({
  selectedGame,
  busy,
  focusedIndex = -1,
  onLaunch,
  onDetails,
}: {
  selectedGame: Game | null;
  busy: boolean;
  focusedIndex?: number;
  onLaunch: () => void;
  onDetails: () => void;
}) {
  return (
    <div className="actions">
      <button
        className={`primary ${focusedIndex === 0 ? "controller-focused" : ""}`}
        onClick={onLaunch}
        disabled={busy || !selectedGame?.launchTarget}
      >
        {busy ? <Loader2 size={22} className="spin" /> : <Play size={22} />} Launch
      </button>
      <button
        className={focusedIndex === 1 ? "controller-focused" : ""}
        onClick={onDetails}
        disabled={!selectedGame}
      >
        Details
      </button>
    </div>
  );
}

import type { Game } from "../types";
import { formatLivePlaytime } from "../utils/format";

export function ContinueRail({
  games,
  focusedIndex = -1,
  activeSessions = {},
  onSelect,
}: {
  games: Game[];
  focusedIndex?: number;
  activeSessions?: Record<string, string>;
  onSelect: (game: Game) => void;
}) {
  if (!games.length) return null;
  return (
    <div className="rail-block secondary">
      <h2 className="rail-title">Continue Playing</h2>
      <div className="continue-rail">
        {games.map((game, index) => (
          <button
            key={game.id}
            className={`continue-card ${focusedIndex === index ? "controller-focused" : ""}`}
            onClick={() => onSelect(game)}
          >
            {game.headerImage || game.coverImage ? (
              <img src={game.headerImage ?? game.coverImage ?? undefined} alt="" />
            ) : (
              <div className="continue-placeholder" />
            )}
            <div className="continue-overlay">
              <strong>{game.title}</strong>
              <span className={activeSessions[game.id] ? "live" : undefined}>
                {formatLivePlaytime(game.playtimeMinutes, activeSessions[game.id])}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

import { motion } from "framer-motion";
import { Calendar, Clock3, Loader2, Play, Tags, Trash2, Users, X } from "lucide-react";
import type { Game } from "../types";
import { formatDate, formatLivePlaytime } from "../utils/format";
import { SOURCE_META } from "../lib/sources";

export function GameDialog({
  game,
  busy,
  reduceMotion = false,
  focusedAction = 0,
  sessionStartedAt,
  onClose,
  onLaunch,
  onEdit,
  onRemove,
}: {
  game: Game;
  busy: boolean;
  reduceMotion?: boolean;
  focusedAction?: number;
  /** ISO start time if this game currently has a tracked play session running. */
  sessionStartedAt?: string;
  onClose: () => void;
  onLaunch: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const banner = game.heroImage || game.headerImage || game.coverImage;
  const genres = game.genres
    ? game.genres.split(",").map((g) => g.trim()).filter(Boolean)
    : [];

  return (
    <motion.div
      className="dialog-layer"
      role="dialog"
      aria-modal="true"
      aria-label={game.title}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.16 }}
    >
      <button className="dialog-scrim" onClick={onClose} aria-label="Close details" />
      <motion.section
        className="game-dialog"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: reduceMotion ? 0 : 0.18 }}
      >
        <button className="icon-button close-button" onClick={onClose} title="Close">
          <X size={20} />
        </button>
        <div className="dialog-hero" style={banner ? { backgroundImage: `url("${banner}")` } : undefined}>
          {!banner && <div className="placeholder dialog-hero-placeholder"><strong>{game.title.slice(0, 2).toUpperCase()}</strong></div>}
          <div className="dialog-hero-content">
            <span className="eyebrow" style={{ color: SOURCE_META[game.source].color }}>
              {SOURCE_META[game.source].label}
            </span>
            <h2>{game.title}</h2>
          </div>
        </div>
        <div className="dialog-body">
          <div className="dialog-actions-row">
            <button
              className={`primary ${focusedAction === 0 ? "controller-focused" : ""}`}
              onClick={onLaunch}
              disabled={busy || !game.launchTarget}
            >
              {busy ? <Loader2 size={22} className="spin" /> : <Play size={22} />} Play
            </button>
            {game.source === "manual" && (
              <>
                <button
                  className={focusedAction === 1 ? "controller-focused" : ""}
                  onClick={onEdit}
                  disabled={busy}
                >
                  Edit
                </button>
                <button
                  className={focusedAction === 2 ? "controller-focused" : ""}
                  onClick={onRemove}
                  disabled={busy}
                >
                  {busy ? <Loader2 size={18} className="spin" /> : <Trash2 size={18} />} Remove
                </button>
              </>
            )}
          </div>

          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-label"><Clock3 size={15} /> Playtime</span>
              <span className={`stat-value ${sessionStartedAt ? "live" : ""}`}>
                {formatLivePlaytime(game.playtimeMinutes, sessionStartedAt, game.lastPlayedAt)}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label"><Calendar size={15} /> Last Played</span>
              <span className="stat-value">{game.lastPlayedAt ? formatDate(game.lastPlayedAt) : "Never"}</span>
            </div>
            {game.releaseDate && (
              <div className="stat-card">
                <span className="stat-label"><Calendar size={15} /> Released</span>
                <span className="stat-value">{game.releaseDate}</span>
              </div>
            )}
            {game.developers && (
              <div className="stat-card">
                <span className="stat-label"><Users size={15} /> Developer</span>
                <span className="stat-value">{game.developers}</span>
              </div>
            )}
          </div>

          {game.description && <p className="dialog-description">{game.description}</p>}

          {genres.length > 0 && (
            <div className="tag-row">
              <span className="tag-row-label"><Tags size={14} /> Genres</span>
              {genres.map((genre) => (
                <span className="tag-pill" key={genre}>{genre}</span>
              ))}
            </div>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
}

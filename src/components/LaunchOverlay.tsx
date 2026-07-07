import { motion } from "framer-motion";
import type { Game } from "../types";

export function LaunchOverlay({ game, reduceMotion = false }: { game: Game; reduceMotion?: boolean }) {
  const banner = game.heroImage || game.headerImage || game.coverImage;

  return (
    <motion.div
      className="launch-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.25 }}
    >
      <div className="launch-overlay-bg" style={banner ? { backgroundImage: `url("${banner}")` } : undefined} />
      <div className="launch-overlay-scrim" />
      <motion.div
        className="launch-overlay-content"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.3, delay: reduceMotion ? 0 : 0.1 }}
      >
        <span className="launch-spinner spin" aria-hidden="true" />
        <span className="eyebrow">Launching</span>
        <h2>{game.title}</h2>
      </motion.div>
    </motion.div>
  );
}

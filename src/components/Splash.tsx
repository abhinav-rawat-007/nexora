import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { playBootChime } from "../sound";

const WORD = "NEXORA";
const MIN_DISPLAY_MS = 1200;

const letterVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export function Splash({
  dataReady,
  reduceMotion = false,
  onDone,
}: {
  dataReady: boolean;
  reduceMotion?: boolean;
  onDone: () => void;
}) {
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const chimePlayed = useRef(false);

  useEffect(() => {
    if (!chimePlayed.current) {
      chimePlayed.current = true;
      playBootChime(reduceMotion ? 0.4 : 1);
    }
    const timer = window.setTimeout(() => setMinTimeElapsed(true), reduceMotion ? 300 : MIN_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [reduceMotion]);

  useEffect(() => {
    if (dataReady && minTimeElapsed) onDone();
  }, [dataReady, minTimeElapsed, onDone]);

  return (
    <motion.div
      className="splash"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.4, ease: "easeInOut" }}
    >
      {!reduceMotion && (
        <>
          <motion.div
            className="splash-glow splash-glow-a"
            animate={{ opacity: [0.4, 0.7, 0.4], scale: [1, 1.15, 1] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="splash-glow splash-glow-b"
            animate={{ opacity: [0.3, 0.6, 0.3], scale: [1.1, 1, 1.1] }}
            transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
          />
        </>
      )}

      <motion.div
        className="splash-word"
        initial="hidden"
        animate="visible"
        transition={{ staggerChildren: reduceMotion ? 0 : 0.07, delayChildren: 0.1 }}
      >
        {WORD.split("").map((letter, index) => (
          <motion.span
            key={`${letter}-${index}`}
            className="splash-letter"
            variants={reduceMotion ? undefined : letterVariants}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            {letter}
          </motion.span>
        ))}
      </motion.div>

      <motion.div
        className="splash-tagline"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: reduceMotion ? 0.1 : 0.6 }}
      >
        Your games, one home.
      </motion.div>
    </motion.div>
  );
}

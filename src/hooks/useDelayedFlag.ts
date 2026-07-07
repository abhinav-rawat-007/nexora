import { useEffect, useState } from "react";

/** Mirrors `flag`, but only turns true after it has stayed true for `delayMs`.
 * Keeps loading skeletons from flashing on loads that finish quickly. */
export function useDelayedFlag(flag: boolean, delayMs: number) {
  const [delayed, setDelayed] = useState(false);

  useEffect(() => {
    if (!flag) {
      setDelayed(false);
      return;
    }
    const timer = window.setTimeout(() => setDelayed(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [flag, delayMs]);

  return delayed;
}

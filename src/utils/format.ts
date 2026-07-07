export function formatPlaytime(minutes?: number | null, lastPlayedAt?: string | null) {
  // Distinguish "never launched" from "launched but no time tracked yet".
  if (!minutes) return lastPlayedAt ? "No playtime yet" : "Never played";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours ? `${hours}h ${mins}m played` : `${mins}m played`;
}

/** Playtime for the hero/detail tags: a live elapsed count while a session is running, the usual
 * lifetime total otherwise. `sessionStartedAt` comes from the active-sessions map in App.tsx. */
export function formatLivePlaytime(
  minutes: number | null | undefined,
  sessionStartedAt: string | null | undefined,
  lastPlayedAt?: string | null,
) {
  if (!sessionStartedAt) return formatPlaytime(minutes, lastPlayedAt);
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(sessionStartedAt).getTime()) / 60_000));
  return elapsedMinutes < 1 ? "Playing now" : `Playing · ${elapsedMinutes}m`;
}

export function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function readError(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err);
}

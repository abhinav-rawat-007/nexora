import { useEffect, useRef, useState } from "react";
import { getActiveSessions, onSessionEnded, onSessionStarted, type SessionEndedPayload } from "../tauri";

/** gameId -> ISO start time, for every game currently being tracked as "in a play session". */
export type ActiveSessionMap = Record<string, string>;

/** Tracks live play sessions: seeds from `get_active_sessions` on mount (so a reload doesn't lose
 * an in-progress session's timer), then follows `game-session-started`/`game-session-ended`
 * events for the rest of the app's lifetime. `onEnded` is called once per finished session so the
 * caller can fold the new total into its own game list. */
export function usePlaytimeTracking(onEnded: (payload: SessionEndedPayload) => void): ActiveSessionMap {
  const [sessions, setSessions] = useState<ActiveSessionMap>({});
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  useEffect(() => {
    let cancelled = false;
    getActiveSessions().then((active) => {
      if (cancelled) return;
      setSessions(Object.fromEntries(active.map((session) => [session.gameId, session.startedAt])));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Mirrors the cancellation-guard pattern in useControllerInfo.ts: listen() resolves
    // asynchronously, so without this guard StrictMode's double-invoked effects can leak the
    // first subscription in development.
    let cancelled = false;
    let unlistenStarted: (() => void) | undefined;
    let unlistenEnded: (() => void) | undefined;

    onSessionStarted((payload) => {
      setSessions((prev) => ({ ...prev, [payload.gameId]: payload.startedAt }));
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else unlistenStarted = cleanup;
    });

    onSessionEnded((payload) => {
      setSessions((prev) => {
        const next = { ...prev };
        delete next[payload.gameId];
        return next;
      });
      onEndedRef.current(payload);
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else unlistenEnded = cleanup;
    });

    return () => {
      cancelled = true;
      unlistenStarted?.();
      unlistenEnded?.();
    };
  }, []);

  return sessions;
}

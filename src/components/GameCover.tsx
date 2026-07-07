import { useState } from "react";
import type { Game } from "../types";

export function GameCover({ game, reduceMotion = false }: { game: Game; reduceMotion?: boolean }) {
  const [stage, setStage] = useState<"cover" | "header" | "failed">("cover");
  const [loaded, setLoaded] = useState(false);
  const src = stage === "cover" ? game.coverImage : stage === "header" ? game.headerImage : null;
  if (!src) return <Placeholder title={game.title} />;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      // Cached images can finish loading before React attaches onLoad - catch those here.
      ref={(el) => {
        if (el?.complete && el.naturalWidth > 0) setLoaded(true);
      }}
      style={reduceMotion ? undefined : { opacity: loaded ? 1 : 0, transition: "opacity 220ms ease" }}
      onLoad={() => setLoaded(true)}
      onError={() => {
        setLoaded(false);
        setStage((current) => (current === "cover" ? "header" : "failed"));
      }}
    />
  );
}

// The source badge (which storefront this came from) is rendered by the caller
// (GameRail's .source-badge pill, GameDialog's eyebrow) - not duplicated here.
function Placeholder({ title }: { title: string }) {
  return (
    <div className="placeholder">
      <strong>{title.slice(0, 2).toUpperCase()}</strong>
    </div>
  );
}

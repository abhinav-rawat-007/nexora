import { useEffect, useRef, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { Star } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Game } from "../types";
import { GameCover } from "./GameCover";
import { SOURCE_META } from "../lib/sources";
import { useDelayedFlag } from "../hooks/useDelayedFlag";

const railVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
};

const tileVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.22 } },
};

export function GameRail({
  games,
  selectedIndex,
  active = true,
  reduceMotion = false,
  dragEnabled = false,
  loading = false,
  searchQuery = "",
  activeSessions = {},
  onSelect,
  onToggleFavorite,
  onReorder,
  onSync,
  onAddManual,
  onClearSearch,
}: {
  games: Game[];
  selectedIndex: number;
  active?: boolean;
  reduceMotion?: boolean;
  /** Only "Custom order" sort mode (and no active search filter) makes drag reordering meaningful. */
  dragEnabled?: boolean;
  /** True while the library is still being fetched - shows skeleton tiles instead of an empty state. */
  loading?: boolean;
  /** The active search filter, used to tell "library empty" apart from "no search results". */
  searchQuery?: string;
  /** gameId -> session start time, for games currently in a tracked play session. */
  activeSessions?: Record<string, string>;
  onSelect: (index: number) => void;
  onToggleFavorite?: (game: Game) => void;
  onReorder?: (orderedGameIds: string[]) => void;
  onSync?: () => void;
  onAddManual?: () => void;
  onClearSearch?: () => void;
}) {
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [isSorting, setIsSorting] = useState(false);
  // Only surface skeletons for genuinely slow loads so fast starts don't flash.
  const showSkeleton = useDelayedFlag(loading, 500);

  const lastNavAtRef = useRef(0);

  useEffect(() => {
    // Rapid selection changes (held d-pad) skip smooth scrolling - queued smooth scrolls
    // fight each other and make fast navigation feel laggy.
    const now = performance.now();
    const rapid = now - lastNavAtRef.current < 150;
    lastNavAtRef.current = now;
    tileRefs.current[selectedIndex]?.scrollIntoView({
      behavior: reduceMotion || rapid ? "auto" : "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [selectedIndex, reduceMotion]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (loading) {
    if (!showSkeleton) return null;
    return (
      <div className="rail" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className={`tile-skeleton skeleton ${reduceMotion ? "static" : ""}`} />
        ))}
      </div>
    );
  }

  if (!games.length) {
    if (searchQuery.trim()) {
      return (
        <div className="empty">
          <h2>No results for “{searchQuery.trim()}”</h2>
          <p>Try a different title, or clear the search to see your whole library.</p>
          {onClearSearch && (
            <div className="empty-actions">
              <button type="button" onClick={onClearSearch}>Clear search</button>
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="empty">
        <h2>No games yet</h2>
        <p>Pull in games from your installed launchers, or add one manually.</p>
        <div className="empty-actions">
          {onSync && (
            <button type="button" className="primary" onClick={onSync}>Sync libraries</button>
          )}
          {onAddManual && (
            <button type="button" onClick={onAddManual}>Add manually</button>
          )}
        </div>
      </div>
    );
  }

  // Keep framer's layout FLIP disabled until dnd-kit's drop-settle transition (250ms default)
  // finishes, so a released tile animates into its slot instead of snapping.
  function endSorting() {
    window.setTimeout(() => setIsSorting(false), reduceMotion ? 0 : 250);
  }

  function handleDragEnd(event: DragEndEvent) {
    endSorting();
    const { active: activeItem, over } = event;
    if (!over || activeItem.id === over.id || !onReorder) return;
    const oldIndex = games.findIndex((game) => game.id === activeItem.id);
    const newIndex = games.findIndex((game) => game.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(games, oldIndex, newIndex).map((game) => game.id));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={() => setIsSorting(true)}
      onDragEnd={handleDragEnd}
      onDragCancel={endSorting}
    >
      <SortableContext items={games.map((game) => game.id)} strategy={horizontalListSortingStrategy}>
        <motion.div
          className="rail"
          variants={reduceMotion ? undefined : railVariants}
          initial={reduceMotion ? undefined : "hidden"}
          animate={reduceMotion ? undefined : "visible"}
        >
          {games.map((game, index) => (
            <SortableTile
              key={game.id}
              game={game}
              selected={index === selectedIndex}
              active={active}
              reduceMotion={reduceMotion}
              dragEnabled={dragEnabled}
              sorting={isSorting}
              flipLabel={index >= games.length - 2}
              playing={!!activeSessions[game.id]}
              onSelect={() => onSelect(index)}
              onToggleFavorite={onToggleFavorite}
              setTileRef={(el) => {
                tileRefs.current[index] = el;
              }}
            />
          ))}
        </motion.div>
      </SortableContext>
    </DndContext>
  );
}

function SortableTile({
  game,
  selected,
  active,
  reduceMotion,
  dragEnabled,
  sorting,
  flipLabel,
  playing,
  onSelect,
  onToggleFavorite,
  setTileRef,
}: {
  game: Game;
  selected: boolean;
  active: boolean;
  reduceMotion: boolean;
  dragEnabled: boolean;
  /** Whether any tile in this rail is currently being dragged, not just this one. */
  sorting: boolean;
  /** True for the last couple of tiles, where the label would otherwise overflow past the rail's right edge. */
  flipLabel: boolean;
  /** Whether this game currently has a tracked play session running. */
  playing: boolean;
  onSelect: () => void;
  onToggleFavorite?: (game: Game) => void;
  setTileRef: (el: HTMLButtonElement | null) => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: game.id,
    disabled: !dragEnabled,
  });

  // While a drag is in progress anywhere in this rail, dnd-kit drives every tile's transform
  // directly (the grabbed tile follows the pointer, siblings shift live to make room) - same as
  // a plain dnd-kit sortable list. The moment nothing is being dragged, dnd-kit's transform goes
  // back to null and framer-motion's `layout` FLIP below takes over instead, for reorders that
  // aren't drag-driven (a favourited game jumping to the front, a sort mode switch). `layout` is
  // turned off for the whole rail during an active drag so the two never touch transform at once.
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: reduceMotion ? undefined : transition,
    zIndex: isDragging ? 3 : undefined,
  };

  return (
    <motion.div
      ref={setNodeRef}
      layout={sorting || reduceMotion ? false : "position"}
      transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
      style={style}
      className={`tile-slot ${selected ? "selected" : ""} ${isDragging ? "dragging" : ""}`}
      {...(dragEnabled ? attributes : {})}
      {...(dragEnabled ? listeners : {})}
    >
      <motion.button
        ref={setTileRef}
        className={`tile ${selected ? (active ? "selected" : "selected muted") : ""} ${dragEnabled ? "draggable" : ""}`}
        onClick={onSelect}
        title={game.title}
        variants={reduceMotion ? undefined : tileVariants}
      >
        {/* Decorative overlays only - never touch this button's own transform (owned by CSS .tile.selected) */}
        {selected && (
          <motion.span
            className="tile-border"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
          />
        )}
        <GameCover game={game} reduceMotion={reduceMotion} />
        {playing && <span className="playing-badge">Playing</span>}
        {game.source !== "manual" && (
          <span className="source-badge" style={{ color: SOURCE_META[game.source].color }}>
            {SOURCE_META[game.source].label}
          </span>
        )}
        {onToggleFavorite && (
          <span
            role="button"
            tabIndex={-1}
            className={`favorite-badge ${game.isFavorite ? "active" : ""}`}
            title={game.isFavorite ? "Remove from favourites" : "Add to favourites"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite(game);
            }}
          >
            <motion.span
              key={game.isFavorite ? "favourited" : "unfavourited"}
              style={{ display: "inline-flex" }}
              initial={reduceMotion ? false : { scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 16 }}
            >
              <Star size={14} fill={game.isFavorite ? "currentColor" : "none"} />
            </motion.span>
          </span>
        )}
        {selected && (
          <span className={`tile-label ${flipLabel ? "flip" : ""}`}>{game.title}</span>
        )}
      </motion.button>
    </motion.div>
  );
}

import { Plus, RefreshCw, Search, Settings } from "lucide-react";
import type { View } from "../types";

export function TopBar({
  view,
  busy,
  syncing,
  searchOpen,
  searchQuery,
  clock,
  focusedIndex = -1,
  onSearchToggle,
  onSearchFocus,
  onSearchQueryChange,
  onSync,
  onAddGame,
  onToggleSettings,
  onOpenSettings,
}: {
  view: View;
  busy: boolean;
  syncing: boolean;
  searchOpen: boolean;
  searchQuery: string;
  clock: Date;
  focusedIndex?: number;
  onSearchToggle: () => void;
  onSearchFocus: () => void;
  onSearchQueryChange: (value: string) => void;
  onSync: () => void;
  onAddGame: () => void;
  onToggleSettings: () => void;
  onOpenSettings: () => void;
}) {
  const focusedClass = (index: number) => (focusedIndex === index ? "controller-focused" : "");
  return (
    <header className="topbar">
      <div className="tabs">
        <span className="tab active">Games</span>
        <button
          className={`sync-inline-button ${focusedClass(0)}`}
          title="Sync your libraries"
          onClick={onSync}
          disabled={syncing || busy}
        >
          <RefreshCw size={15} className={syncing ? "spin" : ""} />
          <span className="sync-label">{syncing ? "Syncing..." : "Sync"}</span>
        </button>
      </div>
      <div className="topbar-actions">
        <div className={searchOpen ? "search-box open" : "search-box"}>
          <input
            placeholder="Search your library"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onFocus={onSearchFocus}
          />
        </div>
        <button className={`icon-button ghost ${focusedClass(1)}`} title="Search" onClick={onSearchToggle}>
          <Search size={19} />
        </button>
        <button
          className={`icon-button ghost ${focusedClass(2)}`}
          title="Add a game"
          onClick={onAddGame}
          disabled={busy || syncing}
        >
          <Plus size={19} />
        </button>
        <button
          className={`icon-button ghost ${view === "settings" ? "active" : ""} ${focusedClass(3)}`}
          title="Settings"
          onClick={onToggleSettings}
        >
          <Settings size={19} />
        </button>
        <span className="clock">
          {clock.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </span>
        <button className={`avatar ${focusedClass(4)}`} title="Settings" onClick={onOpenSettings}>
          N<span className="avatar-dot" />
        </button>
      </div>
    </header>
  );
}

# Nexora

A living-room home for your game library. Nexora syncs your games from Steam, Xbox, GOG, Epic Games, Battle.net, and Riot Games, lets you add anything else by hand, and puts it all on one couch-friendly screen — full controller support included.

![platform](https://img.shields.io/badge/platform-Windows-0a84ff)
![license](https://img.shields.io/badge/license-MIT-green)
![status](https://img.shields.io/badge/status-v0.1.0-orange)

## Features

- **Multi-launcher sync** — automatically pulls your library from Steam, Xbox, GOG, Epic Games, Battle.net, and Riot Games.
- **Manual entries** — add anything that isn't covered by a launcher (emulators, standalone .exe games, etc.).
- **One-screen launching** — browse and launch every game from a single unified, big-screen UI.
- **Full controller support** — navigate menus, launch games, and manage settings entirely with a gamepad (built on [`gilrs`](https://crates.io/crates/gilrs), with a raw HID fallback for DualSense battery reporting over Bluetooth).
- **Playtime tracking** — keeps track of how long you've spent in each game.
- **Rich cover art** — fetches box art via SteamGridDB.
- **Fast, local, native** — a Rust backend with a SQLite-backed local database; no cloud account required.

## Tech stack

- **Frontend** — React, TypeScript, Vite, Tailwind CSS, Framer Motion, Radix UI
- **Backend/shell** — [Tauri 2](https://tauri.app/), Rust
- **Storage** — SQLite (via `rusqlite`)
- **Input** — `gilrs` for controllers, `hidapi` for raw HID device access

## Getting started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/)
- Windows (currently the only supported/tested platform)

### Setup

```bash
pnpm install
```

### Run in development

```bash
pnpm tauri dev
```

### Build a release executable

```bash
pnpm tauri build
```

This produces a standalone executable and installers (MSI and NSIS) under `src-tauri/target/release/`.

## Project structure

```
src/                # React frontend (UI, components, hooks)
src-tauri/          # Rust backend
  src/
    steam.rs        # Steam library integration
    xbox.rs         # Xbox integration
    gog.rs          # GOG integration
    epic.rs         # Epic Games integration
    battlenet.rs     # Battle.net integration
    riot.rs         # Riot Games integration
    other.rs        # Manually-added games
    controller.rs   # Gamepad input handling
    steamgriddb.rs  # Cover art fetching
    playtime.rs     # Playtime tracking
    db.rs           # SQLite persistence layer
```

## Contributing

Issues and pull requests are welcome. If you're adding support for a new launcher or platform, take a look at one of the existing integrations (e.g. `steam.rs` or `gog.rs`) as a starting point for the shape of the code.

## License

[MIT](LICENSE)

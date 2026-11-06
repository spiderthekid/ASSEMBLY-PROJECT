# Project Architecture: Tactical Arena FPS (Permadeath Scavenger Edition)

## 1. Core Rules & Loop
- **Platform:** PC (Mouse & Keyboard, PointerLock API / Raw Input).
- **Mode:** Offline Single-Player Free-For-All (1 Human Player vs. N AI Bots).
- **Permadeath Rule:** Bots respawn continuously to keep the arena full. The Human Player has 1 LIFE. When `Player.health <= 0`, the match ends immediately.
- **Map Cycling on Death:** Death UI allows 1-click transition to:
  1. `[SPACE]` Next Pre-Chosen Map in playlist queue.
  2. `[R]` Random Map (excluding current map).
  3. `[T]` Instant Retry on current map.
- **Asymmetric Loadouts & Scavenging:** Every combatant spawns with a different primary weapon from the 8-weapon military roster. Player spawns with scarce reserve ammo (2 mags). Killed bots drop their physical weapon with remaining ammo; Player presses `[F]` to swap weapons or walks over matching weapons to scavenge ammo.

## 2. Directory Structure
- `/src/core/` -> `MatchManager`, `MapRegistry`, `InputManager`, `AudioManager`, `AuthManager`
- `/src/player/` -> `ArenaPlayerController`, `WeaponViewModel`, `PlayerHUD`, `AuthUI`
- `/src/weapons/` -> `WeaponDatabase` (8 military guns), `WeaponSystem`, `LootDropManager`
- `/src/ai/` -> `BotDirector`, `BotAgent` (FFA threat matrix, NavMesh/waypoint pathing, loadout-aware combat)
- `/src/maps/` -> `MapBuilder`, `SpawnSystem` (anti-spawn-trap LOS/distance scoring), `MapAssets` (Killhouse Alpha, Black Site Khyber, Severomorsk Dock, Bone Yard)

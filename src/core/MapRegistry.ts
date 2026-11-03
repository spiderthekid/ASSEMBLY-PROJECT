import {
  MAP_ORDER,
  MAP_DEFINITIONS,
  type MapId,
  type MapMetadata,
} from '../maps/MapAssets';

export type MapSelectionMode = 'single' | 'playlist' | 'random';

export function getMapThumbnailSvg(mapId: MapId): string {
  switch (mapId) {
    case 'killhouse_alpha':
      return `<svg viewBox="0 0 120 68" class="map-thumb-svg">
        <rect width="120" height="68" fill="#0d131a"/>
        <rect x="6" y="6" width="108" height="56" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3 2"/>
        <rect x="14" y="12" width="28" height="18" fill="#1e293b" stroke="#94a3b8" stroke-width="1"/>
        <rect x="78" y="12" width="28" height="18" fill="#1e293b" stroke="#94a3b8" stroke-width="1"/>
        <rect x="14" y="38" width="28" height="18" fill="#1e293b" stroke="#94a3b8" stroke-width="1"/>
        <rect x="78" y="38" width="28" height="18" fill="#1e293b" stroke="#94a3b8" stroke-width="1"/>
        <rect x="46" y="22" width="28" height="24" fill="#0284c7" fill-opacity="0.32" stroke="#38bdf8" stroke-width="1.6"/>
        <text x="60" y="37" text-anchor="middle" fill="#e0f2fe" font-size="8" font-family="Consolas">TOWER 2F</text>
      </svg>`;
    case 'blacksite_khyber':
      return `<svg viewBox="0 0 120 68" class="map-thumb-svg">
        <rect width="120" height="68" fill="#1f1624"/>
        <rect x="6" y="6" width="108" height="56" fill="none" stroke="#fb923c" stroke-width="1.5"/>
        <rect x="10" y="12" width="10" height="44" fill="#431407" stroke="#fb923c" stroke-width="1"/>
        <rect x="100" y="12" width="10" height="44" fill="#431407" stroke="#fb923c" stroke-width="1"/>
        <rect x="38" y="9" width="44" height="10" fill="#292524" stroke="#a8a29e" stroke-width="1"/>
        <rect x="38" y="49" width="44" height="10" fill="#292524" stroke="#a8a29e" stroke-width="1"/>
        <circle cx="60" cy="34" r="13" fill="#ea580c" fill-opacity="0.25" stroke="#fdba74" stroke-width="1.5"/>
        <text x="60" y="37" text-anchor="middle" fill="#fed7aa" font-size="9" font-weight="bold" font-family="Consolas">H</text>
      </svg>`;
    case 'severomorsk_dock':
      return `<svg viewBox="0 0 120 68" class="map-thumb-svg">
        <rect width="120" height="68" fill="#0f1d2a"/>
        <rect x="8" y="6" width="16" height="56" fill="#334155" stroke="#93c5fd" stroke-width="1"/>
        <rect x="96" y="6" width="16" height="56" fill="#334155" stroke="#93c5fd" stroke-width="1"/>
        <line x1="24" y1="22" x2="96" y2="22" stroke="#60a5fa" stroke-width="2" stroke-dasharray="4 2"/>
        <line x1="24" y1="46" x2="96" y2="46" stroke="#60a5fa" stroke-width="2" stroke-dasharray="4 2"/>
        <rect x="49" y="10" width="22" height="48" rx="9" fill="#1e293b" stroke="#e2e8f0" stroke-width="1.4"/>
        <text x="60" y="37" text-anchor="middle" fill="#bae6fd" font-size="7.5" font-family="Consolas">SUB-09</text>
      </svg>`;
    case 'bone_yard':
    default:
      return `<svg viewBox="0 0 120 68" class="map-thumb-svg">
        <rect width="120" height="68" fill="#292014"/>
        <rect x="6" y="6" width="108" height="56" fill="none" stroke="#facc15" stroke-width="2"/>
        <rect x="26" y="29" width="68" height="10" rx="4" fill="#475569" stroke="#fde047" stroke-width="1.2"/>
        <polygon points="48,14 72,14 66,29 54,29" fill="#334155" stroke="#cbd5e1" stroke-width="1"/>
        <polygon points="54,39 66,39 72,54 48,54" fill="#334155" stroke="#cbd5e1" stroke-width="1"/>
        <text x="60" y="36" text-anchor="middle" fill="#fef08a" font-size="7.5" font-family="Consolas">C-130</text>
      </svg>`;
  }
}

export class MapRegistry {
  selectionMode: MapSelectionMode = 'playlist';
  singleMapId: MapId = 'killhouse_alpha';
  playlist: MapId[] = [...MAP_ORDER];
  private playlistCursor = 0;
  currentMapId: MapId = 'killhouse_alpha';

  get currentMeta(): MapMetadata {
    return MAP_DEFINITIONS[this.currentMapId];
  }

  get allMaps(): MapMetadata[] {
    return MAP_ORDER.map((id) => MAP_DEFINITIONS[id]);
  }

  getMeta(id: MapId): MapMetadata {
    return MAP_DEFINITIONS[id];
  }

  setCurrentMap(id: MapId): MapMetadata {
    this.currentMapId = id;
    const idx = this.playlist.indexOf(id);
    if (idx >= 0) this.playlistCursor = idx;
    return this.currentMeta;
  }

  setSelectionMode(mode: MapSelectionMode): void {
    this.selectionMode = mode;
  }

  setSingleMap(id: MapId): void {
    this.singleMapId = id;
  }

  setPlaylist(maps: MapId[]): void {
    const valid = maps.filter((id) => MAP_ORDER.includes(id));
    if (valid.length === 0) return;
    this.playlist = valid;
    this.playlistCursor = Math.max(0, this.playlist.indexOf(this.currentMapId));
  }

  toggleMapInPlaylist(id: MapId): boolean {
    const idx = this.playlist.indexOf(id);
    if (idx >= 0) {
      if (this.playlist.length <= 1) return false; // Always keep at least 1 map in playlist
      this.playlist.splice(idx, 1);
      if (this.playlistCursor >= this.playlist.length) {
        this.playlistCursor = 0;
      }
      return true;
    } else {
      this.playlist.push(id);
      return true;
    }
  }

  moveMapInPlaylist(index: number, delta: -1 | 1): void {
    const target = index + delta;
    if (index < 0 || index >= this.playlist.length) return;
    if (target < 0 || target >= this.playlist.length) return;
    const tmp = this.playlist[index];
    this.playlist[index] = this.playlist[target];
    this.playlist[target] = tmp;
  }

  reorderPlaylist(fromIndex: number, toIndex: number): void {
    if (
      fromIndex < 0 ||
      fromIndex >= this.playlist.length ||
      toIndex < 0 ||
      toIndex >= this.playlist.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const [moved] = this.playlist.splice(fromIndex, 1);
    this.playlist.splice(toIndex, 0, moved);
  }

  /**
   * Resolves which map to load when starting a new run from the Sandbox Lobby
   * based on `selectionMode` ('single', 'playlist', or 'random').
   */
  resolveInitialLobbyMap(): MapMetadata {
    if (this.selectionMode === 'single') {
      this.currentMapId = this.singleMapId;
      return this.currentMeta;
    }
    if (this.selectionMode === 'random') {
      const pick = MAP_ORDER[Math.floor(Math.random() * MAP_ORDER.length)];
      this.currentMapId = pick;
      return this.currentMeta;
    }
    // 'playlist' mode starts at index 0 of the user's Pre-Chosen Playlist Queue
    this.playlistCursor = 0;
    this.currentMapId = this.playlist[0] ?? 'killhouse_alpha';
    return this.currentMeta;
  }

  /**
   * Peeks at the NEXT map in the Pre-Chosen Map Playlist Queue without mutating state.
   */
  peekNextMap(): MapMetadata {
    if (this.playlist.length === 0) return MAP_DEFINITIONS.killhouse_alpha;
    const curIdx = this.playlist.indexOf(this.currentMapId);
    const nextIdx = curIdx >= 0 ? (curIdx + 1) % this.playlist.length : (this.playlistCursor + 1) % this.playlist.length;
    return MAP_DEFINITIONS[this.playlist[nextIdx]];
  }

  /**
   * Advances to the next map in the Pre-Chosen Playlist Queue (`[SPACEBAR]` on End-of-Run screen).
   */
  advanceToNextMap(): MapMetadata {
    const nextMeta = this.peekNextMap();
    this.currentMapId = nextMeta.id;
    const idx = this.playlist.indexOf(nextMeta.id);
    this.playlistCursor = idx >= 0 ? idx : 0;
    return this.currentMeta;
  }

  /**
   * Picks a random map strictly excluding the current map (`[R]` on End-of-Run screen).
   */
  advanceToRandomMap(): MapMetadata {
    const candidates = MAP_ORDER.filter((id) => id !== this.currentMapId);
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    this.currentMapId = pick;
    const idx = this.playlist.indexOf(pick);
    if (idx >= 0) this.playlistCursor = idx;
    return this.currentMeta;
  }
}

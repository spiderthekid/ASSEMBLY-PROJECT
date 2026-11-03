import * as THREE from 'three';

/**
 * Static axis-aligned box world used for player collision.
 * The training ground is built from boxes, so AABB-vs-AABB resolution is exact.
 */
export class CollisionWorld {
  readonly boxes: THREE.Box3[] = [];

  add(box: THREE.Box3): void {
    this.boxes.push(box);
  }

  addFromCenter(cx: number, cy: number, cz: number, w: number, h: number, d: number): THREE.Box3 {
    const box = new THREE.Box3(
      new THREE.Vector3(cx - w / 2, cy - h / 2, cz - d / 2),
      new THREE.Vector3(cx + w / 2, cy + h / 2, cz + d / 2),
    );
    this.boxes.push(box);
    return box;
  }

  /** Returns the first box strictly overlapping the given AABB, or null. */
  firstOverlap(min: THREE.Vector3, max: THREE.Vector3): THREE.Box3 | null {
    for (const b of this.boxes) {
      if (
        min.x < b.max.x && max.x > b.min.x &&
        min.y < b.max.y && max.y > b.min.y &&
        min.z < b.max.z && max.z > b.min.z
      ) {
        return b;
      }
    }
    return null;
  }

  /**
   * Highest box top within [minY, maxY] whose footprint overlaps the XZ rectangle.
   * Used for ground probing and stair-down snapping.
   */
  highestFloor(minX: number, maxX: number, minZ: number, maxZ: number, minY: number, maxY: number): number | null {
    let best: number | null = null;
    for (const b of this.boxes) {
      if (minX < b.max.x && maxX > b.min.x && minZ < b.max.z && maxZ > b.min.z) {
        const top = b.max.y;
        if (top >= minY && top <= maxY && (best === null || top > best)) best = top;
      }
    }
    return best;
  }
}

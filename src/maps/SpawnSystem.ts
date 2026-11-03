import * as THREE from 'three';

export interface SpawnNode {
  id: string;
  position: THREE.Vector3;
  yaw: number;
  label?: string;
}

export interface LivingCombatantRef {
  id: string;
  position: THREE.Vector3;
  eyePosition: THREE.Vector3;
  alive: boolean;
}

export interface SpawnNodeScore {
  node: SpawnNode;
  nearestDistance: number;
  hasDirectLineOfSight: boolean;
  disqualified: boolean;
  disqualifyReason: 'none' | 'too_close_under_15m' | 'direct_los';
  score: number;
}

export const SPAWN_PROTECTION_DURATION_SEC = 1.5;
export const MIN_SAFE_SPAWN_DISTANCE_M = 15.0;
export const OPTIMAL_SPAWN_MIN_M = 25.0;
export const OPTIMAL_SPAWN_MAX_M = 45.0;

/**
 * SpawnSystem — Anti-spawn-trap node evaluator & 1.5s spawn protection tracker.
 *
 * Rules:
 *  - Every map provides 24+ Spawn Nodes.
 *  - Disqualifies any node with direct Line-of-Sight to a living combatant
 *    OR within 15m of any living combatant.
 *  - Weights nodes highest where the nearest living combatant is between 25m and 45m away.
 *  - Grants 1.5s of spawn protection to newly spawned combatants (removed immediately upon firing).
 */
export class SpawnSystem {
  readonly nodes: SpawnNode[] = [];
  private readonly protectionTimers = new Map<string, number>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmpNodeEye = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();

  setNodes(nodes: SpawnNode[]): void {
    this.nodes.length = 0;
    this.nodes.push(...nodes);
  }

  /**
   * Grants 1.5 seconds of spawn protection to `combatantId`.
   */
  grantSpawnProtection(combatantId: string, durationSec = SPAWN_PROTECTION_DURATION_SEC): void {
    this.protectionTimers.set(combatantId, durationSec);
  }

  /**
   * Immediately removes spawn protection when a combatant fires their weapon.
   */
  onCombatantFired(combatantId: string): void {
    this.protectionTimers.delete(combatantId);
  }

  /**
   * Returns true if the combatant currently has active spawn protection.
   */
  isProtected(combatantId: string): boolean {
    return (this.protectionTimers.get(combatantId) ?? 0) > 0;
  }

  getRemainingProtection(combatantId: string): number {
    return Math.max(0, this.protectionTimers.get(combatantId) ?? 0);
  }

  update(dt: number): void {
    for (const [id, rem] of this.protectionTimers) {
      const next = rem - dt;
      if (next <= 0) this.protectionTimers.delete(id);
      else this.protectionTimers.set(id, next);
    }
  }

  clearAllProtection(): void {
    this.protectionTimers.clear();
  }

  /**
   * Scores all spawn nodes against living combatants and obstacle geometry.
   */
  scoreAllNodes(
    livingCombatants: LivingCombatantRef[],
    obstacleMeshes: THREE.Object3D[],
    excludeCombatantId?: string,
  ): SpawnNodeScore[] {
    const activeEnemies = livingCombatants.filter(
      (c) => c.alive && c.id !== excludeCombatantId,
    );

    return this.nodes.map((node) => {
      if (activeEnemies.length === 0) {
        return {
          node,
          nearestDistance: Infinity,
          hasDirectLineOfSight: false,
          disqualified: false,
          disqualifyReason: 'none',
          score: 100,
        };
      }

      let nearestDist = Infinity;
      let hasDirectLos = false;

      this.tmpNodeEye.set(node.position.x, node.position.y + 1.55, node.position.z);

      for (const enemy of activeEnemies) {
        const d = node.position.distanceTo(enemy.position);
        if (d < nearestDist) nearestDist = d;

        // Check direct raycast Line-of-Sight between spawn eye and enemy eye
        this.tmpDir.subVectors(enemy.eyePosition, this.tmpNodeEye);
        const eyeDist = this.tmpDir.length();
        if (eyeDist > 0.1 && eyeDist <= 95) {
          this.tmpDir.multiplyScalar(1 / eyeDist);
          this.raycaster.set(this.tmpNodeEye, this.tmpDir);
          this.raycaster.near = 0.15;
          this.raycaster.far = eyeDist - 0.15;
          const hits = this.raycaster.intersectObjects(obstacleMeshes, false);
          if (hits.length === 0) {
            hasDirectLos = true;
          }
        }
      }

      const tooClose = nearestDist < MIN_SAFE_SPAWN_DISTANCE_M;
      const disqualified = tooClose || hasDirectLos;
      const disqualifyReason: SpawnNodeScore['disqualifyReason'] = tooClose
        ? 'too_close_under_15m'
        : hasDirectLos
          ? 'direct_los'
          : 'none';

      let score = 0;
      if (!disqualified) {
        if (nearestDist >= OPTIMAL_SPAWN_MIN_M && nearestDist <= OPTIMAL_SPAWN_MAX_M) {
          // Highest weight in the 25m - 45m sweet spot (85 .. 100)
          const center = (OPTIMAL_SPAWN_MIN_M + OPTIMAL_SPAWN_MAX_M) * 0.5; // 35m
          const halfSpan = (OPTIMAL_SPAWN_MAX_M - OPTIMAL_SPAWN_MIN_M) * 0.5; // 10m
          const closenessToSweetCenter = 1 - Math.abs(nearestDist - center) / halfSpan;
          score = 85 + 15 * THREE.MathUtils.clamp(closenessToSweetCenter, 0, 1);
        } else if (nearestDist < OPTIMAL_SPAWN_MIN_M) {
          // Between 15m and 25m: ramps from 25 -> 75
          const t = (nearestDist - MIN_SAFE_SPAWN_DISTANCE_M) / (OPTIMAL_SPAWN_MIN_M - MIN_SAFE_SPAWN_DISTANCE_M);
          score = 25 + 50 * THREE.MathUtils.clamp(t, 0, 1);
        } else {
          // Beyond 45m: gentle taper from 75 down to 40 so combat stays brisk
          const over = Math.min(nearestDist - OPTIMAL_SPAWN_MAX_M, 50);
          score = 75 - (over / 50) * 35;
        }
      } else {
        // Fallback negative score ordered by safety if every node is stressed
        score = (hasDirectLos ? -500 : -100) + Math.min(nearestDist, 45);
      }

      return {
        node,
        nearestDistance: nearestDist,
        hasDirectLineOfSight: hasDirectLos,
        disqualified,
        disqualifyReason,
        score,
      };
    });
  }

  /**
   * Selects the best spawn node for a combatant and grants 1.5s spawn protection.
   */
  selectSpawnNode(
    combatantId: string,
    livingCombatants: LivingCombatantRef[],
    obstacleMeshes: THREE.Object3D[],
  ): SpawnNodeScore {
    const scored = this.scoreAllNodes(livingCombatants, obstacleMeshes, combatantId);
    const qualified = scored.filter((s) => !s.disqualified);

    const pool = qualified.length > 0 ? qualified : scored;
    pool.sort((a, b) => b.score - a.score);

    // Pick among the top-scoring band (within 8 points of best) for natural variety
    const topScore = pool[0].score;
    const topCandidates = pool.filter((s) => s.score >= topScore - 8);
    const chosen = topCandidates[Math.floor(Math.random() * topCandidates.length)];

    this.grantSpawnProtection(combatantId, SPAWN_PROTECTION_DURATION_SEC);
    return chosen;
  }
}

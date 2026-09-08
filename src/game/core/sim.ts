import { ALERT_COOLDOWN, ALERT_TICKS, DANGER_SUBDIV, TICK_HZ, TILE_TICKS } from './constants.ts';
import { isWalkable } from './level.ts';
import { distanceField, findPath } from './pathfind.ts';
import { detect, type SensorRef } from './sensors.ts';
import type { CollectibleRuntime, LevelRuntime } from './types.ts';

export type SimStatus = 'running' | 'won' | 'caught';

export interface PickupEvent {
  collectible: CollectibleRuntime;
  tick: number;
}

/**
 * The live simulation.
 *
 * Advances in whole ticks and never reads wall-clock time, so a given sequence of
 * commits always produces the same run. `solver.ts` searches this exact action
 * space, which is what lets the validator guarantee all 30 levels are beatable.
 */
export class Sim {
  readonly lv: LevelRuntime;

  tick = 0;
  status: SimStatus = 'running';

  /** Tile the thief is standing on, or stepping away from while `moving`. */
  tileX: number;
  tileY: number;
  /** Tile being entered while `moving`. */
  toX: number;
  toY: number;
  moving = false;
  progress = 0;

  mask = 0;
  alert = 0;
  everSpotted = false;
  spottedBy: SensorRef | null = null;
  caughtBy: SensorRef | null = null;

  waypointsUsed = 0;
  path: [number, number][] = [];

  /** Drained by the renderer each frame. */
  pickups: PickupEvent[] = [];
  arrivedThisTick = false;

  constructor(lv: LevelRuntime) {
    this.lv = lv;
    this.tileX = lv.start[0];
    this.tileY = lv.start[1];
    this.toX = this.tileX;
    this.toY = this.tileY;
    this.collectHere();
  }

  get seconds(): number {
    return this.tick / TICK_HZ;
  }

  /** Fractional tile-space position, matching what the solver samples. */
  get posX(): number {
    return this.moving ? this.tileX + (this.toX - this.tileX) * (this.progress / TILE_TICKS) : this.tileX;
  }

  get posY(): number {
    return this.moving ? this.tileY + (this.toY - this.tileY) * (this.progress / TILE_TICKS) : this.tileY;
  }

  /**
   * Position detection is evaluated at: the exact position snapped to the
   * DANGER_SUBDIV lattice. Keeping this identical to what the offline solver
   * samples is what makes every validated route actually walkable.
   */
  get sensePosX(): number {
    return Math.round(this.posX * DANGER_SUBDIV) / DANGER_SUBDIV;
  }

  get sensePosY(): number {
    return Math.round(this.posY * DANGER_SUBDIV) / DANGER_SUBDIV;
  }

  /** Where a newly committed path must start from. */
  get anchorX(): number {
    return this.moving ? this.toX : this.tileX;
  }

  get anchorY(): number {
    return this.moving ? this.toY : this.tileY;
  }

  get lootTaken(): number {
    let n = 0;
    for (const l of this.lv.loot) if (this.mask & (1 << l.bit)) n++;
    return n;
  }

  get hasAllLoot(): boolean {
    return (this.mask & this.lv.lootMask) === this.lv.lootMask;
  }

  get waypointsLeft(): number {
    return this.lv.maxWaypoints === 0 ? Infinity : this.lv.maxWaypoints - this.waypointsUsed;
  }

  hasKey(color: number): boolean {
    const key = this.lv.keys.find((k) => k.color === color);
    return !!key && (this.mask & (1 << key.bit)) !== 0;
  }

  isCollected(c: CollectibleRuntime): boolean {
    return (this.mask & (1 << c.bit)) !== 0;
  }

  /** Distances from the thief's anchor tile - drives the freeze-mode reachability glow. */
  reachField(): Uint16Array {
    return distanceField(this.lv, this.anchorX, this.anchorY, this.mask);
  }

  /**
   * The route the thief would take to `(tx,ty)` right now. Excludes the anchor tile.
   *
   * Always goes through `findPath` - the offline validator proves its routes against
   * the very same function, so a preview can never diverge from a validated solution.
   */
  previewPath(tx: number, ty: number): [number, number][] | null {
    if (!isWalkable(this.lv, tx, ty, this.mask)) return null;
    const full = findPath(this.lv, this.anchorX, this.anchorY, tx, ty, this.mask);
    return full ? full.slice(1) : null;
  }

  /** Returns true when the tap was accepted and a waypoint was spent. */
  commit(tx: number, ty: number): boolean {
    if (this.status !== 'running') return false;
    if (this.waypointsLeft <= 0) return false;
    const next = this.previewPath(tx, ty);
    if (!next) return false;
    if (next.length === 0 && !this.moving && this.path.length === 0) return false;
    this.path = next;
    this.waypointsUsed++;
    return true;
  }

  /** One deterministic simulation tick. */
  step(): void {
    if (this.status !== 'running') return;
    this.arrivedThisTick = false;

    if (!this.moving && this.tick % TILE_TICKS === 0 && this.path.length > 0) {
      const [nx, ny] = this.path.shift()!;
      this.toX = nx;
      this.toY = ny;
      this.moving = true;
      this.progress = 0;
    }

    const sensor = detect(this.lv, this.sensePosX, this.sensePosY, this.tick);
    if (sensor) {
      this.spottedBy = sensor;
      this.everSpotted = true;
      this.alert++;
      if (this.alert >= ALERT_TICKS) {
        this.alert = ALERT_TICKS;
        this.caughtBy = sensor;
        this.status = 'caught';
        return;
      }
    } else {
      this.alert = Math.max(0, this.alert - ALERT_COOLDOWN);
      if (this.alert === 0) this.spottedBy = null;
    }

    if (this.moving) {
      this.progress++;
      if (this.progress >= TILE_TICKS) {
        this.tileX = this.toX;
        this.tileY = this.toY;
        this.moving = false;
        this.progress = 0;
        this.arrivedThisTick = true;
        this.collectHere();
        if (
          this.tileX === this.lv.exit[0] &&
          this.tileY === this.lv.exit[1] &&
          this.hasAllLoot
        ) {
          this.status = 'won';
        }
      }
    }

    this.tick++;
  }

  private collectHere(): void {
    for (const c of this.lv.collectibles) {
      if (c.x !== this.tileX || c.y !== this.tileY) continue;
      if (this.mask & (1 << c.bit)) continue;
      this.mask |= 1 << c.bit;
      this.pickups.push({ collectible: c, tick: this.tick });
    }
  }
}

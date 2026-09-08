import type { Sim } from '../core/sim.ts';
import type { LevelRuntime } from '../core/types.ts';

export interface RunResult {
  won: boolean;
  seconds: number;
  stars: number;
  underPar: boolean;
  ghost: boolean;
  par: number;
  reason: string;
  detail: string;
  newBest: boolean;
  firstClear: boolean;
  /** Screen y of what the player should be looking at, so the card can dodge it. */
  focusY: number;
}

/**
 * The slice of GameScene the HUD is allowed to see.
 *
 * Declared here rather than in either scene so the two never import each other.
 */
export interface GameView {
  levelId: number;
  runId: number;
  lv: LevelRuntime;
  sim: Sim;
  frozen: boolean;
  freezeAmount: number;
  introLeft: number;
  result: RunResult | null;
  /** False while the freeze-frame plays, so the card never hides the evidence. */
  resultReady: boolean;
  hasFrozenOnce: boolean;
  restartRun(): void;
  gotoNext(): void;
  gotoSelect(): void;
}

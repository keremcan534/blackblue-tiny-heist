/**
 * Haptics abstraction.
 *
 * Three back ends, tried in order: the Capacitor Haptics plugin when the app is
 * running inside a native shell, the Web Vibration API on Android browsers, and
 * silence everywhere else (iOS Safari has no vibration API). Callers never branch.
 */
import { Save } from './storage.ts';

export type HapticKind = 'tick' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

const PATTERNS: Record<HapticKind, number | number[]> = {
  tick: 8,
  light: 12,
  medium: 24,
  heavy: 40,
  success: [18, 40, 26],
  warning: [26, 50, 26],
  error: [40, 60, 90],
};

interface CapacitorHaptics {
  impact?: (opts: { style: string }) => Promise<void> | void;
  notification?: (opts: { type: string }) => Promise<void> | void;
  vibrate?: (opts: { duration: number }) => Promise<void> | void;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: { Haptics?: CapacitorHaptics };
}

function capacitor(): CapacitorHaptics | null {
  const g = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!g || !g.Plugins || !g.Plugins.Haptics) return null;
  if (typeof g.isNativePlatform === 'function' && !g.isNativePlatform()) return null;
  return g.Plugins.Haptics;
}

const IMPACT: Partial<Record<HapticKind, string>> = {
  tick: 'Light',
  light: 'Light',
  medium: 'Medium',
  heavy: 'Heavy',
};

const NOTIFY: Partial<Record<HapticKind, string>> = {
  success: 'SUCCESS',
  warning: 'WARNING',
  error: 'ERROR',
};

export function haptic(kind: HapticKind): void {
  if (!Save.all().haptics) return;

  const plugin = capacitor();
  if (plugin) {
    try {
      const impact = IMPACT[kind];
      const notify = NOTIFY[kind];
      if (notify && plugin.notification) {
        void plugin.notification({ type: notify });
        return;
      }
      if (impact && plugin.impact) {
        void plugin.impact({ style: impact });
        return;
      }
      if (plugin.vibrate) {
        void plugin.vibrate({ duration: 20 });
        return;
      }
    } catch {
      /* fall through to the web API */
    }
  }

  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate === 'function') {
    try {
      nav.vibrate(PATTERNS[kind]);
    } catch {
      /* some browsers throw when the page is not visible */
    }
  }
}

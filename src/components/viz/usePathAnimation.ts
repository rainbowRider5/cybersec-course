import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export type Pt = readonly [number, number];

function lengthOf(points: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return len;
}

function pointAt(points: readonly Pt[], t: number): Pt {
  if (points.length === 1) return points[0];
  const total = lengthOf(points);
  let target = total * t;
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (target <= seg || i === points.length - 1) {
      const f = seg === 0 ? 1 : Math.min(1, target / seg);
      return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * f, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * f];
    }
    target -= seg;
  }
  return points[points.length - 1];
}

/**
 * Moves a point along a polyline once each time `runKey` changes.
 * With prefers-reduced-motion it jumps straight to the end.
 */
export function usePathAnimation(points: readonly Pt[], runKey: unknown, durationMs = 2000): { pos: Pt; progress: number } {
  const reduced = useReducedMotion();
  const [state, setState] = useState<{ pos: Pt; progress: number }>({ pos: points[points.length - 1] ?? [0, 0], progress: 1 });
  const frame = useRef(0);

  useEffect(() => {
    if (!points.length) return;
    if (reduced) {
      setState({ pos: points[points.length - 1], progress: 1 });
      return;
    }
    const start = performance.now();
    const dur = Math.max(400, durationMs * Math.min(1.6, lengthOf(points) / 500));
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      setState({ pos: pointAt(points, eased), progress: t });
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, reduced]);

  return state;
}

export const toPoints = (pts: readonly Pt[]) => pts.map((p) => p.join(',')).join(' ');

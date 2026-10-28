import type { LinkType } from '../core';

export interface Point { x: number; y: number }

const STUB = 9;

/**
 * The elbow line of a link, from one end of the predecessor's bar to one end of the successor's. `from`/`to` are the
 * bar ends the link joins: start-of-bar sits on the left edge, finish on the right.
 */
export function linkPath(type: LinkType, source: { left: number; right: number; y: number }, target: { left: number; right: number; y: number }): Point[] {
  const fromFinish = type === 'FS' || type === 'FF';
  const toStart = type === 'FS' || type === 'SS';
  const sx = fromFinish ? source.right : source.left;
  const tx = toStart ? target.left : target.right;
  const sy = source.y;
  const ty = target.y;
  const out = fromFinish ? sx + STUB : sx - STUB;
  const into = toStart ? tx - STUB : tx + STUB;
  const mid = sy + (ty >= sy ? 1 : -1) * ((Math.abs(ty - sy) || 1) / 2);

  if (type === 'FS') {
    if (into >= out) return [{ x: sx, y: sy }, { x: out, y: sy }, { x: out, y: ty }, { x: tx, y: ty }];
    return [{ x: sx, y: sy }, { x: out, y: sy }, { x: out, y: mid }, { x: into, y: mid }, { x: into, y: ty }, { x: tx, y: ty }];
  }
  if (type === 'SS') {
    const vx = Math.min(out, into);
    return [{ x: sx, y: sy }, { x: vx, y: sy }, { x: vx, y: ty }, { x: tx, y: ty }];
  }
  if (type === 'FF') {
    const vx = Math.max(out, into);
    return [{ x: sx, y: sy }, { x: vx, y: sy }, { x: vx, y: ty }, { x: tx, y: ty }];
  }
  // SF
  if (into <= out) return [{ x: sx, y: sy }, { x: out, y: sy }, { x: out, y: ty }, { x: tx, y: ty }];
  return [{ x: sx, y: sy }, { x: out, y: sy }, { x: out, y: mid }, { x: into, y: mid }, { x: into, y: ty }, { x: tx, y: ty }];
}

export function pathData(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
}

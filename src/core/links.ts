import type { GanttLink, LinkType } from './types';
import { LINK_TYPES } from './types';

/** Would adding predecessor -> successor close a loop (including a task linked to itself)? */
export function wouldCreateCycle(links: readonly GanttLink[], predecessorId: string, successorId: string): boolean {
  if (predecessorId === successorId) return true;
  const next = new Map<string, string[]>();
  for (const l of links) {
    const list = next.get(l.predecessorId) ?? [];
    list.push(l.successorId);
    next.set(l.predecessorId, list);
  }
  const seen = new Set<string>();
  const stack = [successorId];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (cur === predecessorId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of next.get(cur) ?? []) stack.push(n);
  }
  return false;
}

/** Task ids in an order where every predecessor comes before its successors; `cyclic` holds those caught in a loop. */
export function topoOrder(ids: readonly string[], links: readonly GanttLink[]): { order: string[]; cyclic: string[] } {
  const idSet = new Set(ids);
  const indeg = new Map<string, number>(ids.map((i) => [i, 0]));
  const next = new Map<string, string[]>();
  for (const l of links) {
    if (!idSet.has(l.predecessorId) || !idSet.has(l.successorId)) continue;
    indeg.set(l.successorId, (indeg.get(l.successorId) ?? 0) + 1);
    const list = next.get(l.predecessorId) ?? [];
    list.push(l.successorId);
    next.set(l.predecessorId, list);
  }
  const queue = ids.filter((i) => indeg.get(i) === 0);
  const order: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i] as string;
    order.push(cur);
    for (const n of next.get(cur) ?? []) {
      const d = (indeg.get(n) ?? 0) - 1;
      indeg.set(n, d);
      if (d === 0) queue.push(n);
    }
  }
  const done = new Set(order);
  return { order, cyclic: ids.filter((i) => !done.has(i)) };
}

const TOKEN_RE = /^(\d+(?:\.\d+)*)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+)\s*d?)?$/i;

export interface ParsedPredecessor { predecessorId: string; type: LinkType; lagDays: number }

/**
 * Reads a predecessor cell the way a project planner types it: "3", "3FS", "3SS+2d", "2.1FF-1", several separated by
 * commas or semicolons. Numbers are outline (WBS) numbers; `idOfWbs` turns them into task ids.
 */
export function parsePredecessors(text: string, idOfWbs: ReadonlyMap<string, string>): { links: ParsedPredecessor[]; errors: string[] } {
  const links: ParsedPredecessor[] = [];
  const errors: string[] = [];
  for (const raw of text.split(/[,;]/)) {
    const token = raw.trim();
    if (!token) continue;
    const m = TOKEN_RE.exec(token);
    if (!m) { errors.push(`"${token}" is not a link (try 3, 3FS, 3SS+2d)`); continue; }
    const id = idOfWbs.get(m[1] as string);
    if (!id) { errors.push(`There is no row ${m[1]}`); continue; }
    const type = ((m[2] ?? 'FS').toUpperCase()) as LinkType;
    if (!LINK_TYPES.includes(type)) { errors.push(`"${token}" has an unknown link type`); continue; }
    const lag = m[4] ? Number(m[4]) * (m[3] === '-' ? -1 : 1) : 0;
    links.push({ predecessorId: id, type, lagDays: lag });
  }
  return { links, errors };
}

/** The reverse of parsePredecessors for one link, e.g. "3SS+2d" ("3" for a plain finish-to-start) */
export function formatPredecessor(wbs: string, type: LinkType, lagDays: number): string {
  const lag = lagDays === 0 ? '' : `${lagDays > 0 ? '+' : '-'}${Math.abs(lagDays)}d`;
  return `${wbs}${type === 'FS' && lag === '' ? '' : type}${lag}`;
}

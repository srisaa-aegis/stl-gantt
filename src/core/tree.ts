import type { WorkCalendar } from './calendar';
import { dayNum, isoOf } from './dates';
import type { GanttTask, IsoDate } from './types';

export interface TreeRow {
  task: GanttTask;
  depth: number;
  /** "1", "1.2", "1.2.3": the outline number */
  wbs: string;
  hasChildren: boolean;
}

export interface Tree {
  /** Every task, in outline order */
  rows: TreeRow[];
  children: Map<string, GanttTask[]>;
  wbsOf: Map<string, string>;
  idOfWbs: Map<string, string>;
}

const byOrder = (a: GanttTask, b: GanttTask): number => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** A task whose parent is missing (or that sits in a parent loop) is treated as top level, so bad data never hides a row. */
export function buildTree(tasks: readonly GanttTask[]): Tree {
  const ids = new Set(tasks.map((t) => t.id));
  const children = new Map<string, GanttTask[]>();
  const roots: GanttTask[] = [];
  for (const t of tasks) {
    if (t.parentId && t.parentId !== t.id && ids.has(t.parentId)) {
      const list = children.get(t.parentId) ?? [];
      list.push(t);
      children.set(t.parentId, list);
    } else roots.push(t);
  }
  for (const list of children.values()) list.sort(byOrder);
  roots.sort(byOrder);

  const rows: TreeRow[] = [];
  const wbsOf = new Map<string, string>();
  const idOfWbs = new Map<string, string>();
  const seen = new Set<string>();
  const walk = (list: GanttTask[], depth: number, prefix: string): void => {
    list.forEach((t, i) => {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      const wbs = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      wbsOf.set(t.id, wbs);
      idOfWbs.set(wbs, t.id);
      const kids = children.get(t.id) ?? [];
      rows.push({ task: t, depth, wbs, hasChildren: kids.length > 0 });
      walk(kids, depth + 1, wbs);
    });
  };
  walk(roots, 0, '');
  // Parent loops leave tasks unreached: show them at the end rather than lose them
  for (const t of tasks) if (!seen.has(t.id)) { seen.add(t.id); rows.push({ task: t, depth: 0, wbs: String(rows.length + 1), hasChildren: false }); }
  return { rows, children, wbsOf, idOfWbs };
}

/** Rows to draw: everything except the descendants of a collapsed row */
export function visibleRows(tree: Tree, collapsed: ReadonlySet<string>): TreeRow[] {
  const out: TreeRow[] = [];
  let hideBelow = Number.POSITIVE_INFINITY;
  for (const r of tree.rows) {
    if (r.depth > hideBelow) continue;
    hideBelow = Number.POSITIVE_INFINITY;
    out.push(r);
    if (r.hasChildren && collapsed.has(r.task.id)) hideBelow = r.depth;
  }
  return out;
}

export function isSummary(tree: Tree, id: string): boolean {
  return (tree.children.get(id)?.length ?? 0) > 0;
}

/** Ids of a task and everything below it */
export function descendantsOf(tree: Tree, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const c of tree.children.get(cur) ?? []) if (!out.has(c.id)) { out.add(c.id); stack.push(c.id); }
  }
  return out;
}

export interface Rolled { start: IsoDate | null; end: IsoDate | null; percentComplete: number }

/**
 * A group's dates and progress come from the tasks inside it: earliest start, latest end, and progress weighted by each
 * task's working days. Leaf tasks keep their own values.
 */
export function rollUp(tasks: readonly GanttTask[], cal: WorkCalendar, tree: Tree = buildTree(tasks)): Map<string, Rolled> {
  const out = new Map<string, Rolled>();
  const visit = (t: GanttTask): Rolled => {
    const done = out.get(t.id);
    if (done) return done;
    const kids = tree.children.get(t.id) ?? [];
    let r: Rolled;
    if (kids.length === 0) r = { start: t.start, end: t.end, percentComplete: t.percentComplete };
    else {
      let min: number | null = null;
      let max: number | null = null;
      let weight = 0;
      let weighted = 0;
      for (const k of kids) {
        const kr = visit(k);
        if (!kr.start || !kr.end) continue;
        const s = dayNum(kr.start);
        const e = dayNum(kr.end);
        if (min === null || s < min) min = s;
        if (max === null || e > max) max = e;
        const w = cal.duration(kr.start, kr.end);
        weight += w;
        weighted += w * kr.percentComplete;
      }
      r = { start: min === null ? null : isoOf(min), end: max === null ? null : isoOf(max), percentComplete: weight ? Math.round(weighted / weight) : 0 };
    }
    out.set(t.id, r);
    return r;
  };
  for (const t of tasks) visit(t);
  return out;
}

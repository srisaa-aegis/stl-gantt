import type { WorkCalendar } from './calendar';
import { dayNum } from './dates';
import { topoOrder } from './links';
import { buildTree, isSummary, type Tree } from './tree';
import type { GanttLink, GanttTask } from './types';

export interface PathInfo {
  /** Working days the task can slip without moving the project's finish; 0 = critical */
  slack: number;
  critical: boolean;
}

/**
 * Total slack and the critical path. Early dates are the dates as planned; late dates are worked backwards from the
 * project's last finish through the links. A task is critical when its slack is 0. A group is critical when any task in
 * it is. Tasks with no dates, and links to or from groups, are left out.
 */
export function criticalPath(tasks: readonly GanttTask[], links: readonly GanttLink[], cal: WorkCalendar, tree: Tree = buildTree(tasks)): Map<string, PathInfo> {
  const leaf = new Map<string, { startOrd: number; endOrd: number; dur: number }>();
  for (const t of tasks) {
    if (!t.start || !t.end || isSummary(tree, t.id)) continue;
    const startOrd = cal.ord(cal.snapForward(dayNum(t.start)));
    const endOrd = cal.ord(cal.snapBack(dayNum(t.end)));
    leaf.set(t.id, { startOrd, endOrd, dur: Math.max(1, endOrd - startOrd + 1) });
  }
  const used = links.filter((l) => leaf.has(l.predecessorId) && leaf.has(l.successorId));
  const out = new Map<string, PathInfo>();
  if (leaf.size === 0) return out;

  let projectEnd = Number.NEGATIVE_INFINITY;
  for (const v of leaf.values()) projectEnd = Math.max(projectEnd, v.endOrd);

  const outgoing = new Map<string, GanttLink[]>();
  for (const l of used) {
    const list = outgoing.get(l.predecessorId) ?? [];
    list.push(l);
    outgoing.set(l.predecessorId, list);
  }

  const { order, cyclic } = topoOrder([...leaf.keys()], used);
  const lateEnd = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const me = leaf.get(id) as { dur: number };
    let lf = projectEnd;
    for (const l of outgoing.get(id) ?? []) {
      const s = leaf.get(l.successorId) as { dur: number };
      const sLf = lateEnd.get(l.successorId);
      if (sLf === undefined) continue; // the successor is in a loop
      const sLs = sLf - s.dur + 1;
      let bound: number;
      switch (l.type) {
        case 'FS': bound = sLs - 1 - l.lagDays; break;
        case 'SS': bound = sLs - l.lagDays + me.dur - 1; break;
        case 'FF': bound = sLf - l.lagDays; break;
        default: bound = sLf - l.lagDays + me.dur - 1; // SF
      }
      if (bound < lf) lf = bound;
    }
    lateEnd.set(id, lf);
  }

  for (const id of order) {
    const v = leaf.get(id) as { endOrd: number };
    const slack = Math.max(0, (lateEnd.get(id) as number) - v.endOrd);
    out.set(id, { slack, critical: slack === 0 });
  }
  for (const id of cyclic) out.set(id, { slack: 0, critical: false });

  // A group is critical when anything inside it is
  for (const t of tasks) {
    if (!isSummary(tree, t.id)) continue;
    let crit = false;
    const stack = [...(tree.children.get(t.id) ?? [])];
    while (stack.length) {
      const c = stack.pop() as GanttTask;
      if (out.get(c.id)?.critical) { crit = true; break; }
      for (const k of tree.children.get(c.id) ?? []) stack.push(k);
    }
    out.set(t.id, { slack: crit ? 0 : 1, critical: crit });
  }
  return out;
}

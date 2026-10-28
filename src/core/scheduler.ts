import type { WorkCalendar } from './calendar';
import { dayNum, isoOf } from './dates';
import { topoOrder } from './links';
import { buildTree, isSummary, type Tree } from './tree';
import type { DateRange, GanttLink, GanttTask } from './types';

export interface ScheduleResult {
  /** Tasks whose dates had to move so that no link is broken (only ever later, never earlier) */
  changes: Map<string, DateRange>;
  /** Tasks caught in a link loop: left as they are */
  cyclic: string[];
  /** Links that were not used: an end is a group, missing, or not scheduled yet */
  ignored: string[];
}

interface Placed { startOrd: number; duration: number }

/**
 * Pushes tasks later where a link would otherwise be broken. A task is only ever moved later, and keeps its length in
 * working days, so dates set by hand are respected. Groups are never moved: they follow the tasks inside them. Links
 * to or from a group are ignored.
 */
export function schedule(tasks: readonly GanttTask[], links: readonly GanttLink[], cal: WorkCalendar, tree: Tree = buildTree(tasks)): ScheduleResult {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const usable = (id: string): GanttTask | null => {
    const t = byId.get(id);
    return t && t.start && t.end && !isSummary(tree, id) ? t : null;
  };

  const ignored: string[] = [];
  const used: GanttLink[] = [];
  for (const l of links) {
    if (usable(l.predecessorId) && usable(l.successorId)) used.push(l); else ignored.push(l.id);
  }

  const placed = new Map<string, Placed>();
  for (const t of tasks) {
    if (!usable(t.id)) continue;
    const start = cal.ord(cal.snapForward(dayNum(t.start as string)));
    placed.set(t.id, { startOrd: start, duration: cal.duration(t.start as string, t.end as string) });
  }

  const incoming = new Map<string, GanttLink[]>();
  for (const l of used) {
    const list = incoming.get(l.successorId) ?? [];
    list.push(l);
    incoming.set(l.successorId, list);
  }

  const { order, cyclic } = topoOrder([...placed.keys()], used);
  const changes = new Map<string, DateRange>();
  for (const id of order) {
    const me = placed.get(id) as Placed;
    let startOrd = me.startOrd;
    for (const l of incoming.get(id) ?? []) {
      const p = placed.get(l.predecessorId) as Placed;
      const pEnd = p.startOrd + p.duration - 1;
      let need: number;
      switch (l.type) {
        case 'FS': need = pEnd + 1 + l.lagDays; break;
        case 'SS': need = p.startOrd + l.lagDays; break;
        case 'FF': need = pEnd + l.lagDays - me.duration + 1; break;
        default: need = p.startOrd + l.lagDays - me.duration + 1; // SF: the end may not come before the predecessor starts
      }
      if (need > startOrd) startOrd = need;
    }
    if (startOrd !== me.startOrd) {
      me.startOrd = startOrd;
      changes.set(id, { start: isoOf(cal.dayAt(startOrd)), end: isoOf(cal.dayAt(startOrd + me.duration - 1)) });
    }
  }
  return { changes, cyclic, ignored };
}

/** Apply `change` to one task, then reschedule: returns every task whose dates differ afterwards (the edited one included). */
export function applyChange(
  tasks: readonly GanttTask[], links: readonly GanttLink[], cal: WorkCalendar, id: string, change: DateRange,
): Map<string, DateRange> {
  const edited = tasks.map((t) => (t.id === id ? { ...t, start: change.start, end: change.end } : t));
  const result = schedule(edited, links, cal);
  const out = new Map<string, DateRange>([[id, change], ...result.changes]);
  return out;
}

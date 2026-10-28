/** Dates are ISO calendar days ("2026-11-05"); a task's end is the last day it works (inclusive). */
export type IsoDate = string;

export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';

export interface GanttTask {
  id: string;
  parentId: string | null;
  name: string;
  /** null start or end = not scheduled yet: drawn as an empty row, ignored by the scheduler */
  start: IsoDate | null;
  end: IsoDate | null;
  /** 0 to 100 */
  percentComplete: number;
  sortOrder: number;
  /** A date marked with a diamond on this row (a milestone's planned date, a contractual deadline) */
  deadline?: IsoDate | null;
  /** Anything the host application wants handed back in callbacks */
  meta?: unknown;
}

export interface GanttLink {
  id: string;
  predecessorId: string;
  successorId: string;
  type: LinkType;
  /** Working days between the two ends of the link; negative = lead (overlap) */
  lagDays: number;
}

export interface DateRange { start: IsoDate; end: IsoDate }

export const LINK_TYPES: readonly LinkType[] = ['FS', 'SS', 'FF', 'SF'];

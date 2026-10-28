import type { CalendarSpec, GanttLink, GanttTask, IsoDate, LinkType } from '../core';

export type Zoom = 'day' | 'week' | 'month' | 'quarter';

/** What the person changed about one task. Only the fields that changed are set. */
export interface TaskPatch {
  id: string;
  name?: string;
  start?: IsoDate | null;
  end?: IsoDate | null;
  percentComplete?: number;
  parentId?: string | null;
  sortOrder?: number;
}

export interface NewLink { predecessorId: string; successorId: string; type: LinkType; lagDays: number }

type Maybe = void | Promise<unknown>;

/**
 * The chart never saves anything itself. It applies each edit on screen straight away, then tells the host through
 * these callbacks. If a callback throws or rejects, the chart puts the screen back as it was and calls `onError`.
 */
export interface GanttCallbacks {
  onChange?: (patches: TaskPatch[]) => Maybe;
  onLinkCreate?: (link: NewLink) => Maybe;
  onLinkUpdate?: (id: string, patch: { type?: LinkType; lagDays?: number }) => Maybe;
  onLinkDelete?: (id: string) => Maybe;
  /** The Add button: `parentId` is the selected row (new task goes inside it) or null */
  onAddTask?: (parentId: string | null) => void;
  /** The Delete button, for the selected row */
  onDeleteTask?: (id: string) => void;
  /** Double click on a name or a bar */
  onOpenTask?: (id: string) => void;
  onError?: (error: unknown) => void;
}

export interface GanttOptions {
  tasks: readonly GanttTask[];
  links?: readonly GanttLink[];
  calendar?: CalendarSpec;
  zoom?: Zoom;
  /** Colour the critical path and show slack */
  criticalPath?: boolean;
  /** No dragging, no editing, no toolbar buttons that change anything */
  readOnly?: boolean;
  rowHeight?: number;
  /** Treat this day as "today" (defaults to the real one) */
  today?: IsoDate;
  callbacks?: GanttCallbacks;
}

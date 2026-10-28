import {
  WorkCalendar, buildTree, criticalPath, dayNum, formatPredecessor, isoOf, isSummary, parsePredecessors, rollUp, schedule,
  todayIso, visibleRows, wouldCreateCycle, LINK_TYPES,
  type GanttLink, type GanttTask, type IsoDate, type LinkType, type PathInfo, type Rolled, type Tree, type TreeRow,
} from '../core';
import { linkPath, pathData, type Point } from './geometry';
import type { GanttCallbacks, GanttOptions, TaskPatch, Zoom } from './options';
import { DAY_WIDTH, scaleSegments } from './scale';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ZOOMS: readonly Zoom[] = ['day', 'week', 'month', 'quarter'];
const ZOOM_LABEL: Record<Zoom, string> = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter' };
const COLUMNS = [
  { key: 'wbs', label: '#', width: 46 },
  { key: 'name', label: 'Task', width: 230 },
  { key: 'start', label: 'Start', width: 112 },
  { key: 'end', label: 'Finish', width: 112 },
  { key: 'dur', label: 'Days', width: 54 },
  { key: 'pct', label: '%', width: 54 },
  { key: 'pred', label: 'Predecessors', width: 110 },
] as const;
const LEFT_WIDTH = COLUMNS.reduce((n, c) => n + c.width, 0);
const HEADER_H = 52;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

interface Snapshot { tasks: GanttTask[]; links: GanttLink[] }

interface Drag {
  kind: 'move' | 'left' | 'right' | 'progress' | 'link';
  id: string;
  startX: number;
  origStart: number;
  origEnd: number;
  dur: number;
  bar: HTMLElement;
  side?: 'start' | 'finish';
  from?: Point;
  preview?: { start: number; end: number; pct?: number };
  moved: boolean;
}

/**
 * A Gantt chart in plain DOM: a task grid on the left, a timeline on the right. Dependency-free. See README.md.
 */
export class GanttChart {
  private tasks: GanttTask[];
  private links: GanttLink[];
  private cal: WorkCalendar;
  private calendarSpec: NonNullable<GanttOptions['calendar']>;
  private zoom: Zoom;
  private showCritical: boolean;
  private readonly readOnly: boolean;
  private readonly rowH: number;
  private today: IsoDate;
  private readonly cb: GanttCallbacks;

  private tree!: Tree;
  private rows: TreeRow[] = [];
  private rolled = new Map<string, Rolled>();
  private path = new Map<string, PathInfo>();
  private collapsed = new Set<string>();
  private selected: string | null = null;
  private origin = 0;
  private last = 0;
  private dw: number;
  private leftWidth = LEFT_WIDTH;
  private busy = false;

  private root!: HTMLElement;
  private toolbar!: HTMLElement;
  private headLeft!: HTMLElement;
  private headScale!: HTMLElement;
  private left!: HTMLElement;
  private right!: HTMLElement;
  private plot!: HTMLElement;
  private overlay!: SVGSVGElement;
  private popover: HTMLElement | null = null;
  private drag: Drag | null = null;
  private readonly off: Array<() => void> = [];
  private toolbarButtons = new Map<string, HTMLButtonElement>();

  constructor(private readonly host: HTMLElement, options: GanttOptions) {
    this.tasks = options.tasks.map((t) => ({ ...t }));
    this.links = (options.links ?? []).map((l) => ({ ...l }));
    this.calendarSpec = options.calendar ?? {};
    this.cal = new WorkCalendar(this.calendarSpec);
    this.zoom = options.zoom ?? 'week';
    this.dw = DAY_WIDTH[this.zoom];
    this.showCritical = options.criticalPath ?? false;
    this.readOnly = options.readOnly ?? false;
    this.rowH = options.rowHeight ?? 34;
    this.today = options.today ?? todayIso();
    this.cb = options.callbacks ?? {};
    this.build();
    this.render();
    this.scrollToStart();
  }

  /* ------------------------------------------------------------------ public */

  /** Replace what is shown (after the host saved, or reloaded). Selection, zoom, scroll and collapsed rows are kept. */
  setData(data: { tasks: readonly GanttTask[]; links?: readonly GanttLink[]; calendar?: GanttOptions['calendar'] }): void {
    this.tasks = data.tasks.map((t) => ({ ...t }));
    this.links = (data.links ?? []).map((l) => ({ ...l }));
    if (data.calendar) { this.calendarSpec = data.calendar; this.cal = new WorkCalendar(data.calendar); }
    if (this.selected && !this.tasks.some((t) => t.id === this.selected)) this.selected = null;
    this.render();
  }

  setZoom(zoom: Zoom): void {
    const centre = this.centreDay();
    this.zoom = zoom;
    this.dw = DAY_WIDTH[zoom];
    this.render();
    this.scrollToDay(centre, true);
  }

  setCriticalPath(on: boolean): void { this.showCritical = on; this.render(); }

  select(id: string | null): void { this.selected = id; this.paintSelection(); this.updateToolbar(); }

  getSelected(): string | null { return this.selected; }

  scrollToToday(): void { this.scrollToDay(dayNum(this.today), true); }

  /** The zoom level at which the whole plan fits the width, scrolled to its start */
  fitToProject(): void {
    const dated = this.tasks.filter((t) => t.start && t.end);
    if (dated.length === 0) { this.scrollToToday(); return; }
    const first = Math.min(...dated.map((t) => dayNum(t.start as string)));
    const lastDay = Math.max(...dated.map((t) => dayNum(t.end as string)));
    const span = lastDay - first + 8;
    const width = Math.max(200, this.right.clientWidth - 24);
    const fit = [...ZOOMS].reverse().find((z) => DAY_WIDTH[z] * span <= width) ?? 'quarter';
    this.zoom = fit === 'quarter' && DAY_WIDTH.month * span <= width ? 'month' : fit;
    this.dw = DAY_WIDTH[this.zoom];
    this.render();
    this.right.scrollLeft = Math.max(0, this.x(first) - 24);
  }

  destroy(): void {
    for (const f of this.off) f();
    this.off.length = 0;
    this.root.remove();
  }

  /* ------------------------------------------------------------------ build */

  private build(): void {
    this.root = el('div', 'stl-g');
    this.root.tabIndex = 0;
    this.toolbar = el('div', 'stl-g-toolbar');
    const head = el('div', 'stl-g-head');
    this.headLeft = el('div', 'stl-g-head-left');
    const splitter = el('div', 'stl-g-splitter');
    this.headScale = el('div', 'stl-g-head-scale');
    head.append(this.headLeft, splitter, this.headScale);
    const main = el('div', 'stl-g-main');
    this.left = el('div', 'stl-g-left');
    const splitterBody = el('div', 'stl-g-splitter');
    this.right = el('div', 'stl-g-right');
    this.plot = el('div', 'stl-g-plot');
    this.overlay = svg('svg', { class: 'stl-g-links' });
    this.right.append(this.plot);
    main.append(this.left, splitterBody, this.right);
    this.root.append(this.toolbar, head, main);
    this.host.append(this.root);
    this.buildToolbar();

    const on = <T extends EventTarget>(t: T, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions): void => {
      t.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(this.right, 'scroll', () => {
      this.left.scrollTop = this.right.scrollTop;
      this.headScale.scrollLeft = this.right.scrollLeft;
    });
    on(this.left, 'wheel', (e: WheelEvent) => { this.right.scrollTop += e.deltaY; e.preventDefault(); }, { passive: false });
    on(this.plot, 'pointerdown', (e: PointerEvent) => this.onPlotPointerDown(e));
    on(this.plot, 'dblclick', (e: MouseEvent) => {
      const bar = (e.target as HTMLElement).closest<HTMLElement>('.stl-g-bar');
      if (bar?.dataset.id) this.cb.onOpenTask?.(bar.dataset.id);
    });
    on(document, 'pointermove', (e: PointerEvent) => this.onPointerMove(e));
    on(document, 'pointerup', (e: PointerEvent) => { void this.onPointerUp(e); });
    on(document, 'pointerdown', (e: PointerEvent) => {
      if (this.popover && !this.popover.contains(e.target as Node) && !(e.target as Element).closest?.('.stl-g-link-hit')) this.closePopover();
    });
    on(this.root, 'keydown', (e: KeyboardEvent) => this.onKey(e));
    for (const s of [splitter, splitterBody]) on(s, 'pointerdown', (e: PointerEvent) => this.startSplit(e));
  }

  private buildToolbar(): void {
    this.toolbar.replaceChildren();
    this.toolbarButtons.clear();
    const btn = (key: string, label: string, title: string, fn: () => void, cls = ''): HTMLButtonElement => {
      const b = el('button', `stl-g-btn ${cls}`.trim(), label);
      b.type = 'button';
      b.title = title;
      b.addEventListener('click', fn);
      this.toolbarButtons.set(key, b);
      return b;
    };
    const group = (...items: HTMLElement[]): HTMLElement => { const g = el('div', 'stl-g-group'); g.append(...items); return g; };

    const edit: HTMLElement[] = [];
    if (!this.readOnly) {
      if (this.cb.onAddTask) edit.push(btn('add', '+ Task', 'Add a task (inside the selected row)', () => this.cb.onAddTask?.(this.selected)));
      edit.push(
        btn('outdent', '←', 'Outdent: move out of its group (Shift+Tab)', () => { void this.outdent(); }),
        btn('indent', '→', 'Indent: put inside the row above (Tab)', () => { void this.indent(); }),
        btn('up', '↑', 'Move up (Alt+Up)', () => { void this.moveRow(-1); }),
        btn('down', '↓', 'Move down (Alt+Down)', () => { void this.moveRow(1); }),
      );
      if (this.cb.onDeleteTask) edit.push(btn('delete', 'Delete', 'Delete the selected task', () => { if (this.selected) this.cb.onDeleteTask?.(this.selected); }, 'stl-g-danger'));
    }
    if (edit.length) this.toolbar.append(group(...edit));

    const zoomBtns = ZOOMS.map((z) => btn(`zoom-${z}`, ZOOM_LABEL[z], `Show by ${ZOOM_LABEL[z].toLowerCase()}`, () => this.setZoom(z)));
    this.toolbar.append(group(...zoomBtns));
    this.toolbar.append(group(
      btn('today', 'Today', 'Scroll to today', () => this.scrollToToday()),
      btn('fit', 'Fit', 'Fit the whole plan', () => this.fitToProject()),
      btn('expand', 'Expand', 'Expand all groups', () => { this.collapsed.clear(); this.render(); }),
      btn('collapse', 'Collapse', 'Collapse all groups', () => {
        this.collapsed = new Set(this.tree.rows.filter((r) => r.hasChildren).map((r) => r.task.id));
        this.render();
      }),
    ));
    const crit = el('label', 'stl-g-check');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = this.showCritical;
    box.addEventListener('change', () => this.setCriticalPath(box.checked));
    crit.append(box, document.createTextNode(' Critical path'));
    this.toolbar.append(crit);
  }

  private updateToolbar(): void {
    for (const z of ZOOMS) this.toolbarButtons.get(`zoom-${z}`)?.classList.toggle('stl-g-on', z === this.zoom);
    const has = this.selected !== null && !this.readOnly;
    const set = (k: string, on: boolean): void => { const b = this.toolbarButtons.get(k); if (b) b.disabled = !on; };
    set('indent', has && this.canIndent());
    set('outdent', has && this.canOutdent());
    set('up', has);
    set('down', has);
    set('delete', has);
  }

  /* ------------------------------------------------------------------ geometry */

  private x(day: number): number { return (day - this.origin) * this.dw; }

  private dayAtX(px: number): number { return this.origin + Math.round(px / this.dw); }

  private centreDay(): number { return this.origin + Math.round((this.right.scrollLeft + this.right.clientWidth / 2) / this.dw); }

  private scrollToDay(day: number, centre: boolean): void {
    const px = this.x(day) - (centre ? this.right.clientWidth / 2 : 40);
    this.right.scrollLeft = Math.max(0, px);
    this.headScale.scrollLeft = this.right.scrollLeft;
  }

  /** Scroll to the plan: around today if today falls inside it, else to its first task */
  scrollToStart(): void {
    const dated = this.tasks.filter((t) => t.start);
    const today = dayNum(this.today);
    if (dated.length === 0) { this.scrollToDay(today, true); return; }
    const first = Math.min(...dated.map((t) => dayNum(t.start as string)));
    const lastDay = Math.max(...dated.map((t) => dayNum((t.end ?? t.start) as string)));
    this.scrollToDay(today >= first && today <= lastDay ? today - 14 : first - 3, false);
  }

  private computeRange(): void {
    const days: number[] = [dayNum(this.today)];
    for (const t of this.tasks) {
      if (t.start) days.push(dayNum(t.start));
      if (t.end) days.push(dayNum(t.end));
      if (t.deadline) days.push(dayNum(t.deadline));
    }
    let from = Math.min(...days) - 14;
    let to = Math.max(...days) + 45;
    if (to - from < 90) to = from + 90;
    from -= (((from + 4) % 7) + 6) % 7; // back to a Monday
    this.origin = from;
    this.last = to;
  }

  /* ------------------------------------------------------------------ render */

  private render(): void {
    this.closePopover();
    this.tree = buildTree(this.tasks);
    this.rows = visibleRows(this.tree, this.collapsed);
    this.rolled = rollUp(this.tasks, this.cal, this.tree);
    this.path = this.showCritical ? criticalPath(this.tasks, this.links, this.cal, this.tree) : new Map();
    this.computeRange();
    this.renderHead();
    this.renderLeft();
    this.renderPlot();
    this.updateToolbar();
    this.paintSelection();
  }

  private renderHead(): void {
    // grid header
    this.headLeft.replaceChildren();
    this.headLeft.style.width = `${this.leftWidth}px`;
    let x = 0;
    const scale = this.leftWidth / LEFT_WIDTH;
    for (const c of COLUMNS) {
      const cell = el('div', 'stl-g-hcell', c.label);
      cell.style.width = `${c.width * scale}px`;
      cell.style.left = `${x}px`;
      x += c.width * scale;
      this.headLeft.append(cell);
    }
    // timeline header
    const width = (this.last - this.origin + 1) * this.dw;
    const { top, bottom } = scaleSegments(this.zoom, this.origin, this.last);
    this.headScale.replaceChildren();
    const inner = el('div', 'stl-g-scale');
    inner.style.width = `${width}px`;
    const row = (segs: typeof top, cls: string, y: number): void => {
      for (const s of segs) {
        const c = el('div', cls, s.label);
        c.style.left = `${this.x(s.from)}px`;
        c.style.width = `${(s.to - s.from + 1) * this.dw}px`;
        c.style.top = `${y}px`;
        if (this.zoom === 'day' && cls.includes('bottom')) {
          if (!this.cal.isWorking(s.from)) c.classList.add('stl-g-off-head');
          if (s.from === dayNum(this.today)) c.classList.add('stl-g-today-head');
        }
        inner.append(c);
      }
    };
    row(top, 'stl-g-seg stl-g-top', 0);
    row(bottom, 'stl-g-seg stl-g-bottom', HEADER_H / 2);
    this.headScale.append(inner);
    this.headScale.scrollLeft = this.right.scrollLeft;
  }

  private renderLeft(): void {
    this.left.replaceChildren();
    this.left.style.width = `${this.leftWidth}px`;
    const scale = this.leftWidth / LEFT_WIDTH;
    for (const r of this.rows) {
      const t = r.task;
      const summary = r.hasChildren;
      const rolled = this.rolled.get(t.id);
      const row = el('div', 'stl-g-lrow');
      row.dataset.id = t.id;
      row.style.height = `${this.rowH}px`;
      if (summary) row.classList.add('stl-g-summary-row');
      row.addEventListener('pointerdown', () => { this.select(t.id); });

      const cells: Record<string, HTMLElement> = {};
      for (const c of COLUMNS) {
        const cell = el('div', `stl-g-cell stl-g-c-${c.key}`);
        cell.style.width = `${c.width * scale}px`;
        cells[c.key] = cell;
        row.append(cell);
      }
      (cells.wbs as HTMLElement).textContent = r.wbs;

      const nameCell = cells.name as HTMLElement;
      nameCell.style.paddingLeft = `${6 + r.depth * 16}px`;
      if (summary) {
        const tw = el('button', 'stl-g-twisty', this.collapsed.has(t.id) ? '▸' : '▾');
        tw.type = 'button';
        tw.title = this.collapsed.has(t.id) ? 'Expand' : 'Collapse';
        tw.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.collapsed.has(t.id)) this.collapsed.delete(t.id); else this.collapsed.add(t.id);
          this.render();
        });
        nameCell.append(tw);
      } else nameCell.append(el('span', 'stl-g-twisty-gap'));
      const name = this.input(t.name, !this.readOnly, 'text');
      name.addEventListener('change', () => { void this.commit([{ id: t.id, name: name.value.trim() || t.name }]); });
      name.addEventListener('dblclick', () => this.cb.onOpenTask?.(t.id));
      nameCell.append(name);

      const start = rolled?.start ?? t.start;
      const end = rolled?.end ?? t.end;
      const editable = !this.readOnly && !summary;
      const startIn = this.input(start ?? '', editable, 'date');
      const endIn = this.input(end ?? '', editable, 'date');
      const durIn = this.input(start && end ? String(this.cal.duration(start, end)) : '', editable, 'number');
      const pctIn = this.input(String(Math.round(rolled?.percentComplete ?? t.percentComplete)), editable, 'number');
      durIn.min = '1'; pctIn.min = '0'; pctIn.max = '100';
      startIn.addEventListener('change', () => this.editStart(t, startIn.value));
      endIn.addEventListener('change', () => this.editEnd(t, endIn.value));
      durIn.addEventListener('change', () => this.editDuration(t, Number(durIn.value)));
      pctIn.addEventListener('change', () => { void this.commit([{ id: t.id, percentComplete: clamp(Math.round(Number(pctIn.value) || 0), 0, 100) }]); });
      (cells.start as HTMLElement).append(startIn);
      (cells.end as HTMLElement).append(endIn);
      (cells.dur as HTMLElement).append(durIn);
      (cells.pct as HTMLElement).append(pctIn);

      const predIn = this.input(this.predecessorText(t.id), editable, 'text');
      predIn.placeholder = editable ? '3, 4SS+2d' : '';
      predIn.addEventListener('change', () => { void this.editPredecessors(t.id, predIn); });
      (cells.pred as HTMLElement).append(predIn);
      this.left.append(row);
    }
    this.left.scrollTop = this.right.scrollTop;
  }

  private input(value: string, editable: boolean, type: string): HTMLInputElement {
    const i = el('input', 'stl-g-in');
    i.type = type;
    i.value = value;
    i.readOnly = !editable;
    if (!editable) i.tabIndex = -1;
    return i;
  }

  private renderPlot(): void {
    const width = (this.last - this.origin + 1) * this.dw;
    const height = Math.max(this.rows.length * this.rowH, this.right.clientHeight || 0);
    this.plot.replaceChildren();
    this.plot.style.width = `${width}px`;
    this.plot.style.height = `${height}px`;
    this.plot.style.setProperty('--stl-row', `${this.rowH}px`);

    // days nobody works
    if (this.zoom === 'day' || this.zoom === 'week') {
      let runStart: number | null = null;
      const flush = (end: number): void => {
        if (runStart === null) return;
        const d = el('div', 'stl-g-off');
        d.style.left = `${this.x(runStart)}px`;
        d.style.width = `${(end - runStart + 1) * this.dw}px`;
        this.plot.append(d);
        runStart = null;
      };
      for (let d = this.origin; d <= this.last; d++) {
        if (!this.cal.isWorking(d)) { if (runStart === null) runStart = d; } else flush(d - 1);
      }
      flush(this.last);
    }

    const today = dayNum(this.today);
    const line = el('div', 'stl-g-today');
    line.style.left = `${this.x(today) + this.dw / 2}px`;
    this.plot.append(line);

    const rowIndex = new Map<string, number>();
    const barBox = new Map<string, { left: number; right: number; y: number }>();
    this.rows.forEach((r, i) => {
      rowIndex.set(r.task.id, i);
      this.plot.append(this.rowBar(r, i, barBox));
    });

    // links
    this.overlay = svg('svg', { class: 'stl-g-links', width, height });
    const defs = svg('defs');
    for (const [id, color] of [['stl-arrow', '#64748b'], ['stl-arrow-crit', '#dc2626']] as const) {
      const m = svg('marker', { id, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto' });
      m.append(svg('path', { d: 'M0 0 L8 4 L0 8 z', fill: color }));
      defs.append(m);
    }
    this.overlay.append(defs);
    for (const l of this.links) {
      const a = barBox.get(l.predecessorId);
      const b = barBox.get(l.successorId);
      if (!a || !b) continue;
      const crit = this.showCritical && this.path.get(l.predecessorId)?.critical && this.path.get(l.successorId)?.critical;
      const d = pathData(linkPath(l.type, a, b));
      const line2 = svg('path', { d, class: `stl-g-link${crit ? ' stl-g-link-crit' : ''}`, 'marker-end': `url(#${crit ? 'stl-arrow-crit' : 'stl-arrow'})` });
      const hit = svg('path', { d, class: 'stl-g-link-hit' });
      hit.dataset.linkId = l.id;
      hit.addEventListener('click', (e) => this.openPopover(l, e as MouseEvent));
      this.overlay.append(line2, hit);
    }
    this.plot.append(this.overlay);
  }

  private rowBar(r: TreeRow, index: number, boxes: Map<string, { left: number; right: number; y: number }>): HTMLElement {
    const t = r.task;
    const wrap = el('div', 'stl-g-prow');
    wrap.style.top = `${index * this.rowH}px`;
    wrap.style.height = `${this.rowH}px`;
    wrap.dataset.id = t.id;

    const rolled = this.rolled.get(t.id);
    const start = r.hasChildren ? rolled?.start ?? null : t.start;
    const end = r.hasChildren ? rolled?.end ?? null : t.end;
    const pct = r.hasChildren ? rolled?.percentComplete ?? 0 : t.percentComplete;
    const barH = r.hasChildren ? 10 : 18;
    const y = index * this.rowH + this.rowH / 2;

    if (t.deadline) {
      const d = el('div', 'stl-g-deadline');
      d.style.left = `${this.x(dayNum(t.deadline)) + this.dw / 2}px`;
      d.title = `Due ${t.deadline}`;
      wrap.append(d);
    }
    if (!start || !end) {
      boxes.set(t.id, { left: 0, right: 0, y });
      return wrap;
    }
    const s = dayNum(start);
    const e = dayNum(end);
    const left = this.x(s);
    const widthPx = Math.max(this.dw, (e - s + 1) * this.dw);
    boxes.set(t.id, { left, right: left + widthPx, y });

    const info = this.path.get(t.id);
    const crit = this.showCritical && info?.critical;
    const bar = el('div', `stl-g-bar${r.hasChildren ? ' stl-g-summary' : ''}${crit ? ' stl-g-critical' : ''}`);
    bar.dataset.id = t.id;
    bar.style.left = `${left}px`;
    bar.style.width = `${widthPx}px`;
    bar.style.height = `${barH}px`;
    bar.style.top = `${(this.rowH - barH) / 2}px`;
    bar.title = `${t.name}\n${start} to ${end}  (${this.cal.duration(start, end)} working days)\n${Math.round(pct)}% complete${info && this.showCritical ? `\nSlack: ${info.slack} working days` : ''}`;
    const prog = el('div', 'stl-g-progress');
    prog.style.width = `${clamp(pct, 0, 100)}%`;
    bar.append(prog);
    if (widthPx > 70 && !r.hasChildren) bar.append(el('span', 'stl-g-bar-label', t.name));
    if (!this.readOnly && !r.hasChildren) {
      bar.append(el('div', 'stl-g-h stl-g-h-l'), el('div', 'stl-g-h stl-g-h-r'));
      const handle = el('div', 'stl-g-prog-handle');
      handle.style.left = `${clamp(pct, 0, 100)}%`;
      bar.append(handle);
      for (const side of ['start', 'finish'] as const) {
        const dot = el('div', `stl-g-dot stl-g-dot-${side}`);
        dot.dataset.side = side;
        dot.title = side === 'finish' ? 'Drag to another task to link: finish-to-start' : 'Drag to another task to link: start-to-start';
        bar.append(dot);
      }
    }
    wrap.append(bar);
    return wrap;
  }

  private paintSelection(): void {
    for (const e of this.left.querySelectorAll<HTMLElement>('.stl-g-lrow')) e.classList.toggle('stl-g-selected', e.dataset.id === this.selected);
    for (const e of this.plot.querySelectorAll<HTMLElement>('.stl-g-prow')) e.classList.toggle('stl-g-selected', e.dataset.id === this.selected);
  }

  /* ------------------------------------------------------------------ editing */

  private snapshot(): Snapshot { return { tasks: this.tasks.map((t) => ({ ...t })), links: this.links.map((l) => ({ ...l })) }; }

  private restore(s: Snapshot): void { this.tasks = s.tasks; this.links = s.links; this.render(); }

  private fail(err: unknown, s: Snapshot): void {
    this.restore(s);
    this.cb.onError?.(err);
  }

  /** Apply patches on screen (with the pushes a link would force), then tell the host */
  private async commit(patches: TaskPatch[]): Promise<void> {
    if (patches.length === 0 || this.busy) return;
    const snap = this.snapshot();
    this.applyLocal(patches);
    this.render();
    this.busy = true;
    try {
      await this.cb.onChange?.(patches);
    } catch (err) {
      this.fail(err, snap);
    } finally {
      this.busy = false;
    }
  }

  private applyLocal(patches: TaskPatch[]): void {
    const by = new Map(patches.map((p) => [p.id, p]));
    this.tasks = this.tasks.map((t) => {
      const p = by.get(t.id);
      if (!p) return t;
      return {
        ...t,
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.start !== undefined ? { start: p.start } : {}),
        ...(p.end !== undefined ? { end: p.end } : {}),
        ...(p.percentComplete !== undefined ? { percentComplete: p.percentComplete } : {}),
        ...(p.parentId !== undefined ? { parentId: p.parentId } : {}),
        ...(p.sortOrder !== undefined ? { sortOrder: p.sortOrder } : {}),
      };
    });
    if (patches.some((p) => p.start !== undefined || p.end !== undefined || p.parentId !== undefined)) {
      const pushed = schedule(this.tasks, this.links, this.cal).changes;
      if (pushed.size) this.tasks = this.tasks.map((t) => { const c = pushed.get(t.id); return c ? { ...t, start: c.start, end: c.end } : t; });
    }
  }

  private editStart(t: GanttTask, value: string): void {
    if (!value) { void this.commit([{ id: t.id, start: null, end: null }]); return; }
    if (!t.end || !t.start) { void this.commit([{ id: t.id, start: value, end: value }]); return; }
    const dur = this.cal.duration(t.start, t.end);
    void this.commit([{ id: t.id, start: value, end: this.cal.finish(value, dur) }]);
  }

  private editEnd(t: GanttTask, value: string): void {
    if (!value) { void this.commit([{ id: t.id, start: null, end: null }]); return; }
    if (!t.start) { void this.commit([{ id: t.id, start: value, end: value }]); return; }
    void this.commit([{ id: t.id, start: t.start, end: value < t.start ? t.start : value }]);
  }

  private editDuration(t: GanttTask, days: number): void {
    if (!t.start || !Number.isFinite(days) || days < 1) { this.render(); return; }
    void this.commit([{ id: t.id, start: t.start, end: this.cal.finish(t.start, Math.round(days)) }]);
  }

  /* ------------------------------------------------------------------ links */

  private predecessorText(id: string): string {
    return this.links
      .filter((l) => l.successorId === id)
      .map((l) => formatPredecessor(this.tree.wbsOf.get(l.predecessorId) ?? '?', l.type, l.lagDays))
      .join(', ');
  }

  private checkLinkable(pred: string, succ: string, existing: readonly GanttLink[]): string | null {
    if (pred === succ) return 'A task cannot depend on itself';
    if (isSummary(this.tree, pred) || isSummary(this.tree, succ)) return 'A group cannot be linked. Link the tasks inside it.';
    if (wouldCreateCycle(existing, pred, succ)) return 'That link would make the plan loop back on itself';
    return null;
  }

  private async editPredecessors(id: string, input: HTMLInputElement): Promise<void> {
    const { links: wanted, errors } = parsePredecessors(input.value, this.tree.idOfWbs);
    const current = this.links.filter((l) => l.successorId === id);
    if (errors.length) { this.cb.onError?.(new Error(errors[0])); input.value = this.predecessorText(id); return; }

    const keep = new Set(wanted.map((w) => w.predecessorId));
    const doomed = current.filter((l) => !keep.has(l.predecessorId));
    const rest = this.links.filter((l) => !doomed.includes(l));
    const ops: Array<() => Promise<unknown> | void> = [];
    const snap = this.snapshot();
    const next: GanttLink[] = rest.filter((l) => l.successorId !== id || keep.has(l.predecessorId));
    for (const w of wanted) {
      const have = current.find((l) => l.predecessorId === w.predecessorId);
      if (have) {
        if (have.type !== w.type || have.lagDays !== w.lagDays) {
          have.type = w.type; have.lagDays = w.lagDays;
          ops.push(() => this.cb.onLinkUpdate?.(have.id, { type: w.type, lagDays: w.lagDays }));
        }
        continue;
      }
      const problem = this.checkLinkable(w.predecessorId, id, next);
      if (problem) { this.cb.onError?.(new Error(problem)); input.value = this.predecessorText(id); this.links = snap.links; return; }
      next.push({ id: `new:${w.predecessorId}:${id}`, predecessorId: w.predecessorId, successorId: id, type: w.type, lagDays: w.lagDays });
      ops.push(() => this.cb.onLinkCreate?.({ predecessorId: w.predecessorId, successorId: id, type: w.type, lagDays: w.lagDays }));
    }
    for (const d of doomed) ops.push(() => this.cb.onLinkDelete?.(d.id));
    if (ops.length === 0) return;

    this.links = next;
    this.applyLocal([{ id, start: this.tasks.find((t) => t.id === id)?.start ?? null }].filter((p) => p.start !== null));
    this.render();
    this.busy = true;
    try { for (const op of ops) await op(); } catch (err) { this.fail(err, snap); } finally { this.busy = false; }
  }

  private async createLink(predecessorId: string, successorId: string, type: LinkType): Promise<void> {
    const problem = this.checkLinkable(predecessorId, successorId, this.links);
    if (problem) { this.cb.onError?.(new Error(problem)); return; }
    if (this.links.some((l) => l.predecessorId === predecessorId && l.successorId === successorId)) {
      this.cb.onError?.(new Error('These two tasks are already linked'));
      return;
    }
    const snap = this.snapshot();
    this.links.push({ id: `new:${predecessorId}:${successorId}`, predecessorId, successorId, type, lagDays: 0 });
    this.applyLocal([{ id: successorId, start: this.tasks.find((t) => t.id === successorId)?.start ?? null }].filter((p) => p.start !== null));
    this.render();
    this.busy = true;
    try { await this.cb.onLinkCreate?.({ predecessorId, successorId, type, lagDays: 0 }); } catch (err) { this.fail(err, snap); } finally { this.busy = false; }
  }

  private openPopover(link: GanttLink, e: MouseEvent): void {
    this.closePopover();
    if (this.readOnly) return;
    const pred = this.tree.wbsOf.get(link.predecessorId) ?? '?';
    const succ = this.tree.wbsOf.get(link.successorId) ?? '?';
    const pop = el('div', 'stl-g-pop');
    pop.append(el('div', 'stl-g-pop-title', `Link ${pred} → ${succ}`));
    const type = el('select', 'stl-g-pop-in');
    const names: Record<LinkType, string> = { FS: 'Finish to start', SS: 'Start to start', FF: 'Finish to finish', SF: 'Start to finish' };
    for (const t of LINK_TYPES) { const o = el('option', '', names[t]); o.value = t; o.selected = t === link.type; type.append(o); }
    const lag = el('input', 'stl-g-pop-in');
    lag.type = 'number';
    lag.value = String(link.lagDays);
    lag.title = 'Lag in working days (negative = lead)';
    const lagRow = el('label', 'stl-g-pop-row');
    lagRow.append(document.createTextNode('Lag (days) '), lag);
    const del = el('button', 'stl-g-btn stl-g-danger', 'Remove link');
    del.type = 'button';
    pop.append(type, lagRow, del);

    const save = async (): Promise<void> => {
      const patch = { type: type.value as LinkType, lagDays: Math.round(Number(lag.value) || 0) };
      const snap = this.snapshot();
      const target = this.links.find((l) => l.id === link.id);
      if (!target) return;
      target.type = patch.type; target.lagDays = patch.lagDays;
      this.applyLocal([{ id: link.successorId, start: this.tasks.find((t) => t.id === link.successorId)?.start ?? null }].filter((p) => p.start !== null));
      this.render();
      try { await this.cb.onLinkUpdate?.(link.id, patch); } catch (err) { this.fail(err, snap); }
    };
    type.addEventListener('change', () => { void save(); });
    lag.addEventListener('change', () => { void save(); });
    del.addEventListener('click', async () => {
      const snap = this.snapshot();
      this.links = this.links.filter((l) => l.id !== link.id);
      this.render();
      try { await this.cb.onLinkDelete?.(link.id); } catch (err) { this.fail(err, snap); }
    });

    const box = this.root.getBoundingClientRect();
    pop.style.left = `${clamp(e.clientX - box.left, 0, Math.max(0, box.width - 230))}px`;
    pop.style.top = `${clamp(e.clientY - box.top + 8, 0, Math.max(0, box.height - 150))}px`;
    this.root.append(pop);
    this.popover = pop;
  }

  private closePopover(): void { this.popover?.remove(); this.popover = null; }

  /* ------------------------------------------------------------------ outline */

  private siblings(parentId: string | null): GanttTask[] {
    return this.tree.rows.filter((r) => (r.task.parentId ?? null) === parentId && this.tasks.some((t) => t.id === r.task.id)).map((r) => r.task);
  }

  private parentOf(id: string): string | null {
    const t = this.tasks.find((x) => x.id === id);
    return t?.parentId && this.tasks.some((x) => x.id === t.parentId) ? t.parentId : null;
  }

  private canIndent(): boolean {
    if (!this.selected) return false;
    const sib = this.siblings(this.parentOf(this.selected));
    return sib.findIndex((t) => t.id === this.selected) > 0;
  }

  private canOutdent(): boolean {
    return !!this.selected && this.parentOf(this.selected) !== null;
  }

  /** Explicit 0..n sort numbers for an ordered list of siblings; patches only for the ones that differ */
  private renumber(order: readonly GanttTask[]): TaskPatch[] {
    const out: TaskPatch[] = [];
    order.forEach((t, i) => { if (t.sortOrder !== i) out.push({ id: t.id, sortOrder: i }); });
    return out;
  }

  private async indent(): Promise<void> {
    if (!this.selected || !this.canIndent()) return;
    const id = this.selected;
    const parent = this.parentOf(id);
    const sib = this.siblings(parent);
    const prev = sib[sib.findIndex((t) => t.id === id) - 1] as GanttTask;
    const kids = this.siblings(prev.id);
    this.collapsed.delete(prev.id);
    await this.commit([{ id, parentId: prev.id, sortOrder: kids.length }]);
  }

  private async outdent(): Promise<void> {
    if (!this.selected || !this.canOutdent()) return;
    const id = this.selected;
    const parentId = this.parentOf(id) as string;
    const gp = this.parentOf(parentId);
    const newSiblings = this.siblings(gp).filter((t) => t.id !== id);
    const at = newSiblings.findIndex((t) => t.id === parentId);
    const moved = this.tasks.find((t) => t.id === id) as GanttTask;
    newSiblings.splice(at + 1, 0, moved);
    const patches = this.renumber(newSiblings).filter((p) => p.id !== id);
    await this.commit([{ id, parentId: gp, sortOrder: at + 1 }, ...patches]);
  }

  private async moveRow(dir: -1 | 1): Promise<void> {
    if (!this.selected) return;
    const id = this.selected;
    const sib = this.siblings(this.parentOf(id));
    const i = sib.findIndex((t) => t.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sib.length) return;
    const a = sib[i] as GanttTask;
    sib[i] = sib[j] as GanttTask;
    sib[j] = a;
    await this.commit(this.renumber(sib));
  }

  private onKey(e: KeyboardEvent): void {
    const inField = (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT';
    if (e.key === 'Escape') { this.closePopover(); return; }
    if (this.readOnly || inField || !this.selected) return;
    if (e.key === 'Tab') { e.preventDefault(); void (e.shiftKey ? this.outdent() : this.indent()); }
    else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); void this.moveRow(-1); }
    else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); void this.moveRow(1); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const i = this.rows.findIndex((r) => r.task.id === this.selected);
      const n = this.rows[clamp(i + (e.key === 'ArrowUp' ? -1 : 1), 0, this.rows.length - 1)];
      if (n) this.select(n.task.id);
    }
  }

  /* ------------------------------------------------------------------ dragging */

  private onPlotPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const bar = target.closest<HTMLElement>('.stl-g-bar');
    if (!bar?.dataset.id) return;
    const id = bar.dataset.id;
    this.select(id);
    if (this.readOnly || bar.classList.contains('stl-g-summary')) return;
    const t = this.tasks.find((x) => x.id === id);
    if (!t?.start || !t.end) return;
    const base = { id, startX: e.clientX, origStart: dayNum(t.start), origEnd: dayNum(t.end), dur: this.cal.duration(t.start, t.end), bar, moved: false };
    if (target.classList.contains('stl-g-dot')) {
      const side = target.dataset.side === 'start' ? 'start' : 'finish';
      const box = bar.getBoundingClientRect();
      const plot = this.plot.getBoundingClientRect();
      this.drag = { ...base, kind: 'link', side, from: { x: (side === 'start' ? box.left : box.right) - plot.left, y: box.top + box.height / 2 - plot.top } };
    } else if (target.classList.contains('stl-g-h-l')) this.drag = { ...base, kind: 'left' };
    else if (target.classList.contains('stl-g-h-r')) this.drag = { ...base, kind: 'right' };
    else if (target.classList.contains('stl-g-prog-handle')) this.drag = { ...base, kind: 'progress' };
    else this.drag = { ...base, kind: 'move' };
    e.preventDefault();
  }

  private onPointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < 3 && d.kind !== 'link') return;
    d.moved = true;
    const dDays = Math.round(dx / this.dw);
    const bar = d.bar;
    const cal = this.cal;
    if (d.kind === 'move') {
      const start = cal.snapForward(d.origStart + dDays);
      const end = dayNum(cal.finish(isoOf(start), d.dur));
      d.preview = { start, end };
      bar.style.left = `${this.x(start)}px`;
    } else if (d.kind === 'left') {
      const start = Math.min(cal.snapForward(d.origStart + dDays), d.origEnd);
      d.preview = { start, end: d.origEnd };
      bar.style.left = `${this.x(start)}px`;
      bar.style.width = `${(d.origEnd - start + 1) * this.dw}px`;
    } else if (d.kind === 'right') {
      const end = Math.max(cal.snapBack(d.origEnd + dDays), d.origStart);
      d.preview = { start: d.origStart, end };
      bar.style.width = `${(end - d.origStart + 1) * this.dw}px`;
    } else if (d.kind === 'progress') {
      const box = bar.getBoundingClientRect();
      const pct = clamp(Math.round(((e.clientX - box.left) / box.width) * 100), 0, 100);
      d.preview = { start: d.origStart, end: d.origEnd, pct };
      const prog = bar.querySelector<HTMLElement>('.stl-g-progress');
      const handle = bar.querySelector<HTMLElement>('.stl-g-prog-handle');
      if (prog) prog.style.width = `${pct}%`;
      if (handle) handle.style.left = `${pct}%`;
    } else if (d.kind === 'link' && d.from) {
      const plot = this.plot.getBoundingClientRect();
      this.overlay.querySelector('.stl-g-rubber')?.remove();
      const line = svg('path', { d: `M${d.from.x} ${d.from.y} L${e.clientX - plot.left} ${e.clientY - plot.top}`, class: 'stl-g-rubber' });
      this.overlay.append(line);
    }
    if (d.kind !== 'link' && d.preview) bar.title = `${isoOf(d.preview.start)} to ${isoOf(d.preview.end)}`;
  }

  private async onPointerUp(e: PointerEvent): Promise<void> {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    this.overlay.querySelector('.stl-g-rubber')?.remove();
    if (!d.moved) return;
    if (d.kind === 'link') {
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.stl-g-bar');
      const targetId = over?.dataset.id;
      if (!over || !targetId || targetId === d.id) return;
      const box = over.getBoundingClientRect();
      const toStart = e.clientX < box.left + box.width / 2;
      const type: LinkType = d.side === 'finish' ? (toStart ? 'FS' : 'FF') : (toStart ? 'SS' : 'SF');
      await this.createLink(d.id, targetId, type);
      return;
    }
    const p = d.preview;
    if (!p) return;
    if (d.kind === 'progress') {
      if (p.pct !== undefined) await this.commit([{ id: d.id, percentComplete: p.pct }]);
      return;
    }
    if (p.start === d.origStart && p.end === d.origEnd) { this.render(); return; }
    await this.commit([{ id: d.id, start: isoOf(p.start), end: isoOf(p.end) }]);
  }

  private startSplit(e: PointerEvent): void {
    e.preventDefault();
    const startX = e.clientX;
    const startW = this.leftWidth;
    const move = (ev: PointerEvent): void => {
      this.leftWidth = clamp(startW + ev.clientX - startX, 280, 900);
      this.renderHead();
      this.renderLeft();
    };
    const up = (): void => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }
}

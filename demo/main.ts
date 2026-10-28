import { GanttChart } from '../src';
import type { GanttLink, GanttTask, LinkType } from '../src';

const sample = (): { tasks: GanttTask[]; links: GanttLink[] } => ({
  tasks: [
    { id: 'p1', parentId: null, name: 'Phase 1: Survey', start: null, end: null, percentComplete: 0, sortOrder: 0, deadline: '2026-11-20' },
    { id: 'a', parentId: 'p1', name: 'Site visit', start: '2026-11-02', end: '2026-11-04', percentComplete: 100, sortOrder: 0 },
    { id: 'b', parentId: 'p1', name: 'Survey report', start: '2026-11-05', end: '2026-11-10', percentComplete: 40, sortOrder: 1 },
    { id: 'p2', parentId: null, name: 'Phase 2: Build', start: null, end: null, percentComplete: 0, sortOrder: 1 },
    { id: 'c', parentId: 'p2', name: 'Procure materials', start: '2026-11-11', end: '2026-11-18', percentComplete: 0, sortOrder: 0 },
    { id: 'd', parentId: 'p2', name: 'Install', start: '2026-11-19', end: '2026-11-27', percentComplete: 0, sortOrder: 1 },
    { id: 'e', parentId: 'p2', name: 'Site security (runs alongside)', start: '2026-11-11', end: '2026-12-04', percentComplete: 10, sortOrder: 2 },
    { id: 'p3', parentId: null, name: 'Phase 3: Handover', start: null, end: null, percentComplete: 0, sortOrder: 2 },
    { id: 'f', parentId: 'p3', name: 'Testing', start: '2026-11-30', end: '2026-12-04', percentComplete: 0, sortOrder: 0 },
    { id: 'g', parentId: 'p3', name: 'Training', start: '2026-11-30', end: '2026-12-02', percentComplete: 0, sortOrder: 1 },
    { id: 'h', parentId: 'p3', name: 'Sign-off', start: '2026-12-07', end: '2026-12-07', percentComplete: 0, sortOrder: 2 },
    { id: 'u', parentId: null, name: 'Unscheduled idea (no dates yet)', start: null, end: null, percentComplete: 0, sortOrder: 3 },
  ],
  links: [
    { id: 'l1', predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 0 },
    { id: 'l2', predecessorId: 'b', successorId: 'c', type: 'FS', lagDays: 0 },
    { id: 'l3', predecessorId: 'c', successorId: 'd', type: 'FS', lagDays: 0 },
    { id: 'l4', predecessorId: 'd', successorId: 'f', type: 'FS', lagDays: 1 },
    { id: 'l5', predecessorId: 'f', successorId: 'g', type: 'SS', lagDays: 0 },
    { id: 'l6', predecessorId: 'f', successorId: 'h', type: 'FS', lagDays: 0 },
    { id: 'l7', predecessorId: 'c', successorId: 'e', type: 'SS', lagDays: 0 },
  ],
});

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const logBox = $('log');
const log = (s: string): void => { logBox.textContent = `${s}\n${logBox.textContent ?? ''}`; };

let data = sample();
let holidays = ['2026-11-12', '2026-11-26'];
let seq = 100;
const readOnly = location.hash === '#ro';
$<HTMLInputElement>('ro').checked = readOnly;

const chart = new GanttChart($('g'), {
  tasks: data.tasks,
  links: data.links,
  calendar: { holidays },
  zoom: 'week',
  criticalPath: true,
  readOnly,
  today: '2026-11-09',
  callbacks: {
    onChange: (patches) => {
      for (const p of patches) {
        const t = data.tasks.find((x) => x.id === p.id);
        if (t) Object.assign(t, p);
      }
      log(`onChange ${JSON.stringify(patches)}`);
    },
    onLinkCreate: (l) => {
      data.links.push({ id: `n${seq++}`, ...l });
      chart.setData(data);
      log(`onLinkCreate ${JSON.stringify(l)}`);
    },
    onLinkUpdate: (id, patch) => {
      const l = data.links.find((x) => x.id === id);
      if (l) {
        if (patch.type) l.type = patch.type as LinkType;
        if (patch.lagDays !== undefined) l.lagDays = patch.lagDays;
      }
      chart.setData(data);
      log(`onLinkUpdate ${id} ${JSON.stringify(patch)}`);
    },
    onLinkDelete: (id) => {
      data.links = data.links.filter((x) => x.id !== id);
      chart.setData(data);
      log(`onLinkDelete ${id}`);
    },
    onAddTask: (parentId) => {
      data.tasks.push({ id: `t${seq++}`, parentId, name: 'New task', start: '2026-11-16', end: '2026-11-18', percentComplete: 0, sortOrder: seq });
      chart.setData(data);
      log(`onAddTask parent=${parentId ?? 'none'}`);
    },
    onDeleteTask: (id) => {
      data.tasks = data.tasks.filter((x) => x.id !== id && x.parentId !== id);
      data.links = data.links.filter((x) => x.predecessorId !== id && x.successorId !== id);
      chart.setData(data);
      log(`onDeleteTask ${id}`);
    },
    onOpenTask: (id) => log(`onOpenTask ${id} (open your own edit dialog here)`),
    onError: (e) => log(`onError ${e instanceof Error ? e.message : String(e)}`),
  },
});

$<HTMLInputElement>('crit').addEventListener('change', (e) => chart.setCriticalPath((e.target as HTMLInputElement).checked));
$<HTMLSelectElement>('zoom').addEventListener('change', (e) => chart.setZoom((e.target as HTMLSelectElement).value as 'day' | 'week' | 'month' | 'quarter'));
$('apply').addEventListener('click', () => {
  holidays = $<HTMLInputElement>('hol').value.split(',').map((s) => s.trim()).filter(Boolean);
  chart.setData({ tasks: data.tasks, links: data.links, calendar: { holidays } });
  log(`calendar holidays = ${holidays.join(', ')}`);
});
$('reset').addEventListener('click', () => { data = sample(); chart.setData(data); log('reset'); });
// Read only is chosen when the chart is built, so the checkbox reloads the page with it on or off.
$('ro').addEventListener('change', (e) => {
  location.hash = (e.target as HTMLInputElement).checked ? 'ro' : '';
  location.reload();
});

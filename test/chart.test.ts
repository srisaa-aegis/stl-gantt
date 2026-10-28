/** @jest-environment jsdom */
import { GanttChart } from '../src';
import type { GanttLink, GanttTask } from '../src';

const task = (id: string, start: string | null, end: string | null, parentId: string | null = null, o: Partial<GanttTask> = {}): GanttTask =>
  ({ id, parentId, name: `Task ${id}`, start, end, percentComplete: 0, sortOrder: 0, ...o });

const tasks: GanttTask[] = [
  task('g', null, null),
  task('a', '2026-11-02', '2026-11-04', 'g'),
  task('b', '2026-11-05', '2026-11-06', 'g', { sortOrder: 1 }),
  task('c', '2026-11-09', '2026-11-10', null, { sortOrder: 1 }),
];
const links: GanttLink[] = [{ id: 'l1', predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 0 }];

let host: HTMLElement;
beforeEach(() => { document.body.innerHTML = '<div id="h"></div>'; host = document.getElementById('h') as HTMLElement; });

describe('GanttChart (DOM)', () => {
  it('draws one outline row and one bar row per task', () => {
    const chart = new GanttChart(host, { tasks, links, today: '2026-11-03' });
    expect(host.querySelectorAll('.stl-g-lrow')).toHaveLength(4);
    expect(host.querySelectorAll('.stl-g-prow')).toHaveLength(4);
    const names = Array.from(host.querySelectorAll('input')).map((i) => i.value);
    expect(names).toContain('Task a');
    chart.destroy();
  });

  it('marks a group as a summary bar', () => {
    new GanttChart(host, { tasks, links, today: '2026-11-03' });
    expect(host.querySelectorAll('.stl-g-summary').length).toBeGreaterThanOrEqual(1);
  });

  it('draws an arrow for each link', () => {
    new GanttChart(host, { tasks, links, today: '2026-11-03' });
    expect(host.querySelectorAll('path.stl-g-link')).toHaveLength(1);
  });

  it('selects a row and reports it', () => {
    const chart = new GanttChart(host, { tasks, links, today: '2026-11-03' });
    chart.select('c');
    expect(chart.getSelected()).toBe('c');
    expect(host.querySelectorAll('.stl-g-selected').length).toBeGreaterThan(0);
    chart.select(null);
    expect(chart.getSelected()).toBeNull();
  });

  it('setData replaces the rows and drops a selection that no longer exists', () => {
    const chart = new GanttChart(host, { tasks, links, today: '2026-11-03' });
    chart.select('c');
    chart.setData({ tasks: tasks.filter((t) => t.id !== 'c'), links });
    expect(host.querySelectorAll('.stl-g-lrow')).toHaveLength(3);
    expect(chart.getSelected()).toBeNull();
  });

  it('changes zoom without losing rows', () => {
    const chart = new GanttChart(host, { tasks, links, zoom: 'day', today: '2026-11-03' });
    for (const z of ['week', 'month', 'quarter', 'day'] as const) {
      chart.setZoom(z);
      expect(host.querySelectorAll('.stl-g-lrow')).toHaveLength(4);
    }
  });

  it('colours the critical path only when asked', () => {
    const chart = new GanttChart(host, { tasks, links, today: '2026-11-03' });
    expect(host.querySelectorAll('.stl-g-critical')).toHaveLength(0);
    chart.setCriticalPath(true);
    expect(host.querySelectorAll('.stl-g-critical').length).toBeGreaterThan(0);
    chart.setCriticalPath(false);
    expect(host.querySelectorAll('.stl-g-critical')).toHaveLength(0);
  });

  it('shows an unscheduled task as a row with no bar', () => {
    new GanttChart(host, { tasks: [...tasks, task('u', null, null, null, { sortOrder: 5 })], links, today: '2026-11-03' });
    expect(host.querySelectorAll('.stl-g-lrow')).toHaveLength(5);
  });

  it('copies its input, so later changes to the array passed in do not leak in', () => {
    const mine = tasks.map((t) => ({ ...t }));
    new GanttChart(host, { tasks: mine, links, today: '2026-11-03' });
    mine.length = 0;
    expect(host.querySelectorAll('.stl-g-lrow')).toHaveLength(4);
  });

  it('destroy empties the host', () => {
    const chart = new GanttChart(host, { tasks, links, today: '2026-11-03' });
    chart.destroy();
    expect(host.querySelectorAll('.stl-g-lrow')).toHaveLength(0);
  });
});

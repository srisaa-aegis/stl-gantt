import {
  WorkCalendar, applyChange, buildTree, criticalPath, formatPredecessor, parsePredecessors, rollUp, schedule, visibleRows,
  wouldCreateCycle, type GanttLink, type GanttTask, type LinkType,
} from '../src';

// 2026-11-02 is a Monday
const task = (id: string, start: string | null, end: string | null, extra: Partial<GanttTask> = {}): GanttTask => ({
  id, parentId: null, name: id, start, end, percentComplete: 0, sortOrder: 0, ...extra,
});
const link = (p: string, s: string, type: LinkType = 'FS', lagDays = 0): GanttLink => ({ id: `${p}-${s}`, predecessorId: p, successorId: s, type, lagDays });
const cal = new WorkCalendar();

describe('WorkCalendar', () => {
  it('counts working days both ends in, skipping weekends', () => {
    expect(cal.duration('2026-11-02', '2026-11-06')).toBe(5);
    expect(cal.duration('2026-11-05', '2026-11-09')).toBe(3); // Thu, Fri, Mon
    expect(cal.duration('2026-11-07', '2026-11-08')).toBe(1); // a weekend-only range still takes a day
  });
  it('finds the last day from a start and a length, and the reverse', () => {
    expect(cal.finish('2026-11-02', 5)).toBe('2026-11-06');
    expect(cal.finish('2026-11-02', 6)).toBe('2026-11-09');
    expect(cal.startFor('2026-11-06', 5)).toBe('2026-11-02');
    expect(cal.startFor('2026-11-09', 2)).toBe('2026-11-06');
  });
  it('moves off a weekend', () => {
    expect(cal.workingOnOrAfter('2026-11-07')).toBe('2026-11-09');
    expect(cal.workingOnOrBefore('2026-11-08')).toBe('2026-11-06');
    expect(cal.shift('2026-11-02', 1)).toBe('2026-11-03');
    expect(cal.shift('2026-11-09', -1)).toBe('2026-11-06');
  });
  it('skips holidays, and a holiday on a day off changes nothing', () => {
    const h = new WorkCalendar({ holidays: ['2026-11-04', '2026-11-07'] });
    expect(h.finish('2026-11-02', 3)).toBe('2026-11-05');
    expect(h.duration('2026-11-02', '2026-11-06')).toBe(4);
    expect(h.isWorking(Date.UTC(2026, 10, 7) / 86_400_000)).toBe(false);
  });
  it('supports a six-day week and falls back to Monday to Friday for an empty mask', () => {
    const sat = new WorkCalendar({ workingDays: '1111110' });
    expect(sat.duration('2026-11-02', '2026-11-07')).toBe(6);
    expect(new WorkCalendar({ workingDays: '0000000' }).duration('2026-11-02', '2026-11-06')).toBe(5);
  });
});

describe('schedule', () => {
  const A = task('A', '2026-11-02', '2026-11-04'); // Mon-Wed, 3 days
  it('finish-to-start pushes the successor to the next working day', () => {
    const r = schedule([A, task('B', '2026-11-03', '2026-11-05')], [link('A', 'B')], cal);
    expect(r.changes.get('B')).toEqual({ start: '2026-11-05', end: '2026-11-09' });
  });
  it('applies lag and lead', () => {
    expect(schedule([A, task('B', '2026-11-03', '2026-11-05')], [link('A', 'B', 'FS', 1)], cal).changes.get('B')?.start).toBe('2026-11-06');
    expect(schedule([A, task('B', '2026-11-02', '2026-11-03')], [link('A', 'B', 'FS', -1)], cal).changes.get('B')?.start).toBe('2026-11-04');
  });
  it('start-to-start', () => {
    const r = schedule([task('A', '2026-11-03', '2026-11-04'), task('B', '2026-11-02', '2026-11-03')], [link('A', 'B', 'SS')], cal);
    expect(r.changes.get('B')).toEqual({ start: '2026-11-03', end: '2026-11-04' });
  });
  it('finish-to-finish keeps the length', () => {
    const r = schedule([task('A', '2026-11-02', '2026-11-06'), task('B', '2026-11-02', '2026-11-03')], [link('A', 'B', 'FF')], cal);
    expect(r.changes.get('B')).toEqual({ start: '2026-11-05', end: '2026-11-06' });
  });
  it('start-to-finish: the successor may not end before the predecessor starts', () => {
    const r = schedule([task('A', '2026-11-09', '2026-11-13'), task('B', '2026-11-02', '2026-11-03')], [link('A', 'B', 'SF')], cal);
    expect(r.changes.get('B')).toEqual({ start: '2026-11-06', end: '2026-11-09' });
  });
  it('carries a push down a chain', () => {
    const r = schedule(
      [A, task('B', '2026-11-03', '2026-11-03'), task('C', '2026-11-04', '2026-11-04')],
      [link('A', 'B'), link('B', 'C')], cal,
    );
    expect(r.changes.get('B')?.start).toBe('2026-11-05');
    expect(r.changes.get('C')?.start).toBe('2026-11-06');
  });
  it('never moves a task earlier, so hand-set dates stay', () => {
    const r = schedule([A, task('B', '2026-11-16', '2026-11-17')], [link('A', 'B')], cal);
    expect(r.changes.size).toBe(0);
  });
  it('uses the most demanding of several predecessors', () => {
    const r = schedule(
      [A, task('A2', '2026-11-02', '2026-11-10'), task('B', '2026-11-03', '2026-11-03')],
      [link('A', 'B'), link('A2', 'B')], cal,
    );
    expect(r.changes.get('B')?.start).toBe('2026-11-11');
  });
  it('ignores groups and unscheduled tasks, and reports a loop', () => {
    const g = task('G', null, null);
    const kid = task('K', '2026-11-02', '2026-11-03', { parentId: 'G' });
    const un = task('U', null, null);
    const r = schedule([g, kid, un, task('B', '2026-11-02', '2026-11-02')], [link('G', 'B'), link('U', 'B'), link('K', 'B')], cal);
    expect(r.ignored.sort()).toEqual(['G-B', 'U-B']);
    expect(r.changes.get('B')?.start).toBe('2026-11-04');
    const loop = schedule([task('X', '2026-11-02', '2026-11-02'), task('Y', '2026-11-03', '2026-11-03')], [link('X', 'Y'), link('Y', 'X')], cal);
    expect(loop.cyclic.sort()).toEqual(['X', 'Y']);
  });
  it('applyChange moves the edited task and what depends on it', () => {
    const tasks = [A, task('B', '2026-11-05', '2026-11-06')];
    const r = applyChange(tasks, [link('A', 'B')], cal, 'A', { start: '2026-11-04', end: '2026-11-06' });
    expect(r.get('A')).toEqual({ start: '2026-11-04', end: '2026-11-06' });
    expect(r.get('B')).toEqual({ start: '2026-11-09', end: '2026-11-10' });
  });
});

describe('criticalPath', () => {
  it('marks the longest chain critical and gives the rest slack', () => {
    const tasks = [task('A', '2026-11-02', '2026-11-04'), task('B', '2026-11-05', '2026-11-06'), task('C', '2026-11-02', '2026-11-03')];
    const p = criticalPath(tasks, [link('A', 'B')], cal);
    expect(p.get('A')).toEqual({ slack: 0, critical: true });
    expect(p.get('B')).toEqual({ slack: 0, critical: true });
    expect(p.get('C')).toEqual({ slack: 3, critical: false });
  });
  it('gives a task with room before its successor slack', () => {
    const tasks = [task('A', '2026-11-02', '2026-11-02'), task('B', '2026-11-06', '2026-11-06')];
    const p = criticalPath(tasks, [link('A', 'B')], cal);
    expect(p.get('A')?.slack).toBe(3);
    expect(p.get('B')?.critical).toBe(true);
  });
  it('handles every link type and marks a group critical when a task in it is', () => {
    const tasks = [
      task('G', null, null), task('A', '2026-11-02', '2026-11-04', { parentId: 'G' }), task('B', '2026-11-03', '2026-11-06'),
      task('C', '2026-11-02', '2026-11-02'),
    ];
    const p = criticalPath(tasks, [link('A', 'B', 'SS', 1), link('A', 'C', 'FF')], cal);
    expect(p.get('B')?.critical).toBe(true);
    expect(p.get('G')?.critical).toBe(p.get('A')?.critical);
  });
});

describe('tree', () => {
  const tasks = [
    task('P', null, null, { sortOrder: 1 }),
    task('P1', '2026-11-02', '2026-11-03', { parentId: 'P', sortOrder: 1, percentComplete: 100 }),
    task('P2', '2026-11-04', '2026-11-06', { parentId: 'P', sortOrder: 2, percentComplete: 0 }),
    task('Q', '2026-11-09', '2026-11-09', { sortOrder: 2 }),
  ];
  it('numbers the outline and hides what is collapsed', () => {
    const t = buildTree(tasks);
    expect(t.rows.map((r) => `${r.wbs}:${r.task.id}`)).toEqual(['1:P', '1.1:P1', '1.2:P2', '2:Q']);
    expect(visibleRows(t, new Set(['P'])).map((r) => r.task.id)).toEqual(['P', 'Q']);
    expect(t.idOfWbs.get('1.2')).toBe('P2');
  });
  it('rolls a group up from its tasks, weighting progress by length', () => {
    const r = rollUp(tasks, cal).get('P');
    expect(r).toEqual({ start: '2026-11-02', end: '2026-11-06', percentComplete: 40 }); // (2*100 + 3*0) / 5
  });
  it('keeps a task with a missing parent in view', () => {
    expect(buildTree([task('X', null, null, { parentId: 'gone' })]).rows).toHaveLength(1);
  });
});

describe('links', () => {
  it('detects loops', () => {
    const links = [link('A', 'B'), link('B', 'C')];
    expect(wouldCreateCycle(links, 'C', 'A')).toBe(true);
    expect(wouldCreateCycle(links, 'A', 'C')).toBe(false);
    expect(wouldCreateCycle([], 'A', 'A')).toBe(true);
  });
  it('reads and writes predecessor cells', () => {
    const ids = new Map([['1', 'a'], ['2.1', 'b']]);
    const { links, errors } = parsePredecessors('1, 2.1ss+2d; 1FF-1', ids);
    expect(errors).toEqual([]);
    expect(links).toEqual([
      { predecessorId: 'a', type: 'FS', lagDays: 0 },
      { predecessorId: 'b', type: 'SS', lagDays: 2 },
      { predecessorId: 'a', type: 'FF', lagDays: -1 },
    ]);
    expect(parsePredecessors('9, abc', ids).errors).toHaveLength(2);
    expect(formatPredecessor('2.1', 'SS', 2)).toBe('2.1SS+2d');
    expect(formatPredecessor('3', 'FS', 0)).toBe('3');
    expect(formatPredecessor('3', 'FS', -1)).toBe('3FS-1d');
  });
});

# stl-gantt

A dependency-free TypeScript Gantt chart. Plain DOM, no framework, MIT licensed.

![stl-gantt demo: three phases with dependencies, the critical path in red, holidays shaded and a today line](https://raw.githubusercontent.com/srisaa-aegis/stl-gantt/main/demo/gantt.png)

- Task outline (groups and tasks); drag to move, resize and set progress
- Dependencies: finish-to-start, start-to-start, finish-to-finish, start-to-finish, with lag or lead
- Working calendar: weekly days off and holidays; durations and lags count working days
- Scheduling: when a link would be broken the successor is pushed later (never earlier, so dates set by hand stay)
- Critical path and total slack
- Day / week / month / quarter zoom, today line, deadline diamonds, collapsible groups, indent / outdent / reorder
- Read-only mode
- A pure core (`WorkCalendar`, `schedule`, `criticalPath`, `buildTree`, ...) you can use without the chart, for example on a server

## Install

```
npm install stl-gantt
```

## Use

```ts
import { GanttChart } from 'stl-gantt';
import 'stl-gantt/style.css';

const chart = new GanttChart(document.getElementById('gantt')!, {
  tasks: [
    { id: 'a', parentId: null, name: 'Design', start: '2026-11-02', end: '2026-11-06', percentComplete: 50, sortOrder: 0 },
    { id: 'b', parentId: null, name: 'Build', start: '2026-11-09', end: '2026-11-20', percentComplete: 0, sortOrder: 1 },
  ],
  links: [{ id: 'l1', predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 0 }],
  calendar: { workingDays: '1111100', holidays: ['2026-11-12'] },
  callbacks: {
    onChange: async (patches) => { await save(patches); chart.setData(await load()); },
    onLinkCreate: async (link) => { await saveLink(link); chart.setData(await load()); },
  },
});
```

The chart never saves anything. It applies each edit on screen, then calls your callback. If the callback throws, the
screen is put back and `onError` is called. Call `setData` with the saved data to refresh.

Dates are ISO days (`2026-11-05`); a task's `end` is its last working day. A task with no `start` or `end` is unscheduled.
Groups (a task that has children) take their dates and progress from the tasks inside and cannot be linked.

### Options

| Option | Meaning |
|---|---|
| `tasks`, `links` | The data (copied on the way in) |
| `calendar` | `{ workingDays: '1111100', holidays: [...] }`; Monday to Friday by default |
| `zoom` | `'day' \| 'week' \| 'month' \| 'quarter'` |
| `criticalPath` | Colour the critical path and show slack |
| `readOnly` | No dragging or editing |
| `rowHeight`, `today` | Row height in pixels; override "today" (useful in tests) |
| `callbacks` | `onChange`, `onLinkCreate`, `onLinkUpdate`, `onLinkDelete`, `onAddTask`, `onDeleteTask`, `onOpenTask`, `onError` |

### Methods

`setData`, `setZoom`, `setCriticalPath`, `select`, `getSelected`, `scrollToToday`, `scrollToStart`, `fitToProject`, `destroy`.

Theme it with CSS variables on `.stl-g` (`--stl-bar`, `--stl-critical`, `--stl-today`, ...); see `src/style.css`.

## Core only

```ts
import { WorkCalendar, schedule, criticalPath } from 'stl-gantt';

const cal = new WorkCalendar({ holidays: ['2026-11-12'] });
const { changes } = schedule(tasks, links, cal); // Map<taskId, { start, end }> of tasks that must move later
const path = criticalPath(tasks, links, cal);    // Map<taskId, { slack, critical }>
```

## Demo

```
npm install
npm run demo        # bundles demo/main.ts into demo/gantt.js
```

Then open `demo/index.html` in a browser (add `#ro` to the address for read-only). The demo shows a three-phase plan with all four link types, a holiday calendar, the critical path, an unscheduled task, and a log of every callback the chart fires.

## Develop

```
npm test            # core (calendar, scheduler, critical path, tree, links) and DOM tests (jsdom)
npm run typecheck
npm run build       # dist/cjs and dist/esm
```

## Not yet

Baselines, resource allocation, task constraints (must start on...), MS Project import and export, printing, undo.

## Licence

MIT. Copyright (c) 2026 Srisaa Technologies (OPC) Private Limited.

## Credits

Created and maintained by Srisaa Technologies (OPC) Private Limited.

# Contributing

Thanks for helping. Bug reports and pull requests are welcome.

```
npm install
npm run typecheck
npm test
npm run demo      # then open demo/index.html
```

- Keep the library dependency-free (dev dependencies only).
- The pure core (`src/core`) must not touch the DOM. The chart (`src/ui`) must not save anything; it reports edits through callbacks.
- Add a test with every change: core logic in `test/core.test.ts`, drawing in `test/chart.test.ts`.
- Dates are ISO days (`2026-11-05`); a task end is its last working day.
- Open an issue before a large change.

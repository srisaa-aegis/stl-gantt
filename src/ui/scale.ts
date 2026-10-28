import { weekdayOf } from '../core';
import type { Zoom } from './options';

/** Pixels per day at each zoom level */
export const DAY_WIDTH: Record<Zoom, number> = { day: 32, week: 14, month: 4.5, quarter: 1.6 };

export interface Segment { label: string; from: number; to: number } // from/to are day numbers, both included

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MS = 86_400_000;

const ymd = (day: number): { y: number; m: number; d: number } => {
  const t = new Date(day * MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
};
const dayOfYmd = (y: number, m: number, d: number): number => Math.floor(Date.UTC(y, m, d) / MS);

/** The two rows of the date scale for a range of days */
export function scaleSegments(zoom: Zoom, from: number, to: number): { top: Segment[]; bottom: Segment[] } {
  const top: Segment[] = [];
  const bottom: Segment[] = [];

  const monthSegments = (label: (y: number, m: number) => string, into: Segment[]): void => {
    let { y, m } = ymd(from);
    for (;;) {
      const s = dayOfYmd(y, m, 1);
      if (s > to) break;
      const e = dayOfYmd(y, m + 1, 1) - 1;
      into.push({ label: label(y, m), from: Math.max(s, from), to: Math.min(e, to) });
      m++;
      if (m > 11) { m = 0; y++; }
    }
  };
  const yearSegments = (into: Segment[]): void => {
    for (let y = ymd(from).y; dayOfYmd(y, 0, 1) <= to; y++) {
      into.push({ label: String(y), from: Math.max(dayOfYmd(y, 0, 1), from), to: Math.min(dayOfYmd(y + 1, 0, 1) - 1, to) });
    }
  };

  if (zoom === 'day') {
    monthSegments((y, m) => `${MONTHS[m]} ${y}`, top);
    for (let d = from; d <= to; d++) bottom.push({ label: String(ymd(d).d), from: d, to: d });
  } else if (zoom === 'week') {
    monthSegments((y, m) => `${MONTHS[m]} ${y}`, top);
    // weeks start on Monday
    let d = from - ((weekdayOf(from) + 6) % 7);
    for (; d <= to; d += 7) bottom.push({ label: String(ymd(d).d), from: Math.max(d, from), to: Math.min(d + 6, to) });
  } else if (zoom === 'month') {
    yearSegments(top);
    monthSegments((_y, m) => MONTHS[m] as string, bottom);
  } else {
    yearSegments(top);
    let { y, m } = ymd(from);
    m = Math.floor(m / 3) * 3;
    for (;;) {
      const s = dayOfYmd(y, m, 1);
      if (s > to) break;
      const e = dayOfYmd(y, m + 3, 1) - 1;
      bottom.push({ label: `Q${m / 3 + 1}`, from: Math.max(s, from), to: Math.min(e, to) });
      m += 3;
      if (m > 11) { m = 0; y++; }
    }
  }
  return { top, bottom };
}

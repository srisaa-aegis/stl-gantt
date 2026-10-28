import { dayNum, isoOf, weekdayOf } from './dates';
import type { IsoDate } from './types';

export interface CalendarSpec {
  /** Seven 0/1 characters, Monday first: "1111100" is Monday to Friday (the default) */
  workingDays?: string;
  /** Days nobody works, on top of the weekly days off */
  holidays?: readonly IsoDate[];
}

const DEFAULT_MASK = '1111100';

/**
 * Which days are worked. Working days are numbered 1, 2, 3 ... from 1970-01-01, so schedule arithmetic ("three working
 * days after this one") is plain integer arithmetic on those numbers: `ord` gives a day's number, `dayAt` the reverse.
 */
export class WorkCalendar {
  private readonly worked: boolean[]; // index = weekday, Sunday = 0
  private readonly perWeek: number;
  private readonly holidays: number[]; // sorted, only days that would otherwise be worked

  constructor(spec: CalendarSpec = {}) {
    let mask = spec.workingDays && /^[01]{7}$/.test(spec.workingDays) ? spec.workingDays : DEFAULT_MASK;
    if (!mask.includes('1')) mask = DEFAULT_MASK; // a calendar with no working day cannot schedule anything
    this.worked = Array.from({ length: 7 }, (_, wd) => mask[(wd + 6) % 7] === '1');
    this.perWeek = this.worked.filter(Boolean).length;
    const set = new Set<number>();
    for (const h of spec.holidays ?? []) {
      const d = dayNum(h);
      if (this.worked[weekdayOf(d)]) set.add(d);
    }
    this.holidays = [...set].sort((a, b) => a - b);
  }

  isWorking(day: number): boolean {
    return this.worked[weekdayOf(day)] === true && !this.isHoliday(day);
  }

  isHoliday(day: number): boolean {
    let lo = 0;
    let hi = this.holidays.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = this.holidays[mid] as number;
      if (v === day) return true;
      if (v < day) lo = mid + 1; else hi = mid - 1;
    }
    return false;
  }

  /** How many working days fall on or before `day` (0 or more) */
  ord(day: number): number {
    if (day < 0) return 0;
    const weeks = Math.floor((day + 1) / 7);
    let n = weeks * this.perWeek;
    for (let d = weeks * 7; d <= day; d++) if (this.worked[weekdayOf(d)]) n++;
    let lo = 0;
    let hi = this.holidays.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.holidays[mid] as number) <= day) lo = mid + 1; else hi = mid;
    }
    return n - lo;
  }

  /** The k-th working day (k >= 1) */
  dayAt(k: number): number {
    const target = Math.max(1, k);
    let lo = 0;
    let hi = Math.ceil(target / this.perWeek) * 7 + (this.holidays.length + 1) * 7 + 7;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ord(mid) >= target) hi = mid; else lo = mid + 1;
    }
    return lo;
  }

  /** The day itself if worked, else the next working day */
  snapForward(day: number): number {
    return this.isWorking(day) ? day : this.dayAt(this.ord(day) + 1);
  }

  /** The day itself if worked, else the previous working day */
  snapBack(day: number): number {
    return this.isWorking(day) ? day : this.dayAt(Math.max(1, this.ord(day)));
  }

  /** Working days from `start` to `end`, both counted (at least 1) */
  duration(startIso: IsoDate, endIso: IsoDate): number {
    const s = this.ord(this.snapForward(dayNum(startIso)));
    const e = this.ord(this.snapBack(dayNum(endIso)));
    return Math.max(1, e - s + 1);
  }

  /** Last day of a task that starts on `startIso` (moved to a working day) and takes `duration` working days */
  finish(startIso: IsoDate, duration: number): IsoDate {
    const s = this.ord(this.snapForward(dayNum(startIso)));
    return isoOf(this.dayAt(s + Math.max(1, duration) - 1));
  }

  /** The first day of a task that finishes on `endIso` and takes `duration` working days */
  startFor(endIso: IsoDate, duration: number): IsoDate {
    const e = this.ord(this.snapBack(dayNum(endIso)));
    return isoOf(this.dayAt(e - Math.max(1, duration) + 1));
  }

  /** The working day `n` working days after (or before, n < 0) `iso`, which is first moved to a working day */
  shift(iso: IsoDate, n: number): IsoDate {
    return isoOf(this.dayAt(this.ord(this.snapForward(dayNum(iso))) + n));
  }

  workingOnOrAfter(iso: IsoDate): IsoDate { return isoOf(this.snapForward(dayNum(iso))); }

  workingOnOrBefore(iso: IsoDate): IsoDate { return isoOf(this.snapBack(dayNum(iso))); }
}

// Hours and money. Rules (from the spec):
// - Only closed shifts count. Each shift = check_out - check_in, rounded per settings.
// - Day total = sum of shifts minus that day's break (override, else employee default), never below 0.
// - Pay = day minutes / 60 x the hourly rate valid on that date. Rounded to whole dram per period.
import { q } from '../db.js';
import { rateOn } from './employees.js';
import { daysBetween } from '../time.js';

export function shiftMinutes(s, rounding = 0) {
  if (!s.check_out) return 0;
  const raw = Math.max(0, (new Date(s.check_out) - new Date(s.check_in)) / 60000);
  const m = Math.round(raw);
  if (!rounding) return m;
  return Math.round(m / rounding) * rounding;
}

/**
 * Summaries for many employees over a date range.
 * Returns Map(employeeId -> { days: {date: day}, minutes, earned, flags })
 */
export async function summarize(employees, start, end, settings) {
  const ids = employees.map((e) => e.id);
  const out = new Map();
  if (!ids.length) return out;
  const [shifts, breaks, rates] = await Promise.all([
    q(`SELECT * FROM shifts WHERE employee_id = ANY($1) AND work_date BETWEEN $2 AND $3
       ORDER BY check_in`, [ids, start, end]),
    q(`SELECT * FROM day_breaks WHERE employee_id = ANY($1) AND work_date BETWEEN $2 AND $3`, [ids, start, end]),
    q(`SELECT * FROM rates WHERE employee_id = ANY($1) ORDER BY effective_from DESC`, [ids]),
  ]);
  const dates = daysBetween(start, end);
  for (const e of employees) {
    const days = {};
    for (const d of dates) days[d] = { date: d, shifts: [], gross: 0, breakMin: 0, minutes: 0, earned: 0, rate: 0 };
    out.set(e.id, { employee: e, days, minutes: 0, earned: 0, rates: rates.filter((r) => r.employee_id === e.id),
      flags: { pending: 0, open: 0, review: 0, edited: 0, late: 0, outside: 0 } });
  }
  for (const s of shifts) {
    const sum = out.get(s.employee_id); const day = sum.days[s.work_date];
    if (!day) continue;
    day.shifts.push(s);
    day.gross += shiftMinutes(s, settings.rounding);
    if (s.needs_approval) sum.flags.pending++;
    if (s.status === 'open') sum.flags.open++;
    if (s.status === 'review') sum.flags.review++;
    if (s.edited) sum.flags.edited++;
    if (s.late) sum.flags.late++;
    if (s.out_of_window) sum.flags.outside++;
  }
  const overrides = new Map(breaks.map((b) => [`${b.employee_id}|${b.work_date}`, b.break_min]));
  for (const sum of out.values()) {
    let earned = 0;
    for (const day of Object.values(sum.days)) {
      const key = `${sum.employee.id}|${day.date}`;
      day.breakOverride = overrides.has(key) ? overrides.get(key) : null;
      if (day.gross > 0) {
        day.breakMin = day.breakOverride ?? sum.employee.break_min ?? 0;
        day.minutes = Math.max(0, day.gross - day.breakMin);
      }
      day.rate = rateOn(sum.rates, day.date);
      day.earned = (day.minutes / 60) * day.rate;
      sum.minutes += day.minutes;
      earned += day.earned;
    }
    sum.earned = Math.round(earned);
  }
  return out;
}

export async function summarizeOne(employee, start, end, settings) {
  return (await summarize([employee], start, end, settings)).get(employee.id);
}

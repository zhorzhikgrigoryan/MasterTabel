// Numbers for the Analytics page. Everything is derived from shifts, breaks and rates via summarize().
import { listEmployees } from './employees.js';
import { summarize } from './calc.js';
import { daysBetween, weekday, minutesOfDay, addDays, dayDiff, monthStart, monthEnd, shiftPeriod } from '../time.js';

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export async function analytics(start, end, settings) {
  const emps = await listEmployees({ includeInactive: true });
  const len = dayDiff(start, end) + 1;
  const prevEnd = addDays(start, -1); const prevStart = addDays(prevEnd, -(len - 1));
  const trendStart = shiftPeriod('monthly', monthStart(end), -5).start; const trendEnd = monthEnd(end);
  const [cur, prev, trend] = await Promise.all([
    summarize(emps, start, end, settings),
    summarize(emps, prevStart, prevEnd, settings),
    summarize(emps, trendStart, trendEnd, settings),
  ]);

  const dates = daysBetween(start, end);
  const daily = Object.fromEntries(dates.map((d) => [d, { date: d, minutes: 0, cost: 0, people: 0 }]));
  const byWeekday = Array.from({ length: 7 }, (_, i) => ({ wd: i + 1, minutes: 0, days: 0 }));
  const people = [];
  const totals = { minutes: 0, cost: 0, late: 0, requests: 0, review: 0, edited: 0, workdays: 0 };

  for (const sum of cur.values()) {
    const e = sum.employee;
    const row = { employee: e, minutes: 0, cost: 0, days: 0, late: 0, requests: 0, review: 0, edited: 0, ins: [], outs: [] };
    for (const day of Object.values(sum.days)) {
      if (!day.shifts.length) continue;
      const dd = daily[day.date];
      dd.minutes += day.minutes; dd.cost += day.earned; if (day.minutes > 0) dd.people += 1;
      if (day.minutes > 0) {
        row.days += 1;
        row.ins.push(minutesOfDay(new Date(day.shifts[0].check_in)));
        const last = day.shifts.at(-1);
        if (last.check_out) row.outs.push(minutesOfDay(new Date(last.check_out)));
      }
      row.minutes += day.minutes; row.cost += day.earned;
      for (const s of day.shifts) {
        if (s.late) row.late += 1;
        if (s.in_source === 'request' || s.out_source === 'request') row.requests += 1;
        if (s.status === 'review') row.review += 1;
        if (s.edited) row.edited += 1;
      }
    }
    if (!row.days && !row.review && e.status === 'deactivated') continue;
    row.cost = Math.round(row.cost);
    row.avgIn = avg(row.ins); row.avgOut = avg(row.outs);
    row.avgDay = row.days ? row.minutes / row.days : 0;
    for (const k of ['minutes', 'cost', 'late', 'requests', 'review', 'edited']) totals[k] += row[k];
    totals.workdays += row.days;
    people.push(row);
  }
  for (const d of Object.values(daily)) {
    const w = byWeekday[weekday(d.date) - 1];
    w.minutes += d.minutes; w.days += 1;
    d.cost = Math.round(d.cost);
  }
  people.sort((a, b) => b.minutes - a.minutes);

  let prevMinutes = 0; let prevCost = 0;
  for (const sum of prev.values()) { prevMinutes += sum.minutes; prevCost += sum.earned; }

  const months = [];
  for (let m = trendStart; m <= trendEnd; m = shiftPeriod('monthly', m, 1).start) months.push({ month: m, minutes: 0, cost: 0 });
  for (const sum of trend.values()) {
    for (const day of Object.values(sum.days)) {
      const mo = months.find((x) => x.month === monthStart(day.date));
      if (mo) { mo.minutes += day.minutes; mo.cost += day.earned; }
    }
  }
  months.forEach((m) => { m.cost = Math.round(m.cost); });

  return {
    start, end, len, prevStart, prevEnd,
    totals: { ...totals, cost: Math.round(totals.cost), avgDay: totals.workdays ? totals.minutes / totals.workdays : 0, activePeople: people.filter((p) => p.days).length },
    prev: { minutes: prevMinutes, cost: Math.round(prevCost) },
    daily: Object.values(daily),
    weekdays: byWeekday.map((w) => ({ ...w, avg: w.days ? w.minutes / w.days : 0 })),
    people, months,
  };
}

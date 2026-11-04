// Runs every minute: sends reminders and moves forgotten shifts to "Needs review".
import { q } from './db.js';
import { getSettings } from './core/settings.js';
import { markReview } from './core/shifts.js';
import { dateOf, minutesOfDay, weekday, hmToMin } from './time.js';

export async function tick(send, now = new Date()) {
  const st = await getSettings();
  await markReview(st, now);
  const date = dateOf(now); const nowMin = minutesOfDay(now); const wd = weekday(date);
  const emps = await q(
    `SELECT e.*,
       (SELECT count(*) FROM shifts s WHERE s.employee_id=e.id AND s.work_date=$1)::int AS shifts_today,
       (SELECT count(*) FROM shifts s WHERE s.employee_id=e.id AND s.work_date=$1 AND s.status='open')::int AS open_today
     FROM employees e
     WHERE e.status='active' AND e.telegram_id IS NOT NULL AND $2 = ANY(e.sched_days)
       AND e.sched_start IS NOT NULL AND e.sched_end IS NOT NULL`,
    [date, wd],
  );
  const sent = [];
  for (const e of emps) {
    const start = hmToMin(e.sched_start); const end = hmToMin(e.sched_end);
    const inAfter = e.remind_in_after ?? st.remind_in_after;
    const again = e.remind_out_again ?? st.remind_out_again;
    const due = [];
    if (e.shifts_today === 0 && nowMin >= start + inAfter && nowMin < end) due.push('in');
    if (e.open_today > 0 && nowMin >= end) due.push('out');
    if (e.open_today > 0 && nowMin >= end + again) due.push('out2');
    for (const kind of due) {
      const ins = await q(
        `INSERT INTO reminders_sent (employee_id, work_date, kind) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING RETURNING kind`, [e.id, date, kind]);
      if (!ins.length) continue;
      // "out" and "out2" both due at once (e.g. after a restart) -> send only the latest.
      if (kind === 'out' && due.includes('out2')) continue;
      try { await send(e, kind); sent.push([e.id, kind]); } catch (err) { console.error('reminder', e.id, kind, err.message); }
    }
  }
  return sent;
}

export function startScheduler(send) {
  const run = () => tick(send).catch((e) => console.error('scheduler', e.message));
  run();
  return setInterval(run, 60 * 1000);
}

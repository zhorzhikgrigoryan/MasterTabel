// Fills the local database with sample employees and shifts (for trying the panel locally).
import { connect, close, q } from '../src/db.js';
import { getSettings, setSetting } from '../src/core/settings.js';
import * as E from '../src/core/employees.js';
import * as S from '../src/core/shifts.js';
import { at, today, addDays, weekday, dateOf } from '../src/time.js';

await connect();
const st = await getSettings();
const people = [
  ['Աննա Հակոբյան', '+374 91 111111', 2200, 60, 'monthly', '09:00', '18:00'],
  ['Դավիթ Սարգսյան', '+374 93 222222', 1800, 30, 'weekly', '08:00', '16:00'],
  ['Լիլիթ Պետրոսյան', '+374 94 333333', 2500, 60, 'monthly', '10:00', '19:00'],
  ['Գոռ Մանուկյան', '+374 77 444444', 1600, 30, 'weekly', '07:00', '15:00'],
  ['Մանե Ավետիսյան', '+374 98 555555', 2000, 45, 'monthly', '09:00', '17:00'],
  ['Նարեկ Գրիգորյան', '+374 55 666666', 1900, 60, 'monthly', '12:00', '21:00'],
];
const td = today();
const emps = [];
for (const [name, phone, rate, brk, cycle, s, e] of people) {
  const emp = await E.createEmployee({ full_name: name, phone, hourly_amd: rate, rate_from: addDays(td, -60), break_min: brk,
    pay_cycle: cycle, sched_days: [1, 2, 3, 4, 5, 6], sched_start: s, sched_end: e });
  await q(`UPDATE employees SET status='active', telegram_id=$2 WHERE id=$1`, [emp.id, 1000 + emp.id]);
  emps.push({ ...emp, status: 'active', sched_start: s, sched_end: e });
}
await q(`UPDATE employees SET status='invited', telegram_id=NULL WHERE id=$1`, [emps[5].id]);

const jitter = (n) => Math.round((Math.sin(n * 12.9898) * 43758.5453 % 1) * 20) - 10;
const plus = (hmS, m) => { const [h, mi] = hmS.split(':').map(Number); const t = h * 60 + mi + m; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
for (let back = 40; back >= 1; back--) {
  const d = addDays(td, -back);
  if (weekday(d) === 7) continue;
  for (const [i, e] of emps.entries()) {
    if (i === 5) continue;
    if ((back + i) % 9 === 0) continue; // day off
    const inT = plus(e.sched_start, jitter(back * 7 + i));
    const outT = plus(e.sched_end, jitter(back * 3 + i * 5));
    await S.checkIn(e, st, at(d, inT));
    await S.checkOut(e, st, at(d, outT));
  }
}
// Today: two working, one finished early, one forgot to check in (request)
const nowHM = (d) => `${String(d.getUTCHours() + 4).padStart(2, '0')}`;
await S.checkIn(emps[0], st, at(td, '09:07'));
await S.checkIn(emps[1], st, at(td, '08:14'));
await S.adminCreate(emps[2], td, '07:30', '11:00', null, st);
await S.requestIn(emps[3], '07:05', st, at(td, '12:00'));
// Yesterday: one forgot to check out -> review
const y = addDays(td, -1) ; const yy = weekday(y) === 7 ? addDays(y, -1) : y;
await q(`UPDATE shifts SET check_out=NULL, status='review' WHERE id = (SELECT id FROM shifts WHERE employee_id=$1 AND work_date=$2 LIMIT 1)`, [emps[4].id, yy]);
// An owner edit with a reason
const s1 = (await q(`SELECT * FROM shifts WHERE employee_id=$1 AND work_date=$2`, [emps[0].id, addDays(td, -2)]))[0];
if (s1) await S.adminUpdate(emps[0], s1.id, '09:00', '18:30', 'Մնացել է գույքագրման համար', st);
await setSetting('owner', { telegram_id: '1', name: 'Dev' });
console.log('Demo data ready:', emps.length, 'employees');
await close();

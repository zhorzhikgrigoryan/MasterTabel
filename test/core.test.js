import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect, close, q } from '../src/db.js';
import { getSettings, setSetting } from '../src/core/settings.js';
import * as E from '../src/core/employees.js';
import * as S from '../src/core/shifts.js';
import * as P from '../src/core/payroll.js';
import { summarizeOne } from '../src/core/calc.js';
import { at, periodOf, shiftPeriod, parseHM, dateOf, hm } from '../src/time.js';

let settings;
before(async () => { await connect({ memory: true }); settings = await getSettings(); });
after(async () => { await close(); });

test('time helpers', () => {
  assert.equal(parseHM('9:05'), '09:05');
  assert.equal(parseHM('0930'), '09:30');
  assert.equal(parseHM('25:00'), null);
  assert.deepEqual(periodOf('weekly', '2026-11-04'), { start: '2026-11-02', end: '2026-11-08' });
  assert.deepEqual(periodOf('monthly', '2026-02-10'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(shiftPeriod('monthly', '2026-01-01', -1), { start: '2025-12-01', end: '2025-12-31' });
  assert.equal(dateOf(new Date('2026-11-04T21:30:00Z')), '2026-11-05'); // 01:30 in Yerevan
  assert.equal(hm(at('2026-11-04', '09:15')), '09:15');
});

test('phone matching', () => {
  assert.ok(E.samePhone('+374 91 123456', '37491123456'));
  assert.ok(E.samePhone('091 12-34-56', '+37491123456'));
  assert.ok(!E.samePhone('+37491123456', '+37491123457'));
});

test('employee, rates, check in/out, break, pay', async () => {
  const emp = await E.createEmployee({ full_name: 'Anna', phone: '+37491000001', break_min: 60,
    hourly_amd: 2000, rate_from: '2026-11-01', sched_days: [1, 2, 3, 4, 5], sched_start: '09:00', sched_end: '18:00' });
  const d = '2026-11-03';
  // Tap at 09:12 (late) and out at 18:00 -> 8h48 gross, -60 break = 7h48 = 468 min
  const s = await S.checkIn(emp, settings, at(d, '09:12'));
  assert.equal(s.late, true);
  await assert.rejects(S.checkIn(emp, settings, at(d, '09:20')), /already_in/);
  await S.checkOut(emp, settings, at(d, '18:00'));
  await assert.rejects(S.checkOut(emp, settings, at(d, '18:05')), /not_in/);
  let sum = await summarizeOne(emp, d, d, settings);
  assert.equal(sum.days[d].minutes, 468);
  assert.equal(sum.earned, Math.round(468 / 60 * 2000)); // 15600

  // Second shift same day 20:00-21:00: break is per day, not per shift
  await S.checkIn(emp, settings, at(d, '20:00'));
  await S.checkOut(emp, settings, at(d, '21:00'));
  sum = await summarizeOne(emp, d, d, settings);
  assert.equal(sum.days[d].minutes, 528);

  // Day override: no break today
  await S.setDayBreak(emp, d, 0, 'no lunch');
  sum = await summarizeOne(emp, d, d, settings);
  assert.equal(sum.days[d].minutes, 588);
});

test('rate change applies from its date onward only', async () => {
  const emp = await E.createEmployee({ full_name: 'Davit', phone: '+37491000002', hourly_amd: 1000, rate_from: '2026-10-01' });
  await E.setRate(emp.id, 1500, '2026-10-16');
  for (const d of ['2026-10-15', '2026-10-16']) {
    await S.adminCreate(emp, d, '10:00', '12:00', null, settings);
  }
  const sum = await summarizeOne(emp, '2026-10-01', '2026-10-31', settings);
  assert.equal(sum.earned, 2 * 1000 + 2 * 1500);
});

test('forgot requests are flagged; open shift goes to review', async () => {
  const emp = await E.createEmployee({ full_name: 'Gor', phone: '+37491000003', hourly_amd: 1000 });
  const d = '2026-11-02';
  const now = at(d, '11:00');
  const s = await S.requestIn(emp, '09:00', settings, now);
  assert.equal(s.needs_approval, true);
  await assert.rejects(S.requestIn(emp, '09:30', settings, now), /already_in/);
  // Never checks out; end of window -> review
  const reviewed = await S.markReview(settings, at(d, '23:59'));
  assert.ok(reviewed.some((r) => r.id === s.id));
  // Next day he says he left at 17:30
  const closed = await S.requestOut(emp, '17:30', settings, at('2026-11-03', '08:00'));
  assert.equal(closed.status, 'closed');
  assert.equal(hm(closed.check_out), '17:30');
  await assert.rejects(S.requestIn(emp, '12:00', settings, at(d, '11:00')), /future/);
  // Owner approves
  await S.approve(emp, s.id);
  const after = await S.getShift(s.id);
  assert.equal(after.needs_approval, false);
});

test('owner edit is logged; payroll locks and records only the difference', async () => {
  const emp = await E.createEmployee({ full_name: 'Lilit', phone: '+37491000004', hourly_amd: 1000, rate_from: '2026-09-01' });
  const { start, end } = periodOf('monthly', '2026-09-10');
  const s = await S.adminCreate(emp, '2026-09-10', '09:00', '17:00', null, settings); // 8h = 8000
  await P.addAdjustment(emp.id, start, end, 'bonus', 2000, 'good month');
  await P.addAdjustment(emp.id, start, end, 'advance', 3000, 'mid-month');
  let p = await P.periodSummary(emp, start, end, settings);
  assert.equal(p.balance, 8000 + 2000 - 3000);
  const paid = await P.markPaid(emp, start, end, settings);
  assert.equal(paid, 7000);
  p = await P.periodSummary(emp, start, end, settings);
  assert.equal(p.locked, true);
  assert.equal(p.balance, 0);
  await assert.rejects(S.adminUpdate(emp, s.id, '09:00', '18:00', 'stayed late', settings), /locked/);
  await P.unlock(emp.id, start, end);
  await S.adminUpdate(emp, s.id, '09:00', '18:00', 'stayed late', settings);
  const hist = await S.history(emp.id, '2026-09-10');
  assert.ok(hist.some((h) => h.field === 'check_out' && h.old_value === '17:00' && h.new_value === '18:00'));
  p = await P.periodSummary(emp, start, end, settings);
  assert.equal(p.balance, 1000);
  assert.equal(await P.markPaid(emp, start, end, settings), 1000);
});

test('rounding setting', async () => {
  await setSetting('rounding', 15);
  const st = await getSettings();
  const emp = await E.createEmployee({ full_name: 'Narek', phone: '+37491000005', hourly_amd: 1000 });
  await S.adminCreate(emp, '2026-08-05', '09:03', '17:11', null, st); // 488 min -> 495 (nearest 15)
  const sum = await summarizeOne(emp, '2026-08-05', '2026-08-05', st);
  assert.equal(sum.minutes, 495);
  await setSetting('rounding', 0);
});

test('invite join requires matching phone', async () => {
  const emp = await E.createEmployee({ full_name: 'Mane', phone: '091 55 66 77' });
  const bad = await E.linkTelegram(emp.invite_token, 111, '+37491556678', 'mane');
  assert.equal(bad.error, 'phone');
  const ok = await E.linkTelegram(emp.invite_token, 111, '+37491556677', 'mane');
  assert.equal(ok.employee.status, 'active');
  const rows = await q('SELECT telegram_id FROM employees WHERE id=$1', [emp.id]);
  assert.equal(rows[0].telegram_id, '111');
});

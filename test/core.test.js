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

test('amounts in words', async () => {
  const { amountInWords } = await import('../src/documents/words.js');
  assert.equal(amountInWords(55267), 'Հիսունհինգ հազար երկու հարյուր վաթսունյոթ դրամ');
  assert.equal(amountInWords(424123), 'Չորս հարյուր քսանչորս հազար հարյուր քսաներեք դրամ');
  assert.equal(amountInWords(1000), 'Հազար դրամ');
  assert.equal(amountInWords(110010), 'Հարյուր տասը հազար տասը դրամ');
  assert.equal(amountInWords(2015000), 'Երկու միլիոն տասնհինգ հազար դրամ');
  assert.equal(amountInWords(0), 'Զրո դրամ');
  assert.equal(amountInWords(95250, 'en'), 'Ninety-five thousand two hundred fifty drams');
});

test('receipt PDF and payroll Excel are generated', async () => {
  const { receiptsPdf, receiptAmount } = await import('../src/documents/receipt.js');
  const { payrollXlsx } = await import('../src/export.js');
  const ExcelJS = (await import('exceljs')).default;
  const emp = await E.createEmployee({ full_name: 'Արամ Թեստ', phone: '+37491000099', hourly_amd: 2000, rate_from: '2026-07-01', pay_cycle: 'weekly' });
  await S.adminCreate(emp, '2026-07-06', '09:00', '17:00', null, settings); // 8h -> 16000
  const { start, end } = periodOf('weekly', '2026-07-06');
  await P.addAdjustment(emp.id, start, end, 'advance', 6000, null);
  const p = await P.periodSummary(emp, start, end, settings);
  assert.equal(receiptAmount(p), 10000);
  const pdf = await receiptsPdf([p], { lang: 'hy', business: 'Test' });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  await P.markPaid(emp, start, end, settings);
  assert.equal(receiptAmount(await P.periodSummary(emp, start, end, settings)), 10000); // reprint after payment
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await payrollXlsx('weekly', start, end, settings, {}, 'hy'));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Ամփոփում', 'Տաբել', 'Աշխատակիցներ', 'Լրացումներ']);
  const row = wb.getWorksheet('Ամփոփում').getRow(5);
  assert.equal(row.getCell(2).value, 'Արամ Թեստ');
  assert.equal(row.getCell(6).value, 16000);
  assert.match(row.getCell(11).value.formula, /^F5\+N\(G5\)/); // payable is a live formula
  assert.equal(row.getCell(10).value, 10000); // already paid
});

test('weekly presets and overlapping payment guard', async () => {
  const { presetRange, detectPreset } = await import('../src/time.js');
  assert.deepEqual(presetRange('sat_fri', '2026-11-06'), { start: '2026-10-31', end: '2026-11-06' });
  assert.deepEqual(presetRange('mon_fri', '2026-11-06'), { start: '2026-11-02', end: '2026-11-06' });
  assert.equal(detectPreset('2026-11-02', '2026-11-08'), 'mon_sun');
  assert.equal(detectPreset('2026-11-03', '2026-11-05'), null);
  const emp = await E.createEmployee({ full_name: 'Overlap', phone: '+37491000098', hourly_amd: 1000, rate_from: '2026-06-01', pay_cycle: 'weekly' });
  await S.adminCreate(emp, '2026-06-05', '09:00', '10:00', null, settings);
  await P.markPaid(emp, '2026-05-30', '2026-06-05', settings); // Sat–Fri
  const p = await P.periodSummary(emp, '2026-06-01', '2026-06-07', settings); // Mon–Sun shares days
  assert.equal(p.overlap.length, 1);
  await assert.rejects(P.markPaid(emp, '2026-06-01', '2026-06-07', settings), /overlap/);
});

test('analytics totals match the timesheet', async () => {
  const { analytics } = await import('../src/core/analytics.js');
  const emp = await E.createEmployee({ full_name: 'Stats', phone: '+37491000097', hourly_amd: 1200, rate_from: '2025-01-01', sched_days: [1, 2, 3, 4, 5], sched_start: '09:00', sched_end: '18:00' });
  await S.checkIn(emp, settings, at('2025-02-03', '09:30')); await S.checkOut(emp, settings, at('2025-02-03', '17:30')); // late, 8h
  await S.adminCreate(emp, '2025-02-04', '09:00', '13:00', null, settings); // 4h
  const a = await analytics('2025-02-01', '2025-02-28', settings);
  const row = a.people.find((p) => p.employee.id === emp.id);
  assert.equal(row.minutes, 720); assert.equal(row.days, 2); assert.equal(row.late, 1); assert.equal(row.cost, 14400);
  assert.equal(a.daily.length, 28);
  assert.equal(a.weekdays[0].minutes, 480); // Monday
  assert.equal(a.months.at(-1).month, '2025-02-01');
});

test('hourly rates keep decimals and accept a comma', async () => {
  const { fmtRate } = await import('../src/time.js');
  assert.equal(E.parseRate('1692,20'), 1692.2);
  assert.equal(E.parseRate('1 692.5'), 1692.5);
  assert.ok(Number.isNaN(E.parseRate('abc')));
  assert.ok(Number.isNaN(E.parseRate('1692,205')));
  assert.equal(fmtRate(1692.2), '1 692,20 ֏');
  assert.equal(fmtRate(1600), '1 600 ֏');
  const emp = await E.createEmployee({ full_name: 'Decimal', phone: '+37491000096', hourly_amd: '1692,20', rate_from: '2025-03-01' });
  const [r] = await E.listRates(emp.id);
  assert.equal(r.hourly_amd, 1692.2);
  await S.adminCreate(emp, '2025-03-03', '09:00', '19:00', null, settings); // 10h
  const sum = await summarizeOne(emp, '2025-03-03', '2025-03-03', settings);
  assert.equal(sum.earned, 16922);
});

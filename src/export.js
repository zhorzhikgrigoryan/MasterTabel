// Excel exports for the accountant.
import ExcelJS from 'exceljs';
import { listEmployees } from './core/employees.js';
import { summarize } from './core/calc.js';
import { periodSummary } from './core/payroll.js';
import { daysBetween, weekday, hm } from './time.js';

const INK = 'FF1F3A93';
const head = (row) => {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
  row.alignment = { vertical: 'middle' };
};
const hours = (min) => Math.round((min / 60) * 100) / 100;

export async function timesheetXlsx(start, end, settings, L) {
  const emps = await listEmployees({ includeInactive: true });
  const sums = await summarize(emps, start, end, settings);
  const days = daysBetween(start, end);
  const wb = new ExcelJS.Workbook();

  // Sheet 1: grid of hours
  const ws = wb.addWorksheet(L.nav_timesheet);
  ws.addRow([L.employee, ...days.map((d) => `${L.weekdays[weekday(d) - 1]} ${d.slice(8)}.${d.slice(5, 7)}`), `${L.total}, ${L.hours}`, `${L.amount}, ֏`]);
  head(ws.getRow(1));
  for (const e of emps) {
    const s = sums.get(e.id);
    if (!s.minutes && e.status === 'deactivated') continue;
    ws.addRow([e.full_name, ...days.map((d) => (s.days[d].minutes ? hours(s.days[d].minutes) : null)), hours(s.minutes), s.earned]);
  }
  ws.getColumn(1).width = 24;
  for (let i = 2; i <= days.length + 3; i++) { ws.getColumn(i).width = i > days.length + 1 ? 14 : 9; ws.getColumn(i).numFmt = '0.00'; }
  ws.getColumn(days.length + 3).numFmt = '#,##0';
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];

  // Sheet 2: every shift
  const ds = wb.addWorksheet(L.shifts);
  ds.addRow([L.employee, 'Date', L.check_in, L.check_out, L.minus_break, `${L.day_total}, ${L.hours}`, `${L.amount}, ֏`]);
  head(ds.getRow(1));
  for (const e of emps) {
    const s = sums.get(e.id);
    for (const d of days) {
      const day = s.days[d];
      if (!day.shifts.length) continue;
      ds.addRow([e.full_name, d, day.shifts.map((x) => hm(x.check_in)).join(', '),
        day.shifts.map((x) => (x.check_out ? hm(x.check_out) : '—')).join(', '),
        day.breakMin, hours(day.minutes), Math.round(day.earned)]);
    }
  }
  ds.columns.forEach((c, i) => { c.width = [24, 12, 14, 14, 10, 12, 12][i]; });
  return wb.xlsx.writeBuffer();
}

export async function payrollXlsx(cycle, start, end, settings, L) {
  const emps = (await listEmployees({ includeInactive: true })).filter((e) => e.pay_cycle === cycle);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(L.payroll_title);
  ws.addRow([`${L.payroll_title}: ${start} – ${end}`]);
  ws.getRow(1).font = { bold: true, size: 13 };
  ws.addRow([L.employee, L.hours, `${L.earned}, ֏`, `${L.bonus}, ֏`, `${L.advance}, ֏`, `${L.deduction}, ֏`, `${L.paid}, ֏`, `${L.to_pay}, ֏`, L.status]);
  head(ws.getRow(2));
  for (const e of emps) {
    const p = await periodSummary(e, start, end, settings);
    if (!p.minutes && !p.everPaid && e.status === 'deactivated') continue;
    ws.addRow([e.full_name, hours(p.minutes), p.earned, p.bonus, p.advance, p.deduction, p.paid, p.balance, p.locked ? L.locked : L.not_paid]);
  }
  ws.columns.forEach((c, i) => { c.width = i === 0 ? 24 : 13; if (i >= 2 && i <= 7) c.numFmt = '#,##0'; });
  ws.getColumn(2).numFmt = '0.00';
  return wb.xlsx.writeBuffer();
}

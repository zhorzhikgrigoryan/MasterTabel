// Excel exports for the accountant.
import ExcelJS from 'exceljs';
import { listEmployees } from './core/employees.js';
import { summarize } from './core/calc.js';
import { periodSummary } from './core/payroll.js';
import { daysBetween, weekday, hm } from './time.js';
import { dt, ddmmyyyy } from './documents/texts.js';

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

// Payroll workbook modelled on the owner's own sheet: Summary (with signature column), Timesheet, Employees, Adjustments.
const NAVY = 'FF1F4E78'; const PALE = 'FFF5F9FC'; const BAND = 'FFD9EAF7'; const PAY = 'FFE2EFDA';
const thin = { style: 'thin', color: { argb: 'FFC9D3DD' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const xDate = (d) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))));
const dayFrac = (min) => (min || 0) / 1440;
const minOfDay = (iso) => { const [h, m] = hm(iso).split(':').map(Number); return h * 60 + m; };

function navyHeader(row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = box;
  });
  row.height = 44;
}

export async function payrollXlsx(cycle, start, end, settings, L, lang = 'hy') {
  const D = dt(lang);
  const money = `#,##0 "${D.amd}"`; const rateFmt = `#,##0 "${D.per_hour}"`;
  const emps = (await listEmployees({ includeInactive: true })).filter((e) => e.pay_cycle === cycle);
  const periods = [];
  for (const e of emps) {
    const p = await periodSummary(e, start, end, settings);
    if (e.status === 'deactivated' && !p.minutes && !p.everPaid && !p.adjustments.length) continue;
    periods.push(p);
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MasterTabel';
  wb.calcProperties.fullCalcOnLoad = true; // formulas recalculate when opened

  // ---------- 1. Summary ----------
  const ws = wb.addWorksheet(D.x_summary, { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const heads = [D.x_num, D.employee, D.days_worked, D.hours_worked, D.rate, D.earned, D.bonus, D.advance, D.deduction, D.x_paid, D.to_pay, D.x_status, D.signature];
  const widths = [6, 26, 13, 14, 15, 16, 15, 15, 15, 15, 17, 15, 28];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const last = String.fromCharCode(64 + heads.length);
  ws.mergeCells(`A1:${last}1`);
  ws.getCell('A1').value = cycle === 'weekly' ? D.x_title_weekly : D.x_title_monthly;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;
  ws.getCell('A2').value = D.period; ws.mergeCells('A2:B2');
  ws.getCell('C2').value = `${ddmmyyyy(start)} – ${ddmmyyyy(end)}`; ws.mergeCells('C2:E2');
  if (settings.business_name) { ws.getCell('J2').value = settings.business_name; ws.mergeCells(`J2:${last}2`); ws.getCell('J2').alignment = { horizontal: 'right' }; }
  for (const a of ['A2', 'C2']) ws.getCell(a).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: a === 'A2' ? BAND : 'FFFFF2CC' } };
  ws.getCell('A2').font = { bold: true }; ws.getCell('C2').font = { bold: true };
  ws.addRow([]);
  navyHeader(ws.addRow(heads));
  const first = 5;
  periods.forEach((p, i) => {
    const r = first + i;
    const days = Object.values(p.summary.days).filter((d) => d.minutes > 0).length;
    const rates = [...new Set(Object.values(p.summary.days).filter((d) => d.minutes > 0).map((d) => d.rate))];
    const row = ws.addRow([i + 1, p.employee.full_name, days, dayFrac(p.minutes), rates.length === 1 ? rates[0] : (rates.length ? rates.join(' → ') : null),
      p.earned, p.bonus || null, p.advance || null, p.deduction || null, p.paid || null,
      { formula: `F${r}+N(G${r})-N(H${r})-N(I${r})-N(J${r})`, result: p.balance }, p.locked ? D.x_paid_status : D.x_unpaid, '']);
    row.height = 30;
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.border = box; c.alignment = { vertical: 'middle', horizontal: col === 2 || col === 13 ? 'left' : col === 1 ? 'center' : 'right' };
    });
    row.getCell(4).numFmt = '[h]:mm'; row.getCell(5).numFmt = rateFmt;
    for (const c of [6, 7, 8, 9, 10, 11]) row.getCell(c).numFmt = money;
    row.getCell(11).font = { bold: true };
    row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAY } };
    row.getCell(12).font = { color: { argb: p.locked ? 'FF2E7D4F' : 'FF8A6D00' } };
  });
  const lastData = first + periods.length - 1;
  const sum = (col) => (periods.length ? { formula: `SUM(${col}${first}:${col}${lastData})`, result: 0 } : 0);
  const tot = ws.addRow([null, D.x_total, sum('C'), sum('D'), null, sum('F'), sum('G'), sum('H'), sum('I'), sum('J'), sum('K'), null, null]);
  const totals = { C: periods.reduce((s, p) => s + Object.values(p.summary.days).filter((d) => d.minutes > 0).length, 0),
    D: dayFrac(periods.reduce((s, p) => s + p.minutes, 0)), F: periods.reduce((s, p) => s + p.earned, 0),
    G: periods.reduce((s, p) => s + p.bonus, 0), H: periods.reduce((s, p) => s + p.advance, 0), I: periods.reduce((s, p) => s + p.deduction, 0),
    J: periods.reduce((s, p) => s + p.paid, 0), K: periods.reduce((s, p) => s + p.balance, 0) };
  for (const [col, v] of Object.entries(totals)) if (periods.length) tot.getCell(col).value = { formula: `SUM(${col}${first}:${col}${lastData})`, result: v };
  tot.font = { bold: true }; tot.height = 24;
  tot.eachCell({ includeEmpty: true }, (c, col) => {
    c.border = { top: { style: 'medium', color: { argb: NAVY } }, bottom: thin };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } };
    c.alignment = { vertical: 'middle', horizontal: col === 2 ? 'left' : 'right' };
  });
  tot.getCell(4).numFmt = '[h]:mm';
  for (const c of [6, 7, 8, 9, 10, 11]) tot.getCell(c).numFmt = money;
  ws.addRow([]);
  const note = ws.addRow([D.x_privacy]);
  ws.mergeCells(`A${note.number}:${last}${note.number}`);
  note.getCell(1).font = { italic: true, color: { argb: 'FF5F6B5C' } };
  ws.views = [{ state: 'frozen', ySplit: 4 }];

  // ---------- 2. Timesheet ----------
  const ts = wb.addWorksheet(D.x_timesheet, { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const tHeads = [D.col_date, D.employee, `${D.x_in} 1`, `${D.x_out} 1`, `${D.x_in} 2`, `${D.x_out} 2`, `${D.x_in} 3`, `${D.x_out} 3`,
    D.x_break_min, D.hours_worked, D.rate, D.earned, D.x_note];
  [13, 24, 9, 9, 9, 9, 9, 9, 13, 13, 14, 15, 30].forEach((w, i) => { ts.getColumn(i + 1).width = w; });
  navyHeader(ts.addRow(tHeads));
  const lines = [];
  for (const p of periods) for (const d of Object.values(p.summary.days)) if (d.shifts.length) lines.push({ p, d });
  lines.sort((a, b) => a.d.date.localeCompare(b.d.date) || a.p.employee.full_name.localeCompare(b.p.employee.full_name));
  for (const { p, d } of lines) {
    const times = [];
    d.shifts.slice(0, 3).forEach((s) => { times.push(dayFrac(minOfDay(s.check_in)), s.check_out ? dayFrac(minOfDay(s.check_out)) : null); });
    while (times.length < 6) times.push(null);
    const notes = [];
    if (d.shifts.length > 3) notes.push(`${D.x_more} ${d.shifts.slice(3).map((s) => `${hm(s.check_in)}–${s.check_out ? hm(s.check_out) : '…'}`).join(', ')}`);
    if (d.shifts.some((s) => s.needs_approval)) notes.push(D.x_pending);
    if (d.shifts.some((s) => s.status === 'review')) notes.push(D.x_review);
    if (d.shifts.some((s) => s.edited)) notes.push(D.x_edited);
    const row = ts.addRow([xDate(d.date), p.employee.full_name, ...times, d.gross ? d.breakMin : null, dayFrac(d.minutes), d.rate || null, Math.round(d.earned), notes.join('; ')]);
    row.getCell(1).numFmt = 'dd.mm.yyyy';
    for (let c = 3; c <= 8; c++) row.getCell(c).numFmt = 'hh:mm';
    row.getCell(10).numFmt = '[h]:mm'; row.getCell(11).numFmt = rateFmt; row.getCell(12).numFmt = money;
    row.eachCell({ includeEmpty: true }, (c) => { c.border = box; });
  }
  ts.autoFilter = { from: 'A1', to: 'M1' };
  ts.views = [{ state: 'frozen', ySplit: 1 }];

  // ---------- 3. Employees ----------
  const es = wb.addWorksheet(D.x_employees);
  [6, 26, 18, 16, 20].forEach((w, i) => { es.getColumn(i + 1).width = w; });
  navyHeader(es.addRow([D.x_num, D.employee, D.phone, D.rate, D.x_cycle]));
  periods.forEach((p, i) => {
    const rate = Object.values(p.summary.days).at(-1)?.rate || null;
    const row = es.addRow([i + 1, p.employee.full_name, p.employee.phone, rate, p.employee.pay_cycle === 'weekly' ? D.weekly : D.monthly]);
    row.getCell(4).numFmt = rateFmt;
    row.eachCell({ includeEmpty: true }, (c) => { c.border = box; });
  });

  // ---------- 4. Adjustments (only when there are any) ----------
  const adj = periods.flatMap((p) => p.adjustments.map((a) => ({ p, a })));
  if (adj.length) {
    const as = wb.addWorksheet(D.x_adjustments);
    [26, 16, 16, 40].forEach((w, i) => { as.getColumn(i + 1).width = w; });
    navyHeader(as.addRow([D.employee, D.x_kind, D.x_amount, D.x_comment]));
    for (const { p, a } of adj) {
      const row = as.addRow([p.employee.full_name, D[a.kind], a.kind === 'bonus' ? a.amount_amd : -a.amount_amd, a.comment || '']);
      row.getCell(3).numFmt = money;
      row.eachCell({ includeEmpty: true }, (c) => { c.border = box; });
    }
  }
  return wb.xlsx.writeBuffer();
}

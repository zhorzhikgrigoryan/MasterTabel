// "Ստացական" — printable receipt the employee signs when receiving their pay. One page per employee.
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dt, ddmmyyyy, money } from './texts.js';
import { amountInWords } from './words.js';
import { hm, fmtMin, weekday, today, dateOf } from '../time.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT = (f) => path.join(here, '..', '..', 'fonts', f);

const C = { ink: '#1F3A93', inkSoft: '#E7ECF8', text: '#1A1D21', muted: '#5F6B5C', rule: '#D5DDCF', soft: '#F4F6F1' };
const PAGE = { w: 595.28, h: 841.89, m: 56 };
const W = PAGE.w - PAGE.m * 2;
const INLINE_DAYS_MAX = 9; // weekly receipts keep the day list on the same page

/** What the receipt says was handed over. */
export function receiptAmount(p) {
  return p.balance !== 0 ? p.balance : p.paid;
}

export function receiptNumber(p) {
  return `${p.start.slice(2).replace(/-/g, '')}-${p.employee.id}`;
}

function rateText(p, D) {
  const rates = [...new Set(Object.values(p.summary.days).filter((d) => d.minutes > 0).map((d) => d.rate))];
  if (!rates.length) {
    const last = Object.values(p.summary.days).at(-1);
    return last && last.rate ? `${money(last.rate, D).replace(D.amd, D.per_hour)}` : '—';
  }
  return rates.map((r) => money(r, D).replace(D.amd, D.per_hour)).join(' → ');
}

function workedDays(p) {
  return Object.values(p.summary.days).filter((d) => d.shifts.length);
}

/** Build one PDF with a receipt for each period summary in `items`. */
export function receiptsPdf(items, { lang = 'hy', business = '' } = {}) {
  const D = dt(lang);
  const doc = new PDFDocument({
    size: 'A4', margins: { top: PAGE.m, bottom: PAGE.m, left: PAGE.m, right: PAGE.m }, autoFirstPage: false,
    info: { Title: `${D.receipt}`, Author: business || 'MasterTabel', Creator: 'MasterTabel' },
  });
  doc.registerFont('R', FONT('NotoSansArmenian-Regular.ttf'));
  doc.registerFont('S', FONT('NotoSansArmenian-SemiBold.ttf'));
  doc.registerFont('B', FONT('NotoSansArmenian-Bold.ttf'));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  for (const p of items) drawReceipt(doc, p, D, lang, business);
  if (!items.length) { doc.addPage(); doc.font('R').fontSize(11).fillColor(C.muted).text('—', PAGE.m, PAGE.m); }
  doc.end();
  return done;
}

function line(doc, x1, y, x2, color = C.rule, width = 0.75) {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(color).stroke();
}

function header(doc, p, D, business, issuedDate) {
  const x = PAGE.m; let y = PAGE.m;
  if (business) doc.font('B').fontSize(12).fillColor(C.text).text(business, x, y, { width: W * 0.6, lineBreak: false, ellipsis: true });
  doc.font('R').fontSize(9).fillColor(C.muted)
    .text(`${D.no} ${receiptNumber(p)}`, x, y, { width: W, align: 'right' })
    .text(`${D.issued} ${ddmmyyyy(issuedDate)}`, x, y + 13, { width: W, align: 'right' });
  y += 44;
  line(doc, x, y, x + W, C.ink, 1.5);
  return y;
}

function drawDays(doc, days, D, x, y) {
  const cols = [
    { k: 'date', w: 104, a: 'left' }, { k: 'times', w: 170, a: 'left' }, { k: 'break', w: 62, a: 'right' },
    { k: 'hours', w: 60, a: 'right' }, { k: 'amount', w: W - 396, a: 'right' },
  ];
  const head = { date: D.col_date, times: D.col_times, break: D.col_break, hours: D.col_hours, amount: D.col_amount };
  const row = (vals, font, color, yy) => {
    let cx = x;
    for (const c of cols) {
      doc.font(font).fontSize(9.5).fillColor(color).text(vals[c.k], cx, yy, { width: c.w - 8, align: c.a, lineBreak: false, ellipsis: true });
      cx += c.w;
    }
  };
  row(head, 'S', C.muted, y);
  y += 16; line(doc, x, y, x + W);
  y += 5;
  for (const d of days) {
    const times = d.shifts.map((s) => `${hm(s.check_in)}–${s.check_out ? hm(s.check_out) : '…'}`).join(', ');
    row({
      date: `${ddmmyyyy(d.date).slice(0, 5)}, ${D.weekdays[weekday(d.date) - 1]}`,
      times: times + (d.shifts.some((s) => !s.check_out) ? ` (${D.open_shift})` : ''),
      break: d.breakMin ? `${d.breakMin} ${D.min}` : '—',
      hours: fmtMin(d.minutes), amount: money(d.earned, D),
    }, 'R', C.text, y);
    y += 17;
    line(doc, x, y - 4, x + W, '#EDF0EA', 0.5);
  }
  return y;
}

function drawReceipt(doc, p, D, lang, business) {
  doc.addPage();
  const x = PAGE.m;
  const lastPayment = p.payments.at(-1);
  const issued = p.balance === 0 && lastPayment ? dateOf(lastPayment.paid_at) : today();
  let y = header(doc, p, D, business, issued);

  // Title
  y += 22;
  doc.font('B').fontSize(22).fillColor(C.text).text(D.receipt, x, y, { width: W, align: 'center', characterSpacing: 3 });
  y += 30;
  doc.font('R').fontSize(10.5).fillColor(C.muted).text(D.receipt_sub, x, y, { width: W, align: 'center' });
  y += 30;

  // Who and when
  const info = [
    [D.employee, p.employee.full_name],
    [D.phone, p.employee.phone || '—'],
    [D.period, `${ddmmyyyy(p.start)} – ${ddmmyyyy(p.end)}  (${p.employee.pay_cycle === 'weekly' ? D.weekly : D.monthly})`],
  ];
  for (const [k, v] of info) {
    doc.font('R').fontSize(10).fillColor(C.muted).text(k, x, y + 1, { width: 140, lineBreak: false });
    doc.font(k === D.employee ? 'B' : 'S').fontSize(k === D.employee ? 13 : 11).fillColor(C.text)
      .text(v, x + 140, y - (k === D.employee ? 1 : 0), { width: W - 140, lineBreak: false, ellipsis: true });
    y += 22; line(doc, x, y - 4, x + W);
  }
  y += 14;

  // Day by day (inline for short periods)
  const days = workedDays(p);
  const inlineDays = days.length > 0 && days.length <= INLINE_DAYS_MAX;
  if (inlineDays) {
    doc.font('S').fontSize(10.5).fillColor(C.text).text(D.daily, x, y);
    y += 20;
    y = drawDays(doc, days, D, x, y);
    y += 14;
  }

  // Amounts
  const amount = receiptAmount(p);
  const rows = [
    [D.days_worked, String(days.filter((d) => d.minutes > 0).length)],
    [D.hours_worked, fmtMin(p.minutes)],
    [D.rate, rateText(p, D)],
    [D.earned, money(p.earned, D)],
  ];
  if (p.bonus) rows.push([D.bonus, `+ ${money(p.bonus, D)}`]);
  if (p.advance) rows.push([D.advance, `− ${money(p.advance, D)}`]);
  if (p.deduction) rows.push([D.deduction, `− ${money(p.deduction, D)}`]);
  if (p.balance !== 0 && p.paid) rows.push([D.paid_before, `− ${money(p.paid, D)}`]);
  const colX = x + W * 0.42; const colW = W * 0.58;
  for (const [k, v] of rows) {
    doc.font('R').fontSize(10.5).fillColor(C.muted).text(k, colX, y, { width: colW * 0.55, lineBreak: false });
    doc.font('S').fontSize(10.5).fillColor(C.text).text(v, colX, y, { width: colW, align: 'right', lineBreak: false });
    y += 19; line(doc, colX, y - 5, colX + colW, '#EDF0EA', 0.5);
  }
  y += 4;
  doc.rect(colX - 10, y, colW + 10, 34).fill(C.inkSoft);
  doc.font('B').fontSize(11.5).fillColor(C.text).text(p.balance === 0 && p.paid ? D.paid_amount : D.to_pay, colX, y + 10, { width: colW * 0.5, lineBreak: false });
  doc.font('B').fontSize(16).fillColor(C.ink).text(money(amount, D), colX, y + 7, { width: colW - 8, align: 'right', lineBreak: false });
  y += 48;

  // In words
  doc.font('R').fontSize(10).fillColor(C.muted).text(D.in_words, x, y, { continued: false });
  y += 15;
  doc.font('S').fontSize(11).fillColor(C.text).text(amountInWords(amount, lang), x, y, { width: W });
  y = doc.y + 18;

  // Statement
  doc.rect(x, y, W, 30).fill(C.soft);
  doc.font('S').fontSize(10.5).fillColor(C.text).text(D.statement, x + 12, y + 9, { width: W - 24, lineBreak: false, ellipsis: true });
  y += 52;

  // Signatures
  const sigTop = y + 8;
  const half = (W - 40) / 2;
  const sigBlock = (sx, title, name) => {
    let sy = sigTop;
    doc.font('B').fontSize(10.5).fillColor(C.text).text(title, sx, sy, { width: half });
    sy += 30;
    if (name) doc.font('S').fontSize(11).fillColor(C.text).text(name, sx, sy - 14, { width: half, lineBreak: false, ellipsis: true });
    line(doc, sx, sy + 2, sx + half, C.text, 0.6);
    doc.font('R').fontSize(8.5).fillColor(C.muted).text(D.name_line, sx, sy + 5, { width: half });
    sy += 40;
    line(doc, sx, sy + 2, sx + half, C.text, 0.6);
    doc.font('R').fontSize(8.5).fillColor(C.muted).text(D.signature, sx, sy + 5, { width: half });
    sy += 34;
    doc.font('R').fontSize(10).fillColor(C.text).text(`${D.date}${lang === 'en' ? ':' : '՝'}   ____ / ____ / ________`, sx, sy, { width: half, lineBreak: false });
  };
  sigBlock(x, D.receiver, p.employee.full_name);
  sigBlock(x + half + 40, D.payer, '');

  // Long periods: list of days on the next page
  if (days.length && !inlineDays) {
    doc.addPage();
    let ay = header(doc, p, D, business, issued) + 24;
    doc.font('B').fontSize(13).fillColor(C.text).text(`${D.appendix}. ${D.daily}`, x, ay);
    ay += 22;
    doc.font('R').fontSize(10).fillColor(C.muted).text(`${p.employee.full_name} · ${ddmmyyyy(p.start)} – ${ddmmyyyy(p.end)}`, x, ay);
    ay += 26;
    drawDays(doc, days, D, x, ay);
  }
}

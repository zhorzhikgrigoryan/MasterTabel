// "Ստացական" — compact receipt the employee signs when receiving pay.
// Each receipt is a full-width horizontal strip, a quarter of an A4 page; four per sheet with cut lines between.
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dt, money } from './texts.js';
import { today, dateOf } from '../time.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT = (f) => path.join(here, '..', '..', 'fonts', f);

const C = { ink: '#1F3A93', inkSoft: '#E7ECF8', text: '#1A1D21', muted: '#5F6B5C', rule: '#D5DDCF', cut: '#B9C4B3' };
const PAGE = { w: 595.28, h: 841.89 };
const SLOT = { w: PAGE.w, h: PAGE.h / 4, padX: 32, padY: 22 };

/** What the receipt says was handed over. */
export function receiptAmount(p) {
  return p.balance !== 0 ? p.balance : p.paid;
}

export function receiptNumber(p) {
  return `${p.start.slice(2).replace(/-/g, '')}-${p.employee.id}`;
}

/** 01/01/26 */
const short = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;

/** 1800 min -> "30 ժամ", 2260 -> "37 ժ 40 ր" */
export function hoursText(min, D) {
  const m = Math.max(0, Math.round(min || 0));
  const h = Math.floor(m / 60); const r = m % 60;
  return r ? `${h} ${D.h_short} ${r} ${D.min}` : `${h} ${D.hours_word}`;
}

/** Build one PDF: four receipts per A4 page, in order. */
export function receiptsPdf(items, { lang = 'hy', business = '' } = {}) {
  const D = dt(lang);
  const doc = new PDFDocument({
    size: 'A4', margin: 0, autoFirstPage: false,
    info: { Title: D.receipt, Author: business || 'MasterTabel', Creator: 'MasterTabel' },
  });
  doc.registerFont('R', FONT('NotoSansArmenian-Regular.ttf'));
  doc.registerFont('S', FONT('NotoSansArmenian-SemiBold.ttf'));
  doc.registerFont('B', FONT('NotoSansArmenian-Bold.ttf'));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  if (!items.length) doc.addPage();
  items.forEach((p, i) => {
    const slot = i % 4;
    if (slot === 0) { doc.addPage(); cutLines(doc); }
    drawReceipt(doc, p, D, business, 0, slot * SLOT.h);
  });
  doc.end();
  return done;
}

function cutLines(doc) {
  doc.save().lineWidth(0.6).strokeColor(C.cut).dash(4, { space: 4 });
  for (let i = 1; i < 4; i++) doc.moveTo(14, SLOT.h * i).lineTo(PAGE.w - 14, SLOT.h * i).stroke();
  doc.undash().restore();
}

function rule(doc, x1, y, x2, color = C.rule, width = 0.6) {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(color).stroke();
}

function drawReceipt(doc, p, D, business, ox, oy) {
  const x = ox + SLOT.padX; const w = SLOT.w - SLOT.padX * 2;
  const gap = 28; const lw = w * 0.52; const rx = x + lw + gap; const rw = w - lw - gap;
  let y = oy + SLOT.padY;
  const lastPayment = p.payments.at(-1);
  const issued = p.balance === 0 && lastPayment ? dateOf(lastPayment.paid_at) : today();

  // Header: title left, business and number right
  doc.font('B').fontSize(14).fillColor(C.text).text(D.receipt, x, y, { width: lw, characterSpacing: 2, lineBreak: false });
  const meta = [business, `${D.no} ${receiptNumber(p)}`].filter(Boolean).join('   ·   ');
  doc.font('R').fontSize(8.5).fillColor(C.muted).text(meta, x, y + 4, { width: w, align: 'right', lineBreak: false });
  y += 22;
  rule(doc, x, y, x + w, C.ink, 1.1);
  y += 10;
  const top = y;

  // Left column: date, employee, dates and hours
  const field = (label, value, big = false) => {
    doc.font('R').fontSize(7.5).fillColor(C.muted).text(label, x, y, { width: lw, lineBreak: false });
    y += 10;
    doc.font(big ? 'B' : 'S').fontSize(big ? 12 : 10.5).fillColor(C.text).text(value, x, y, { width: lw, lineBreak: false, ellipsis: true });
    y += big ? 18 : 16;
    rule(doc, x, y - 2, x + lw);
    y += 6;
  };
  field(D.date, short(issued));
  field(D.employee, p.employee.full_name, true);
  field(D.period_hours, `${short(p.start)} – ${short(p.end)},  ${D.total} ${hoursText(p.minutes, D)}`);

  // Right column: amount, statement, employee signature
  let ry = top;
  doc.rect(rx, ry, rw, 38).fill(C.inkSoft);
  doc.font('S').fontSize(9).fillColor(C.text).text(D.amount, rx + 10, ry + 14, { width: rw * 0.35, lineBreak: false });
  doc.font('B').fontSize(16).fillColor(C.ink).text(money(receiptAmount(p), D), rx + 10, ry + 9, { width: rw - 20, align: 'right', lineBreak: false });
  ry += 48;
  doc.font('R').fontSize(8.5).fillColor(C.text).text(D.received_short, rx, ry, { width: rw, lineBreak: false, ellipsis: true });
  const sy = oy + SLOT.h - SLOT.padY - 14;
  rule(doc, rx, sy, rx + rw, C.text, 0.6);
  doc.font('R').fontSize(7.5).fillColor(C.muted).text(D.signature_emp, rx, sy + 4, { width: rw, lineBreak: false });
}

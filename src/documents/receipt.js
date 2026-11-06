// "Ստացական" — compact receipt the employee signs when receiving pay.
// Each receipt takes a quarter of an A4 page (A6); four fit on one sheet with cut lines between.
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dt, money } from './texts.js';
import { today, dateOf } from '../time.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT = (f) => path.join(here, '..', '..', 'fonts', f);

const C = { ink: '#1F3A93', inkSoft: '#E7ECF8', text: '#1A1D21', muted: '#5F6B5C', rule: '#D5DDCF', cut: '#B9C4B3' };
const PAGE = { w: 595.28, h: 841.89 };
const SLOT = { w: PAGE.w / 2, h: PAGE.h / 2, pad: 26 };

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
    drawReceipt(doc, p, D, business, (slot % 2) * SLOT.w, Math.floor(slot / 2) * SLOT.h);
  });
  doc.end();
  return done;
}

function cutLines(doc) {
  doc.save().lineWidth(0.6).strokeColor(C.cut).dash(4, { space: 4 });
  doc.moveTo(SLOT.w, 14).lineTo(SLOT.w, PAGE.h - 14).stroke();
  doc.moveTo(14, SLOT.h).lineTo(PAGE.w - 14, SLOT.h).stroke();
  doc.undash().restore();
}

function rule(doc, x1, y, x2, color = C.rule, width = 0.6) {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(color).stroke();
}

function drawReceipt(doc, p, D, business, ox, oy) {
  const x = ox + SLOT.pad; const w = SLOT.w - SLOT.pad * 2;
  let y = oy + SLOT.pad;
  const lastPayment = p.payments.at(-1);
  const issued = p.balance === 0 && lastPayment ? dateOf(lastPayment.paid_at) : today();

  // Header
  doc.font('B').fontSize(15).fillColor(C.text).text(D.receipt, x, y, { width: w, characterSpacing: 2, lineBreak: false });
  doc.font('R').fontSize(8).fillColor(C.muted).text(`${D.no} ${receiptNumber(p)}`, x, y + 5, { width: w, align: 'right', lineBreak: false });
  y += 22;
  if (business) {
    doc.font('R').fontSize(8.5).fillColor(C.muted).text(business, x, y, { width: w, lineBreak: false, ellipsis: true });
    y += 13;
  }
  y += 4;
  rule(doc, x, y, x + w, C.ink, 1.2);
  y += 14;

  // Fields
  const field = (label, value, big = false) => {
    doc.font('R').fontSize(8).fillColor(C.muted).text(label, x, y, { width: w, lineBreak: false });
    y += 11;
    doc.font(big ? 'B' : 'S').fontSize(big ? 12.5 : 11).fillColor(C.text).text(value, x, y, { width: w, lineBreak: false, ellipsis: true });
    y += big ? 20 : 18;
    rule(doc, x, y - 3, x + w);
    y += 7;
  };
  field(D.date, short(issued));
  field(D.employee, p.employee.full_name, true);
  field(D.period_hours, `${short(p.start)} – ${short(p.end)},  ${D.total} ${hoursText(p.minutes, D)}`);

  // Amount
  y += 2;
  doc.rect(x, y, w, 40).fill(C.inkSoft);
  doc.font('S').fontSize(9.5).fillColor(C.text).text(D.amount, x + 10, y + 14, { width: w * 0.4, lineBreak: false });
  doc.font('B').fontSize(17).fillColor(C.ink).text(money(receiptAmount(p), D), x + 10, y + 9, { width: w - 20, align: 'right', lineBreak: false });
  y += 54;

  // Employee signature (bottom of the slot, with room to sign)
  const sy = oy + SLOT.h - SLOT.pad - 26;
  doc.font('R').fontSize(9).fillColor(C.text).text(D.received_short, x, Math.max(y, sy - 52), { width: w });
  rule(doc, x, sy, x + w, C.text, 0.6);
  doc.font('R').fontSize(8).fillColor(C.muted).text(D.signature_emp, x, sy + 5, { width: w, lineBreak: false });
}

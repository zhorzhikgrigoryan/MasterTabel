// Pay periods: earned + bonuses - advances - deductions - already paid = balance to pay.
// "Mark as paid" records the balance and locks the period. Unlock allows edits again;
// marking paid later records only the difference, so nothing is paid twice.
import { q, one } from '../db.js';
import { summarizeOne } from './calc.js';

export async function isLocked(employeeId, date) {
  const r = await one(
    `SELECT 1 FROM payments WHERE employee_id=$1 AND locked AND $2 BETWEEN period_start AND period_end LIMIT 1`,
    [employeeId, date],
  );
  return !!r;
}

export async function periodSummary(employee, start, end, settings) {
  const [sum, adjustments, payments, overlap] = await Promise.all([
    summarizeOne(employee, start, end, settings),
    q(`SELECT * FROM adjustments WHERE employee_id=$1 AND period_start=$2 AND period_end=$3 ORDER BY created_at`,
      [employee.id, start, end]),
    q(`SELECT * FROM payments WHERE employee_id=$1 AND period_start=$2 AND period_end=$3 ORDER BY paid_at`,
      [employee.id, start, end]),
    // Payments made for a different date range that shares days with this one (paid twice otherwise).
    q(`SELECT DISTINCT period_start, period_end FROM payments WHERE employee_id=$1 AND period_start <= $3 AND period_end >= $2
       AND NOT (period_start=$2 AND period_end=$3) ORDER BY period_start`, [employee.id, start, end]),
  ]);
  const total = (k) => adjustments.filter((a) => a.kind === k).reduce((s, a) => s + a.amount_amd, 0);
  const bonus = total('bonus'); const advance = total('advance'); const deduction = total('deduction');
  const paid = payments.reduce((s, p) => s + p.amount_amd, 0);
  const payable = sum.earned + bonus - advance - deduction;
  return {
    employee, start, end, summary: sum, minutes: sum.minutes, earned: sum.earned,
    adjustments, payments, bonus, advance, deduction, payable, paid,
    balance: payable - paid,
    locked: payments.some((p) => p.locked),
    everPaid: payments.length > 0,
    overlap,
    flags: sum.flags,
  };
}

export async function addAdjustment(employeeId, start, end, kind, amount, comment) {
  if (!['bonus', 'advance', 'deduction'].includes(kind)) throw new Error('kind');
  const amt = Math.round(Math.abs(Number(amount)));
  if (!amt) throw new Error('amount');
  return one(
    `INSERT INTO adjustments (employee_id, period_start, period_end, kind, amount_amd, comment)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [employeeId, start, end, kind, amt, comment || null],
  );
}

export async function deleteAdjustment(id) {
  await q('DELETE FROM adjustments WHERE id=$1', [id]);
}

export async function markPaid(employee, start, end, settings) {
  const p = await periodSummary(employee, start, end, settings);
  if (p.overlap.length) { const e = new Error('overlap'); e.code = 'overlap'; e.overlap = p.overlap; throw e; }
  await q(`UPDATE payments SET locked=true WHERE employee_id=$1 AND period_start=$2 AND period_end=$3`,
    [employee.id, start, end]);
  if (p.balance !== 0 || !p.everPaid) {
    await q(`INSERT INTO payments (employee_id, period_start, period_end, amount_amd) VALUES ($1,$2,$3,$4)`,
      [employee.id, start, end, p.balance]);
  }
  return p.balance;
}

export async function unlock(employeeId, start, end) {
  await q(`UPDATE payments SET locked=false WHERE employee_id=$1 AND period_start=$2 AND period_end=$3`,
    [employeeId, start, end]);
}

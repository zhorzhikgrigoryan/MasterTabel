// Texts for printed documents (receipt PDF, payroll Excel). Follow the admin panel language.
const hy = {
  amd: 'դր.', per_hour: 'դր./ժ',
  receipt: 'ՍՏԱՑԱԿԱՆ', receipt_sub: 'աշխատավարձի ստացման մասին',
  no: 'N', issued: 'Կազմվել է՝',
  employee: 'Աշխատակից', phone: 'Հեռախոս', period: 'Ժամանակահատված',
  weekly: 'շաբաթական', monthly: 'ամսական',
  days_worked: 'Աշխատած օրեր', hours_worked: 'Աշխատած ժամեր', rate: 'Ժամավճար',
  earned: 'Հաշվարկված', bonus: 'Պարգևավճար', advance: 'Կանխավճար', deduction: 'Պահումներ',
  paid_before: 'Արդեն վճարված', to_pay: 'Վճարման ենթակա', paid_amount: 'Վճարված գումար',
  in_words: 'Գումարը տառերով՝',
  statement: 'Վերոնշյալ գումարը ստացել եմ ամբողջությամբ, պահանջներ չունեմ։',
  receiver: 'Ստացող (աշխատակից)', payer: 'Վճարող (գործատու)',
  name_line: 'Անուն, ազգանուն', signature: 'Ստորագրություն', date: 'Ամսաթիվ',
  daily: 'Աշխատած օրեր', appendix: 'Հավելված',
  col_date: 'Ամսաթիվ', col_times: 'Մուտք – Ելք', col_break: 'Ընդմիջում', col_hours: 'Ժամեր', col_amount: 'Գումար',
  min: 'ր', open_shift: 'ելքը նշված չէ',
  weekdays: ['Երկ', 'Երք', 'Չրք', 'Հնգ', 'Ուրբ', 'Շբթ', 'Կիր'],
  // Excel
  x_title_weekly: 'ՇԱԲԱԹԱԿԱՆ ՎՃԱՐՄԱՆ ԱՄՓՈՓՈՒՄ', x_title_monthly: 'ԱՄՍԱԿԱՆ ՎՃԱՐՄԱՆ ԱՄՓՈՓՈՒՄ',
  x_summary: 'Ամփոփում', x_timesheet: 'Տաբել', x_employees: 'Աշխատակիցներ', x_adjustments: 'Լրացումներ',
  x_num: 'N', x_paid: 'Վճարված', x_status: 'Կարգավիճակ', x_paid_status: 'Վճարված', x_unpaid: 'Չվճարված',
  x_total: 'ԸՆԴԱՄԵՆԸ', x_privacy: 'Աշխատակցին տվեք միայն իր ստացականը, որպեսզի մյուսների գումարները չերևան։',
  x_in: 'Մուտք', x_out: 'Ելք', x_break_min: 'Ընդմիջում (րոպե)', x_note: 'Նշում',
  x_edited: 'խմբագրված', x_pending: 'սպասում է հաստատման', x_review: 'ելքը նշված չէ', x_more: 'լրացուցիչ ժամեր՝',
  x_cycle: 'Վճարման պարբերականություն', x_kind: 'Տեսակ', x_amount: 'Գումար', x_comment: 'Մեկնաբանություն',
  x_business: 'Կազմակերպություն',
};

const en = {
  amd: 'AMD', per_hour: 'AMD/h',
  receipt: 'RECEIPT', receipt_sub: 'for payment of wages',
  no: 'No.', issued: 'Issued',
  employee: 'Employee', phone: 'Phone', period: 'Period',
  weekly: 'weekly', monthly: 'monthly',
  days_worked: 'Days worked', hours_worked: 'Hours worked', rate: 'Hourly rate',
  earned: 'Earned', bonus: 'Bonus', advance: 'Advance', deduction: 'Deductions',
  paid_before: 'Already paid', to_pay: 'To pay', paid_amount: 'Amount paid',
  in_words: 'Amount in words:',
  statement: 'I have received the above amount in full and have no claims.',
  receiver: 'Received by (employee)', payer: 'Paid by (employer)',
  name_line: 'Full name', signature: 'Signature', date: 'Date',
  daily: 'Days worked', appendix: 'Appendix',
  col_date: 'Date', col_times: 'In – Out', col_break: 'Break', col_hours: 'Hours', col_amount: 'Amount',
  min: 'min', open_shift: 'no check-out',
  weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  x_title_weekly: 'WEEKLY PAYROLL SUMMARY', x_title_monthly: 'MONTHLY PAYROLL SUMMARY',
  x_summary: 'Summary', x_timesheet: 'Timesheet', x_employees: 'Employees', x_adjustments: 'Adjustments',
  x_num: 'No.', x_paid: 'Paid', x_status: 'Status', x_paid_status: 'Paid', x_unpaid: 'Not paid',
  x_total: 'TOTAL', x_privacy: "Give each employee only their own receipt, so others' amounts stay private.",
  x_in: 'In', x_out: 'Out', x_break_min: 'Break (min)', x_note: 'Note',
  x_edited: 'edited', x_pending: 'waiting for approval', x_review: 'no check-out', x_more: 'extra shifts:',
  x_cycle: 'Pay cycle', x_kind: 'Type', x_amount: 'Amount', x_comment: 'Comment',
  x_business: 'Business',
};

export const DOC = { hy, en };
export const dt = (lang) => DOC[lang] || hy;

export const ddmmyyyy = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
export function money(n, D) {
  const v = Math.round(n || 0);
  const s = Math.abs(v).toLocaleString('en-US').replace(/,/g, D === en ? ',' : ' ');
  return `${v < 0 ? '−' : ''}${s} ${D.amd}`;
}

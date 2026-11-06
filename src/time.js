// Time helpers. All business dates are in Yerevan time (UTC+4, no daylight saving).
export const TZ = 'Asia/Yerevan';
export const OFFSET = '+04:00';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function parts(d) {
  const o = {};
  for (const p of fmt.formatToParts(d)) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';
  return o;
}

/** 'YYYY-MM-DD' of an instant, in Yerevan. */
export function dateOf(d = new Date()) {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 'HH:MM' of an instant, in Yerevan. */
export function hm(d) {
  if (!d) return '';
  const p = parts(new Date(d));
  return `${p.hour}:${p.minute}`;
}

/** Minutes since local midnight. */
export function minutesOfDay(d = new Date()) {
  const p = parts(d);
  return Number(p.hour) * 60 + Number(p.minute);
}

export const today = () => dateOf(new Date());

/** Instant for a Yerevan date + 'HH:MM'. */
export function at(date, time) {
  return new Date(`${date}T${time}:00${OFFSET}`);
}

export function parseHM(s) {
  const m = String(s || '').trim().replace(/[.,\- ]/, ':').match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

export const hmToMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

/** Add days to 'YYYY-MM-DD'. */
export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday 1=Mon..7=Sun for 'YYYY-MM-DD'. */
export function weekday(date) {
  const w = new Date(`${date}T12:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

export function weekStart(date) { return addDays(date, 1 - weekday(date)); }
export function monthStart(date) { return `${date.slice(0, 7)}-01`; }
export function monthEnd(date) {
  const d = new Date(`${monthStart(date)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** Pay period containing `date` for a cycle. */
export function periodOf(cycle, date) {
  if (cycle === 'weekly') { const s = weekStart(date); return { start: s, end: addDays(s, 6) }; }
  return { start: monthStart(date), end: monthEnd(date) };
}

/** Previous / next period. */
export function shiftPeriod(cycle, start, dir) {
  if (cycle === 'weekly') return periodOf(cycle, addDays(start, 7 * dir));
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + dir);
  return periodOf(cycle, d.toISOString().slice(0, 10));
}

export function daysBetween(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 452 -> '7:32' */
export function fmtMin(min) {
  const m = Math.max(0, Math.round(min || 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Rate with up to 2 decimals, Armenian style: 1 692,20 ֏ (whole numbers stay 1 600 ֏). */
export function fmtRate(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const [i, f] = v.toFixed(2).split('.');
  const int = Number(i).toLocaleString('en-US').replace(/,/g, ' ');
  return `${int}${f === '00' ? '' : `,${f}`} ֏`;
}

export function fmtAmd(n) {
  return `${Math.round(n || 0).toLocaleString('en-US').replace(/,/g, ' ')} ֏`;
}

/** Number of days from a to b ('YYYY-MM-DD'), b - a. */
export function dayDiff(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
}

/** Quick weekly ranges. anchor = any day inside the wanted week. */
export const WEEK_PRESETS = ['mon_sun', 'mon_fri', 'sat_fri'];
export function presetRange(kind, anchor) {
  if (kind === 'sat_fri') {
    const fri = addDays(anchor, (5 - weekday(anchor) + 7) % 7);
    return { start: addDays(fri, -6), end: fri };
  }
  const mon = weekStart(anchor);
  return { start: mon, end: addDays(mon, kind === 'mon_fri' ? 4 : 6) };
}
export function detectPreset(start, end) {
  for (const k of WEEK_PRESETS) {
    const r = presetRange(k, addDays(start, 3));
    if (r.start === start && r.end === end) return k;
  }
  return null;
}

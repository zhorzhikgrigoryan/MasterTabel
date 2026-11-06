import express from 'express';
import { q, one } from '../db.js';
import { html, raw, layout, esc } from './html.js';
import { at as adminText, ADMIN } from './i18n.js';
import * as E from '../core/employees.js';
import * as S from '../core/shifts.js';
import * as P from '../core/payroll.js';
import { summarize, summarizeOne, shiftMinutes } from '../core/calc.js';
import { getSettings, setSetting } from '../core/settings.js';
import {
  createAuthToken, exchangeToken, sessionAdmin, logout, createSession, hasAdmins, listAdmins, removeAdmin,
} from '../core/auth.js';
import {
  today, hm, dateOf, addDays, weekStart, monthStart, monthEnd, daysBetween, weekday, periodOf, shiftPeriod,
  fmtMin, fmtAmd, fmtRate, parseHM, minutesOfDay, hmToMin, dayDiff, WEEK_PRESETS, presetRange, detectPreset,
} from '../time.js';
import { timesheetXlsx, payrollXlsx } from '../export.js';
import { receiptsPdf } from '../documents/receipt.js';
import { registerAnalytics } from './analytics.js';

const COOKIE = 'mt_s';

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, days) {
  const secure = process.env.NODE_ENV === 'production' || process.env.RAILWAY_PUBLIC_DOMAIN ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}${secure}`);
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

function dateLabel(L, lang, d, withWeekday = false) {
  const m = Number(d.slice(5, 7)); const day = Number(d.slice(8, 10));
  const wd = withWeekday ? `${L.weekdays[weekday(d) - 1]}, ` : '';
  return lang === 'hy' ? `${wd}${L.months[m - 1]}ի ${day}` : `${wd}${day} ${L.months[m - 1]}`;
}
const ddmm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
function rangeLabel(L, lang, start, end) {
  if (start.slice(8) === '01' && end === monthEnd(start)) return `${L.months_nom[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`;
  return `${ddmm(start)} – ${ddmm(end)}.${end.slice(0, 4)}`;
}

export function adminRouter({ botUsername }) {
  const r = express.Router();
  r.use(express.urlencoded({ extended: true }));

  // ----- language + auth -----
  r.use(async (req, res, next) => {
    const st = await getSettings();
    req.settings = st;
    req.lang = ADMIN[st.admin_lang] ? st.admin_lang : 'hy';
    req.L = adminText(req.lang);
    res.page = (opts) => {
      const flash = req.query.ok ? { type: 'ok', text: req.L[`ok_${req.query.ok}`] || req.L.ok_saved }
        : req.query.err ? { type: 'err', text: req.L[`err_${req.query.err}`] || req.L.err_invalid } : null;
      res.send(layout({ L: req.L, lang: req.lang, flash, ...opts }));
    };
    next();
  });

  const tme = (payload) => (botUsername() ? `https://t.me/${botUsername()}?start=${payload}` : null);

  r.get('/login', async (req, res) => {
    const L = req.L; const owner = await hasAdmins();
    const kind = owner ? 'login' : 'claim';
    const token = await createAuthToken(kind);
    const link = tme(`${kind}_${token}`);
    res.page({
      title: L.login_title, bare: true,
      body: html`<section class="login">
        <div class="login-card">
          <span class="mark big" aria-hidden="true"></span>
          <h1>${owner ? L.login_title : L.setup_title}</h1>
          <p>${owner ? L.login_text : L.setup_text}</p>
          ${link ? html`<a class="btn primary wide" href="${link}" target="_blank" rel="noopener" data-login="${token}">${L.login_btn}</a>
            <p class="muted small" data-login-wait hidden>${L.login_wait}</p>
            <p class="muted small" data-login-expired hidden>${L.login_expired}</p>` : html`<p class="flash err">${L.no_bot}</p>`}
          ${process.env.DEV_LOGIN ? html`<form method="post" action="/auth/dev"><button class="btn ghost wide">Dev login</button></form>` : ''}
          <p class="langs">${['hy', 'en'].map((l) => html`<a href="/lang/${l}?back=/login" class="${req.lang === l ? 'on' : ''}">${l === 'hy' ? 'Հայերեն' : 'English'}</a>`)}</p>
        </div>
      </section>`,
    });
  });

  r.get('/auth/poll', async (req, res) => {
    const session = await exchangeToken(String(req.query.t || ''));
    if (session) { setCookie(res, COOKIE, session, 30); return res.json({ ok: true }); }
    const row = await one(`SELECT created_at FROM auth_tokens WHERE token=$1`, [String(req.query.t || '')]);
    const expired = !row || Date.now() - new Date(row.created_at) > 15 * 60000;
    res.json({ ok: false, expired });
  });

  if (process.env.DEV_LOGIN) {
    r.post('/auth/dev', async (req, res) => {
      await q(`INSERT INTO admins (telegram_id, name) VALUES (1, 'Dev') ON CONFLICT DO NOTHING`);
      setCookie(res, COOKIE, await createSession('1'), 30);
      res.redirect('/');
    });
  }

  r.get('/lang/:l', async (req, res) => {
    if (ADMIN[req.params.l]) await setSetting('admin_lang', req.params.l);
    const back = String(req.query.back || req.get('referer') || '/');
    res.redirect(back.startsWith('/') || back.startsWith('http') ? back : '/');
  });

  r.use(async (req, res, next) => {
    req.adminId = await sessionAdmin(cookies(req)[COOKIE]);
    if (req.adminId) return next();
    if (req.method === 'GET') return res.redirect('/login');
    res.status(401).send('Unauthorized');
  });

  r.post('/logout', async (req, res) => {
    await logout(cookies(req)[COOKIE]);
    res.append('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`);
    res.redirect('/login');
  });

  // ================= TODAY =================
  r.get('/', async (req, res) => {
    const { L, lang, settings: st } = req;
    const d = today(); const nowMin = minutesOfDay(new Date());
    const [att, emps] = await Promise.all([S.attention(), E.listEmployees()]);
    const sums = await summarize(emps, d, d, st);
    const working = []; const missing = []; const done = [];
    for (const e of emps) {
      const day = sums.get(e.id).days[d];
      const open = day.shifts.find((s) => s.status === 'open');
      if (open) working.push({ e, open });
      else if (day.shifts.length) done.push({ e, day });
      else if (e.status === 'active' && e.sched_start && (e.sched_days || []).includes(weekday(d))
        && nowMin > hmToMin(e.sched_start) + Number(st.late_grace)) missing.push(e);
    }
    const why = (s) => (s.needs_approval ? (s.in_source === 'request' && s.out_source !== 'request' ? L.why_pending_in : L.why_pending_out)
      : s.status === 'review' ? L.why_review : L.why_outside);
    res.page({
      title: L.nav_today, active: 'today',
      body: html`
        <div class="head"><h1>${dateLabel(L, lang, d, true)}</h1></div>
        <section class="block">
          <h2>${L.today_attention}${att.length ? html` <span class="count warn">${att.length}</span>` : ''}</h2>
          ${att.length ? html`<ul class="rows">${att.map((s) => html`
            <li class="row"><a href="/day/${s.employee_id}/${s.work_date}">
              <span class="row-main"><strong>${s.full_name}</strong><span class="muted">${why(s)}</span></span>
              <span class="row-side"><span class="time">${hm(s.check_in)}–${s.check_out ? hm(s.check_out) : '…'}</span><span class="muted small">${dateLabel(L, lang, s.work_date)}</span></span>
            </a></li>`)}</ul>` : html`<p class="empty">${L.today_attention_none}</p>`}
        </section>
        <section class="block">
          <h2>${L.today_working} <span class="count">${working.length}</span></h2>
          ${working.length ? html`<ul class="rows">${working.map(({ e, open }) => html`
            <li class="row"><a href="/day/${e.id}/${d}"><span class="row-main"><span class="dot live" aria-hidden="true"></span><strong>${e.full_name}</strong></span>
              <span class="row-side"><span class="muted">${L.since}</span> <span class="time">${hm(open.check_in)}</span>${open.late ? html` <span class="tag warn">${L.late}</span>` : ''}</span></a></li>`)}</ul>`
            : html`<p class="empty">${L.today_working_none}</p>`}
        </section>
        ${missing.length ? html`<section class="block"><h2>${L.today_missing} <span class="count">${missing.length}</span></h2><ul class="rows">${missing.map((e) => html`
          <li class="row"><a href="/day/${e.id}/${d}"><span class="row-main"><strong>${e.full_name}</strong></span>
          <span class="row-side"><span class="muted">${L.expected}</span> <span class="time">${e.sched_start}</span></span></a></li>`)}</ul></section>` : ''}
        ${done.length ? html`<section class="block"><h2>${L.today_done} <span class="count">${done.length}</span></h2><ul class="rows">${done.map(({ e, day }) => html`
          <li class="row"><a href="/day/${e.id}/${d}"><span class="row-main"><strong>${e.full_name}</strong></span>
          <span class="row-side"><span class="time ink">${fmtMin(day.minutes)}</span></span></a></li>`)}</ul></section>` : ''}
        ${!emps.length ? html`<p class="empty">${L.no_employees} <a href="/employees/new">${L.add_first}</a></p>` : ''}
      `,
    });
  });

  // ================= TIMESHEET =================
  r.get('/timesheet', async (req, res) => {
    const { L, lang, settings: st } = req;
    const view = req.query.view === 'month' ? 'month' : 'week';
    const anchor = isDate(req.query.date) ? req.query.date : today();
    const start = view === 'week' ? weekStart(anchor) : monthStart(anchor);
    const end = view === 'week' ? addDays(start, 6) : monthEnd(anchor);
    const prev = view === 'week' ? addDays(start, -7) : shiftPeriod('monthly', start, -1).start;
    const next = view === 'week' ? addDays(start, 7) : shiftPeriod('monthly', start, 1).start;
    const emps = await E.listEmployees();
    const sums = await summarize(emps, start, end, st);
    const days = daysBetween(start, end); const td = today();
    const dayTotals = Object.fromEntries(days.map((d) => [d, 0]));
    let grandMin = 0; let grandAmd = 0;
    const cell = (e, day) => {
      const s = day.shifts;
      const pending = s.some((x) => x.needs_approval); const open = s.some((x) => x.status === 'open');
      const review = s.some((x) => x.status === 'review'); const edited = s.some((x) => x.edited);
      const cls = [pending && 'c-pending', review && 'c-review', open && 'c-open', day.date === td && 'c-today', weekday(day.date) >= 6 && 'c-weekend'].filter(Boolean).join(' ');
      const val = day.minutes ? fmtMin(day.minutes) : open ? '•' : review ? '?' : '';
      return html`<td class="${cls}"><a href="/day/${e.id}/${day.date}" aria-label="${e.full_name} ${day.date}">${val}${edited ? html`<i class="ed" aria-hidden="true"></i>` : ''}</a></td>`;
    };
    const rows = emps.map((e) => {
      const sum = sums.get(e.id);
      for (const d of days) dayTotals[d] += sum.days[d].minutes;
      grandMin += sum.minutes; grandAmd += sum.earned;
      return html`<tr><th scope="row"><a href="/employees/${e.id}">${e.full_name}</a></th>${days.map((d) => cell(e, sum.days[d]))}
        <td class="tot">${fmtMin(sum.minutes)}</td><td class="tot amd">${fmtAmd(sum.earned)}</td></tr>`;
    });
    res.page({
      title: L.nav_timesheet, active: 'timesheet',
      body: html`
        <div class="head">
          <h1>${rangeLabel(L, lang, start, end)}</h1>
          <div class="seg" role="group">
            <a class="${view === 'week' ? 'on' : ''}" href="/timesheet?view=week&date=${anchor}">${L.week}</a>
            <a class="${view === 'month' ? 'on' : ''}" href="/timesheet?view=month&date=${anchor}">${L.month}</a>
          </div>
        </div>
        <div class="toolbar">
          <a class="btn ghost" href="/timesheet?view=${view}&date=${prev}" aria-label="${L.prev}">‹</a>
          <a class="btn ghost" href="/timesheet?view=${view}">${view === 'week' ? L.this_week : L.this_month}</a>
          <a class="btn ghost" href="/timesheet?view=${view}&date=${next}" aria-label="${L.next}">›</a>
          <span class="grow"></span>
          <a class="btn ghost" href="/export/timesheet.xlsx?start=${start}&end=${end}">${L.export_xlsx}</a>
        </div>
        ${emps.length ? html`
        <div class="ledger-wrap"><table class="ledger ${view}">
          <thead><tr><th scope="col" class="corner">${L.employee}</th>${days.map((d) => html`<th scope="col" class="${d === td ? 'c-today' : ''} ${weekday(d) >= 6 ? 'c-weekend' : ''}"><span class="wd">${L.weekdays[weekday(d) - 1]}</span><span class="dn">${Number(d.slice(8))}</span></th>`)}
            <th scope="col" class="tot">${L.hours}</th><th scope="col" class="tot">${L.amount}</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><th scope="row">${L.total}</th>${days.map((d) => html`<td>${dayTotals[d] ? fmtMin(dayTotals[d]) : ''}</td>`)}
            <td class="tot">${fmtMin(grandMin)}</td><td class="tot amd">${fmtAmd(grandAmd)}</td></tr></tfoot>
        </table></div>
        <p class="legend"><span><i class="lg pending"></i>${L.legend_pending}</span><span><i class="lg review"></i>${L.legend_review}</span><span><i class="lg open"></i>${L.legend_open}</span><span><i class="lg edited"></i>${L.legend_edited}</span></p>`
        : html`<p class="empty">${L.no_employees} <a href="/employees/new">${L.add_first}</a></p>`}
      `,
    });
  });

  // ================= DAY DETAIL =================
  async function loadEmp(req, res) {
    const e = await E.getEmployee(Number(req.params.id));
    if (!e) { res.status(404).send('Not found'); return null; }
    return e;
  }

  r.get('/day/:id/:date', async (req, res) => {
    const { L, lang, settings: st } = req;
    const e = await loadEmp(req, res); if (!e) return;
    const d = req.params.date; if (!isDate(d)) return res.redirect('/timesheet');
    const [sum, hist, locked] = await Promise.all([summarizeOne(e, d, d, st), S.history(e.id, d), P.isLocked(e.id, d)]);
    const day = sum.days[d];
    const back = `/timesheet?view=week&date=${d}`;
    const statusOf = (s) => (s.needs_approval ? ['warn', L.st_pending] : s.status === 'review' ? ['err', L.st_review]
      : s.status === 'open' ? ['live', L.st_open] : null);
    const src = (x) => (x ? L[`src_${x}`] : '');
    res.page({
      title: e.full_name, active: 'timesheet',
      body: html`
        <a class="back" href="${back}">‹ ${L.nav_timesheet}</a>
        <div class="head"><h1>${e.full_name}</h1><p class="sub">${dateLabel(L, lang, d, true)}</p></div>
        <div class="daysum">
          <div><span class="muted">${L.gross}</span><strong class="time">${fmtMin(day.gross)}</strong></div>
          <div><span class="muted">${L.minus_break}</span><strong class="time">−${fmtMin(day.breakMin)}</strong></div>
          <div class="em"><span class="muted">${L.day_total}</span><strong class="time ink">${fmtMin(day.minutes)}</strong></div>
          <div><span class="muted">${L.amount}</span><strong>${fmtAmd(day.earned)}</strong></div>
        </div>
        ${locked ? html`<p class="flash note">${L.locked_note} <a href="/payroll/${e.id}?start=${periodOf(e.pay_cycle, d).start}&end=${periodOf(e.pay_cycle, d).end}">${L.nav_payroll}</a></p>` : ''}
        <section class="block">
          <h2>${L.shifts}</h2>
          ${day.shifts.length ? day.shifts.map((s) => {
            const badge = statusOf(s);
            return html`<form class="shift" method="post" action="/shift/${s.id}">
              <div class="shift-top">
                ${badge ? html`<span class="tag ${badge[0]}">${badge[1]}</span>` : ''}
                ${s.late ? html`<span class="tag">${L.late}</span>` : ''}${s.out_of_window ? html`<span class="tag">${L.outside}</span>` : ''}
                <span class="muted small">${L.check_in}: ${src(s.in_source)}${s.out_source ? ` · ${L.check_out}: ${src(s.out_source)}` : ''}</span>
              </div>
              <div class="times">
                <label>${L.check_in}<input type="time" name="in" value="${hm(s.check_in)}" required ${locked ? 'disabled' : ''}></label>
                <label>${L.check_out}<input type="time" name="out" value="${s.check_out ? hm(s.check_out) : ''}" ${locked ? 'disabled' : ''}></label>
                <span class="dur time">${s.check_out ? fmtMin(shiftMinutes(s, st.rounding)) : '…'}</span>
              </div>
              ${locked ? '' : html`<label class="reason">${L.reason}<input type="text" name="reason" maxlength="200"></label>
              <div class="actions">
                <button class="btn primary">${L.save}</button>
                ${s.needs_approval ? html`<button class="btn ok" formaction="/shift/${s.id}/approve">${L.approve}</button>` : ''}
                <button class="btn danger ghost" formaction="/shift/${s.id}/delete" data-confirm="${L.confirm_delete}">${L.delete}</button>
              </div>`}
            </form>`;
          }) : html`<p class="empty">${L.no_shifts}</p>`}
          ${locked ? '' : html`<details class="add"><summary class="btn ghost">+ ${L.add_shift}</summary>
            <form method="post" action="/day/${e.id}/${d}/shift" class="shift">
              <div class="times"><label>${L.check_in}<input type="time" name="in" required></label>
              <label>${L.check_out}<input type="time" name="out"></label></div>
              <label class="reason">${L.reason}<input type="text" name="reason" maxlength="200"></label>
              <div class="actions"><button class="btn primary">${L.save}</button></div>
            </form></details>`}
        </section>
        <section class="block">
          <h2>${L.break_day}</h2>
          <form method="post" action="/day/${e.id}/${d}/break" class="inline">
            <input type="number" name="break_min" min="0" max="600" step="5" value="${day.breakOverride ?? ''}" placeholder="${e.break_min}" ${locked ? 'disabled' : ''}>
            <span class="muted small">${L.break_default(e.break_min)}</span>
            ${locked ? '' : html`<button class="btn ghost">${L.save}</button>${day.breakOverride !== null ? html`<button class="btn ghost" name="reset" value="1">${L.break_reset}</button>` : ''}`}
          </form>
        </section>
        <section class="block">
          <h2>${L.history}</h2>
          ${hist.length ? html`<ul class="hist">${hist.map((h) => html`<li>
            <span class="muted small">${dateLabel(L, lang, dateOf(h.changed_at))} ${hm(h.changed_at)}</span>
            <span><strong>${L.h_field[h.field] || h.field}</strong>${h.old_value || h.new_value ? html` <span class="time">${h.old_value || '—'} → ${h.new_value || '—'}</span>` : ''}</span>
            ${h.reason ? html`<span class="muted">${h.reason}</span>` : ''}</li>`)}</ul>` : html`<p class="empty">${L.history_none}</p>`}
        </section>
      `,
    });
  });

  const dayUrl = (empId, date) => `/day/${empId}/${date}`;
  function ruleErr(res, url, e) {
    if (e.code === 'locked' || e.code === 'out_before_in') return res.redirect(`${url}?err=${e.code}`);
    throw e;
  }
  const t = (v) => (v ? parseHM(v) : null);

  r.post('/day/:id/:date/shift', async (req, res) => {
    const e = await loadEmp(req, res); if (!e) return;
    const url = dayUrl(e.id, req.params.date);
    if (!t(req.body.in)) return res.redirect(`${url}?err=invalid`);
    try { await S.adminCreate(e, req.params.date, t(req.body.in), t(req.body.out), req.body.reason, req.settings); }
    catch (err) { return ruleErr(res, url, err); }
    res.redirect(`${url}?ok=saved`);
  });

  async function withShift(req, res, fn) {
    const s = await S.getShift(Number(req.params.sid));
    if (!s) return res.status(404).send('Not found');
    const e = await E.getEmployee(s.employee_id);
    const url = dayUrl(e.id, s.work_date);
    try { await fn(e, s); } catch (err) { return ruleErr(res, url, err); }
    res.redirect(`${url}?ok=saved`);
  }
  r.post('/shift/:sid', (req, res) => withShift(req, res, (e, s) => {
    if (!t(req.body.in)) { const err = new Error('x'); err.code = 'out_before_in'; throw err; }
    return S.adminUpdate(e, s.id, t(req.body.in), t(req.body.out), req.body.reason, req.settings);
  }));
  r.post('/shift/:sid/approve', (req, res) => withShift(req, res, async (e, s) => {
    const inT = t(req.body.in) || hm(s.check_in); const outT = t(req.body.out) ?? (s.check_out ? hm(s.check_out) : null);
    await S.adminUpdate(e, s.id, inT, outT, req.body.reason, req.settings);
  }));
  r.post('/shift/:sid/delete', (req, res) => withShift(req, res, (e, s) => S.adminDelete(e, s.id, req.body.reason)));

  r.post('/day/:id/:date/break', async (req, res) => {
    const e = await loadEmp(req, res); if (!e) return;
    const url = dayUrl(e.id, req.params.date);
    try { await S.setDayBreak(e, req.params.date, req.body.reset ? null : req.body.break_min, null); }
    catch (err) { return ruleErr(res, url, err); }
    res.redirect(`${url}?ok=saved`);
  });

  // ================= EMPLOYEES =================
  r.get('/employees', async (req, res) => {
    const { L } = req;
    const all = req.query.all === '1';
    const emps = await E.listEmployees({ includeInactive: all });
    res.page({
      title: L.people_title, active: 'people',
      body: html`
        <div class="head"><h1>${L.people_title}</h1><a class="btn primary" href="/employees/new">+ ${L.add_employee}</a></div>
        ${emps.length ? html`<ul class="rows">${emps.map((e) => html`<li class="row"><a href="/employees/${e.id}">
          <span class="row-main"><strong>${e.full_name}</strong><span class="muted">${e.phone}</span></span>
          <span class="row-side"><span class="amd">${e.current_rate !== null && e.current_rate !== undefined ? `${fmtRate(e.current_rate)}${L.per_hour}` : '—'}</span>
          <span class="tag ${e.status === 'active' ? 'live' : e.status === 'invited' ? 'warn' : ''}">${L[`status_${e.status}`]}</span></span></a></li>`)}</ul>`
          : html`<p class="empty">${L.no_employees}</p>`}
        <p><a class="muted small" href="/employees${all ? '' : '?all=1'}">${all ? '‹' : ''} ${L.show_inactive}</a></p>`,
    });
  });

  /** 1692.2 -> "1692,20", 1600 -> "1600" (for the rate input) */
  const rateInput = (v) => (v === null || v === undefined ? '' : Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(2).replace('.', ','));

  function employeeForm(L, e = {}, isNew = false) {
    const days = e.sched_days || [1, 2, 3, 4, 5];
    return html`
      <fieldset><div class="grid2">
        <label>${L.name}<input name="full_name" required value="${e.full_name || ''}" autocomplete="off"></label>
        <label>${L.phone}<input name="phone" type="tel" required value="${e.phone || ''}" placeholder="+374 91 123456"></label>
        <label>${L.rate}<input name="hourly_amd" type="text" inputmode="decimal" pattern="[0-9][0-9 ]*([.,][0-9]{1,2})?" placeholder="1692,20" value="${rateInput(e.current_rate)}" ${isNew ? 'required' : ''}></label>
        <label>${L.rate_from}<input name="rate_from" type="date" value="${today()}" required>${isNew ? '' : html`<span class="muted small hint">${L.rate_change_hint}</span>`}</label>
        <label>${L.break_min}<input name="break_min" type="number" min="0" max="600" step="5" value="${e.break_min ?? 60}"><span class="muted small hint">${L.break_hint}</span></label>
        <label>${L.pay_cycle}<select name="pay_cycle">
          <option value="monthly" ${e.pay_cycle !== 'weekly' ? 'selected' : ''}>${L.monthly}</option>
          <option value="weekly" ${e.pay_cycle === 'weekly' ? 'selected' : ''}>${L.weekly}</option></select></label>
        <label>${L.bot_lang}<select name="lang">${[['hy', 'Հայերեն'], ['ru', 'Русский'], ['en', 'English']].map(([v, n]) => html`<option value="${v}" ${(e.lang || 'hy') === v ? 'selected' : ''}>${n}</option>`)}</select></label>
      </div></fieldset>
      <fieldset><legend>${L.schedule}</legend><p class="muted small">${L.schedule_hint}</p>
        <div class="days">${L.weekdays.map((w, i) => html`<label class="chip"><input type="checkbox" name="sched_days" value="${i + 1}" ${days.includes(i + 1) ? 'checked' : ''}><span>${w}</span></label>`)}</div>
        <div class="grid2">
          <label>${L.start}<input type="time" name="sched_start" value="${e.sched_start || ''}"></label>
          <label>${L.end}<input type="time" name="sched_end" value="${e.sched_end || ''}"></label>
          <label>${L.remind_in}<input type="number" name="remind_in_after" min="0" max="600" value="${e.remind_in_after ?? ''}" placeholder="${L.use_default}"></label>
          <label>${L.remind_out}<input type="number" name="remind_out_again" min="0" max="600" value="${e.remind_out_again ?? ''}" placeholder="${L.use_default}"></label>
        </div>
      </fieldset>
      <fieldset><label>${L.notes}<textarea name="notes" rows="2">${e.notes || ''}</textarea></label></fieldset>`;
  }

  r.get('/employees/new', (req, res) => {
    const { L } = req;
    res.page({ title: L.add_employee, active: 'people', body: html`
      <a class="back" href="/employees">‹ ${L.people_title}</a>
      <div class="head"><h1>${L.add_employee}</h1></div>
      <form method="post" action="/employees" class="form">${employeeForm(L, {}, true)}
        <div class="actions"><button class="btn primary">${L.save}</button></div></form>` });
  });

  r.post('/employees', async (req, res) => {
    const errs = E.validateEmployee(req.body);
    if (errs.length) return res.redirect(`/employees/new?err=${errs[0]}`);
    const e = await E.createEmployee(req.body);
    res.redirect(`/employees/${e.id}?ok=saved`);
  });

  r.get('/employees/:id', async (req, res) => {
    const { L, lang } = req;
    const e = await loadEmp(req, res); if (!e) return;
    const rates = await E.listRates(e.id);
    const link = e.invite_token ? tme(`inv_${e.invite_token}`) : null;
    res.page({ title: e.full_name, active: 'people', body: html`
      <a class="back" href="/employees">‹ ${L.people_title}</a>
      <div class="head"><h1>${e.full_name}</h1><span class="tag ${e.status === 'active' ? 'live' : e.status === 'invited' ? 'warn' : ''}">${L[`status_${e.status}`]}</span></div>
      ${e.status !== 'deactivated' ? html`<section class="block invite">
        <h2>${L.invite}</h2><p class="muted small">${L.invite_hint}</p>
        ${link ? html`<div class="copyrow"><input readonly value="${link}" id="inv"><button class="btn primary" type="button" data-copy="#inv" data-copied="${L.copied}">${L.copy}</button></div>` : html`<p class="flash err">${L.no_bot}</p>`}
        <form method="post" action="/employees/${e.id}/reinvite"><button class="btn ghost small" data-confirm="${L.new_invite_confirm}">${L.new_invite}</button></form>
      </section>` : ''}
      <section class="block">
        <h2>${L.rates}</h2><p class="muted small">${L.rate_hint}</p>
        <ul class="rows">${rates.map((rt) => html`<li class="row"><div><span class="row-main"><strong class="amd">${fmtRate(rt.hourly_amd)}${L.per_hour}</strong></span>
          <span class="row-side"><span class="muted">${L.rate_from}</span> ${dateLabel(L, lang, rt.effective_from)}
          <form method="post" action="/rates/${rt.id}/delete" class="inline-del"><input type="hidden" name="emp" value="${e.id}"><button class="x" aria-label="${L.delete}" data-confirm="${L.confirm}">×</button></form></span></div></li>`)}</ul>
        <form method="post" action="/employees/${e.id}/rate" class="inline">
          <input type="text" inputmode="decimal" pattern="[0-9][0-9 ]*([.,][0-9]{1,2})?" name="hourly_amd" required placeholder="${L.rate}">
          <input type="date" name="effective_from" value="${today()}" required>
          <button class="btn ghost">${L.add_rate}</button>
        </form>
      </section>
      <section class="block"><h2>${L.edit_employee}</h2>
        <form method="post" action="/employees/${e.id}" class="form">${employeeForm(L, { ...e, current_rate: E.rateOn(rates, today()) || (rates.length ? rates.at(-1).hourly_amd : null) })}
          <div class="actions"><button class="btn primary">${L.save}</button></div></form>
      </section>
      <form method="post" action="/employees/${e.id}/${e.status === 'deactivated' ? 'reactivate' : 'deactivate'}">
        <button class="btn ${e.status === 'deactivated' ? 'ghost' : 'danger ghost'}" ${e.status === 'deactivated' ? '' : raw(`data-confirm="${esc(L.deactivate_confirm)}"`)}>${e.status === 'deactivated' ? L.reactivate : L.deactivate}</button>
      </form>` });
  });

  r.post('/employees/:id', async (req, res) => {
    const errs = E.validateEmployee(req.body);
    if (errs.length) return res.redirect(`/employees/${req.params.id}?err=${errs[0]}`);
    const id = Number(req.params.id);
    await E.updateEmployee(id, req.body);
    // A changed rate is added to the history from the chosen date; earlier days keep their rate.
    const rate = E.parseRate(req.body.hourly_amd);
    if (rate >= 0 && isDate(req.body.rate_from)) {
      const current = E.rateOn(await E.listRates(id), req.body.rate_from);
      if (Math.abs(current - rate) > 0.001) await E.setRate(id, rate, req.body.rate_from);
    }
    res.redirect(`/employees/${id}?ok=saved`);
  });
  r.post('/employees/:id/rate', async (req, res) => {
    const rate = E.parseRate(req.body.hourly_amd);
    if (!(rate >= 0) || !isDate(req.body.effective_from)) return res.redirect(`/employees/${req.params.id}?err=rate`);
    await E.setRate(Number(req.params.id), rate, req.body.effective_from);
    res.redirect(`/employees/${req.params.id}?ok=saved`);
  });
  r.post('/rates/:rid/delete', async (req, res) => {
    await E.deleteRate(Number(req.params.rid));
    res.redirect(`/employees/${Number(req.body.emp)}?ok=saved`);
  });
  r.post('/employees/:id/deactivate', async (req, res) => { await E.setStatus(Number(req.params.id), 'deactivated'); res.redirect(`/employees/${req.params.id}?ok=saved`); });
  r.post('/employees/:id/reactivate', async (req, res) => { await E.reactivate(Number(req.params.id)); res.redirect(`/employees/${req.params.id}?ok=saved`); });
  r.post('/employees/:id/reinvite', async (req, res) => { await E.regenerateInvite(Number(req.params.id)); res.redirect(`/employees/${req.params.id}?ok=saved`); });

  // ================= PAYROLL =================
  async function payrollGroup(L, lang, st, cycle, start, end, emps, controls) {
    const list = emps.filter((e) => e.pay_cycle === cycle);
    const rows = [];
    for (const e of list) rows.push(await P.periodSummary(e, start, end, st));
    const tot = rows.reduce((s, p) => s + p.balance, 0);
    const qs = `start=${start}&end=${end}`;
    return html`<section class="block">
      <div class="groupbar"><h2>${cycle === 'weekly' ? L.weekly_people : L.monthly_people}</h2>
        <div class="toolbar tight">
        <a class="btn ghost" href="/export/payroll.xlsx?cycle=${cycle}&${qs}">${L.export_xlsx}</a>
        ${rows.length ? html`<a class="btn ghost" href="/receipts.pdf?cycle=${cycle}&${qs}" target="_blank" rel="noopener">${L.receipts_all}</a>` : ''}</div></div>
      ${controls}
      ${rows.length ? html`<div class="table-wrap"><table class="pay">
        <thead><tr><th scope="col">${L.employee}</th><th scope="col">${L.hours}</th><th scope="col">${L.earned}</th><th scope="col">${L.adjustments}</th><th scope="col">${L.paid}</th><th scope="col">${L.to_pay}</th><th scope="col"><span class="sr">${L.status}</span></th><th scope="col"><span class="sr">${L.receipt}</span></th></tr></thead>
        <tbody>${rows.map((p) => html`<tr>
          <th scope="row"><a href="/payroll/${p.employee.id}?${qs}">${p.employee.full_name}</a>${p.flags.pending || p.flags.review ? html` <span class="tag warn" title="${L.warn_open}">!</span>` : ''}</th>
          <td class="time">${fmtMin(p.minutes)}</td><td class="amd">${fmtAmd(p.earned)}</td>
          <td class="amd">${p.bonus - p.advance - p.deduction ? fmtAmd(p.bonus - p.advance - p.deduction) : '—'}</td>
          <td class="amd">${p.paid ? fmtAmd(p.paid) : '—'}</td><td class="amd strong">${fmtAmd(p.balance)}</td>
          <td>${p.overlap.length && !p.locked ? html`<a class="tag warn" href="/payroll/${p.employee.id}?${qs}" title="${L.overlap_note(p.overlap.map((o) => `${ddmm(o.period_start)}–${ddmm(o.period_end)}`).join(', '))}">${L.overlap_short}</a>`
            : html`<a class="tag ${p.locked ? 'live' : ''}" href="/payroll/${p.employee.id}?${qs}">${p.locked ? L.locked : L.not_paid}</a>`}</td>
          <td>${p.minutes || p.balance || p.paid ? html`<a class="btn ghost small" href="/payroll/${p.employee.id}/receipt.pdf?${qs}" target="_blank" rel="noopener">${L.receipt}</a>` : ''}</td></tr>`)}</tbody>
        <tfoot><tr><th scope="row">${L.total}</th><td></td><td></td><td></td><td></td><td class="amd strong">${fmtAmd(tot)}</td><td></td><td></td></tr></tfoot>
      </table></div>` : html`<p class="empty">${L.nobody}</p>`}
    </section>`;
  }

  /** Weekly payroll range from the URL: a quick preset, a custom from–to, or the remembered preset. */
  async function weeklyRange(qy, st) {
    if (WEEK_PRESETS.includes(qy.wp)) {
      await setSetting('week_preset', qy.wp);
      return presetRange(qy.wp, isDate(qy.wa) ? qy.wa : today());
    }
    if (isDate(qy.ws) && isDate(qy.we) && qy.ws <= qy.we && dayDiff(qy.ws, qy.we) <= 62) return { start: qy.ws, end: qy.we };
    const preset = WEEK_PRESETS.includes(st.week_preset) ? st.week_preset : 'mon_sun';
    return presetRange(preset, isDate(qy.w) ? qy.w : today());
  }

  r.get('/payroll', async (req, res) => {
    const { L, lang, settings: st } = req;
    const wk = await weeklyRange(req.query, st);
    const m = isDate(req.query.m) ? monthStart(req.query.m) : monthStart(today());
    const mEnd = monthEnd(m);
    const emps = await E.listEmployees({ includeInactive: true });
    const wq = `ws=${wk.start}&we=${wk.end}`;
    const mPrev = shiftPeriod('monthly', m, -1).start; const mNext = shiftPeriod('monthly', m, 1).start;
    const monthlyControls = html`<div class="rangebar"><div class="toolbar tight">
      <a class="btn ghost" href="/payroll?m=${mPrev}&${wq}" aria-label="${L.prev}">‹</a><span class="period">${rangeLabel(L, lang, m, mEnd)}</span>
      <a class="btn ghost" href="/payroll?m=${mNext}&${wq}" aria-label="${L.next}">›</a></div></div>`;
    const len = dayDiff(wk.start, wk.end) + 1; const step = len <= 7 ? 7 : len;
    const active = detectPreset(wk.start, wk.end);
    const anchor = addDays(wk.start, Math.min(3, len - 1));
    const weeklyControls = html`<div class="rangebar">
      <div class="seg" role="group" aria-label="${L.quick_range}">${WEEK_PRESETS.map((k) => html`<a class="${active === k ? 'on' : ''}" href="/payroll?wp=${k}&wa=${anchor}&m=${m}" ${active === k ? raw('aria-current="true"') : ''}>${L[`preset_${k}`]}</a>`)}</div>
      <form class="range" method="get" action="/payroll">
        <input type="hidden" name="m" value="${m}">
        <a class="btn ghost" href="/payroll?ws=${addDays(wk.start, -step)}&we=${addDays(wk.end, -step)}&m=${m}" aria-label="${L.prev}">‹</a>
        <label><span class="sr">${L.range_from}</span><input type="date" name="ws" value="${wk.start}" required></label>
        <span class="dash" aria-hidden="true">–</span>
        <label><span class="sr">${L.range_to}</span><input type="date" name="we" value="${wk.end}" required></label>
        <a class="btn ghost" href="/payroll?ws=${addDays(wk.start, step)}&we=${addDays(wk.end, step)}&m=${m}" aria-label="${L.next}">›</a>
        <button class="btn primary">${L.show}</button>
      </form></div>`;
    const monthly = await payrollGroup(L, lang, st, 'monthly', m, mEnd, emps, monthlyControls);
    const weekly = await payrollGroup(L, lang, st, 'weekly', wk.start, wk.end, emps, weeklyControls);
    res.page({ title: L.payroll_title, active: 'payroll', body: html`<div class="head"><h1>${L.payroll_title}</h1></div>${monthly}${weekly}` });
  });

  r.get('/payroll/:id', async (req, res) => {
    const { L, lang, settings: st } = req;
    const e = await loadEmp(req, res); if (!e) return;
    const per = isDate(req.query.start) && isDate(req.query.end) ? { start: req.query.start, end: req.query.end } : periodOf(e.pay_cycle, today());
    const p = await P.periodSummary(e, per.start, per.end, st);
    const qs = `start=${per.start}&end=${per.end}`;
    const days = Object.values(p.summary.days).filter((d) => d.shifts.length);
    const back = e.pay_cycle === 'weekly' ? `/payroll?ws=${per.start}&we=${per.end}` : `/payroll?m=${per.start}`;
    res.page({ title: e.full_name, active: 'payroll', body: html`
      <a class="back" href="${back}">‹ ${L.payroll_title}</a>
      <div class="head"><h1>${e.full_name}</h1><p class="sub">${rangeLabel(L, lang, per.start, per.end)}</p></div>
      ${p.flags.pending || p.flags.review || p.flags.open ? html`<p class="flash note">${L.warn_open}</p>` : ''}
      ${p.overlap.length ? html`<p class="flash note">${L.overlap_note(p.overlap.map((o) => `${ddmm(o.period_start)}–${ddmm(o.period_end)}`).join(', '))}</p>` : ''}
      <dl class="statement">
        <div><dt>${L.hours}</dt><dd class="time">${fmtMin(p.minutes)}</dd></div>
        <div><dt>${L.earned}</dt><dd>${fmtAmd(p.earned)}</dd></div>
        ${p.bonus ? html`<div><dt>${L.bonus}</dt><dd>+${fmtAmd(p.bonus)}</dd></div>` : ''}
        ${p.advance ? html`<div><dt>${L.advance}</dt><dd>−${fmtAmd(p.advance)}</dd></div>` : ''}
        ${p.deduction ? html`<div><dt>${L.deduction}</dt><dd>−${fmtAmd(p.deduction)}</dd></div>` : ''}
        ${p.paid ? html`<div><dt>${L.paid}</dt><dd>−${fmtAmd(p.paid)}</dd></div>` : ''}
        <div class="total"><dt>${p.everPaid && p.balance ? L.diff : L.to_pay}</dt><dd>${fmtAmd(p.balance)}</dd></div>
      </dl>
      <div class="actions">
        ${p.locked ? html`<span class="tag live">${L.locked}</span>
          <form method="post" action="/payroll/${e.id}/unlock?${qs}"><button class="btn ghost" data-confirm="${L.unlock_confirm}">${L.unlock}</button></form>`
          : p.overlap.length ? '' : html`<form method="post" action="/payroll/${e.id}/paid?${qs}"><button class="btn primary" data-confirm="${L.mark_paid_confirm(fmtAmd(p.balance))}">${L.mark_paid}</button></form>`}
        <a class="btn ghost" href="/payroll/${e.id}/receipt.pdf?${qs}" target="_blank" rel="noopener">${L.receipt}</a>
      </div>
      <section class="block"><h2>${L.adjustments}</h2>
        ${p.adjustments.length ? html`<ul class="rows">${p.adjustments.map((a) => html`<li class="row"><div>
          <span class="row-main"><strong>${L[a.kind]}</strong><span class="muted">${a.comment || ''}</span></span>
          <span class="row-side"><span class="amd">${a.kind === 'bonus' ? '+' : '−'}${fmtAmd(a.amount_amd)}</span>
          ${p.locked ? '' : html`<form method="post" action="/adjustments/${a.id}/delete?${qs}&emp=${e.id}" class="inline-del"><button class="x" aria-label="${L.delete}" data-confirm="${L.confirm}">×</button></form>`}</span></div></li>`)}</ul>`
          : html`<p class="empty">${L.no_adjustments}</p>`}
        ${p.locked ? '' : html`<form method="post" action="/payroll/${e.id}/adjust?${qs}" class="inline wrapline">
          <select name="kind"><option value="bonus">${L.bonus}</option><option value="advance">${L.advance}</option><option value="deduction">${L.deduction}</option></select>
          <input type="number" name="amount" min="1" step="1" required placeholder="֏">
          <input type="text" name="comment" maxlength="200" placeholder="${L.comment}">
          <button class="btn ghost">${L.add}</button></form>`}
      </section>
      <section class="block"><h2>${L.shifts}</h2>
        ${days.length ? html`<div class="table-wrap"><table class="pay"><tbody>${days.map((d) => html`<tr>
          <th scope="row"><a href="/day/${e.id}/${d.date}">${dateLabel(L, lang, d.date, true)}</a></th>
          <td class="time muted">${d.shifts.map((s) => `${hm(s.check_in)}–${s.check_out ? hm(s.check_out) : '…'}`).join(', ')}</td>
          <td class="time">${fmtMin(d.minutes)}</td><td class="amd">${fmtAmd(d.earned)}</td></tr>`)}</tbody></table></div>`
          : html`<p class="empty">${L.no_shifts}</p>`}
      </section>
      ${p.payments.length ? html`<section class="block"><h2>${L.payments}</h2><ul class="rows">${p.payments.map((pm) => html`<li class="row"><div>
        <span class="row-main">${dateLabel(L, lang, dateOf(pm.paid_at))} ${hm(pm.paid_at)}</span><span class="row-side amd">${fmtAmd(pm.amount_amd)}</span></div></li>`)}</ul></section>` : ''}
    ` });
  });

  const payBack = (req) => `/payroll/${req.params.id}?start=${req.query.start}&end=${req.query.end}`;
  r.post('/payroll/:id/paid', async (req, res) => {
    const e = await loadEmp(req, res); if (!e) return;
    if (!isDate(req.query.start) || !isDate(req.query.end)) return res.redirect('/payroll');
    try { await P.markPaid(e, req.query.start, req.query.end, req.settings); }
    catch (err) { if (err.code === 'overlap') return res.redirect(`${payBack(req)}&err=overlap`); throw err; }
    res.redirect(`${payBack(req)}&ok=paid`);
  });
  r.post('/payroll/:id/unlock', async (req, res) => {
    if (!isDate(req.query.start) || !isDate(req.query.end)) return res.redirect('/payroll');
    await P.unlock(Number(req.params.id), req.query.start, req.query.end);
    res.redirect(`${payBack(req)}&ok=unlocked`);
  });
  r.post('/payroll/:id/adjust', async (req, res) => {
    if (!isDate(req.query.start) || !isDate(req.query.end)) return res.redirect('/payroll');
    if (await P.isLocked(Number(req.params.id), req.query.start)) return res.redirect(`${payBack(req)}&err=locked`);
    try { await P.addAdjustment(Number(req.params.id), req.query.start, req.query.end, req.body.kind, req.body.amount, req.body.comment); }
    catch { return res.redirect(`${payBack(req)}&err=invalid`); }
    res.redirect(`${payBack(req)}&ok=saved`);
  });
  r.post('/adjustments/:aid/delete', async (req, res) => {
    req.params.id = req.query.emp;
    if (await P.isLocked(Number(req.query.emp), req.query.start)) return res.redirect(`${payBack(req)}&err=locked`);
    await P.deleteAdjustment(Number(req.params.aid));
    res.redirect(`${payBack(req)}&ok=saved`);
  });

  // ================= SETTINGS =================
  r.get('/settings', async (req, res) => {
    const { L, settings: st } = req;
    const bot = botUsername();
    const admins = await listAdmins();
    const inv = /^[A-Za-z0-9_-]{10,}$/.test(String(req.query.invite || '')) ? req.query.invite : null;
    const inviteLink = inv ? tme(`admin_${inv}`) : null;
    res.page({ title: L.settings_title, active: 'settings', body: html`
      <div class="head"><h1>${L.settings_title}</h1></div>
      <form method="post" action="/settings" class="form">
        <fieldset><legend>${L.rounding}</legend>
          <select name="rounding">${[0, 5, 10, 15, 30].map((n) => html`<option value="${n}" ${Number(st.rounding) === n ? 'selected' : ''}>${n ? L.rounding_n(n) : L.rounding_none}</option>`)}</select>
        </fieldset>
        <fieldset><legend>${L.window}</legend><p class="muted small">${L.window_hint}</p>
          <div class="grid2"><label>${L.start}<input type="time" name="window_start" value="${st.window_start}" required></label>
          <label>${L.end}<input type="time" name="window_end" value="${st.window_end}" required></label></div>
        </fieldset>
        <fieldset><div class="grid2">
          <label>${L.remind_in_default}<input type="number" name="remind_in_after" min="0" max="600" value="${st.remind_in_after}"></label>
          <label>${L.remind_out_default}<input type="number" name="remind_out_again" min="0" max="600" value="${st.remind_out_again}"></label>
          <label>${L.late_grace}<input type="number" name="late_grace" min="0" max="120" value="${st.late_grace}"></label>
        </div>
        <label class="check"><input type="checkbox" name="notify_owner_requests" value="1" ${st.notify_owner_requests ? 'checked' : ''}> ${L.notify_requests}</label>
        </fieldset>
        <fieldset><label>${L.business_name}<input name="business_name" maxlength="120" value="${st.business_name || ''}" placeholder="${L.business_name_ph}"></label>
          <p class="muted small">${L.business_name_hint}</p></fieldset>
        <fieldset><legend>${L.panel_lang}</legend>
          <div class="seg" role="group">${['hy', 'en'].map((l) => html`<a href="/lang/${l}?back=/settings" class="${req.lang === l ? 'on' : ''}">${l === 'hy' ? 'Հայերեն' : 'English'}</a>`)}</div>
        </fieldset>
        <div class="actions"><button class="btn primary">${L.save}</button></div>
      </form>
      <section class="block admins" id="admins">
        <h2>${L.admins}</h2>
        <p class="muted small">${L.admins_hint}</p>
        <ul class="rows">${admins.map((a) => html`<li class="row"><div>
          <span class="row-main"><strong>${a.name || `Telegram ${a.telegram_id}`}</strong>
            <span class="muted small">${L.admin_since(dateLabel(L, req.lang, dateOf(a.added_at)))}</span></span>
          <span class="row-side">${String(a.telegram_id) === req.adminId ? html`<span class="tag live">${L.you}</span>`
            : html`<form method="post" action="/admins/${a.telegram_id}/remove" class="inline-del"><button class="btn danger ghost small" data-confirm="${L.remove_admin_confirm(a.name || a.telegram_id)}">${L.remove}</button></form>`}</span>
        </div></li>`)}</ul>
        ${inviteLink ? html`<div class="invite-box"><p class="small">${L.invite_admin_hint}</p>
          <div class="copyrow"><input readonly value="${inviteLink}" id="adminInv"><button class="btn primary" type="button" data-copy="#adminInv" data-copied="${L.copied}">${L.copy}</button></div></div>`
          : html`<form method="post" action="/admins/invite"><button class="btn ghost" ${bot ? '' : 'disabled'}>+ ${L.invite_admin}</button></form>`}
      </section>
      ${bot ? html`<p class="muted small">${L.bot_link}: <a href="https://t.me/${bot}">t.me/${bot}</a></p>` : ''}
      <form method="post" action="/logout"><button class="btn ghost">${L.logout}</button></form>` });
  });

  r.post('/admins/invite', async (req, res) => {
    const token = await createAuthToken('invite', req.adminId);
    res.redirect(`/settings?invite=${token}#admins`);
  });
  r.post('/admins/:tid/remove', async (req, res) => {
    if (req.params.tid === req.adminId) return res.redirect('/settings?err=invalid');
    const r2 = await removeAdmin(req.params.tid);
    res.redirect(`/settings?${r2 === 'last' ? 'err=last_admin' : 'ok=saved'}`);
  });

  r.post('/settings', async (req, res) => {
    const b = req.body; const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : d);
    const ws = parseHM(b.window_start); const we = parseHM(b.window_end);
    if (!ws || !we || hmToMin(we) <= hmToMin(ws)) return res.redirect('/settings?err=invalid');
    await setSetting('rounding', [0, 5, 10, 15, 30].includes(num(b.rounding, 0)) ? num(b.rounding, 0) : 0);
    await setSetting('window_start', ws);
    await setSetting('window_end', we);
    await setSetting('remind_in_after', num(b.remind_in_after, 15));
    await setSetting('remind_out_again', num(b.remind_out_again, 60));
    await setSetting('late_grace', num(b.late_grace, 5));
    await setSetting('notify_owner_requests', b.notify_owner_requests === '1');
    await setSetting('business_name', String(b.business_name || '').trim().slice(0, 120));
    res.redirect('/settings?ok=saved');
  });

  // ================= EXPORT =================
  function requestRange(req, cycle) {
    const { start, end } = req.query;
    if (!isDate(start)) return null;
    if (isDate(end) && start <= end && dayDiff(start, end) <= 62) return { start, end };
    return periodOf(cycle, start);
  }
  r.get('/export/timesheet.xlsx', async (req, res) => {
    if (!isDate(req.query.start) || !isDate(req.query.end)) return res.redirect('/timesheet');
    const buf = await timesheetXlsx(req.query.start, req.query.end, req.settings, req.L);
    res.set('Content-Disposition', `attachment; filename="tabel_${req.query.start}_${req.query.end}.xlsx"`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buf);
  });
  r.get('/export/payroll.xlsx', async (req, res) => {
    const cycle = req.query.cycle === 'weekly' ? 'weekly' : 'monthly';
    const per = requestRange(req, cycle); if (!per) return res.redirect('/payroll');
    const buf = await payrollXlsx(cycle, per.start, per.end, req.settings, req.L, req.lang);
    res.set('Content-Disposition', `attachment; filename="payroll_${per.start}_${per.end}.xlsx"`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buf);
  });

  registerAnalytics(r, { rangeLabel });

  // ================= RECEIPTS (PDF) =================
  const asciiName = (s) => `receipt_${String(s).replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '')}`;
  function sendPdf(res, buf, name) {
    res.set('Content-Disposition', `inline; filename="${asciiName(name)}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}.pdf`);
    res.type('application/pdf').send(buf);
  }
  r.get('/payroll/:id/receipt.pdf', async (req, res) => {
    const e = await loadEmp(req, res); if (!e) return;
    if (!isDate(req.query.start) || !isDate(req.query.end)) return res.redirect('/payroll');
    const p = await P.periodSummary(e, req.query.start, req.query.end, req.settings);
    const buf = await receiptsPdf([p], { lang: req.lang, business: req.settings.business_name });
    sendPdf(res, buf, `${req.L.receipt}_${e.full_name}_${req.query.start}`);
  });
  r.get('/receipts.pdf', async (req, res) => {
    const cycle = req.query.cycle === 'weekly' ? 'weekly' : 'monthly';
    const per = requestRange(req, cycle); if (!per) return res.redirect('/payroll');
    const emps = (await E.listEmployees({ includeInactive: true })).filter((e) => e.pay_cycle === cycle);
    const items = [];
    for (const e of emps) {
      const p = await P.periodSummary(e, per.start, per.end, req.settings);
      if (p.minutes || p.balance || p.paid) items.push(p);
    }
    const buf = await receiptsPdf(items, { lang: req.lang, business: req.settings.business_name });
    sendPdf(res, buf, `${req.L.receipt}_${per.start}_${per.end}`);
  });

  return r;
}

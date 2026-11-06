// Analytics page: stat tiles, column/bar charts (plain HTML+CSS, no chart library) and a punctuality table.
import { html, raw } from './html.js';
import { analytics } from '../core/analytics.js';
import { today, addDays, monthStart, monthEnd, shiftPeriod, dayDiff, weekday, fmtMin, fmtAmd } from '../time.js';

const T = {
  hy: {
    title: 'Վերլուծություն',
    r_this_month: 'Այս ամիս', r_last_month: 'Նախորդ ամիս', r_last_30: 'Վերջին 30 օր', r_last_90: 'Վերջին 3 ամիս',
    from: 'Սկիզբ', to: 'Ավարտ', show: 'Ցույց տալ', quick: 'Արագ ընտրություն',
    k_hours: 'Աշխատած ժամեր', k_cost: 'Աշխատավարձի ծախս', k_avg: 'Միջին աշխատանքային օր', k_people: 'Աշխատած աշխատակիցներ',
    k_late: 'Ուշացումներ', k_missed: 'Մոռացված նշումներ',
    vs_prev: (d) => `${d}՝ նախորդ ժամանակահատվածի համեմատ`, no_prev: 'Նախորդ ժամանակահատվածում տվյալներ չկան',
    missed_hint: (r, o) => `${r} հարցում, ${o} չփակված ելք`,
    late_hint: 'Սպասվող գրաֆիկից ուշ մուտքեր',
    c_daily: 'Աշխատած ժամեր ըստ օրերի', c_daily_sub: 'Բոլոր աշխատակիցների գումարային ժամերը',
    c_people: 'Ժամեր և ծախս ըստ աշխատակիցների', c_weekday: 'Միջին ժամեր ըստ շաբաթվա օրերի',
    c_weekday_sub: 'Օրվա միջին գումարային ժամերը՝ ընտրված ժամանակահատվածում',
    c_months: 'Աշխատավարձի ծախսը ըստ ամիսների', c_months_sub: 'Վերջին 6 ամիսը',
    t_punct: 'Կարգապահություն', t_punct_sub: 'Միջին ժամերը հաշվված են աշխատած օրերով',
    col_emp: 'Աշխատակից', col_days: 'Օրեր', col_hours: 'Ժամեր', col_cost: 'Գումար', col_in: 'Միջին մուտք', col_out: 'Միջին ելք',
    col_avg: 'Միջին օր', col_late: 'Ուշացում', col_req: 'Մոռացված', col_edit: 'Խմբագրված',
    col_date: 'Ամսաթիվ', col_people: 'Աշխատողներ', col_wd: 'Օր', col_month: 'Ամիս',
    table: 'Ցույց տալ աղյուսակով', empty: 'Այս ժամանակահատվածում աշխատած ժամեր չկան։ Ընտրեք այլ ամսաթվեր։',
    h: 'ժ', people_n: (n) => `${n} աշխ.`,
    mon: ['Հնվ', 'Փտր', 'Մրտ', 'Ապր', 'Մյս', 'Հնս', 'Հլս', 'Օգս', 'Սպտ', 'Հկտ', 'Նյմ', 'Դկտ'],
  },
  en: {
    title: 'Analytics',
    r_this_month: 'This month', r_last_month: 'Last month', r_last_30: 'Last 30 days', r_last_90: 'Last 3 months',
    from: 'From', to: 'To', show: 'Show', quick: 'Quick selection',
    k_hours: 'Hours worked', k_cost: 'Labour cost', k_avg: 'Average working day', k_people: 'Employees who worked',
    k_late: 'Late check-ins', k_missed: 'Missed taps',
    vs_prev: (d) => `${d} vs the previous period`, no_prev: 'No data in the previous period',
    missed_hint: (r, o) => `${r} requests, ${o} unclosed`,
    late_hint: 'Check-ins later than the expected schedule',
    c_daily: 'Hours worked per day', c_daily_sub: 'All employees combined',
    c_people: 'Hours and cost by employee', c_weekday: 'Average hours by weekday',
    c_weekday_sub: 'Average combined hours per day in the selected period',
    c_months: 'Labour cost by month', c_months_sub: 'Last 6 months',
    t_punct: 'Punctuality', t_punct_sub: 'Averages are over days worked',
    col_emp: 'Employee', col_days: 'Days', col_hours: 'Hours', col_cost: 'Amount', col_in: 'Avg. in', col_out: 'Avg. out',
    col_avg: 'Avg. day', col_late: 'Late', col_req: 'Missed', col_edit: 'Edited',
    col_date: 'Date', col_people: 'People', col_wd: 'Day', col_month: 'Month',
    table: 'Show as table', empty: 'No hours worked in this period. Pick other dates.',
    h: 'h', people_n: (n) => `${n} people`,
    mon: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  },
};

const PRESETS = ['this_month', 'last_month', 'last_30', 'last_90'];
function presetRange(k, d = today()) {
  if (k === 'last_month') { const s = shiftPeriod('monthly', monthStart(d), -1).start; return { start: s, end: monthEnd(s) }; }
  if (k === 'last_30') return { start: addDays(d, -29), end: d };
  if (k === 'last_90') return { start: shiftPeriod('monthly', monthStart(d), -2).start, end: d };
  return { start: monthStart(d), end: d };
}
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const hhmm = (min) => (min === null || min === undefined ? '—' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`);
const ddmm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

/** Round axis ticks: 0 and up to 4 steps of 1/2/2.5/5 x 10^n. */
function ticks(max) {
  if (max <= 0) return { top: 1, list: [0, 1] };
  const raw = max / 4; const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
  const top = Math.ceil(max / step) * step;
  const list = []; for (let v = 0; v <= top + 1e-9; v += step) list.push(v);
  return { top, list };
}
const compactAmd = (v) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1000 ? `${+(v / 1000).toFixed(0)}k` : `${v}`);

/** Vertical column chart in HTML. items: [{ key, value, label, tip }] */
function columns({ items, tickFmt, every = 1, highlight, height = 200, cls = '' }) {
  const { top, list } = ticks(Math.max(...items.map((i) => i.value), 0));
  return html`<div class="cchart ${cls}" style="--h:${height}px">
    <div class="plot">
      ${list.map((t) => html`<div class="gl" style="bottom:${(t / top) * 100}%"><span>${tickFmt(t)}</span></div>`)}
      <div class="cols">${items.map((it) => html`<div class="col${highlight && highlight(it) ? ' hi' : ''}" data-tip="${it.tip}"><i style="height:${Math.max(0, (it.value / top) * 100)}%${it.value > 0 ? '' : ';min-height:0'}"></i></div>`)}</div>
    </div>
    <div class="xl">${items.map((it, i) => html`<span class="${i % every === 0 && (i / every) % 2 === 1 ? 'alt' : ''}">${i % every === 0 ? it.label : ''}</span>`)}</div>
  </div>`;
}

function tableView(A, heads, rows) {
  return html`<details class="tv"><summary>${A.table}</summary><div class="table-wrap"><table class="pay">
    <thead><tr>${heads.map((h, i) => html`<th scope="col"${i === 0 ? raw(' style="text-align:left"') : ''}>${h}</th>`)}</tr></thead>
    <tbody>${rows.map((r) => html`<tr>${r.map((c, i) => (i === 0 ? html`<th scope="row">${c}</th>` : html`<td>${c}</td>`))}</tr>`)}</tbody>
  </table></div></details>`;
}

function delta(cur, prev, A) {
  if (!prev) return html`<span class="muted small">${A.no_prev}</span>`;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const txt = `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct)}%`;
  return html`<span class="muted small">${A.vs_prev(txt)}</span>`;
}

export function registerAnalytics(r, { rangeLabel }) {
  r.get('/analytics', async (req, res) => {
    const { L, lang, settings: st } = req;
    const A = T[lang] || T.hy;
    const monthName = (m) => A.mon[Number(m.slice(5, 7)) - 1];
    let range; let active = null;
    if (PRESETS.includes(req.query.r)) { range = presetRange(req.query.r); active = req.query.r; }
    else if (isDate(req.query.from) && isDate(req.query.to) && req.query.from <= req.query.to && dayDiff(req.query.from, req.query.to) <= 370) {
      range = { start: req.query.from, end: req.query.to };
    } else { range = presetRange('this_month'); active = 'this_month'; }
    const a = await analytics(range.start, range.end, st);
    const t = a.totals;
    const hours = (m) => +(m / 60).toFixed(1);

    const tiles = html`<div class="tiles">
      <div class="tile"><span class="tl">${A.k_hours}</span><strong class="tv-num">${fmtMin(t.minutes)}</strong>${delta(t.minutes, a.prev.minutes, A)}</div>
      <div class="tile"><span class="tl">${A.k_cost}</span><strong class="tv-num">${fmtAmd(t.cost)}</strong>${delta(t.cost, a.prev.cost, A)}</div>
      <div class="tile"><span class="tl">${A.k_avg}</span><strong class="tv-num">${fmtMin(t.avgDay)}</strong><span class="muted small">${A.k_people}: ${t.activePeople}</span></div>
      <div class="tile"><span class="tl">${A.k_late} · ${A.k_missed}</span><strong class="tv-num">${t.late} · ${t.requests + t.review}</strong><span class="muted small">${A.missed_hint(t.requests, t.review)}</span></div>
    </div>`;

    const dailyEvery = a.daily.length <= 14 ? 1 : a.daily.length <= 31 ? 3 : 7;
    const daily = columns({
      items: a.daily.map((d) => ({ key: d.date, value: hours(d.minutes), label: ddmm(d.date),
        tip: `${ddmm(d.date)}, ${L.weekdays[weekday(d.date) - 1]} — ${fmtMin(d.minutes)} ${A.h} · ${fmtAmd(d.cost)} · ${A.people_n(d.people)}` })),
      tickFmt: (v) => `${v}`, every: dailyEvery, highlight: (it) => it.key === today(), cls: a.daily.length > 40 ? 'dense' : '',
    });
    const maxPerson = Math.max(...a.people.map((p) => p.minutes), 1);
    const people = html`<ul class="hbars">${a.people.filter((p) => p.minutes > 0).map((p) => html`<li data-tip="${p.employee.full_name} — ${fmtMin(p.minutes)} ${A.h} · ${fmtAmd(p.cost)} · ${p.days} ${A.col_days.toLowerCase()}">
      <span class="hn">${p.employee.full_name}</span>
      <span class="ht"><i style="width:${(p.minutes / maxPerson) * 100}%"></i></span>
      <span class="hv"><strong>${fmtMin(p.minutes)}</strong> <span class="muted">${fmtAmd(p.cost)}</span></span></li>`)}</ul>`;
    const weekdays = columns({
      items: a.weekdays.map((w) => ({ key: w.wd, value: hours(w.avg), label: L.weekdays[w.wd - 1], tip: `${L.weekdays[w.wd - 1]} — ${fmtMin(w.avg)} ${A.h}` })),
      tickFmt: (v) => `${v}`, height: 160, cls: 'wide',
    });
    const months = columns({
      items: a.months.map((m) => ({ key: m.month, value: m.cost, label: monthName(m.month), tip: `${L.months_nom[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(0, 4)} — ${fmtAmd(m.cost)} · ${fmtMin(m.minutes)} ${A.h}` })),
      tickFmt: compactAmd, height: 160, cls: 'wide', highlight: (it) => it.key === monthStart(range.end),
    });

    const body = html`
      <div class="head"><h1>${A.title}</h1><p class="sub">${rangeLabel(L, lang, range.start, range.end)}</p></div>
      <div class="rangebar">
        <div class="seg seg4" role="group" aria-label="${A.quick}">${PRESETS.map((k) => html`<a href="/analytics?r=${k}" class="${active === k ? 'on' : ''}">${A[`r_${k}`]}</a>`)}</div>
        <form class="range plain" method="get" action="/analytics">
          <label><span class="sr">${A.from}</span><input type="date" name="from" value="${range.start}" required></label>
          <span class="dash" aria-hidden="true">–</span>
          <label><span class="sr">${A.to}</span><input type="date" name="to" value="${range.end}" required></label>
          <button class="btn primary">${A.show}</button>
        </form>
      </div>
      ${tiles}
      ${t.minutes ? html`
      <section class="block chartcard"><h2>${A.c_daily}</h2><p class="muted small">${A.c_daily_sub}</p>${daily}
        ${tableView(A, [A.col_date, A.col_hours, A.col_cost, A.col_people], a.daily.filter((d) => d.minutes).map((d) => [`${ddmm(d.date)}, ${L.weekdays[weekday(d.date) - 1]}`, fmtMin(d.minutes), fmtAmd(d.cost), d.people]))}</section>
      <div class="two">
        <section class="block chartcard"><h2>${A.c_people}</h2>${people}</section>
        <section class="block chartcard"><h2>${A.c_weekday}</h2><p class="muted small">${A.c_weekday_sub}</p>${weekdays}
          ${tableView(A, [A.col_wd, A.col_hours], a.weekdays.map((w) => [L.weekdays[w.wd - 1], fmtMin(w.avg)]))}</section>
      </div>` : html`<p class="empty">${A.empty}</p>`}
      <section class="block chartcard"><h2>${A.c_months}</h2><p class="muted small">${A.c_months_sub}</p>${months}
        ${tableView(A, [A.col_month, A.col_cost, A.col_hours], a.months.map((m) => [`${L.months_nom[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(0, 4)}`, fmtAmd(m.cost), fmtMin(m.minutes)]))}</section>
      ${a.people.length ? html`<section class="block"><h2>${A.t_punct}</h2><p class="muted small">${A.t_punct_sub}</p>
        <div class="table-wrap"><table class="pay">
          <thead><tr><th scope="col">${A.col_emp}</th><th scope="col">${A.col_days}</th><th scope="col">${A.col_in}</th><th scope="col">${A.col_out}</th><th scope="col">${A.col_avg}</th><th scope="col">${A.col_late}</th><th scope="col">${A.col_req}</th><th scope="col">${A.col_edit}</th></tr></thead>
          <tbody>${a.people.map((p) => html`<tr><th scope="row"><a href="/employees/${p.employee.id}">${p.employee.full_name}</a></th>
            <td>${p.days}</td><td class="time">${hhmm(p.avgIn)}</td><td class="time">${hhmm(p.avgOut)}</td><td class="time">${fmtMin(p.avgDay)}</td>
            <td>${p.late ? html`<span class="tag warn">${p.late}</span>` : '0'}</td><td>${p.requests + p.review ? html`<span class="tag warn">${p.requests + p.review}</span>` : '0'}</td><td>${p.edited}</td></tr>`)}</tbody>
        </table></div></section>` : ''}`;
    res.page({ title: A.title, active: 'analytics', body });
  });
}

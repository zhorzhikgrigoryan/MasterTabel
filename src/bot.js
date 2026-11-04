// Telegram bot for employees (and owner login).
import { Bot, InlineKeyboard } from 'grammy';
import { t, ot, LANG_NAMES, buttonKey } from './i18n.js';
import * as E from './core/employees.js';
import * as S from './core/shifts.js';
import { summarizeOne } from './core/calc.js';
import { getSettings } from './core/settings.js';
import { confirmToken, isAdmin, listAdmins } from './core/auth.js';
import { hm, today, weekStart, addDays, periodOf, parseHM, fmtMin, fmtAmd } from './time.js';

const state = new Map(); // telegramId -> { awaiting: 'in'|'out', invite: token }

let seenUrl = null; // learned from the first real visit to the panel
export function rememberPublicUrl(url) { if (url && !/localhost|127\.0\.0\.1/.test(url)) seenUrl = url; }
export function publicUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (seenUrl) return seenUrl;
  return `http://localhost:${process.env.PORT || 3000}`;
}

export function mainKeyboard(lang, isOpen) {
  const L = t(lang);
  return {
    keyboard: [[{ text: isOpen ? L.btn_out : L.btn_in }], [{ text: L.btn_forgot }, { text: L.btn_hours }], [{ text: L.btn_lang }]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

async function keyboardFor(emp) {
  return mainKeyboard(emp.lang, !!(await S.openShift(emp.id)));
}

const ddmm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

export function createBot(token) {
  const bot = new Bot(token);
  let ownerLang = 'hy';

  async function notifyOwner(build) {
    const st = await getSettings();
    if (!st.notify_owner_requests) return;
    ownerLang = st.admin_lang;
    for (const a of await listAdmins()) {
      try { await bot.api.sendMessage(a.telegram_id, build(ot(st.admin_lang))); } catch (e) { console.error('notify admin', e.message); }
    }
  }

  // ---------- /start (invite, owner claim/login) ----------
  bot.command('start', async (ctx) => {
    const payload = (ctx.match || '').trim();
    const from = ctx.from;
    const st = await getSettings();
    const O = ot(st.admin_lang);

    const m = payload.match(/^(claim|login|admin)_(.+)$/);
    if (m) {
      const kind = m[1] === 'admin' ? 'invite' : m[1];
      const res = await confirmToken(kind, m[2], from.id, [from.first_name, from.last_name].filter(Boolean).join(' '));
      if (res === 'added') return ctx.reply(O.admin_added(publicUrl()));
      if (res === 'ok') return ctx.reply(kind === 'claim' ? O.claimed(publicUrl()) : O.login_ok);
      if (res === 'not_admin' || res === 'taken') return ctx.reply(O.not_owner);
      return ctx.reply(O.link_expired);
    }

    if (payload.startsWith('inv_')) {
      const emp = await E.getByInvite(payload.slice(4));
      if (!emp || emp.status === 'deactivated') return ctx.reply(t('hy').invite_invalid);
      if (String(emp.telegram_id) === String(from.id)) {
        return ctx.reply(t(emp.lang).joined(emp.full_name), { reply_markup: await keyboardFor(emp) });
      }
      state.set(from.id, { invite: payload.slice(4) });
      const L = t(emp.lang);
      return ctx.reply(L.share_phone, {
        reply_markup: { keyboard: [[{ text: L.btn_share, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
      });
    }

    const emp = await E.getByTelegram(from.id);
    if (emp) {
      if (emp.status === 'deactivated') return ctx.reply(t(emp.lang).deactivated, { reply_markup: { remove_keyboard: true } });
      return ctx.reply(t(emp.lang).joined(emp.full_name), { reply_markup: await keyboardFor(emp) });
    }
    if (await isAdmin(from.id)) return ctx.reply(O.hello(publicUrl()));
    return ctx.reply(t('hy').need_invite);
  });

  bot.command('panel', async (ctx) => {
    const st = await getSettings();
    if (await isAdmin(ctx.from.id)) return ctx.reply(ot(st.admin_lang).hello(publicUrl()));
  });

  // ---------- Joining: phone number ----------
  bot.on('message:contact', async (ctx) => {
    const s = state.get(ctx.from.id);
    if (!s?.invite) return;
    const c = ctx.message.contact;
    const pending = await E.getByInvite(s.invite);
    const L = t(pending?.lang || 'hy');
    if (c.user_id && c.user_id !== ctx.from.id) return ctx.reply(L.not_own_contact);
    const res = await E.linkTelegram(s.invite, ctx.from.id, c.phone_number, ctx.from.username);
    if (res.error === 'phone') return ctx.reply(L.phone_mismatch, { reply_markup: { remove_keyboard: true } });
    if (res.error) return ctx.reply(L.invite_invalid, { reply_markup: { remove_keyboard: true } });
    state.delete(ctx.from.id);
    return ctx.reply(t(res.employee.lang).joined(res.employee.full_name), { reply_markup: await keyboardFor(res.employee) });
  });

  // ---------- Employee helpers ----------
  async function employeeFor(ctx) {
    const emp = await E.getByTelegram(ctx.from.id);
    if (!emp) { await ctx.reply(t('hy').need_invite); return null; }
    if (emp.status === 'deactivated') { await ctx.reply(t(emp.lang).deactivated, { reply_markup: { remove_keyboard: true } }); return null; }
    return emp;
  }

  async function doCheckIn(ctx, emp) {
    const L = t(emp.lang); const st = await getSettings();
    try {
      const s = await S.checkIn(emp, st);
      const msg = L.checked_in(hm(s.check_in)) + (s.out_of_window ? `\n\n${L.outside_note}` : '');
      return ctx.reply(msg, { reply_markup: mainKeyboard(emp.lang, true) });
    } catch (e) {
      if (e.code === 'already_in') return ctx.reply(L.already_in(hm(e.shift.check_in)), { reply_markup: mainKeyboard(emp.lang, true) });
      throw e;
    }
  }

  async function doCheckOut(ctx, emp) {
    const L = t(emp.lang); const st = await getSettings();
    try {
      const s = await S.checkOut(emp, st);
      const d = (await summarizeOne(emp, s.work_date, s.work_date, st)).days[s.work_date];
      return ctx.reply(L.checked_out(hm(s.check_out), fmtMin(d.minutes), d.breakMin ? fmtMin(d.breakMin) : ''),
        { reply_markup: mainKeyboard(emp.lang, false) });
    } catch (e) {
      if (e.code === 'not_in') return ctx.reply(L.not_in, { reply_markup: mainKeyboard(emp.lang, false) });
      throw e;
    }
  }

  async function showHours(ctx, emp) {
    const L = t(emp.lang); const st = await getSettings();
    const d = today(); const ws = weekStart(d);
    const per = periodOf(emp.pay_cycle, d);
    const [day, week, period] = await Promise.all([
      summarizeOne(emp, d, d, st), summarizeOne(emp, ws, addDays(ws, 6), st), summarizeOne(emp, per.start, per.end, st),
    ]);
    const open = await S.openShift(emp.id);
    return ctx.reply(L.hours({
      today: fmtMin(day.minutes), week: fmtMin(week.minutes), period: fmtMin(period.minutes),
      periodLabel: emp.pay_cycle === 'weekly' ? L.period_week : L.period_month,
      estimate: fmtAmd(period.earned), open: open ? hm(open.check_in) : '', pending: period.flags.pending > 0,
    }), { reply_markup: mainKeyboard(emp.lang, !!open) });
  }

  async function askForgot(ctx, emp) {
    const L = t(emp.lang);
    const open = await S.openShift(emp.id);
    const target = await S.forgotOutTarget(emp.id);
    const kb = new InlineKeyboard();
    if (!open) kb.text(L.forgot_in_btn, 'forgot:in');
    if (target) kb.text(L.forgot_out_btn, 'forgot:out');
    return ctx.reply(L.forgot_choose, { reply_markup: kb });
  }

  async function handleTime(ctx, emp, kind, text) {
    const L = t(emp.lang); const st = await getSettings();
    const time = parseHM(text);
    if (!time) return ctx.reply(L.bad_time);
    try {
      const s = kind === 'in' ? await S.requestIn(emp, time, st) : await S.requestOut(emp, time, st);
      state.delete(ctx.from.id);
      await notifyOwner((O) => O.request(emp.full_name, kind === 'in' ? O.in : O.out, time, ddmm(s.work_date)));
      return ctx.reply(L.request_sent(kind === 'in' ? L.in_word : L.out_word, time), { reply_markup: await keyboardFor(emp) });
    } catch (e) {
      const map = {
        future: () => L.future,
        before_in: () => L.before_in(hm(e.shift.check_in)),
        overlap: () => L.overlap(hm(e.shift.check_out)),
        already_in: () => L.already_in(''),
        not_in: () => L.not_in,
      };
      if (map[e.code]) {
        if (e.code === 'already_in' || e.code === 'not_in') state.delete(ctx.from.id);
        return ctx.reply(map[e.code]());
      }
      throw e;
    }
  }

  // ---------- Text messages ----------
  bot.on('message:text', async (ctx) => {
    const emp = await employeeFor(ctx); if (!emp) return;
    const key = buttonKey(ctx.message.text);
    const s = state.get(ctx.from.id);
    if (!key && s?.awaiting) return handleTime(ctx, emp, s.awaiting, ctx.message.text);
    state.delete(ctx.from.id);
    if (key === 'btn_in') return doCheckIn(ctx, emp);
    if (key === 'btn_out') return doCheckOut(ctx, emp);
    if (key === 'btn_hours') return showHours(ctx, emp);
    if (key === 'btn_forgot') return askForgot(ctx, emp);
    if (key === 'btn_lang') {
      const kb = new InlineKeyboard();
      for (const [code, name] of Object.entries(LANG_NAMES)) kb.text(name, `lang:${code}`);
      return ctx.reply(t(emp.lang).choose_lang, { reply_markup: kb });
    }
    return ctx.reply(t(emp.lang).use_buttons, { reply_markup: await keyboardFor(emp) });
  });

  // ---------- Inline buttons ----------
  bot.on('callback_query:data', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const emp = await employeeFor(ctx); if (!emp) return;
    const [kind, val] = ctx.callbackQuery.data.split(':');
    if (kind === 'lang' && ['hy', 'ru', 'en'].includes(val)) {
      const upd = await E.setLang(emp.id, val);
      return ctx.reply(t(val).lang_set, { reply_markup: await keyboardFor(upd) });
    }
    if (kind === 'forgot') {
      const L = t(emp.lang);
      if (val === 'in') {
        state.set(ctx.from.id, { awaiting: 'in' });
        return ctx.reply(L.ask_time_in);
      }
      const target = await S.forgotOutTarget(emp.id);
      if (!target) return ctx.reply(L.not_in);
      state.set(ctx.from.id, { awaiting: 'out' });
      return ctx.reply(L.ask_time_out(ddmm(target.work_date)));
    }
    if (kind === 'act' && val === 'in') return doCheckIn(ctx, emp);
    if (kind === 'act' && val === 'out') return doCheckOut(ctx, emp);
  });

  bot.catch((err) => console.error('Bot error:', err.error?.message || err));

  return { bot, notifyOwner, ownerLang: () => ownerLang };
}

/** Reminder sender used by the scheduler. */
export function reminderSender(bot) {
  return async (emp, kind) => {
    const L = t(emp.lang);
    const text = kind === 'in' ? L.remind_in(emp.sched_start)
      : kind === 'out' ? L.remind_out(emp.sched_end) : L.remind_out2;
    const kb = new InlineKeyboard().text(kind === 'in' ? L.btn_in_now : L.btn_out_now, kind === 'in' ? 'act:in' : 'act:out');
    await bot.api.sendMessage(emp.telegram_id, text, { reply_markup: kb });
  };
}

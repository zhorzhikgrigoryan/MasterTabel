import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect, close, q } from '../src/db.js';
import { createBot } from '../src/bot.js';
import { tick } from '../src/reminders.js';
import * as E from '../src/core/employees.js';
import { createAuthToken, exchangeToken, validSession, listAdmins, removeAdmin, isAdmin } from '../src/core/auth.js';
import { t } from '../src/i18n.js';
import { at, today, weekday } from '../src/time.js';

let bot; let calls = []; let uid = 1;
const USER = { id: 5001, is_bot: false, first_name: 'Anna', username: 'anna' };
const OWNER = { id: 9001, is_bot: false, first_name: 'Zhorzhik' };

function msg(from, text, extra = {}) {
  const entities = text?.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : undefined;
  return { update_id: uid++, message: { message_id: uid, date: Math.floor(Date.now() / 1000), chat: { id: from.id, type: 'private' }, from, text, entities, ...extra } };
}
function cb(from, data) {
  return { update_id: uid++, callback_query: { id: String(uid), from, chat_instance: '1', data,
    message: { message_id: 1, date: 0, chat: { id: from.id, type: 'private' } } } };
}
const said = () => calls.filter((c) => c.method === 'sendMessage').map((c) => c.payload.text);
const last = () => said().at(-1);
async function send(update) { calls = []; await bot.handleUpdate(update); }

before(async () => {
  await connect({ memory: true });
  const made = createBot('123:TEST');
  bot = made.bot;
  bot.botInfo = { id: 1, is_bot: true, first_name: 'MasterTabel', username: 'mastertabel_test_bot',
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false };
  bot.api.config.use(async (prev, method, payload) => {
    calls.push({ method, payload });
    if (method === 'sendMessage') return { ok: true, result: { message_id: 1, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text } };
    return { ok: true, result: true };
  });
});
after(async () => { await close(); });

test('owner claims the bot, then logs in', async () => {
  const claim = await createAuthToken('claim');
  await send(msg(OWNER, `/start claim_${claim}`));
  assert.match(last(), /owner|սեփականատեր/);
  const session = await exchangeToken(claim);
  assert.ok(await validSession(session));
  // Someone else cannot log in
  const login = await createAuthToken('login');
  await send(msg(USER, `/start login_${login}`));
  assert.equal(await exchangeToken(login), null);
});

test('admin invites a second admin with full access, then removes them', async () => {
  const SECOND = { id: 9002, is_bot: false, first_name: 'Ani' };
  const inv = await createAuthToken('invite', OWNER.id);
  await send(msg(SECOND, `/start admin_${inv}`));
  assert.match(last(), /ադմին/);
  assert.ok(await isAdmin(SECOND.id));
  // the invite works only once
  await send(msg({ id: 9003, is_bot: false, first_name: 'X' }, `/start admin_${inv}`));
  assert.ok(!(await isAdmin(9003)));
  // second admin can log in
  const login = await createAuthToken('login');
  await send(msg(SECOND, `/start login_${login}`));
  const session = await exchangeToken(login);
  assert.ok(await validSession(session));
  // removed -> session no longer valid; last admin can't be removed
  assert.equal(await removeAdmin(SECOND.id), 'ok');
  assert.equal(await validSession(session), false);
  assert.equal((await listAdmins()).length, 1);
  assert.equal(await removeAdmin(OWNER.id), 'last');
});

test('employee joins, checks in and out, asks hours, forgot flow, language', async () => {
  const emp = await E.createEmployee({ full_name: 'Anna', phone: '+374 91 111111', hourly_amd: 2000, rate_from: '2026-01-01' });
  const L = t('hy');
  await send(msg(USER, `/start inv_${emp.invite_token}`));
  assert.equal(last(), L.share_phone);
  // Wrong number
  await send(msg(USER, undefined, { contact: { phone_number: '+37491222222', first_name: 'A', user_id: USER.id } }));
  assert.equal(last(), L.phone_mismatch);
  await send(msg(USER, `/start inv_${emp.invite_token}`));
  await send(msg(USER, undefined, { contact: { phone_number: '37491111111', first_name: 'A', user_id: USER.id } }));
  assert.match(last(), /Anna/);

  await send(msg(USER, L.btn_in));
  assert.match(last(), /Աշխատանքը սկսված է/);
  await send(msg(USER, L.btn_in));
  assert.match(last(), /արդեն/);
  await send(msg(USER, L.btn_out));
  assert.match(last(), /ավարտված/);
  await send(msg(USER, L.btn_hours));
  assert.match(last(), /Ձեր ժամերը/);

  // Forgot to check in: give a time earlier today... but after the last checkout -> overlap or future
  await send(msg(USER, L.btn_forgot));
  const kb = calls.find((c) => c.method === 'sendMessage').payload.reply_markup.inline_keyboard[0].map((b) => b.callback_data);
  assert.ok(kb.includes('forgot:in'));
  await send(cb(USER, 'forgot:in'));
  assert.equal(last(), L.ask_time_in);
  await send(msg(USER, 'abc'));
  assert.equal(last(), L.bad_time);
  await send(msg(USER, '23:58'));
  assert.ok([L.future].includes(last()) || /հարցումը|նախորդ/.test(last()));

  // Language switch
  await send(cb(USER, 'lang:ru'));
  assert.equal(last(), t('ru').lang_set);
  await send(msg(USER, t('ru').btn_hours));
  assert.match(last(), /Ваши часы/);
});

test('unknown user is asked for an invite', async () => {
  await send(msg({ id: 777, is_bot: false, first_name: 'X' }, '/start'));
  assert.equal(last(), t('hy').need_invite);
});

test('reminders: once each, only when due', async () => {
  const d = today();
  const emp = await E.createEmployee({ full_name: 'Gor', phone: '+37491333333', sched_days: [weekday(d)],
    sched_start: '09:00', sched_end: '18:00' });
  await q(`UPDATE employees SET telegram_id=6001, status='active' WHERE id=$1`, [emp.id]);
  const sent = [];
  const fake = async (e, kind) => sent.push([e.full_name, kind]);
  await tick(fake, at(d, '09:10'));
  assert.equal(sent.length, 0);
  await tick(fake, at(d, '09:16'));
  await tick(fake, at(d, '09:30'));
  assert.deepEqual(sent, [['Gor', 'in']]);
  await q(`INSERT INTO shifts (employee_id, work_date, check_in) VALUES ($1,$2,$3)`, [emp.id, d, at(d, '09:40')]);
  await tick(fake, at(d, '18:00'));
  await tick(fake, at(d, '19:00'));
  assert.deepEqual(sent.map((s) => s[1]), ['in', 'out', 'out2']);
  await tick(fake, at(d, '23:59'));
  const [s] = await q(`SELECT status FROM shifts WHERE employee_id=$1`, [emp.id]);
  assert.equal(s.status, 'review');
});

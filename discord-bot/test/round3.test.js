import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commands } from '../src/commands.js';
import { FORMS } from '../src/applications.js';
import { formatSlot, localNow, parseSchedule, slotsStartingNow } from '../src/schedule.js';
import { discountedFee } from '../src/services.js';
import { Store } from '../src/store.js';
import * as views from '../src/views.js';
import { card } from './helpers.js';

const tempStore = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'r3-')), 'store.json'));
const ids = (rows) => rows.flatMap((r) => r.toJSON().components.map((c) => c.custom_id ?? c.url));
const newOrder = (store, customerId = 'cust', fee = 2.5) =>
  store.createOrder({ service: 'ubereats', promo: '10 off', fee, vc: false, details: { address: '1 Road' }, customerId });
const completeOrder = (store, customerId) => {
  const o = newOrder(store, customerId);
  store.accept(o.id, 'staff');
  store.complete(o.id, new Date());
  return o;
};

test('discount codes: personal, single use, and given back when the order is cancelled', () => {
  const store = tempStore();
  const released = [];
  store.onCodeReleased = (code, order) => released.push([code.code, order.id]);
  const free = store.createCode({ type: 'free', ownerId: 'cust' });
  assert.match(free.code, /^FH-[A-Z2-9]{6}$/);
  assert.match(store.checkCode(free.code, 'someone').error, /belongs to someone else/);
  assert.match(store.checkCode('FH-NOPE00', 'cust').error, /isn't a valid code/);
  assert.equal(store.checkCode(` ${free.code.toLowerCase()} `, 'cust').code.code, free.code, 'case and spaces ignored');

  const order = newOrder(store);
  assert.equal(store.redeemCode(free.code, 'cust', order.id).code.status, 'used');
  assert.match(store.checkCode(free.code, 'cust').error, /already been used/);
  store.updateOrder(order.id, { code: free.code });
  store.cancel(order.id, 'cust');
  assert.deepEqual(released, [[free.code, order.id]]);
  assert.equal(store.getCode(free.code).status, 'active');

  assert.equal(discountedFee(2.5, { type: 'free' }), 0);
  assert.equal(discountedFee(2.5, { type: 'discount', amount: 0.5 }), 2);
  assert.equal(discountedFee(0.3, { type: 'discount', amount: 0.5 }), 0);
});

test('referrals: invitee gets 50p after their first order; inviter gets one free-fee order when 3 friends have ordered', () => {
  const store = tempStore();
  store.setInviteLink('ref', 'abc');
  assert.equal(store.inviteOwner('abc'), 'ref');
  assert.equal(store.recordJoin('ref', 'ref'), false, 'no self-referrals');
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) assert.equal(store.recordJoin(id, 'ref'), true);
  assert.equal(store.recordJoin('a', 'other'), false, 'first referrer keeps them');

  assert.equal(store.claimInviteeReward('a', 0.5).error, 'not_yet', 'nothing before the first order');
  completeOrder(store, 'a');
  const { code } = store.claimInviteeReward('a', 0.5);
  assert.deepEqual([code.type, code.amount, code.ownerId], ['discount', 0.5, 'a']);
  assert.equal(store.claimInviteeReward('a', 0.5).error, 'claimed', 'once only');
  assert.equal(store.claimInviteeReward('stranger', 0.5).error, 'not_invited');

  completeOrder(store, 'b');
  assert.equal(store.claimReferralReward('ref').error, 'not_yet', '2 of 3');
  completeOrder(store, 'c');
  assert.equal(store.claimReferralReward('ref').code.type, 'free');
  for (const id of ['d', 'e', 'f']) completeOrder(store, id);
  assert.equal(store.claimReferralReward('ref').error, 'claimed', 'the inviter reward is once only');
  assert.equal(store.codesFor('ref').length, 1);
});

test('trial stats, keep open, staff cancel and online timeouts', () => {
  const store = tempStore();
  const a = newOrder(store);
  store.accept(a.id, 'trial1');
  store.updateOrder(a.id, { trial: true });
  const b = newOrder(store);
  store.accept(b.id, 'trial1');
  store.updateOrder(b.id, { trial: true });
  store.complete(a.id, new Date(Date.now() + 3600e3));
  const stats = store.trialStats();
  assert.deepEqual([stats.trial1.completed.length, stats.trial1.inProgress.length], [1, 1]);
  assert.ok(card(views.trialPanel(stats, 'role')).text.includes(`#${a.id}`));

  assert.equal(store.keepOpen(a.id).order.closeAt, null);
  assert.equal(store.dueForClose(Date.now() + 9e9).length, 0);
  assert.equal(store.staffCancel(b.id, 'staff', 'no show').order.status, 'cancelled');
  assert.ok(store.staffCancel(a.id, 'staff').error, 'completed orders can\'t be cancelled');

  store.setOnline('s1', ['ubereats'], new Date(Date.now() - 1000));
  store.setOnline('s2', ['ubereats'], new Date(Date.now() + 60e3));
  assert.deepEqual(store.expiredOnline(), ['s1']);
  assert.deepEqual(store.onlineByService().ubereats, ['s2'], 'timed-out staff aren\'t pinged');
  assert.deepEqual(store.getStaff('s1').usualServices, ['ubereats']);
});

test('schedules parse common formats and fire at the slot start', () => {
  const { slots, errors } = parseSchedule('Mon-Fri 6pm-10pm, Sat 12-23:30\nweekends 10:00-14:00\ndaily 22:00-02:00');
  assert.deepEqual(errors, []);
  assert.deepEqual(slots.map(formatSlot), ['Mon–Fri 18:00–22:00', 'Sat 12:00–23:30', 'Sat–Sun 10:00–14:00', 'Every day 22:00–02:00 (next day)']);
  assert.deepEqual(parseSchedule('Monday to Thursday from 7pm to 11pm').slots.map(formatSlot), ['Mon–Thu 19:00–23:00']);
  assert.ok(parseSchedule('whenever lol 5-6').errors.length);
  const starting = slotsStartingNow(slots, { day: 0, minutes: 18 * 60 });
  assert.deepEqual(starting.map((s) => s.length), [240]);
  assert.equal(slotsStartingNow(slots, { day: 1, minutes: 22 * 60 })[0].length, 240, 'overnight slot lasts until 02:00');
  const now = localNow('Europe/London', new Date('2026-07-06T17:00:00Z')); // a Monday, BST
  assert.deepEqual([now.day, now.minutes, now.date], [0, 18 * 60, '2026-07-06']);
});

test('new panels and forms serialize within Discord limits', () => {
  assert.deepEqual(card(views.referralPanel()).ids, ['ref:link', 'ref:stats', 'ref:codes']);
  const msg = views.codeMessage({ code: 'FH-ABC234', type: 'discount', amount: 0.5 }, 'hi');
  assert.equal(msg.content, 'FH-ABC234');
  assert.deepEqual(ids(msg.components), ['ref:copy:FH-ABC234']);
  const stats = JSON.stringify(views.referralStatsEmbed({ invited: ['a', 'b'], ordered: ['a'], rewarded: false }, { reward: 'waiting', tracking: false }).toJSON());
  assert.ok(stats.includes('✅  <@a>') && stats.includes('⏳  <@b>') && stats.includes('first order') && stats.includes('Tracking is off') && stats.includes('1/3') && stats.includes('2 more to go'));

  const list = views.suggestionListEmbeds(Array.from({ length: 60 }, (_, i) => ({ number: i + 1, userId: '1', text: 'x'.repeat(200), createdAt: new Date().toISOString() })));
  assert.ok(list.length > 1 && list.every((e) => e.toJSON().description.length <= 4096));
  assert.ok(views.suggestionListEmbeds([])[0].toJSON().description.includes('No suggestions'));
  assert.deepEqual(card(views.suggestionSticky(3)).ids, ['suggest:add', 'suggest:clear']);
  views.suggestionModal().toJSON();

  assert.deepEqual(card(views.applyPanel()).ids, ['apply:orderer', 'apply:partner']);
  for (const form of Object.values(FORMS)) {
    form.steps.forEach((_, i) => views.applicationQuestion(form, i).components[0].toJSON());
    const app = { id: 1, type: 'orderer', userId: '1', answers: {}, status: 'pending', createdAt: new Date().toISOString() };
    views.applicationEmbed(app, form).toJSON();
  }
  assert.deepEqual(ids(views.applicationButtons({ id: 7, type: 'orderer', status: 'pending' })), ['apply:accept:7', 'apply:deny:7']);

  const captcha = views.captchaView({ orderId: 1, token: 't', choices: ['🍔', '🍕', '🍟', '🌮'], answer: '🍕' });
  assert.deepEqual(ids(captcha.components), ['order:captcha:t:0', 'order:captcha:t:1', 'order:captcha:t:2', 'order:captcha:t:3']);
  views.cancelOrderModal(1).toJSON();
  assert.ok(ids(views.onlineDurationPicker(['ubereats', 'ubertrain']).components).every((id) => id.length <= 100));
  views.scheduleModal('Mon 1-2').toJSON();
  assert.deepEqual(ids(views.schedulePrompt(new Date(Date.now() + 3600e3)).components).length, 2);
  views.staffStatusEmbed({ online: ['ubereats'], onlineUntil: new Date().toISOString(), payments: {}, schedule: { slots: parseSchedule('Mon 1-2').slots } }, 'Europe/London').toJSON();
  assert.ok(card(views.transcriptPanel(false)).text.includes('Message Content Intent is off'));

  const names = commands.map((c) => c.toJSON().name);
  for (const n of ['trialpanel', 'referralpanel', 'suggestionpanel', 'applypanel', 'complete', 'close', 'delete', 'rename', 'wise', 'giveaway']) assert.ok(names.includes(n), n);
  assert.equal(new Set(names).size, names.length, 'no duplicate command names');
  assert.ok(names.length <= 100);
});

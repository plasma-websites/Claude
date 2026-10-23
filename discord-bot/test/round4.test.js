import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commands } from '../src/commands.js';
import { Store } from '../src/store.js';
import * as views from '../src/views.js';
import { card } from './helpers.js';

const tempStore = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'r4-')), 'store.json'));
const ids = (rows) => rows.flatMap((r) => r.toJSON().components.map((c) => c.custom_id ?? c.url));
const hours = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const newOrder = (store, customerId = 'cust') => store.createOrder({ service: 'ubereats', promo: '10 off', fee: 2.5, vc: false, details: { address: '1 Road' }, customerId });

test('saved addresses: newest first, no duplicates, max 5, removable', () => {
  const store = tempStore();
  for (const a of ['1 A St', '2 B St', '1 a st', '3 C', '4 D', '5 E', '6 F']) store.saveAddress('u', a);
  assert.deepEqual(store.addressesOf('u'), ['6 F', '5 E', '4 D', '3 C', '1 a st']);
  assert.deepEqual(store.removeAddress('u', 0), ['5 E', '4 D', '3 C', '1 a st']);
  assert.deepEqual(store.addressesOf('nobody'), []);
});

test('vouch reminders go out 1-24h after completion, once, unless vouched', () => {
  const store = tempStore();
  const make = (completedAt, extra = {}) => store.updateOrder(newOrder(store).id, { status: 'completed', completedAt, ...extra });
  const due = make(hours(1.5));
  make(hours(0.5)); // too soon
  make(hours(30)); // from before the feature / too old
  make(hours(2), { vouch: 4 }); // already vouched
  make(hours(2), { vouchReminded: true });
  assert.deepEqual(store.vouchRemindersDue().map((o) => o.id), [due.id]);
});

test('loyalty: 10 completed orders in 21 days earns one code, then starts again', () => {
  const store = tempStore();
  const rules = { orders: 10, days: 21 };
  const complete = (ago) => store.updateOrder(newOrder(store, 'loyal').id, { status: 'closed', completedAt: hours(ago) });
  complete(24 * 30); // too old to count
  for (let i = 0; i < 9; i++) complete(i + 1);
  assert.equal(store.loyaltyOrders('loyal', 21).length, 9);
  assert.equal(store.claimLoyalty('loyal', rules), null);
  complete(0.1);
  const code = store.claimLoyalty('loyal', rules);
  assert.equal(code.type, 'free');
  assert.equal(store.loyaltyOrders('loyal', 21).length, 0, 'used orders don\'t count again');
  assert.equal(store.claimLoyalty('loyal', rules), null);

  const progress = views.loyaltyProgressEmbed([{ completedAt: hours(1) }, { completedAt: hours(2) }, { completedAt: hours(3) }], rules).toJSON();
  assert.ok(progress.description.startsWith('🍔 🍔 🍔 ⚪ ⚪\n⚪ ⚪ ⚪ ⚪ ⚪') && progress.description.includes('**3 / 10**'));
  assert.ok(card(views.loyaltyPanel(rules)).text.includes('3 weeks'));
  assert.deepEqual(card(views.loyaltyPanel(rules)).ids, ['loyalty:check']);
});

test('daily stats: submitted, completed, cancelled, most orders and fastest', () => {
  const store = tempStore();
  const dateOf = (iso) => iso.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const done = (orderer, minutesTaken) => {
    const o = newOrder(store);
    const completedAt = new Date().toISOString();
    store.updateOrder(o.id, { status: 'completed', ordererId: orderer, acceptedAt: new Date(Date.now() - minutesTaken * 60000).toISOString(), completedAt });
  };
  done('slow', 40);
  done('slow', 20);
  done('quick', 5);
  store.cancel(newOrder(store).id, 'cust');
  const stats = store.dailyStats(today, dateOf);
  assert.deepEqual([stats.submitted, stats.completed, stats.cancelled, stats.fees], [4, 3, 1, 7.5]);
  assert.equal(stats.most.userId, 'slow');
  assert.equal(stats.fastest.userId, 'quick');
  assert.equal(Math.round(stats.byOrderer.slow.avgMinutes), 30);

  const view = views.dailyStatsView(stats);
  const { text, ids: buttons } = card(views.dailyStatsView(stats, { ping: '<@&ord>' }));
  assert.ok(text.includes('<@slow>') && text.includes('avg 5 min') && text.includes('£7.50') && text.includes('<@&ord>'));
  assert.deepEqual(buttons, [`stats:me:${today}`]);
  const mine = JSON.stringify(views.personalStatsEmbed(stats, 'slow').toJSON());
  assert.ok(mine.includes('#1 of 2') && mine.includes('20 min fastest'));
  assert.ok(JSON.stringify(views.personalStatsEmbed(stats, 'nobody').toJSON()).includes('0 orders'));
});

test('address picker, address book and prefilled form', () => {
  assert.equal(views.addressFieldOf('ubereats').id, 'address');
  assert.equal(views.addressFieldOf('uberride').id, 'pickup');
  assert.equal(views.addressFieldOf('ubertrain'), null);
  const picker = views.addressPicker('ubereats', '0', 'yes', ['1 Road\nFlat 2', '2 Lane']).components[0].toJSON().components[0];
  assert.equal(picker.custom_id, 'order:addr:ubereats:0:yes');
  assert.deepEqual(picker.options.map((o) => o.value), ['0', '1', 'new']);
  const modal = views.detailsModal('ubereats', '0', 'yes', { address: '1 Road' }).toJSON();
  assert.equal(modal.components[0].components[0].value, '1 Road');
  assert.ok(modal.title.length <= 45);
  assert.deepEqual(ids(views.addressesView(['1 Road']).components), ['order:addrdel', 'order:addradd']);
  assert.deepEqual(ids(views.addressesView([]).components), ['order:addradd']);
  views.addressModal().toJSON();
});

test('every panel is a one-colour V2 card with the server icon, no text dividers, within Discord limits', async () => {
  const promos = (await import('../src/config.js')).loadPromos();
  const { THEME } = await import('../src/util.js');
  const { TOS } = await import('../src/tos.js');
  const { MessageFlags } = await import('discord.js');
  views.setBrand('Food Hub', 'https://cdn.discordapp.com/icons/1/a.png');
  const busy = Object.fromEntries(Object.keys(promos).map((k) => [k, ['1', '2', '3', '4']]));
  const trials = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`u${i}`, { completed: Array.from({ length: 9 }, (_, j) => ({ id: 100000 + j, completedAt: new Date().toISOString() })), inProgress: [] }]));
  const panels = [
    views.ordersPanel(promos, busy), views.supportPanel(), views.verifyPanel('https://x.y'), views.vouchSticky(), views.staffPanel(), views.tosPanel(TOS),
    views.transcriptPanel(false), views.trialPanel(trials, 'r'), views.referralPanel(), views.loyaltyPanel({ orders: 10, days: 21 }), views.applyPanel(), views.whyPanel(),
    views.suggestionSticky(2), views.giveawayView({ id: 1, title: 'T', info: 'x'.repeat(3000), winners: 1, endsAt: new Date().toISOString(), hostId: 'h', entrants: [], winnerIds: [], status: 'running' }),
  ];
  for (const p of panels) {
    const c = card(p);
    assert.equal(p.flags, MessageFlags.IsComponentsV2);
    assert.equal(c.json.accent_color, THEME);
    assert.ok(!c.text.includes('━'), c.text.slice(0, 40));
    assert.ok(c.text.length <= 4000, `${c.text.slice(0, 40)}: ${c.text.length} chars`);
    assert.ok(c.count <= 40, `${c.text.slice(0, 40)}: ${c.count} components`);
  }
  const thumb = card(views.supportPanel()).json.components[0].accessory;
  assert.equal(thumb.media.url, 'https://cdn.discordapp.com/icons/1/a.png', 'server icon beside the heading');
  const names = commands.map((c) => c.toJSON().name);
  for (const n of ['award', 'loyaltypanel', 'stats']) assert.ok(names.includes(n), n);
  assert.equal(new Set(names).size, names.length);
});

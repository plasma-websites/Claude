import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commands } from '../src/commands.js';
import { loadPromos } from '../src/config.js';
import { parseDuration } from '../src/moderation.js';
import { SERVICES } from '../src/services.js';
import * as views from '../src/views.js';

const promos = loadPromos();
const order = {
  id: 483920, service: 'deliveroo', promo: '15f20', vc: false, customerId: '1', ordererId: null, status: 'pending',
  ticketChannelId: null, closeAt: null, screenshot: null, createdAt: new Date().toISOString(),
};
const ids = (rows) => rows.flatMap((r) => r.toJSON().components.map((c) => c.custom_id ?? c.url));

test('order panel lists every company with its promos', () => {
  const { embeds, components } = views.ordersPanel(promos);
  const text = embeds[0].toJSON().description;
  for (const s of Object.values(SERVICES)) assert.ok(text.includes(s.label), s.label);
  assert.ok(text.includes('`15f20`') && text.includes('`12 off`'));
  const menu = components[0].toJSON().components[0];
  assert.equal(menu.custom_id, 'order:service');
  assert.deepEqual(menu.options.map((o) => o.value), ['uberride', 'ubereats', 'deliveroo', 'justeat', 'ubertrain']);
  assert.ok(text.includes('`5 off` (💷 **£1.00**) • `10 off` (💷 **£2.50**)'), 'per-promo fees for trains');
  assert.ok(embeds[0].toJSON().description.length <= 4096);
});

test('order flow components', () => {
  const promo = views.promoPicker('ubereats', promos.ubereats).components[0].toJSON().components[0];
  assert.deepEqual(promo.options.map((o) => o.label), ['10 off', '12 off']);
  const trains = views.promoPicker('ubertrain', promos.ubertrain).embeds[0].toJSON().description;
  assert.ok(trains.includes('£1.00–£2.50'));
  assert.deepEqual(views.detailsModal('ubertrain', '0', 'no').toJSON().components.map((r) => r.components[0].custom_id), ['from', 'to', 'when', 'notes']);
  assert.deepEqual(ids(views.vcPicker('deliveroo', '0').components), ['order:vc:deliveroo:0:yes', 'order:vc:deliveroo:0:no']);
  const modal = views.detailsModal('uberride', '0', 'yes').toJSON();
  assert.equal(modal.custom_id, 'order:details:uberride:0:yes');
  assert.deepEqual(modal.components.map((r) => r.components[0].custom_id), ['pickup', 'dropoff', 'notes']);
  for (const key of Object.keys(SERVICES)) {
    const json = views.detailsModal(key, '0', 'no').toJSON();
    assert.ok(json.title.length <= 45 && json.components.length <= 5 && json.components.every((r) => r.components[0].label.length <= 45));
  }
});

test('ticket names carry status emoji and order number', () => {
  assert.equal(views.orderTicketName({ ...order, status: 'accepted' }), '🔵-order-483920');
  assert.equal(views.orderTicketName({ ...order, status: 'accepted', customerName: 'Plasma.Dev' }), '🔵-order-483920-plasma-dev');
  assert.equal(views.supportTicketName({ id: 813501, status: 'open', userName: 'plasma' }), '🟢-support-813501-plasma');
  assert.equal(views.orderTicketName({ ...order, status: 'completed' }), '🟢-order-483920');
  assert.equal(views.orderTicketName({ ...order, status: 'closed' }), '🔒-order-483920');
  assert.equal(views.supportTicketName({ id: 123456, status: 'open' }), '🟢-support-123456');
});

test('staff and ticket buttons follow status', () => {
  assert.deepEqual(ids(views.staffButtons(order, 'g')), ['order:accept:483920', 'order:ask:483920']);
  assert.equal(views.askQuestionModal(483920).toJSON().custom_id, 'order:askq:483920');
  const accepted = { ...order, status: 'accepted', ordererId: '2', ticketChannelId: 'c' };
  assert.deepEqual(ids(views.staffButtons(accepted, 'g')), ['https://discord.com/channels/g/c']);
  assert.deepEqual(ids(views.ticketButtons(accepted)), ['order:complete:483920', 'order:forfeit:483920', 'order:close:483920', 'order:delete:483920']);
  assert.deepEqual(ids(views.ticketButtons({ ...accepted, status: 'pending', ordererId: null })), ['order:delete:483920'], 'forfeited ticket waits for a new orderer');
  const completed = { ...accepted, status: 'completed', closeAt: new Date().toISOString() };
  assert.deepEqual(ids(views.ticketButtons(completed)), ['order:close:483920', 'order:delete:483920']);
  const closed = { ...completed, status: 'closed', closeAt: null };
  assert.deepEqual(ids(views.ticketButtons(closed)), ['order:delete:483920']);
  assert.deepEqual(views.staffButtons({ ...closed, ticketChannelId: null }, 'g'), [], 'no link once the ticket is deleted');
  const fields = views.orderEmbed(completed).toJSON().fields.map((f) => f.name);
  assert.ok(fields.some((f) => f.includes('VC')) && fields.some((f) => f.includes('auto-deletes')) && fields.some((f) => f.includes('Staff')));
  const withAddress = views.orderEmbed({ ...order, details: { address: '1 High St', notes: '' } }).toJSON().fields;
  assert.equal(withAddress.find((f) => f.name.includes('Delivery address')).value, '1 High St');
  assert.ok(!withAddress.some((f) => f.name.includes('Notes')), 'empty notes are hidden');
});

test('support, verify views and commands serialize', () => {
  assert.equal(views.supportModal().toJSON().custom_id, 'support:modal');
  const ticket = { id: 1, userId: '1', reason: 'x', status: 'open', createdAt: new Date().toISOString() };
  views.supportEmbed(ticket).toJSON();
  assert.deepEqual(ids(views.supportButtons(ticket)), ['support:close', 'support:delete']);
  assert.deepEqual(ids(views.supportButtons({ ...ticket, status: 'closed' })), ['support:delete']);
  assert.deepEqual(ids(views.verifyPanel('https://restorecord.com/verify/x').components), ['https://restorecord.com/verify/x']);
  views.supportPanel().components[0].toJSON();
  const names = commands.map((c) => c.toJSON().name);
  for (const n of ['orderpanel', 'supportpanel', 'verifypanel']) assert.ok(names.includes(n), n);
});

test('promo file validation', () => {
  const names = Object.fromEntries(Object.entries(promos).map(([k, v]) => [k, v.map((p) => `${p.name}=${p.fee}`)]));
  assert.deepEqual(names, {
    uberride: ['10 off=1.5'], ubereats: ['10 off=2.5', '12 off=2.5'], deliveroo: ['15f20=2.5'], justeat: ['10 off=2'], ubertrain: ['5 off=1', '10 off=2.5'],
  });
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'promos-')), 'p.json');
  fs.writeFileSync(bad, JSON.stringify({ uberride: ['10 off'], ubereats: [''], deliveroo: ['x'], justeat: ['x'], ubertrain: [{ name: 'x', fee: 1 }] }));
  assert.throws(() => loadPromos(bad), /promo names/);
  fs.writeFileSync(bad, JSON.stringify({ uberride: ['10 off'], ubereats: [], deliveroo: ['x'], justeat: ['x'], ubertrain: [{ name: 'x', fee: 1 }] }));
  assert.throws(() => loadPromos(bad), /needs 1-25 promos/);
  fs.writeFileSync(bad, JSON.stringify({ uberride: ['10 off'], ubereats: ['x'], deliveroo: ['x'], justeat: ['x'], ubertrain: ['no fee'] }));
  assert.throws(() => loadPromos(bad), /needs a fee/);
});

test('parseDuration', () => {
  assert.equal(parseDuration('10m'), 600000);
  assert.equal(parseDuration('2H'), 7200000);
  assert.equal(parseDuration('28d'), 28 * 86400000);
  assert.equal(parseDuration('29d'), null);
  assert.equal(parseDuration('0m'), null);
  assert.equal(parseDuration('soon'), null);
});

const embedSize = (e) => {
  const j = e.toJSON();
  return (j.title?.length ?? 0) + (j.description?.length ?? 0) + (j.footer?.text.length ?? 0) +
    (j.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
};

test('tos panel contains every section and fits Discord limits', async () => {
  const { TOS } = await import('../src/tos.js');
  const embed = views.tosPanel(TOS).embeds[0];
  const json = embed.toJSON();
  assert.equal(json.title, '📜 FOOD HUB | ORDER POLICY & SERVER RULES');
  assert.equal(json.fields.length, 10);
  assert.ok(json.fields.every((f) => f.value.length <= 1024 && f.name.length <= 256));
  assert.ok(embedSize(embed) <= 6000, `embed is ${embedSize(embed)} chars`);
});

test('completed, vouch and announcement views', () => {
  const done = { ...order, status: 'completed', ordererId: '2' };
  const text = views.completedEmbed(done).toJSON().description;
  assert.ok(text.includes('Another order completed successfully') && text.includes('<@1>') && text.includes('<@2>') && text.includes('Deliveroo'));
  const sticky = views.vouchSticky();
  assert.equal(sticky.components[0].toJSON().components[0].custom_id, 'vouch:start');
  assert.equal(views.starPicker(483920).toJSON().options.length, 5);
  assert.equal(views.vouchModal(483920, '5').toJSON().custom_id, 'vouch:submit:483920:5');
  const vouch = views.vouchEmbed({ number: 3, stars: 4, userId: '1', message: 'fast\nnice', createdAt: new Date().toISOString() }, done).toJSON();
  assert.equal(vouch.title, '⭐⭐⭐⭐☆  Vouch #3');
  assert.equal(views.announceModal('c1', 'here').toJSON().custom_id, 'announce:c1:here');
  assert.equal(views.announcementEmbed({ title: 'Hi', message: 'x', image: 'https://e.com/a.png', author: 'sam' }).toJSON().image.url, 'https://e.com/a.png');
  for (const n of ['tos', 'vouchpanel', 'announce']) assert.ok(commands.some((c) => c.toJSON().name === n), n);
});

test('why food hub panel and embeds', async () => {
  const { WHY_FOOD_HUB, WHY_OVER_FOODPLUG } = await import('../src/whyfoodhub.js');
  assert.deepEqual(ids(views.whyPanel().components), ['why:hub', 'why:foodplug']);
  const hub = views.whyFoodHubEmbed(WHY_FOOD_HUB).toJSON();
  assert.equal(hub.title, '🍔 WHY CHOOSE FOOD HUB?');
  assert.ok(hub.description.includes('Community First') && hub.description.includes('SMARTER SAVINGS'));
  const plug = views.whyOverFoodplugEmbed(WHY_OVER_FOODPLUG).toJSON();
  assert.ok(plug.description.includes('COUGH COUGH BEN') && plug.description.includes('Built for the community'));
  assert.ok(commands.some((c) => c.toJSON().name === 'whyfoodhub'));
});

test('order panel shows fees and who is online', async () => {
  const { money } = await import('../src/services.js');
  assert.equal(money(1.5), '£1.50');
  const text = views.ordersPanel(promos, { ubereats: ['111', '222'] }).embeds[0].toJSON().description;
  assert.ok(text.includes('£1.50') && text.includes('£2.50') && text.includes('£2.00'));
  assert.ok(text.includes('🟢 **Online:** <@111>, <@222>'));
  assert.ok(text.includes('No orderers online'));
  const options = views.ordersPanel(promos, { ubereats: ['111'] }).components[0].toJSON().components[0].options;
  assert.ok(options.find((o) => o.value === 'ubereats').description.startsWith('Fee £2.50 · 🟢 1 online'));
  assert.ok(options.every((o) => o.description.length <= 100));
  const picker = views.promoPicker('justeat', promos.justeat, []).embeds[0].toJSON().description;
  assert.ok(picker.includes('£2.00') && picker.includes('Nobody is online'));
});

test('staff panel, payment details and payment panel', async () => {
  const { PAYMENT_METHODS } = await import('../src/services.js');
  const panelJson = views.staffPanel();
  assert.equal(panelJson.components[0].toJSON().components[0].custom_id, 'staff:online');
  assert.deepEqual(ids([panelJson.components[1]]), ['staff:offline', 'staff:payments', 'staff:me']);
  const modal = views.paymentDetailsModal({ paypal: 'https://paypal.me/x' }).toJSON();
  assert.equal(modal.components.length, 4);
  assert.equal(modal.components[0].components[0].value, 'https://paypal.me/x');

  assert.ok(PAYMENT_METHODS.paypal.pattern.test('https://paypal.me/sam'));
  assert.ok(!PAYMENT_METHODS.paypal.pattern.test('http://evil.com'));
  assert.ok(PAYMENT_METHODS.revolut.pattern.test('https://revolut.me/sam'));
  assert.ok(PAYMENT_METHODS.ltc.pattern.test('ltc1qg82tbbqk5c6lqyq0n2x5f8yxwq3vv9sfm9a3kr'));
  assert.ok(!PAYMENT_METHODS.ltc.pattern.test('not an address'));

  const payment = { id: 123456, method: 'revolut', amount: 12.5, ordererId: 's', customerId: 'c', orderId: 483920, status: 'due', createdAt: new Date().toISOString() };
  const embed = views.paymentEmbed(payment, 'https://revolut.me/sam').toJSON();
  assert.ok(embed.description.includes('<@c> your payment is now due') && embed.description.includes('£12.50') && embed.description.includes('https://revolut.me/sam'));
  assert.deepEqual(ids(views.paymentButtons(payment, 'https://revolut.me/sam')), ['pay:paid:123456', 'https://revolut.me/sam']);
  assert.deepEqual(ids(views.paymentButtons({ ...payment, status: 'marked_paid' })), ['pay:confirm:123456', 'pay:notreceived:123456']);
  assert.deepEqual(views.paymentButtons({ ...payment, status: 'confirmed' }), []);
  const crypto = views.paymentEmbed({ ...payment, method: 'ltc' }, 'ltc1qxyz').toJSON().description;
  assert.ok(crypto.includes('worth of **Litecoin (LTC)**') && crypto.includes('```ltc1qxyz```'));
  const names = commands.map((c) => c.toJSON().name);
  for (const n of ['staffpanel', 'paypal', 'rev', 'starling', 'crypto']) assert.ok(names.includes(n), n);
  assert.equal(commands.find((c) => c.toJSON().name === 'rev').toJSON().options[0].name, 'amount');
});

test('AI views and reply sanitising', async () => {
  assert.deepEqual(ids(views.aiButtons()), ['ai:ask', 'ai:human']);
  assert.equal(views.aiQuestionModal().toJSON().custom_id, 'ai:question');
  const { sanitizeReply } = await import('../src/ai.js');
  const r = sanitizeReply('yo @everyone and @here <@&123> ping <@111> and <@222> 😭');
  assert.ok(!r.content.includes('@everyone') && !r.content.includes('@here') && !r.content.includes('<@&'));
  assert.deepEqual(r.allowedMentions, { parse: [], users: ['111'], repliedUser: false });
  assert.ok(sanitizeReply('a'.repeat(1000)).content.length <= 401);
});

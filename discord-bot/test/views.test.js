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
  assert.deepEqual(menu.options.map((o) => o.value), ['uberride', 'ubereats', 'deliveroo', 'justeat']);
  assert.ok(embeds[0].toJSON().description.length <= 4096);
});

test('order flow components', () => {
  const promo = views.promoPicker('ubereats', promos.ubereats).components[0].toJSON().components[0];
  assert.deepEqual(promo.options.map((o) => o.label), ['10 off', '12 off']);
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
  assert.equal(views.orderTicketName({ ...order, status: 'completed' }), '🟢-order-483920');
  assert.equal(views.orderTicketName({ ...order, status: 'closed' }), '🔒-order-483920');
  assert.equal(views.supportTicketName({ id: 123456, status: 'open' }), '🟢-support-123456');
});

test('staff and ticket buttons follow status', () => {
  assert.deepEqual(ids(views.staffButtons(order, 'g')), ['order:accept:483920', 'order:decline:483920']);
  const accepted = { ...order, status: 'accepted', ordererId: '2', ticketChannelId: 'c' };
  assert.deepEqual(ids(views.staffButtons(accepted, 'g')), ['https://discord.com/channels/g/c']);
  assert.deepEqual(ids(views.ticketButtons(accepted)), ['order:complete:483920', 'order:close:483920', 'order:delete:483920']);
  const completed = { ...accepted, status: 'completed', closeAt: new Date().toISOString() };
  assert.deepEqual(ids(views.ticketButtons(completed)), ['order:close:483920', 'order:delete:483920']);
  const closed = { ...completed, status: 'closed', closeAt: null };
  assert.deepEqual(ids(views.ticketButtons(closed)), ['order:delete:483920']);
  assert.deepEqual(views.staffButtons({ ...closed, ticketChannelId: null }, 'g'), [], 'no link once the ticket is deleted');
  const fields = views.orderEmbed(completed).toJSON().fields.map((f) => f.name);
  assert.ok(fields.some((f) => f.includes('VC')) && fields.some((f) => f.includes('auto-closes')) && fields.some((f) => f.includes('Staff')));
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
  assert.deepEqual(promos, { uberride: ['10 off'], ubereats: ['10 off', '12 off'], deliveroo: ['15f20'], justeat: ['10 off'] });
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'promos-')), 'p.json');
  fs.writeFileSync(bad, JSON.stringify({ uberride: ['10 off'], ubereats: [''], deliveroo: ['x'], justeat: ['x'] }));
  assert.throws(() => loadPromos(bad), /promo names/);
  fs.writeFileSync(bad, JSON.stringify({ uberride: ['10 off'], ubereats: [], deliveroo: ['x'], justeat: ['x'] }));
  assert.throws(() => loadPromos(bad), /needs 1-25 promos/);
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

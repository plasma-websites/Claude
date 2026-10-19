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

const order = {
  id: 7, service: 'deliveroo', promo: null, vc: false, customerId: '1', ordererId: null, status: 'pending',
  ticketChannelId: null, closeAt: null, screenshot: null, createdAt: new Date().toISOString(),
};
const ids = (rows) => rows.flatMap((r) => r.toJSON().components.map((c) => c.custom_id ?? c.url));

test('order flow components', () => {
  const panel = views.ordersPanel().components[0].toJSON().components[0];
  assert.equal(panel.custom_id, 'order:service');
  assert.equal(panel.options.length, Object.keys(SERVICES).length);
  const promo = views.promoPicker('deliveroo', ['A', 'B']).components[0].toJSON().components[0];
  assert.deepEqual(promo.options.map((o) => o.value), ['0', '1', 'none']);
  assert.deepEqual(ids(views.vcPicker('deliveroo', '1').components), ['order:vc:deliveroo:1:yes', 'order:vc:deliveroo:1:no']);
});

test('staff and ticket buttons follow status', () => {
  assert.deepEqual(ids(views.staffButtons(order, 'g')), ['order:accept:7', 'order:decline:7']);
  const accepted = { ...order, status: 'accepted', ordererId: '2', ticketChannelId: 'c' };
  assert.deepEqual(ids(views.staffButtons(accepted, 'g')), ['https://discord.com/channels/g/c']);
  assert.deepEqual(ids(views.ticketButtons(accepted)), ['order:complete:7', 'order:close:7']);
  const completed = { ...accepted, status: 'completed', closeAt: new Date().toISOString() };
  assert.deepEqual(ids(views.ticketButtons(completed)), ['order:close:7']);
  assert.deepEqual(views.ticketButtons({ ...completed, status: 'closed' }), []);
  const fields = views.orderEmbed(completed).toJSON().fields.map((f) => f.name);
  assert.ok(fields.includes('VC') && fields.includes('Ticket closes') && fields.includes('Staff'));
});

test('support views and commands serialize', () => {
  assert.equal(views.supportModal().toJSON().custom_id, 'support:modal');
  views.supportTicketMessage({ id: 1, userId: '1', reason: 'x', createdAt: new Date().toISOString() }).components[0].toJSON();
  for (const c of commands) c.toJSON();
});

test('promo file validation', () => {
  const example = loadPromos(new URL('../promos.example.json', import.meta.url).pathname);
  assert.ok(example.ubereats.length > 0);
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'promos-')), 'p.json');
  fs.writeFileSync(bad, JSON.stringify({ ubereats: [''] }));
  assert.throws(() => loadPromos(bad), /promo names/);
});

test('parseDuration', () => {
  assert.equal(parseDuration('10m'), 600000);
  assert.equal(parseDuration('2H'), 7200000);
  assert.equal(parseDuration('28d'), 28 * 86400000);
  assert.equal(parseDuration('29d'), null);
  assert.equal(parseDuration('0m'), null);
  assert.equal(parseDuration('soon'), null);
});

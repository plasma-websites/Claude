import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-'));
  return new Store(path.join(dir, 'store.json'));
}

const newOrder = (store, customerId = 'cust') => store.createOrder({ service: 'ubereats', promo: 'Promo A', vc: true, customerId });

test('orders get increasing ids and persist to disk', () => {
  const store = tempStore();
  assert.equal(newOrder(store).id, 1);
  assert.equal(newOrder(store).id, 2);
  const reloaded = new Store(store.file);
  assert.equal(reloaded.getOrder(2).promo, 'Promo A');
  assert.equal(reloaded.getOrder(2).vc, true);
  assert.equal(newOrder(reloaded).id, 3);
});

test('only one staff member can accept an order, and not their own', () => {
  const store = tempStore();
  const { id } = newOrder(store);
  assert.match(store.accept(id, 'cust').error, /own order/);
  assert.equal(store.accept(id, 'staff1').order.ordererId, 'staff1');
  assert.match(store.accept(id, 'staff2').error, /already accepted/);
  assert.equal(store.unaccept(id).order.status, 'pending');
});

test('complete schedules auto-close; close ends it', () => {
  const store = tempStore();
  const { id } = newOrder(store);
  assert.ok(store.complete(id, new Date()).error, 'cannot complete before accepting');
  store.accept(id, 'staff1');
  store.complete(id, new Date(Date.now() + 2 * 3600e3));
  assert.equal(store.dueForClose().length, 0);
  assert.equal(store.dueForClose(Date.now() + 3 * 3600e3)[0].id, id);
  assert.equal(store.close(id).order.status, 'closed');
  assert.equal(store.dueForClose(Date.now() + 3 * 3600e3).length, 0);
  assert.ok(store.close(id).error);
});

test('customers can cancel only pending orders', () => {
  const store = tempStore();
  const a = newOrder(store);
  assert.match(store.cancel(a.id, 'stranger').error, /own orders/);
  assert.equal(store.cancel(a.id, 'cust').order.status, 'cancelled');
  const b = newOrder(store);
  store.accept(b.id, 'staff1');
  assert.match(store.cancel(b.id, 'cust').error, /ask in your ticket/);
});

test('open orders and ticket lookups', () => {
  const store = tempStore();
  const a = newOrder(store);
  newOrder(store);
  newOrder(store, 'other');
  store.decline(a.id);
  assert.equal(store.openOrdersFor('cust').length, 1);
  store.updateOrder(2, { ticketChannelId: 'chan' });
  assert.equal(store.orderByTicket('chan').id, 2);
});

test('support tickets: one open per user', () => {
  const store = tempStore();
  const t = store.createSupport({ userId: 'u', reason: 'help' });
  store.updateSupport(t.id, { channelId: 'c1' });
  assert.equal(store.openSupportFor('u').id, t.id);
  assert.equal(store.supportByChannel('c1').id, t.id);
  store.updateSupport(t.id, { status: 'closed' });
  assert.equal(store.openSupportFor('u'), null);
});

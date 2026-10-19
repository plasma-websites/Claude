import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OrderStore } from '../src/store.js';

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-'));
  return new OrderStore(path.join(dir, 'orders.json'));
}

const newOrder = (store, customerId = 'cust') =>
  store.create({ service: 'ubereats', customerId, details: { restaurant: 'Nandos', items: '1/4 chicken', address: '1 Road' } });

test('orders get increasing ids and persist to disk', () => {
  const store = tempStore();
  assert.equal(newOrder(store).id, 1);
  assert.equal(newOrder(store).id, 2);
  const reloaded = new OrderStore(store.file);
  assert.equal(reloaded.get(2).details.restaurant, 'Nandos');
  assert.equal(newOrder(reloaded).id, 3);
});

test('only one orderer can accept an order', () => {
  const store = tempStore();
  const { id } = newOrder(store);
  assert.equal(store.accept(id, 'orderer1').order.ordererId, 'orderer1');
  assert.match(store.accept(id, 'orderer2').error, /already accepted/);
  assert.equal(store.get(id).ordererId, 'orderer1');
});

test('customers cannot accept their own order', () => {
  const store = tempStore();
  const { id } = newOrder(store);
  assert.match(store.accept(id, 'cust').error, /own order/);
});

test('only the accepting orderer (or admin) can complete or release', () => {
  const store = tempStore();
  const { id } = newOrder(store);
  store.accept(id, 'orderer1');
  assert.ok(store.release(id, 'orderer2').error);
  assert.ok(store.complete(id, 'orderer2').error);
  assert.equal(store.release(id, 'orderer1').order.status, 'pending');
  store.accept(id, 'orderer2');
  assert.equal(store.complete(id, 'admin', true).order.status, 'completed');
  assert.ok(store.complete(id, 'orderer2').error);
});

test('cancel rules', () => {
  const store = tempStore();
  const a = newOrder(store);
  assert.match(store.cancel(a.id, 'stranger').error, /own orders/);
  assert.equal(store.cancel(a.id, 'cust').order.status, 'cancelled');

  const b = newOrder(store);
  store.accept(b.id, 'orderer1');
  assert.match(store.cancel(b.id, 'cust').error, /already been accepted/);
  assert.equal(store.cancel(b.id, 'orderer1').order.status, 'cancelled');
});

test('open orders exclude finished ones', () => {
  const store = tempStore();
  const a = newOrder(store);
  newOrder(store);
  newOrder(store, 'other');
  store.cancel(a.id, 'cust');
  assert.equal(store.openOrdersFor('cust').length, 1);
});

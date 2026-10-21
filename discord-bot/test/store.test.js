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

const newOrder = (store, customerId = 'cust') => store.createOrder({ service: 'ubereats', promo: 'Promo A', vc: true, details: { address: '1 Road' }, customerId });

test('orders get unique random 6-digit numbers and persist to disk', () => {
  const store = tempStore();
  const ids = new Set();
  for (let i = 0; i < 500; i++) {
    const { id } = newOrder(store);
    assert.ok(id >= 100000 && id <= 999999, `${id} is 6 digits`);
    ids.add(id);
  }
  assert.equal(ids.size, 500, 'no duplicates');
  const [first] = ids;
  const reloaded = new Store(store.file);
  assert.equal(reloaded.getOrder(first).promo, 'Promo A');
  assert.equal(reloaded.getOrder(first).vc, true);
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
  const b = newOrder(store);
  newOrder(store, 'other');
  store.cancel(a.id, 'cust');
  assert.equal(store.openOrdersFor('cust').length, 1);
  store.updateOrder(b.id, { ticketChannelId: 'chan' });
  assert.equal(store.orderByTicket('chan').id, b.id);
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

test('vouches: only finished orders, once each, by the customer', () => {
  const store = tempStore();
  const a = newOrder(store);
  assert.equal(store.vouchableOrder('cust'), null, 'pending orders cannot be vouched');
  assert.match(store.addVouch({ orderId: a.id, userId: 'cust', stars: 5, message: 'great' }).error, /completed/);
  store.accept(a.id, 'staff1');
  store.complete(a.id, new Date());
  assert.equal(store.vouchableOrder('cust').id, a.id);
  assert.match(store.addVouch({ orderId: a.id, userId: 'other', stars: 5, message: 'x' }).error, /your own/);
  const { vouch } = store.addVouch({ orderId: a.id, userId: 'cust', stars: 5, message: 'great' });
  assert.equal(vouch.number, 1);
  assert.match(store.addVouch({ orderId: a.id, userId: 'cust', stars: 4, message: 'again' }).error, /already vouched/);
  assert.equal(store.vouchableOrder('cust'), null);
  store.setMeta('vouchStickyId', 'm1');
  assert.equal(new Store(store.file).getMeta('vouchStickyId'), 'm1');
});

test('forfeit hands an accepted order back to the queue', () => {
  const store = tempStore();
  const { id } = newOrder(store);
  store.accept(id, 'staff1');
  store.updateOrder(id, { ticketChannelId: 'chan' });
  assert.match(store.forfeit(id, 'staff2').error, /Only the orderer/);
  const { order } = store.forfeit(id, 'staff1');
  assert.equal(order.status, 'pending');
  assert.equal(order.ordererId, null);
  assert.deepEqual(order.forfeitedBy, ['staff1']);
  assert.equal(order.ticketChannelId, 'chan', 'keeps its ticket');
  assert.equal(store.accept(id, 'staff2').order.ordererId, 'staff2');
  assert.deepEqual(store.forfeit(id, 'admin', true).order.forfeitedBy, ['staff1', 'staff2']);
  assert.ok(store.forfeit(id, 'staff1').error, 'cannot forfeit a pending order');
});

test('staff availability and payment details', () => {
  const store = tempStore();
  store.setOnline('a', ['ubereats', 'deliveroo']);
  store.setOnline('b', ['ubereats']);
  assert.deepEqual(store.onlineByService(), { ubereats: ['a', 'b'], deliveroo: ['a'] });
  store.setOnline('a', []);
  assert.deepEqual(store.onlineByService(), { ubereats: ['b'] });
  store.setPaymentDetails('b', { paypal: 'https://paypal.me/b' });
  const reloaded = new Store(store.file);
  assert.equal(reloaded.getStaff('b').payments.paypal, 'https://paypal.me/b');
  assert.deepEqual(reloaded.getStaff('nobody'), { online: [], payments: {} });
});

test('payment requests', () => {
  const store = tempStore();
  const p = store.createPayment({ method: 'revolut', amount: 12.5, ordererId: 's', customerId: 'c', orderId: 1, channelId: 'ch' });
  assert.equal(p.status, 'due');
  assert.equal(store.updatePayment(p.id, { status: 'marked_paid' }).status, 'marked_paid');
  assert.equal(new Store(store.file).getPayment(p.id).amount, 12.5);
});

test('orderer questions: answered once, latest open one found for DM answers', () => {
  const store = tempStore();
  const a = store.createQuestion({ orderId: 1, askerId: 's', customerId: 'c', question: 'which flat?' });
  const b = store.createQuestion({ orderId: 1, askerId: 's', customerId: 'c', question: 'any allergies?' });
  assert.equal(store.openQuestionFor('c').id, b.id);
  assert.equal(store.answerQuestion(b.id, 'none').question.answer, 'none');
  assert.match(store.answerQuestion(b.id, 'again').error, /already answered/);
  assert.equal(store.openQuestionFor('c').id, a.id);
  store.answerQuestion(a.id, 'flat 2');
  assert.equal(store.openQuestionFor('c'), null);
});

test('orders keep fee and customer name', () => {
  const store = tempStore();
  const o = store.createOrder({ service: 'ubertrain', promo: '5 off', fee: 1, vc: false, details: {}, customerId: 'c', customerName: 'plasma' });
  assert.equal(new Store(store.file).getOrder(o.id).fee, 1);
  assert.equal(o.customerName, 'plasma');
});

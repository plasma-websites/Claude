import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES } from '../src/services.js';
import { commands } from '../src/commands.js';
import { orderButtons, orderEmbed, orderModal, panel } from '../src/views.js';

test('every service builds a valid modal within Discord limits', () => {
  for (const key of Object.keys(SERVICES)) {
    const json = orderModal(key).toJSON();
    assert.ok(json.components.length <= 5, `${key} has too many inputs`);
    for (const row of json.components) assert.ok(row.components[0].label.length <= 45);
  }
});

test('order embed and buttons follow status', () => {
  const order = { id: 7, service: 'deliveroo', customerId: '1', ordererId: null, status: 'pending', createdAt: new Date().toISOString(),
    details: { restaurant: 'Wagamama', items: 'Katsu', address: '2 Lane', when: '', notes: '' } };
  const embed = orderEmbed(order).toJSON();
  assert.match(embed.title, /Order #7/);
  assert.ok(!embed.fields.some((f) => f.name === 'Notes'), 'empty optional fields are hidden');
  assert.equal(orderButtons(order)[0].toJSON().components[0].custom_id, 'accept:7');
  assert.equal(orderButtons({ ...order, status: 'accepted' })[0].toJSON().components.length, 3);
  assert.deepEqual(orderButtons({ ...order, status: 'completed' }), []);
});

test('panel and slash commands serialize', () => {
  assert.equal(panel().components[0].toJSON().components.length, Object.keys(SERVICES).length);
  for (const c of commands) c.toJSON();
});

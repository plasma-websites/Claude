import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../server.js';
import { render } from '../uberClient.js';

test('render fills placeholders', () => {
  assert.deepEqual(render({ a: '{{x}}', b: 'hi {{y}}' }, { x: 1, y: 'z' }), { a: 1, b: 'hi z' });
});

test('mock flow: register then book', async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  try {
    assert.equal((await post('/api/register', { name: 'A', phone: '1' })).status, 400);
    const reg = await (await post('/api/register', { name: 'Ann Lee', phone: '+1 555 123 4567' })).json();
    assert.ok(reg.sessionId);
    assert.equal((await post('/api/book', { sessionId: 'nope' })).status, 401);
    const ride = await (await post('/api/book', { sessionId: reg.sessionId, pickup: 'A St', dropoff: 'B St', paymentToken: 't' })).json();
    assert.equal(ride.requestId, 'mock-ride-1');
    assert.equal((await post('/api/book', { sessionId: reg.sessionId, pickup: 'A', dropoff: 'B', paymentToken: 't' })).status, 401);
  } finally { server.close(); }
});

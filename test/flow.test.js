import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMock } from '../mock/mockUber.js';
import { createApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';

let mock, app, base, gw;
before(async () => {
  mock = createMock(); await new Promise((r) => mock.listen(0, r));
  const mp = mock.address().port; gw = `http://localhost:${mp}`;
  const cfg = loadConfig({ UBER_BASE_URL: gw, UBER_PARTNER_KEY: 'dev-partner-key', PROMO_CODES: 'WELCOME,BADCODE',
    PAYMENT_TOKENIZE_URL: `${gw}/gateway/tokens`, MAX_REGISTRATIONS_PER_HOUR: '100' });
  app = createApp(cfg); await new Promise((r) => app.listen(0, r));
  base = `http://localhost:${app.address().port}`;
});
after(() => { app.close(); mock.close(); });

const post = async (p, body, session) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const token = async (number = '4242424242424242') =>
  (await (await fetch(`${gw}/gateway/tokens`, { method: 'POST', body: JSON.stringify({ number }) })).json());

test('zero to booked ride; invalid promo does not block; session destroyed after booking', async () => {
  const reg = await post('/api/register', { name: 'Ada Lovelace', phone: '+14155550101', consent: true });
  assert.equal(reg.status, 201);
  const promos = await post('/api/promos', {}, reg.body.session);
  assert.deepEqual(promos.body.results.map((r) => r.applied), [true, false]);
  const { token: t } = await token();
  const ride = await post('/api/ride', { pickup: { text: '1 Main St' }, dropoff: { text: '2 Oak Ave' }, paymentToken: t }, reg.body.session);
  assert.equal(ride.status, 201);
  assert.match(ride.body.ride.rideId, /^ride_/);
  const again = await post('/api/ride', { pickup: 'a b c', dropoff: 'd e f', paymentToken: t }, reg.body.session);
  assert.equal(again.status, 401);
  const st = await (await fetch(`${base}/api/ride?id=${ride.body.ride.rideId}`)).json();
  assert.equal(st.ride.status, 'requested');
});

test('requires consent and valid phone', async () => {
  assert.equal((await post('/api/register', { name: 'Ada', phone: '+14155550102', consent: false })).status, 400);
  assert.equal((await post('/api/register', { name: 'Ada', phone: '123', consent: true })).status, 400);
});

test('account failure is reported with step and message', async () => {
  const r = await post('/api/register', { name: 'Ada Lovelace', phone: '+14155550000', consent: true });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.step, 'account');
});

test('rejects raw card numbers and unknown tokens at the ride step', async () => {
  const reg = await post('/api/register', { name: 'Bob Smith', phone: '+14155550103', consent: true });
  const raw = await post('/api/ride', { pickup: 'a b c', dropoff: 'd e f', paymentToken: '4242 4242 4242 4242' }, reg.body.session);
  assert.equal(raw.status, 400); assert.equal(raw.body.error.step, 'payment');
  const bad = await post('/api/ride', { pickup: 'a b c', dropoff: 'd e f', paymentToken: 'tok_nope' }, reg.body.session);
  assert.equal(bad.status, 422); assert.equal(bad.body.error.step, 'ride');
});

test('same phone cannot register twice in a day', async () => {
  const body = { name: 'Cy Young', phone: '+14155550104', consent: true };
  assert.equal((await post('/api/register', body)).status, 201);
  assert.equal((await post('/api/register', body)).status, 429);
});

test('upstream outage is retryable', async () => {
  const cfg = loadConfig({ UBER_BASE_URL: 'http://localhost:1', UBER_TIMEOUT_MS: '500' });
  const a = createApp(cfg); await new Promise((r) => a.listen(0, r));
  const r = await fetch(`http://localhost:${a.address().port}/api/register`, { method: 'POST', body: JSON.stringify({ name: 'Dee Dee', phone: '+14155550105', consent: true }) });
  const b = await r.json(); a.close();
  assert.equal(b.error.retryable, true);
});

test('serves the UI with CSP', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
});

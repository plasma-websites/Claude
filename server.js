import express from 'express';
import crypto from 'node:crypto';
import { callStep, UberStepError, uberMode } from './uberClient.js';

export const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(express.static(new URL('./public', import.meta.url).pathname));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://js.stripe.com; frame-src https://js.stripe.com; connect-src 'self' https://api.stripe.com");
  next();
});

// Minimal retention: in-memory only, 30-minute TTL, wiped after booking.
// Names, phone numbers and locations are never logged or written to disk.
const TTL_MS = 30 * 60 * 1000;
const sessions = new Map();
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (s.expires < now) sessions.delete(id);
}, 60 * 1000);
sweep.unref();

const PROMOS = (process.env.PROMO_CODES || '').split(',').map((s) => s.trim()).filter(Boolean);

function getSession(req, res) {
  const s = sessions.get(req.body.sessionId);
  if (!s || s.expires < Date.now()) {
    res.status(401).json({ error: 'Your session expired. Please start again.' });
    return null;
  }
  s.expires = Date.now() + TTL_MS;
  return s;
}

const fail = (res, e) => {
  if (e instanceof UberStepError) return res.status(502).json({ error: e.userMessage, step: e.step });
  console.error(e.message);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
};

app.get('/api/config', (_req, res) =>
  res.json({ mode: uberMode, stripeKey: process.env.STRIPE_PUBLISHABLE_KEY || null }));

// Step 1: register (name + phone) -> account creation, then configured promos.
app.post('/api/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').replace(/[^\d+]/g, '');
  if (name.length < 2 || phone.replace(/\D/g, '').length < 7) {
    return res.status(400).json({ error: 'Please enter your full name and a valid phone number.' });
  }
  try {
    const acct = await callStep('createAccount', { name, phone });
    const warnings = [];
    for (const promoCode of PROMOS) {
      try { await callStep('applyPromo', { promoCode, accountToken: acct.access_token }); }
      catch (e) { if (e instanceof UberStepError) warnings.push(e.userMessage); else throw e; }
    }
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { accountToken: acct.access_token, expires: Date.now() + TTL_MS });
    res.json({ sessionId, warnings });
  } catch (e) { fail(res, e); }
});

// Step 2: book. paymentToken comes from the gateway (Stripe.js); raw card data never reaches us.
app.post('/api/book', async (req, res) => {
  const s = getSession(req, res);
  if (!s) return;
  const { pickup, dropoff, paymentToken } = req.body;
  if (![pickup, dropoff, paymentToken].every((v) => typeof v === 'string' && v.trim())) {
    return res.status(400).json({ error: 'Please fill in pickup, drop-off and payment.' });
  }
  try {
    const ride = await callStep('bookRide', {
      accountToken: s.accountToken, pickup: pickup.trim(), dropoff: dropoff.trim(), paymentToken,
    });
    sessions.delete(req.body.sessionId);
    res.json({ requestId: ride.request_id, status: ride.status, etaMinutes: ride.eta_minutes ?? null });
  } catch (e) { fail(res, e); }
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Listening on :${port} (Uber mode: ${uberMode})`));
}

import { StepError } from './errors.js';

const bad = (step, msg) => new StepError(step, msg, { status: 400, code: 'invalid_input' });
const clean = (s) => String(s ?? '').trim();

export function validateRegistration(b) {
  const name = clean(b.name);
  const phone = clean(b.phone).replace(/[\s().-]/g, '');
  if (name.length < 2 || name.length > 80) throw bad('account', 'Please enter your full name.');
  if (!/^\+?[1-9]\d{7,14}$/.test(phone)) throw bad('account', 'Please enter a valid phone number, including country code if outside your home country.');
  if (b.consent !== true) throw bad('account', 'Consent is required before we can create an account on your behalf.');
  return { name, phone };
}

function place(step, label, p) {
  const text = clean(typeof p === 'string' ? p : p?.text);
  if (text.length < 3 || text.length > 200) throw bad(step, `Please enter a ${label} address.`);
  const out = { text };
  if (p && typeof p === 'object' && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
    out.lat = p.lat; out.lng = p.lng;
  }
  return out;
}

export function validateRide(b) {
  const pickup = place('ride', 'pickup', b.pickup);
  const dropoff = place('ride', 'drop-off', b.dropoff);
  const paymentToken = clean(b.paymentToken);
  // Reject anything that looks like a raw card number: only gateway tokens are accepted.
  if (!paymentToken || /^\d[\d\s-]{11,}$/.test(paymentToken)) {
    throw bad('payment', 'Payment could not be verified. Please re-enter your card.');
  }
  if (paymentToken.length > 256) throw bad('payment', 'Invalid payment token.');
  return { pickup, dropoff, paymentToken };
}

export function validateCode(b) {
  const code = clean(b.code).replace(/\s/g, '');
  if (!/^\d{4,8}$/.test(code)) throw bad('verify', 'Please enter the numeric code sent to your phone.');
  return code;
}

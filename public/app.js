const $ = (id) => document.getElementById(id);
const steps = ['step1', 'step2', 'step3', 'done'];
let sessionId, stripe, card, config;

function show(id) {
  steps.forEach((s) => { $(s).hidden = s !== id; });
  const n = steps.indexOf(id) + 1;
  $('progress').textContent = n <= 3 ? `Step ${n} of 3` : 'Done';
  $(id).querySelector('input, button')?.focus() ?? $(id).focus();
}
function say(msg, ok = false) {
  const el = $('status');
  el.hidden = !msg; el.textContent = msg || ''; el.classList.toggle('ok', ok);
}
async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
const guard = (form, fn) => form.addEventListener('submit', async (e) => {
  e.preventDefault(); say('');
  const btn = form.querySelector('button'); btn.disabled = true;
  try { await fn(); } catch (err) { say(err.message); } finally { btn.disabled = false; }
});

guard($('step1'), async () => {
  const r = await post('/api/register', { name: $('name').value, phone: $('phone').value });
  sessionId = r.sessionId;
  if (r.warnings.length) say(r.warnings.join(' '), true);
  show('step2');
});
guard($('step2'), async () => {
  if (!$('pickup').value.trim() || !$('dropoff').value.trim()) throw new Error('Please enter both addresses.');
  show('step3');
});
guard($('step3'), async () => {
  let paymentToken = 'mock-payment-token';
  if (stripe) {
    const { token, error } = await stripe.createToken(card);
    if (error) throw new Error(error.message);
    paymentToken = token.id; // only this token leaves the browser
  }
  const r = await post('/api/book', { sessionId, pickup: $('pickup').value, dropoff: $('dropoff').value, paymentToken });
  $('done-text').textContent = `Reference ${r.requestId}.` + (r.etaMinutes ? ` Estimated arrival: ${r.etaMinutes} minutes.` : '');
  ['name', 'phone', 'pickup', 'dropoff'].forEach((i) => { $(i).value = ''; });
  show('done');
});
$('restart').addEventListener('click', () => show('step1'));

config = await (await fetch('/api/config')).json();
if (config.stripeKey) {
  await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://js.stripe.com/v3/'; s.onload = ok; s.onerror = no; document.head.append(s); });
  stripe = window.Stripe(config.stripeKey);
  card = stripe.elements().create('card');
  card.mount('#card-element');
} else {
  $('card-element').hidden = true; $('mock-note').hidden = false;
}
show('step1');

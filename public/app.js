const $ = (id) => document.getElementById(id);
let cfg = {}, session = null, pollTimer = null;

const STATUS_TEXT = {
  requested: 'Looking for a driver…',
  driver_assigned: 'A driver is on the way.',
  arrived: 'Your driver has arrived.',
  completed: 'Trip complete.',
  cancelled: 'This ride was cancelled.',
};

function show(n) {
  document.querySelectorAll('.step').forEach((s) => (s.hidden = s.id !== `step${n}`));
  document.querySelectorAll('.progress li').forEach((li) =>
    li.dataset.step == n ? li.setAttribute('aria-current', 'step') : li.removeAttribute('aria-current'));
  clearErrors();
  $(`h${n}`).focus(); // move focus so screen-reader users hear the new step
}

function clearErrors() {
  const box = $('errors'); box.hidden = true; box.textContent = '';
  document.querySelectorAll('[aria-invalid]').forEach((e) => { e.removeAttribute('aria-invalid'); });
  document.querySelectorAll('.field-error').forEach((e) => e.remove());
}

function showError(message, { retryable = false, field } = {}) {
  const box = $('errors');
  box.textContent = message + (retryable ? ' You can press the button to try again.' : '');
  box.hidden = false;
  if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); } else box.focus();
}

function requireFields(pairs) {
  for (const [el, msg] of pairs) {
    if (!el.value.trim()) { showError(msg, { field: el }); return false; }
  }
  return true;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || 'Something went wrong.'), data.error || {});
  return data;
}

async function busy(btn, fn) {
  btn.disabled = true; const label = btn.textContent; btn.textContent = 'Working…';
  $('notice').textContent = 'Working, please wait.';
  try { await fn(); } catch (e) {
    if (e.step === 'session') { session = null; show(1); }
    showError(e.message, { retryable: e.retryable });
  } finally { btn.disabled = false; btn.textContent = label; $('notice').textContent = ''; }
}

// Saved addresses live only in this browser.
const loadSaved = () => { try { return JSON.parse(localStorage.getItem('addrs') || '[]'); } catch { return []; } };
function renderSaved() { $('saved').replaceChildren(...loadSaved().map((a) => Object.assign(document.createElement('option'), { value: a }))); }

$('f1').addEventListener('submit', (ev) => {
  ev.preventDefault(); clearErrors();
  if (!requireFields([[$('name'), 'Please enter your name.'], [$('phone'), 'Please enter your phone number.']])) return;
  if (!$('consent').checked) return showError('Please tick the consent box to continue.', { field: $('consent') });
  busy(ev.submitter, async () => {
    ({ session } = await api('/api/register', { method: 'POST', body: { name: $('name').value, phone: $('phone').value, consent: true } }));
    $('name').value = ''; $('phone').value = ''; // don't keep personal details in the page
    const { results } = await api('/api/promos', { method: 'POST', body: {} });
    const ok = results.filter((r) => r.applied).length, failed = results.filter((r) => !r.applied);
    $('promo-result').textContent = results.length
      ? `${ok} offer(s) added to your account.` + (failed.length ? ` ${failed.length} offer(s) could not be applied; you can still book.` : '')
      : '';
    renderSaved(); show(2);
  });
});

$('f2').addEventListener('submit', (ev) => {
  ev.preventDefault(); clearErrors();
  if (!requireFields([[$('pickup'), 'Please enter a pickup address.'], [$('dropoff'), 'Please enter a drop-off address.']])) return;
  if ($('remember').checked) {
    try { localStorage.setItem('addrs', JSON.stringify([...new Set([$('pickup').value, $('dropoff').value, ...loadSaved()])].slice(0, 6))); } catch { /* storage unavailable */ }
  }
  show(3);
});

// Card data is sent from the browser straight to the gateway; our server only ever sees the token.
async function tokenize() {
  const [mm, yy] = $('cc-exp').value.split('/').map((s) => s.trim());
  const res = await fetch(cfg.payment.tokenizeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.payment.publicKey}` },
    body: JSON.stringify({ number: $('cc-number').value, exp_month: mm, exp_year: yy, cvc: $('cc-csc').value }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.token) throw Object.assign(new Error(d.message || 'Your card was not accepted. Please check the details.'), { retryable: true });
  for (const id of ['cc-number', 'cc-exp', 'cc-csc']) $(id).value = '';
  return d.token;
}

$('f3').addEventListener('submit', (ev) => {
  ev.preventDefault(); clearErrors();
  if (!requireFields([[$('cc-number'), 'Please enter your card number.'], [$('cc-exp'), 'Please enter the expiry date.'], [$('cc-csc'), 'Please enter the security code.']])) return;
  busy(ev.submitter, async () => {
    const paymentToken = await tokenize();
    const { ride } = await api('/api/ride', { method: 'POST', body: {
      pickup: { text: $('pickup').value }, dropoff: { text: $('dropoff').value }, paymentToken } });
    session = null;
    show(4); renderRide(ride); poll(ride.rideId);
  });
});

function renderRide(r) {
  $('ride-status').textContent = STATUS_TEXT[r.status] || r.status;
  $('ride-detail').textContent = [
    r.etaMinutes != null ? `Estimated arrival: ${r.etaMinutes} minutes.` : '',
    r.driver ? `Driver: ${r.driver.name}, ${r.driver.vehicle}.` : '',
    `Booking reference: ${r.rideId}.`,
  ].filter(Boolean).join(' ');
}

function poll(id) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const { ride } = await api(`/api/ride?id=${encodeURIComponent(id)}`);
      renderRide(ride);
      if (['completed', 'cancelled'].includes(ride.status)) clearInterval(pollTimer);
    } catch { /* keep last known status; try again next tick */ }
  }, 5000);
}

$('again').addEventListener('click', () => { clearInterval(pollTimer); show(1); });

fetch('/api/config').then((r) => r.json()).then((c) => { cfg = c; }).catch(() => {});
show(1);

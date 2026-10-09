// Local stand-in for the Uber partner API and the card-tokenization gateway.
// Lets the whole flow run without credentials. Replace by real URLs via .env.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function createMock() {
  let lastIp = ''; const methods = new Set(); const accounts = new Map(); const rides = new Map(); const tokens = new Set();
  const send = (res, s, b) => { res.writeHead(s, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); res.end(JSON.stringify(b)); };
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const p = req.url.split('?')[0];
    if (p === '/_debug/last-ip') return send(res, 200, { ip: lastIp });
    if (p === '/gateway/tokens' && req.method === 'POST') {
      if (!/^\d{12,19}$/.test(String(body.number || '').replace(/\s/g, ''))) return send(res, 400, { message: 'Card number invalid' });
      if (String(body.number).replace(/\s/g, '').endsWith('0002')) return send(res, 402, { message: 'Card declined' });
      const t = 'tok_' + randomUUID(); tokens.add(t); return send(res, 200, { token: t });
    }
    if (req.headers.authorization !== 'Bearer dev-partner-key') return send(res, 401, { message: 'bad partner key' });
    if (p === '/partner/v1/accounts' && req.method === 'POST') {
      if (!body.name || !body.phone) return send(res, 400, { message: 'name and phone required' });
      if (body.phone.endsWith('0000')) return send(res, 409, { code: 'exists', message: 'An account already exists for this phone number.' });
      const id = 'acct_' + randomUUID(); accounts.set(id, { ...body, verified: false, ip: req.headers['x-forwarded-for'] || '' }); lastIp = req.headers['x-forwarded-for'] || ''; return send(res, 201, { accountId: id });
    }
    let m;
    if ((m = p.match(/^\/partner\/v1\/accounts\/([^/]+)\/verify$/)) && req.method === 'POST') {
      const a = accounts.get(m[1]); if (!a) return send(res, 404, { message: 'no such account' });
      if (body.code !== '123456') return send(res, 422, { code: 'bad_code', message: 'That code was not correct.' });
      a.verified = true; return send(res, 200, { verified: true });
    }
    if ((m = p.match(/^\/partner\/v1\/accounts\/([^/]+)\/verify\/resend$/)) && req.method === 'POST') {
      return accounts.has(m[1]) ? send(res, 200, { sent: true }) : send(res, 404, { message: 'no such account' });
    }
    if ((m = p.match(/^\/partner\/v1\/accounts\/([^/]+)\/promos$/)) && req.method === 'POST') {
      if (!accounts.has(m[1])) return send(res, 404, { message: 'no such account' });
      if (body.code === 'BADCODE') return send(res, 422, { code: 'promo_invalid', message: `Promo ${body.code} is not valid.` });
      return send(res, 200, { applied: true, description: `${body.code} applied` });
    }
    if ((m = p.match(/^\/partner\/v1\/accounts\/([^/]+)\/payment-methods$/)) && req.method === 'POST') {
      if (!accounts.has(m[1])) return send(res, 404, { message: 'no such account' });
      if (!tokens.has(body.token)) return send(res, 402, { code: 'payment_rejected', message: 'Payment method was rejected.' });
      const pm = 'pm_' + randomUUID().slice(0, 8); methods.add(pm); return send(res, 201, { paymentMethodId: pm });
    }
    if ((m = p.match(/^\/partner\/v1\/accounts\/([^/]+)\/estimates$/)) && req.method === 'POST') {
      if (!accounts.has(m[1])) return send(res, 404, { message: 'no such account' });
      return send(res, 200, { fare: 14.5, currency: 'USD', etaMinutes: 6 });
    }
    if ((m = p.match(/^\/partner\/v1\/rides\/([^/]+)\/cancel$/)) && req.method === 'POST') {
      const r = rides.get(m[1]); if (!r) return send(res, 404, { message: 'no such ride' });
      r.cancelled = true; return send(res, 200, { status: 'cancelled' });
    }
    if ((m = p.match(/^\/partner\/v1\/accounts\/([^/]+)\/rides$/)) && req.method === 'POST') {
      if (!accounts.has(m[1])) return send(res, 404, { message: 'no such account' });
      if (!methods.has(body.paymentMethodId)) return send(res, 402, { code: 'payment_rejected', message: 'Payment method was rejected.' });
      const id = 'ride_' + randomUUID().slice(0, 8); rides.set(id, { t: Date.now() });
      return send(res, 201, { rideId: id, status: 'requested', etaMinutes: 6 });
    }
    if ((m = p.match(/^\/partner\/v1\/rides\/([^/]+)$/)) && req.method === 'GET') {
      const r = rides.get(m[1]); if (!r) return send(res, 404, { message: 'no such ride' });
      if (r.cancelled) return send(res, 200, { status: 'cancelled' });
      const age = Date.now() - r.t;
      return send(res, 200, age < 8000 ? { status: 'requested', etaMinutes: 6 } : { status: 'driver_assigned', etaMinutes: 4, driver: { name: 'Sam', vehicle: 'Grey Toyota Prius (wheelchair accessible)' } });
    }
    send(res, 404, { message: 'not found' });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createMock().listen(4000, () => console.log('Mock Uber + gateway on http://localhost:4000'));
}

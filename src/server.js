import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from './config.js';
import { UberClient } from './uberClient.js';
import { SessionStore, RateLimiter } from './store.js';
import { StepError, toPublic } from './errors.js';
import { validateRegistration, validateRide } from './validate.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

export function createApp(config = loadConfig(), { fetchImpl } = {}) {
  const uber = new UberClient(config.uber, fetchImpl);
  const sessions = new SessionStore(config.sessionTtlMs);
  const ipLimit = new RateLimiter(config.maxRegistrationsPerHour, 3600_000);
  const phoneLimit = new RateLimiter(1, 24 * 3600_000); // one account per phone per day
  const payHost = config.payment.tokenizeUrl ? new URL(config.payment.tokenizeUrl).origin : '';

  const json = (res, status, body) => {
    res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  async function readBody(req) {
    let size = 0; const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 16_384) throw new StepError('request', 'Request too large.', { status: 413, code: 'too_large' });
      chunks.push(c);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
    catch { throw new StepError('request', 'Malformed request.', { status: 400, code: 'bad_json' }); }
  }

  const sessionFrom = (req) => {
    const id = (req.headers.authorization || '').replace(/^Bearer /, '');
    const s = id && sessions.get(id);
    if (!s) throw new StepError('session', 'Your session expired. Please start again.', { status: 401, code: 'no_session' });
    return { id, s };
  };

  const routes = {
    'GET /api/config': async () => [200, {
      payment: config.payment,
      promoCount: config.promoCodes.length,
    }],

    'POST /api/register': async (req) => {
      const input = validateRegistration(await readBody(req));
      const ip = req.socket.remoteAddress || 'unknown';
      const phoneKey = createHash('sha256').update(input.phone).digest('hex');
      if (!ipLimit.allow(ip) || !phoneLimit.allow(phoneKey)) {
        throw new StepError('account', 'Too many sign-up attempts. Please try again later or contact support.', { status: 429, code: 'rate_limited' });
      }
      const { accountId } = await uber.createAccount(input);
      // Name/phone are NOT kept after this call; only the Uber account id is retained.
      const session = sessions.create({ accountId, promos: [] });
      return [201, { session }];
    },

    'POST /api/promos': async (req) => {
      const { s } = sessionFrom(req);
      const body = await readBody(req);
      const extra = Array.isArray(body.codes) ? body.codes : [];
      const codes = [...new Set([...config.promoCodes, ...extra.map((c) => String(c).trim().toUpperCase())])]
        .filter((c) => /^[A-Z0-9_-]{3,32}$/i.test(c)).slice(0, 3);
      const results = [];
      for (const code of codes) {
        try { results.push(await uber.applyPromo(s.accountId, code)); }
        catch (e) {
          // An invalid promo must not strand the rider: report it and carry on.
          results.push({ code, applied: false, message: e.message });
        }
      }
      s.promos = results;
      return [200, { results }];
    },

    'POST /api/estimate': async (req) => {
      const { s } = sessionFrom(req);
      const { pickup, dropoff } = validateRide({ ...(await readBody(req)), paymentToken: 'n/a' });
      return [200, { estimate: await uber.estimate(s.accountId, { pickup, dropoff }) }];
    },

    'POST /api/ride/cancel': async (req) => {
      const { rideId } = await readBody(req);
      if (!/^[\w-]{3,64}$/.test(String(rideId || ''))) throw new StepError('cancel', 'Invalid ride id.', { status: 400, code: 'invalid_input' });
      return [200, { ride: await uber.cancelRide(rideId) }];
    },

    'POST /api/ride': async (req) => {
      const { id, s } = sessionFrom(req);
      const input = validateRide(await readBody(req));
      const { paymentMethodId } = await uber.addPaymentMethod(s.accountId, input.paymentToken);
      const ride = await uber.requestRide(s.accountId, { pickup: input.pickup, dropoff: input.dropoff, paymentMethodId });
      sessions.destroy(id); // minimise retention: nothing needed after booking
      return [201, { ride }];
    },

    'GET /api/ride': async (req, url) => {
      const rideId = url.searchParams.get('id');
      if (!rideId || !/^[\w-]{3,64}$/.test(rideId)) throw new StepError('status', 'Invalid ride id.', { status: 400, code: 'invalid_input' });
      return [200, { ride: await uber.rideStatus(rideId) }];
    },
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      const handler = routes[`${req.method} ${url.pathname}`];
      if (handler) {
        const [status, body] = await handler(req, url);
        return json(res, status, body);
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api')) {
        const name = url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
        const file = path.join(PUBLIC_DIR, name);
        if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: { message: 'Forbidden' } });
        try {
          const data = await readFile(file);
          res.writeHead(200, {
            ...SECURITY_HEADERS,
            'content-type': MIME[path.extname(file)] || 'application/octet-stream',
            'content-security-policy': `default-src 'self'; connect-src 'self' ${payHost}; style-src 'self'; frame-ancestors 'none'`,
          });
          return res.end(data);
        } catch { /* fall through */ }
      }
      json(res, 404, { error: { step: 'request', code: 'not_found', message: 'Not found' } });
    } catch (e) {
      if (!(e instanceof StepError)) {
        console.error('unexpected error:', e.message); // never log request bodies (PII)
        e = new StepError('unknown', 'Something went wrong on our side. Please try again.', { retryable: true, status: 500 });
      }
      json(res, e.status, toPublic(e));
    }
  });
  server.on('close', () => clearInterval(sessions.timer));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  createApp(cfg).listen(cfg.port, () => console.log(`Listening on http://localhost:${cfg.port}`));
}

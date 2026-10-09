import { StepError } from './errors.js';

// Thin HTTPS client for the Uber partner endpoints configured in env.
// Request/response field names live ONLY in this file; adjust the mappers below
// to match the contract in your Uber documentation.
export class UberClient {
  constructor(cfg, fetchImpl = globalThis.fetch) {
    this.cfg = cfg;
    this.fetch = fetchImpl;
  }

  async #call(step, method, pathTemplate, params, body) {
    const path = pathTemplate.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(params?.[k] ?? ''));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs);
    let res;
    try {
      res = await this.fetch(this.cfg.baseUrl + path, {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${this.cfg.partnerKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
    } catch (e) {
      throw new StepError(step, 'We could not reach Uber. Please try again in a moment.', {
        retryable: true, code: e.name === 'AbortError' ? 'timeout' : 'network',
      });
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new StepError(step, data.message || `Uber rejected the request (${res.status}).`, {
        retryable: res.status >= 500 || res.status === 429,
        status: res.status >= 500 ? 502 : 422,
        code: data.code || `http_${res.status}`,
      });
    }
    return data;
  }

  async createAccount({ name, phone }) {
    const d = await this.#call('account', 'POST', this.cfg.paths.account, {}, { name, phone });
    if (!d.accountId) throw new StepError('account', 'Uber did not return an account id.', { retryable: true });
    return { accountId: d.accountId };
  }

  async verifyPhone(accountId, code) {
    const d = await this.#call('verify', 'POST', this.cfg.paths.verify, { accountId }, { code });
    if (d.verified === false) throw new StepError('verify', 'That code was not correct.', { retryable: true, status: 422, code: 'bad_code' });
    return { verified: true };
  }

  async resendCode(accountId) {
    await this.#call('verify', 'POST', this.cfg.paths.resend, { accountId }, {});
    return { sent: true };
  }

  async applyPromo(accountId, code) {
    const d = await this.#call('promo', 'POST', this.cfg.paths.promo, { accountId }, { code });
    return { code, applied: d.applied !== false, description: d.description || '' };
  }

  async addPaymentMethod(accountId, paymentToken) {
    const d = await this.#call('payment', 'POST', this.cfg.paths.payment, { accountId }, { token: paymentToken });
    if (!d.paymentMethodId) throw new StepError('payment', 'Uber did not accept the payment method.', { retryable: true });
    return { paymentMethodId: d.paymentMethodId };
  }

  async estimate(accountId, { pickup, dropoff }) {
    const d = await this.#call('estimate', 'POST', this.cfg.paths.estimate, { accountId }, { pickup, dropoff });
    return { fare: d.fare ?? null, currency: d.currency || null, etaMinutes: d.etaMinutes ?? null };
  }

  async cancelRide(rideId) {
    const d = await this.#call('cancel', 'POST', this.cfg.paths.cancel, { rideId }, {});
    return { rideId, status: d.status || 'cancelled' };
  }

  async requestRide(accountId, { pickup, dropoff, paymentMethodId }) {
    const d = await this.#call('ride', 'POST', this.cfg.paths.ride, { accountId }, {
      pickup, dropoff, paymentMethodId,
    });
    if (!d.rideId) throw new StepError('ride', 'Uber did not confirm the ride.', { retryable: true });
    return { rideId: d.rideId, status: d.status || 'requested', etaMinutes: d.etaMinutes ?? null, driver: d.driver || null };
  }

  async rideStatus(rideId) {
    const d = await this.#call('status', 'GET', this.cfg.paths.rideStatus, { rideId });
    return { rideId, status: d.status, etaMinutes: d.etaMinutes ?? null, driver: d.driver || null };
  }
}

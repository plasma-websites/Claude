// Central config. Everything Uber-specific comes from env so the real endpoints
// from your Uber agreement can be dropped in without code changes.
const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);

export function loadConfig(env = process.env) {
  const baseUrl = env.UBER_BASE_URL || 'http://localhost:4000';
  if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl)) {
    throw new Error('UBER_BASE_URL must be https:// (plain http allowed only for localhost mocks)');
  }
  return {
    port: num(env.PORT, 3000),
    sessionTtlMs: num(env.SESSION_TTL_MS, 30 * 60 * 1000),
    maxRegistrationsPerHour: num(env.MAX_REGISTRATIONS_PER_HOUR, 3),
    uber: {
      baseUrl,
      partnerKey: env.UBER_PARTNER_KEY || '',
      paths: {
        account: env.UBER_PATH_ACCOUNT || '/partner/v1/accounts',
        promo: env.UBER_PATH_PROMO || '/partner/v1/accounts/{accountId}/promos',
        ride: env.UBER_PATH_RIDE || '/partner/v1/accounts/{accountId}/rides',
        rideStatus: env.UBER_PATH_RIDE_STATUS || '/partner/v1/rides/{rideId}',
      },
      timeoutMs: num(env.UBER_TIMEOUT_MS, 10000),
    },
    promoCodes: (env.PROMO_CODES || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    payment: {
      tokenizeUrl: env.PAYMENT_TOKENIZE_URL || '',
      publicKey: env.PAYMENT_PUBLIC_KEY || '',
    },
  };
}

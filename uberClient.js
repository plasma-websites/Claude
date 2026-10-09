// Adapter for the Uber calls supplied by the operator in endpoints.json.
// No endpoint is hardcoded here: each step (createAccount, applyPromo, bookRide)
// is a request template. {{placeholders}} are filled from the values passed in.
// UBER_MODE=live sends real requests; anything else returns canned mock responses.
import { readFileSync, existsSync } from 'node:fs';

const MODE = process.env.UBER_MODE === 'live' ? 'live' : 'mock';
const CONFIG_PATH = process.env.UBER_ENDPOINTS || new URL('./endpoints.json', import.meta.url).pathname;

export class UberStepError extends Error {
  constructor(step, status, userMessage) {
    super(`${step} failed (${status})`);
    this.step = step;
    this.status = status;
    this.userMessage = userMessage;
  }
}

const USER_MESSAGES = {
  createAccount: "We couldn't create the Uber account. Please check the name and phone number, or ask your caretaker to retry.",
  applyPromo: 'That promo code was not accepted. You can continue and book without it.',
  bookRide: "We couldn't book the ride. Your details are saved for this visit, so you can try again.",
};

export function render(value, vars) {
  if (typeof value === 'string') {
    const whole = value.match(/^\{\{(\w+)\}\}$/);
    if (whole) return vars[whole[1]];
    return value.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''));
  }
  if (Array.isArray(value)) return value.map((v) => render(v, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, vars)]));
  }
  return value;
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) throw new Error(`Missing ${CONFIG_PATH}; copy endpoints.example.json and fill it in.`);
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

const MOCKS = {
  createAccount: () => ({ user_id: 'mock-user-1', access_token: 'mock-token' }),
  applyPromo: (v) => {
    if (v.promoCode === 'INVALID') return { error: true };
    return { applied: true };
  },
  bookRide: () => ({ request_id: 'mock-ride-1', status: 'processing', eta_minutes: 6 }),
};

export async function callStep(step, vars) {
  if (MODE === 'mock') {
    const out = MOCKS[step](vars);
    if (out.error) throw new UberStepError(step, 422, USER_MESSAGES[step]);
    return out;
  }
  const cfg = loadConfig()[step];
  if (!cfg) throw new Error(`endpoints.json has no "${step}" entry`);
  const headers = render(cfg.headers || {}, { ...vars, apiKey: process.env.UBER_API_KEY || '' });
  const res = await fetch(render(cfg.url, vars), {
    method: cfg.method || 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: cfg.body ? JSON.stringify(render(cfg.body, vars)) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new UberStepError(step, res.status, USER_MESSAGES[step]);
  return res.json();
}

export const uberMode = MODE;

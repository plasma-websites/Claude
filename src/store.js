import { randomBytes } from 'node:crypto';

// In-memory sessions with a hard TTL. Nothing is written to disk, and a session
// is destroyed as soon as a ride is confirmed (data minimisation).
export class SessionStore {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.map = new Map();
    this.timer = setInterval(() => this.sweep(), 60_000);
    this.timer.unref();
  }
  create(data) {
    const id = randomBytes(24).toString('base64url');
    this.map.set(id, { data, expires: Date.now() + this.ttlMs });
    return id;
  }
  get(id) {
    const s = this.map.get(id);
    if (!s) return null;
    if (s.expires < Date.now()) { this.map.delete(id); return null; }
    return s.data;
  }
  destroy(id) { this.map.delete(id); }
  sweep() { const now = Date.now(); for (const [k, v] of this.map) if (v.expires < now) this.map.delete(k); }
}

// Sliding-window limiter used to cap account creation per client.
export class RateLimiter {
  constructor(max, windowMs) { this.max = max; this.windowMs = windowMs; this.hits = new Map(); }
  allow(key) {
    const now = Date.now();
    const arr = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) { this.hits.set(key, arr); return false; }
    arr.push(now); this.hits.set(key, arr); return true;
  }
}

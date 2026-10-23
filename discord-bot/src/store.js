import fs from 'node:fs';
import path from 'node:path';

// Orders that count towards a member's open-order limit. Completed orders are
// done for the customer even while their ticket waits to auto-close.
const OPEN = new Set(['pending', 'accepted']);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to mix up
export const REFERRAL_ORDERS = 3; // friends who complete an order to earn the inviter's free-fee order
const MAX_ADDRESSES = 5;
const now = () => new Date().toISOString();

// Random 6-digit number not already used as a key in `taken`.
function randomId(taken) {
  for (;;) {
    const id = 100000 + Math.floor(Math.random() * 900000);
    if (!taken[id]) return id;
  }
}

// Orders and support tickets kept in memory and written to a JSON file after
// every change. All state changes are synchronous, so two staff clicking
// "Accept" at the same moment can't both win.
export class Store {
  constructor(file) {
    this.file = file;
    this.data = {
      orders: {}, support: {}, vouches: [], payments: {}, staff: {}, questions: {}, giveaways: {}, codes: {}, suggestions: [], applications: {},
      referrals: { links: {}, joins: {}, inviterRewarded: [], discountClaimed: [] },
      addresses: {},
      meta: {},
    };
    this.onCodeReleased = null; // called with a code that's usable again after its order was cancelled
    if (fs.existsSync(file)) Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8')));
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // --- orders ---

  getOrder(id) {
    return this.data.orders[id] ?? null;
  }

  orderByTicket(channelId) {
    return Object.values(this.data.orders).find((o) => o.ticketChannelId === channelId) ?? null;
  }

  openOrdersFor(customerId) {
    return Object.values(this.data.orders).filter((o) => o.customerId === customerId && OPEN.has(o.status));
  }

  recentOrdersFor(customerId, limit = 10) {
    return Object.values(this.data.orders)
      .filter((o) => o.customerId === customerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  // Completed orders whose ticket is due to be auto-deleted.
  dueForClose(at = Date.now()) {
    return Object.values(this.data.orders).filter((o) => o.status === 'completed' && o.closeAt && Date.parse(o.closeAt) <= at);
  }

  createOrder({ service, promo, fee = null, vc, details, customerId, customerName = null }) {
    const id = randomId(this.data.orders);
    const order = {
      id,
      service,
      promo,
      fee,
      vc,
      details,
      customerId,
      customerName,
      screenshot: null,
      status: 'pending',
      ordererId: null,
      staffChannelId: null,
      staffMessageId: null,
      ticketChannelId: null,
      ticketMessageId: null,
      closeAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.data.orders[id] = order;
    this.save();
    return order;
  }

  updateOrder(id, changes) {
    const order = this.getOrder(id);
    if (!order) return null;
    const cancelling = changes.status === 'cancelled' && order.status !== 'cancelled';
    Object.assign(order, changes, { updatedAt: now() });
    this.save();
    if (cancelling && order.code) this.#releaseCode(order); // a cancelled order gives its discount code back
    return order;
  }

  #transition(id, from, changes) {
    const order = this.getOrder(id);
    if (!order) return { error: 'That order no longer exists.' };
    if (!from.includes(order.status)) return { error: `Order #${id} is already ${order.status}.`, order };
    return { order: this.updateOrder(id, changes) };
  }

  accept(id, ordererId) {
    if (this.getOrder(id)?.customerId === ordererId) return { error: 'You can\'t accept your own order.' };
    return this.#transition(id, ['pending'], { status: 'accepted', ordererId, acceptedAt: now() });
  }

  // The accepting orderer hands the order back; it goes back to the queue but
  // keeps its ticket so the customer doesn't have to start again.
  forfeit(id, actorId, isAdmin = false) {
    const order = this.getOrder(id);
    if (order && order.ordererId !== actorId && !isAdmin) return { error: 'Only the orderer who accepted this order can forfeit it.' };
    const forfeitedBy = [...(order?.forfeitedBy ?? []), order?.ordererId];
    return this.#transition(id, ['accepted'], { status: 'pending', ordererId: null, forfeitedBy });
  }

  // Undo an accept, e.g. when the ticket channel couldn't be created.
  unaccept(id) {
    return this.#transition(id, ['accepted'], { status: 'pending', ordererId: null });
  }

  complete(id, closeAt) {
    return this.#transition(id, ['accepted'], { status: 'completed', closeAt: closeAt.toISOString(), completedAt: now() });
  }

  // Staff pressed "Keep ticket open": the completed ticket won't auto-delete.
  keepOpen(id) {
    return this.#transition(id, ['completed'], { closeAt: null });
  }

  // Staff cancel from the ticket (any time before it's completed).
  staffCancel(id, actorId, reason = null) {
    return this.#transition(id, ['pending', 'accepted'], { status: 'cancelled', cancelledBy: actorId, cancelReason: reason });
  }

  // Trial orderers' orders, by trial orderer: { userId: { completed: [order], inProgress: [order] } }.
  trialStats() {
    const stats = {};
    for (const o of Object.values(this.data.orders)) {
      if (!o.trial || !o.ordererId) continue;
      const s = (stats[o.ordererId] ??= { completed: [], inProgress: [] });
      if (o.completedAt) s.completed.push(o);
      else if (o.status === 'accepted') s.inProgress.push(o);
    }
    for (const s of Object.values(stats)) s.completed.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    return stats;
  }

  close(id) {
    return this.#transition(id, ['accepted', 'completed'], { status: 'closed', closeAt: null });
  }

  // The order's ticket channel was deleted, so the order is over: close it, or
  // cancel it if it was back in the queue after a forfeit.
  ticketDeleted(id) {
    const order = this.getOrder(id);
    if (!order) return null;
    const status = { accepted: 'closed', completed: 'closed', pending: 'cancelled' }[order.status] ?? order.status;
    return this.updateOrder(id, { status, closeAt: null, ticketChannelId: null, ticketMessageId: null });
  }

  // Orders whose ticket channel should exist, for checking on startup.
  ordersWithTickets() {
    return Object.values(this.data.orders).filter((o) => o.ticketChannelId && ['pending', 'accepted', 'completed'].includes(o.status));
  }

  // Customers can cancel only while nobody has accepted the order yet.
  cancel(id, actorId) {
    const order = this.getOrder(id);
    if (order && order.customerId !== actorId) return { error: 'You can only cancel your own orders.' };
    if (order && order.status !== 'pending') {
      return { error: `Order #${id} is ${order.status}, so it can't be cancelled here — ask in your ticket.` };
    }
    return this.#transition(id, ['pending'], { status: 'cancelled' });
  }

  // --- orderer questions to customers ---

  createQuestion({ orderId, askerId, customerId, question }) {
    const id = randomId(this.data.questions);
    const seq = (this.data.questionSeq = (this.data.questionSeq ?? 0) + 1); // orders questions asked in the same millisecond
    const q = { id, seq, orderId, askerId, customerId, question, answer: null, createdAt: now(), answeredAt: null };
    this.data.questions[id] = q;
    this.save();
    return q;
  }

  getQuestion(id) {
    return this.data.questions[id] ?? null;
  }

  // The customer's most recent unanswered question, for answers typed in DMs.
  openQuestionFor(customerId) {
    return (
      Object.values(this.data.questions)
        .filter((q) => q.customerId === customerId && !q.answer)
        .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0) || b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }

  answerQuestion(id, answer) {
    const q = this.getQuestion(id);
    if (!q) return { error: 'That question no longer exists.' };
    if (q.answer) return { error: 'You\'ve already answered that question. 👍' };
    Object.assign(q, { answer, answeredAt: now() });
    this.save();
    return { question: q };
  }

  // --- vouches ---

  // Most recent finished order of this customer that they haven't vouched for yet.
  vouchableOrder(customerId) {
    return (
      Object.values(this.data.orders)
        .filter((o) => o.customerId === customerId && ['completed', 'closed'].includes(o.status) && !o.vouch)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }

  addVouch({ orderId, userId, stars, message }) {
    const order = this.getOrder(orderId);
    if (!order || order.customerId !== userId) return { error: 'You can only vouch for your own orders.' };
    if (!['completed', 'closed'].includes(order.status)) return { error: 'You can only vouch once your order is completed.' };
    if (order.vouch) return { error: `You've already vouched for order #${orderId}. 💛` };
    const vouch = { number: this.data.vouches.length + 1, orderId, userId, stars, message, createdAt: now() };
    this.data.vouches.push(vouch);
    order.vouch = vouch.number;
    this.save();
    return { vouch, order };
  }

  getMeta(key) {
    return this.data.meta[key] ?? null;
  }

  setMeta(key, value) {
    this.data.meta[key] = value;
    this.save();
  }

  // --- staff: availability & payment details ---

  #staff(userId) {
    return (this.data.staff[userId] ??= { online: [], payments: {} });
  }

  // `until` (a Date) is when they're automatically set offline again.
  setOnline(userId, services, until = null) {
    const staff = this.#staff(userId);
    Object.assign(staff, { online: services, onlineSince: services.length ? now() : null, onlineUntil: services.length && until ? until.toISOString() : null });
    if (services.length) staff.usualServices = services;
    this.save();
  }

  // Staff whose online time has run out.
  expiredOnline(at = Date.now()) {
    return Object.entries(this.data.staff)
      .filter(([, s]) => s.online?.length && s.onlineUntil && Date.parse(s.onlineUntil) <= at)
      .map(([userId]) => userId);
  }

  setSchedule(userId, schedule) {
    this.#staff(userId).schedule = schedule;
    this.save();
  }

  // Remembers that a scheduled "are you online?" DM was sent, so it's sent once per slot.
  markPrompted(userId, key) {
    this.#staff(userId).lastPrompt = key;
    this.save();
  }

  allStaff() {
    return Object.entries(this.data.staff);
  }

  getStaff(userId) {
    return this.data.staff[userId] ?? { online: [], payments: {} };
  }

  // { serviceKey: [userId, …] } for everyone currently online.
  onlineByService() {
    const result = {};
    for (const [userId, s] of Object.entries(this.data.staff)) {
      if (s.onlineUntil && Date.parse(s.onlineUntil) <= Date.now()) continue; // timed out, waiting for the next check
      for (const service of s.online ?? []) (result[service] ??= []).push(userId);
    }
    return result;
  }

  setPaymentDetails(userId, payments) {
    this.#staff(userId).payments = payments;
    this.save();
  }

  // --- payment requests (/paypal, /rev, /starling, /crypto) ---

  createPayment({ method, amount, ordererId, customerId, orderId, channelId }) {
    const id = randomId(this.data.payments);
    const payment = { id, method, amount, ordererId, customerId, orderId, channelId, status: 'due', messageId: null, createdAt: now() };
    this.data.payments[id] = payment;
    this.save();
    return payment;
  }

  getPayment(id) {
    return this.data.payments[id] ?? null;
  }

  updatePayment(id, changes) {
    const payment = this.getPayment(id);
    if (!payment) return null;
    Object.assign(payment, changes, { updatedAt: now() });
    this.save();
    return payment;
  }

  // --- support tickets ---

  openSupportFor(userId) {
    return Object.values(this.data.support).find((t) => t.userId === userId && t.status === 'open') ?? null;
  }

  supportByChannel(channelId) {
    return Object.values(this.data.support).find((t) => t.channelId === channelId) ?? null;
  }

  supportFor(userId) {
    return Object.values(this.data.support)
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  createSupport({ userId, userName = null, reason }) {
    const id = randomId(this.data.support);
    const ticket = { id, userId, userName, reason, channelId: null, status: 'open', createdAt: now() };
    this.data.support[id] = ticket;
    this.save();
    return ticket;
  }

  updateSupport(id, changes) {
    const ticket = this.data.support[id];
    if (!ticket) return null;
    Object.assign(ticket, changes);
    this.save();
    return ticket;
  }

  // --- giveaways ---

  createGiveaway({ title, info, winners, endsAt, hostId, channelId }) {
    const id = randomId(this.data.giveaways);
    const giveaway = { id, title, info, winners, endsAt, hostId, channelId, messageId: null, entrants: [], winnerIds: [], status: 'running', createdAt: now() };
    this.data.giveaways[id] = giveaway;
    this.save();
    return giveaway;
  }

  getGiveaway(id) {
    return this.data.giveaways[id] ?? null;
  }

  updateGiveaway(id, changes) {
    const giveaway = this.getGiveaway(id);
    if (!giveaway) return null;
    Object.assign(giveaway, changes);
    this.save();
    return giveaway;
  }

  // Enters the member, or takes them out if they'd already entered.
  toggleEntry(id, userId) {
    const giveaway = this.getGiveaway(id);
    if (!giveaway) return { error: 'That giveaway no longer exists.' };
    if (giveaway.status !== 'running') return { error: 'This giveaway has ended.' };
    const entered = !giveaway.entrants.includes(userId);
    giveaway.entrants = entered ? [...giveaway.entrants, userId] : giveaway.entrants.filter((u) => u !== userId);
    this.save();
    return { giveaway, entered };
  }

  dueGiveaways(at = Date.now()) {
    return Object.values(this.data.giveaways).filter((g) => g.status === 'running' && Date.parse(g.endsAt) <= at);
  }

  // --- discount codes ---

  // type 'free' = no service fee; 'discount' = `amount` pounds off the fee.
  createCode({ type, ownerId, amount = 0, reason }) {
    let code;
    do code = `FH-${Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('')}`;
    while (this.data.codes[code]);
    const entry = { code, type, amount, ownerId, reason, status: 'active', orderId: null, createdAt: now() };
    this.data.codes[code] = entry;
    this.save();
    return entry;
  }

  getCode(code) {
    return this.data.codes[String(code ?? '').trim().toUpperCase()] ?? null;
  }

  codesFor(userId) {
    return Object.values(this.data.codes).filter((c) => c.ownerId === userId);
  }

  // Checks a code typed into the order form.
  checkCode(code, userId) {
    const entry = this.getCode(code);
    if (!entry) return { error: `\`${String(code).trim()}\` isn't a valid code.` };
    if (entry.ownerId !== userId) return { error: 'That code belongs to someone else — codes are personal.' };
    if (entry.status !== 'active') return { error: `Code \`${entry.code}\` has already been used on order #${entry.orderId}.` };
    return { code: entry };
  }

  redeemCode(code, userId, orderId) {
    const result = this.checkCode(code, userId);
    if (result.error) return result;
    Object.assign(result.code, { status: 'used', orderId, usedAt: now() });
    this.save();
    return result;
  }

  #releaseCode(order) {
    const entry = this.getCode(order.code);
    if (!entry || entry.status !== 'used' || entry.orderId !== order.id) return;
    Object.assign(entry, { status: 'active', orderId: null, usedAt: null });
    this.save();
    this.onCodeReleased?.(entry, order);
  }

  // --- referrals ---

  setInviteLink(userId, inviteCode) {
    this.data.referrals.links[userId] = inviteCode;
    this.save();
  }

  inviteLinkOf(userId) {
    return this.data.referrals.links[userId] ?? null;
  }

  inviteOwner(inviteCode) {
    return Object.entries(this.data.referrals.links).find(([, code]) => code === inviteCode)?.[0] ?? null;
  }

  // First join only: someone who leaves and rejoins through another link still counts for the first referrer.
  recordJoin(inviteeId, referrerId) {
    if (inviteeId === referrerId || this.data.referrals.joins[inviteeId]) return false;
    this.data.referrals.joins[inviteeId] = { referrerId, joinedAt: now() };
    this.save();
    return true;
  }

  referrerOf(inviteeId) {
    return this.data.referrals.joins[inviteeId]?.referrerId ?? null;
  }

  hasCompletedOrder(userId) {
    return Object.values(this.data.orders).some((o) => o.customerId === userId && o.completedAt);
  }

  // invited: everyone who joined with their link; ordered: those who've completed an order.
  referralStats(userId) {
    const invited = Object.entries(this.data.referrals.joins).filter(([, j]) => j.referrerId === userId).map(([id]) => id);
    return { invited, ordered: invited.filter((id) => this.hasCompletedOrder(id)), rewarded: this.inviterRewarded(userId) };
  }

  inviterRewarded(userId) {
    return (this.data.referrals.inviterRewarded ??= []).includes(userId);
  }

  // Inviter reward: once REFERRAL_ORDERS friends have completed an order, one free-fee code. Once only.
  claimReferralReward(userId) {
    const stats = this.referralStats(userId);
    if (stats.rewarded) return { error: 'claimed', stats };
    if (stats.ordered.length < REFERRAL_ORDERS) return { error: 'not_yet', stats };
    this.data.referrals.inviterRewarded.push(userId);
    const code = this.createCode({ type: 'free', ownerId: userId, reason: `Referral reward (${stats.ordered.slice(0, REFERRAL_ORDERS).join(', ')})` });
    return { code, stats: this.referralStats(userId) };
  }

  // Invited member's reward: a discount code for their second order, given once
  // their first order is completed.
  claimInviteeReward(userId, amount) {
    const referrerId = this.referrerOf(userId);
    if (!referrerId) return { error: 'not_invited' };
    if (this.data.referrals.discountClaimed.includes(userId)) return { error: 'claimed' };
    if (!this.hasCompletedOrder(userId)) return { error: 'not_yet' };
    this.data.referrals.discountClaimed.push(userId);
    return { code: this.createCode({ type: 'discount', amount, ownerId: userId, reason: `Invited by ${referrerId}` }) };
  }

  // --- saved addresses ---

  addressesOf(userId) {
    return this.data.addresses[userId] ?? [];
  }

  // Newest first, no duplicates, at most MAX_ADDRESSES.
  saveAddress(userId, text) {
    const clean = text.trim();
    const list = this.addressesOf(userId).filter((a) => a.toLowerCase() !== clean.toLowerCase());
    this.data.addresses[userId] = [clean, ...list].slice(0, MAX_ADDRESSES);
    this.save();
    return this.data.addresses[userId];
  }

  removeAddress(userId, index) {
    this.data.addresses[userId] = this.addressesOf(userId).filter((_, i) => i !== index);
    this.save();
    return this.data.addresses[userId];
  }

  // --- vouch reminders ---

  // Completed 1-24 hours ago, not vouched for, not reminded yet. The 24h cap stops
  // old orders from before this feature all being reminded at once.
  vouchRemindersDue(at = Date.now(), afterMs = 60 * 60 * 1000) {
    return Object.values(this.data.orders).filter((o) => {
      if (!o.completedAt || o.vouch || o.vouchReminded || o.status === 'cancelled') return false;
      const age = at - Date.parse(o.completedAt);
      return age >= afterMs && age < 24 * 60 * 60 * 1000;
    });
  }

  // --- loyalty: LOYALTY_ORDERS completed orders within LOYALTY_DAYS = one free-fee code ---

  // Completed orders inside the window that haven't been used for a reward, oldest first.
  loyaltyOrders(userId, days, at = Date.now()) {
    const since = at - days * 24 * 60 * 60 * 1000;
    return Object.values(this.data.orders)
      .filter((o) => o.customerId === userId && o.completedAt && !o.loyaltyUsed && Date.parse(o.completedAt) > since)
      .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  }

  // Gives a code if they've reached the target; the orders used are marked so they don't count again.
  claimLoyalty(userId, { orders, days }, at = Date.now()) {
    const counted = this.loyaltyOrders(userId, days, at);
    if (counted.length < orders) return null;
    for (const o of counted.slice(0, orders)) o.loyaltyUsed = true;
    return this.createCode({ type: 'free', ownerId: userId, reason: `Loyalty: ${counted.slice(0, orders).map((o) => `#${o.id}`).join(', ')}` });
  }

  // --- daily stats ---

  // Numbers for one day. `dateOf(iso)` gives the local YYYY-MM-DD of a timestamp.
  dailyStats(date, dateOf) {
    const on = (iso) => Boolean(iso) && dateOf(iso) === date;
    const orders = Object.values(this.data.orders);
    const completed = orders.filter((o) => on(o.completedAt));
    const byOrderer = {};
    for (const o of completed) {
      const s = (byOrderer[o.ordererId] ??= { completed: 0, minutes: [], fees: 0, orders: [] });
      s.completed += 1;
      s.fees += o.fee ?? 0;
      s.orders.push(o.id);
      if (o.acceptedAt) s.minutes.push((Date.parse(o.completedAt) - Date.parse(o.acceptedAt)) / 60000);
    }
    for (const s of Object.values(byOrderer)) s.avgMinutes = s.minutes.length ? s.minutes.reduce((a, b) => a + b, 0) / s.minutes.length : null;
    const ranked = Object.entries(byOrderer);
    const most = [...ranked].sort(([, a], [, b]) => b.completed - a.completed)[0] ?? null;
    const fastest = ranked.filter(([, s]) => s.avgMinutes !== null).sort(([, a], [, b]) => a.avgMinutes - b.avgMinutes)[0] ?? null;
    return {
      date,
      submitted: orders.filter((o) => on(o.createdAt)).length,
      completed: completed.length,
      cancelled: orders.filter((o) => o.status === 'cancelled' && on(o.updatedAt)).length,
      fees: completed.reduce((sum, o) => sum + (o.fee ?? 0), 0),
      byOrderer,
      most: most && { userId: most[0], ...most[1] },
      fastest: fastest && { userId: fastest[0], ...fastest[1] },
    };
  }

  // --- bot suggestions ---

  addSuggestion({ userId, text }) {
    const suggestion = { number: (this.data.suggestions.at(-1)?.number ?? 0) + 1, userId, text, createdAt: now() };
    this.data.suggestions.push(suggestion);
    this.save();
    return suggestion;
  }

  clearSuggestions() {
    this.data.suggestions = [];
    this.save();
  }

  // --- orderer & partner applications ---

  createApplication(application) {
    const id = randomId(this.data.applications);
    const entry = { id, status: 'pending', createdAt: now(), ...application };
    this.data.applications[id] = entry;
    this.save();
    return entry;
  }

  getApplication(id) {
    return this.data.applications[id] ?? null;
  }

  updateApplication(id, changes) {
    const entry = this.getApplication(id);
    if (!entry) return null;
    Object.assign(entry, changes);
    this.save();
    return entry;
  }

  pendingApplication(userId, type) {
    return Object.values(this.data.applications).find((a) => a.userId === userId && a.type === type && a.status === 'pending') ?? null;
  }
}

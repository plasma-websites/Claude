import fs from 'node:fs';
import path from 'node:path';

// Orders that count towards a member's open-order limit. Completed orders are
// done for the customer even while their ticket waits to auto-close.
const OPEN = new Set(['pending', 'accepted']);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to mix up
export const REFERRAL_INVITES = 3;
export const REFERRAL_ORDERS = 2;
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
      referrals: { links: {}, joins: {}, rewarded: [], discountClaimed: [] },
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
    return this.#transition(id, ['pending'], { status: 'accepted', ordererId });
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

  // { invited: [ids], ordered: [ids that completed an order and haven't been used for a reward yet], rewarded }
  referralStats(userId) {
    const invited = Object.entries(this.data.referrals.joins).filter(([, j]) => j.referrerId === userId).map(([id]) => id);
    const rewarded = invited.filter((id) => this.data.referrals.rewarded.includes(id));
    const ordered = invited.filter((id) => !rewarded.includes(id) && this.hasCompletedOrder(id));
    return { invited, ordered, rewarded };
  }

  // 3 people invited and 2 of them ordered = one free-fee code. Repeatable: each reward uses up 2 new orderers.
  claimReferralReward(userId) {
    const stats = this.referralStats(userId);
    if (stats.invited.length < REFERRAL_INVITES || stats.ordered.length < REFERRAL_ORDERS) return { error: 'not_yet', stats };
    this.data.referrals.rewarded.push(...stats.ordered.slice(0, REFERRAL_ORDERS));
    const code = this.createCode({ type: 'free', ownerId: userId, reason: `Referral reward (${stats.ordered.slice(0, REFERRAL_ORDERS).join(', ')})` });
    return { code, stats: this.referralStats(userId) };
  }

  // The invited member's one-off first-order discount.
  claimInviteeDiscount(userId, amount) {
    const referrerId = this.referrerOf(userId);
    if (!referrerId) return { error: 'not_invited' };
    if (this.data.referrals.discountClaimed.includes(userId)) return { error: 'claimed' };
    if (this.hasCompletedOrder(userId)) return { error: 'ordered' };
    this.data.referrals.discountClaimed.push(userId);
    return { code: this.createCode({ type: 'discount', amount, ownerId: userId, reason: `Invited by ${referrerId}` }) };
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

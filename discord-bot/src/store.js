import fs from 'node:fs';
import path from 'node:path';

// Orders that count towards a member's open-order limit. Completed orders are
// done for the customer even while their ticket waits to auto-close.
const OPEN = new Set(['pending', 'accepted']);
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
    this.data = { orders: {}, support: {}, vouches: [], payments: {}, staff: {}, questions: {}, giveaways: {}, meta: {} };
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
    Object.assign(order, changes, { updatedAt: now() });
    this.save();
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
    return this.#transition(id, ['accepted'], { status: 'completed', closeAt: closeAt.toISOString() });
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

  setOnline(userId, services) {
    Object.assign(this.#staff(userId), { online: services, onlineSince: services.length ? now() : null });
    this.save();
  }

  getStaff(userId) {
    return this.data.staff[userId] ?? { online: [], payments: {} };
  }

  // { serviceKey: [userId, …] } for everyone currently online.
  onlineByService() {
    const result = {};
    for (const [userId, s] of Object.entries(this.data.staff)) {
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
}

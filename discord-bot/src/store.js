import fs from 'node:fs';
import path from 'node:path';

const OPEN = new Set(['pending', 'accepted', 'completed']);
const now = () => new Date().toISOString();

// Orders and support tickets kept in memory and written to a JSON file after
// every change. All state changes are synchronous, so two staff clicking
// "Accept" at the same moment can't both win.
export class Store {
  constructor(file) {
    this.file = file;
    this.data = { nextOrderId: 1, nextSupportId: 1, orders: {}, support: {} };
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
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  }

  // Completed orders whose ticket is due to auto-close.
  dueForClose(at = Date.now()) {
    return Object.values(this.data.orders).filter((o) => o.status === 'completed' && o.closeAt && Date.parse(o.closeAt) <= at);
  }

  createOrder({ service, promo, vc, details, customerId }) {
    const id = this.data.nextOrderId++;
    const order = {
      id,
      service,
      promo,
      vc,
      details,
      customerId,
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

  // Undo an accept, e.g. when the ticket channel couldn't be created.
  unaccept(id) {
    return this.#transition(id, ['accepted'], { status: 'pending', ordererId: null });
  }

  decline(id) {
    return this.#transition(id, ['pending'], { status: 'declined' });
  }

  complete(id, closeAt) {
    return this.#transition(id, ['accepted'], { status: 'completed', closeAt: closeAt.toISOString() });
  }

  close(id) {
    return this.#transition(id, ['accepted', 'completed'], { status: 'closed', closeAt: null });
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

  // --- support tickets ---

  openSupportFor(userId) {
    return Object.values(this.data.support).find((t) => t.userId === userId && t.status === 'open') ?? null;
  }

  supportByChannel(channelId) {
    return Object.values(this.data.support).find((t) => t.channelId === channelId) ?? null;
  }

  createSupport({ userId, reason }) {
    const id = this.data.nextSupportId++;
    const ticket = { id, userId, reason, channelId: null, status: 'open', createdAt: now() };
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
}

import fs from 'node:fs';
import path from 'node:path';

const OPEN = new Set(['pending', 'accepted']);

// Orders kept in memory and written to a JSON file after every change.
// All state changes are synchronous, so two orderers clicking "Accept" at the
// same moment can't both win: whichever interaction is handled first takes it.
export class OrderStore {
  constructor(file) {
    this.file = file;
    this.data = { nextId: 1, orders: {} };
    if (fs.existsSync(file)) this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get(id) {
    return this.data.orders[id] ?? null;
  }

  openOrdersFor(customerId) {
    return Object.values(this.data.orders).filter((o) => o.customerId === customerId && OPEN.has(o.status));
  }

  recentFor(customerId, limit = 10) {
    return Object.values(this.data.orders)
      .filter((o) => o.customerId === customerId)
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  }

  create({ service, customerId, details }) {
    const id = this.data.nextId++;
    const order = {
      id,
      service,
      customerId,
      details,
      status: 'pending',
      ordererId: null,
      channelId: null,
      messageId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.data.orders[id] = order;
    this.save();
    return order;
  }

  setMessage(id, channelId, messageId) {
    const order = this.get(id);
    if (!order) return null;
    Object.assign(order, { channelId, messageId });
    this.save();
    return order;
  }

  #transition(id, from, changes) {
    const order = this.get(id);
    if (!order) return { error: 'That order no longer exists.' };
    if (!from.includes(order.status)) return { error: `Order #${id} is already ${order.status}.`, order };
    Object.assign(order, changes, { updatedAt: new Date().toISOString() });
    this.save();
    return { order };
  }

  accept(id, ordererId) {
    const order = this.get(id);
    if (order && order.customerId === ordererId) return { error: 'You can\'t accept your own order.', order };
    return this.#transition(id, ['pending'], { status: 'accepted', ordererId });
  }

  // Orderer hands the order back to the queue.
  release(id, actorId, isAdmin = false) {
    const order = this.get(id);
    if (order && order.ordererId !== actorId && !isAdmin) return { error: 'Only the orderer who accepted this can release it.', order };
    return this.#transition(id, ['accepted'], { status: 'pending', ordererId: null });
  }

  complete(id, actorId, isAdmin = false) {
    const order = this.get(id);
    if (order && order.ordererId !== actorId && !isAdmin) return { error: 'Only the orderer who accepted this can complete it.', order };
    return this.#transition(id, ['accepted'], { status: 'completed' });
  }

  // Customers can cancel until someone picks the order up; after that only the
  // orderer who accepted it (or an admin) can.
  cancel(id, actorId, isAdmin = false) {
    const order = this.get(id);
    const isCustomer = order?.customerId === actorId;
    const isOrderer = order?.ordererId === actorId;
    if (order && !isCustomer && !isOrderer && !isAdmin) return { error: 'You can only cancel your own orders.', order };
    if (order?.status === 'accepted' && !isOrderer && !isAdmin) {
      return { error: `Order #${id} has already been accepted — message your orderer to cancel it.`, order };
    }
    return this.#transition(id, ['pending', 'accepted'], { status: 'cancelled' });
  }
}

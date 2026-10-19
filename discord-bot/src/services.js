// Companies members can order from. Promos for each one live in promos.json.
// `fields` is the address form shown after the VC question (max 5 per form).
// `fee` is the Food Hub service fee in pounds.
const deliveryFields = [
  { id: 'address', label: 'Delivery address', style: 'paragraph', required: true, max: 300, placeholder: 'House number, street, city, postcode' },
  { id: 'notes', label: 'Notes (optional)', style: 'paragraph', required: false, max: 500, placeholder: 'Door code, flat number, etc.' },
];

export const SERVICES = {
  uberride: {
    label: 'Uber Rides',
    emoji: '🚗',
    color: 0x1f1f1f,
    fee: 1.5,
    fields: [
      { id: 'pickup', label: 'Pickup address', style: 'paragraph', required: true, max: 300 },
      { id: 'dropoff', label: 'Drop-off address', style: 'paragraph', required: true, max: 300 },
      { id: 'notes', label: 'Notes (optional)', style: 'paragraph', required: false, max: 500, placeholder: 'Pickup time, passengers, etc.' },
    ],
  },
  ubereats: { label: 'Uber Eats', emoji: '🍔', color: 0x06c167, fee: 2.5, fields: deliveryFields },
  deliveroo: { label: 'Deliveroo', emoji: '🛵', color: 0x00ccbc, fee: 2.5, fields: deliveryFields },
  justeat: { label: 'Just Eat', emoji: '🍟', color: 0xff8000, fee: 2, fields: deliveryFields },
};

// `emoji` also prefixes the ticket channel name, e.g. 🔵-order-483920.
export const STATUS = {
  pending: { label: 'Waiting for staff', emoji: '🟡' },
  accepted: { label: 'In progress', emoji: '🔵' },
  completed: { label: 'Completed', emoji: '🟢' },
  closed: { label: 'Closed', emoji: '🔒' },
  declined: { label: 'Declined', emoji: '🔴' },
  cancelled: { label: 'Cancelled', emoji: '⚫' },
};

export const money = (pounds) => `£${Number(pounds).toFixed(2)}`;

// Payment methods orderers can save in the staff panel and request with
// /paypal, /rev, /starling and /crypto.
export const PAYMENT_METHODS = {
  paypal: { label: 'PayPal', emoji: '🅿️', command: 'paypal', kind: 'link', pattern: /^https:\/\/(www\.)?(paypal\.me|paypal\.com)\/\S+$/i, example: 'https://paypal.me/yourname' },
  revolut: { label: 'Revolut', emoji: '💳', command: 'rev', kind: 'link', pattern: /^https:\/\/(www\.)?revolut\.me\/\S+$/i, example: 'https://revolut.me/yourname' },
  starling: { label: 'Starling', emoji: '🏦', command: 'starling', kind: 'link', pattern: /^https:\/\/\S+$/i, example: 'https://settleup.starlingbank.com/yourname' },
  ltc: { label: 'Litecoin (LTC)', emoji: '🪙', command: 'crypto', kind: 'address', pattern: /^(L|M|ltc1)[a-zA-HJ-NP-Z0-9]{25,62}$/, example: 'ltc1q… / L… / M…' },
};

export const SUPPORT_STATUS = {
  open: { label: 'Open', emoji: '🟢' },
  closed: { label: 'Closed', emoji: '🔒' },
};

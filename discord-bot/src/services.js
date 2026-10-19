// Companies members can order from. Promos for each one live in promos.json.
// `fields` is the address form shown after the VC question (max 5 per form).
const deliveryFields = [
  { id: 'address', label: 'Delivery address', style: 'paragraph', required: true, max: 300, placeholder: 'House number, street, city, postcode' },
  { id: 'notes', label: 'Notes (optional)', style: 'paragraph', required: false, max: 500, placeholder: 'Door code, flat number, etc.' },
];

export const SERVICES = {
  uberride: {
    label: 'Uber Rides',
    emoji: '🚗',
    color: 0x1f1f1f,
    fields: [
      { id: 'pickup', label: 'Pickup address', style: 'paragraph', required: true, max: 300 },
      { id: 'dropoff', label: 'Drop-off address', style: 'paragraph', required: true, max: 300 },
      { id: 'notes', label: 'Notes (optional)', style: 'paragraph', required: false, max: 500, placeholder: 'Pickup time, passengers, etc.' },
    ],
  },
  ubereats: { label: 'Uber Eats', emoji: '🍔', color: 0x06c167, fields: deliveryFields },
  deliveroo: { label: 'Deliveroo', emoji: '🛵', color: 0x00ccbc, fields: deliveryFields },
  justeat: { label: 'Just Eat', emoji: '🍟', color: 0xff8000, fields: deliveryFields },
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

export const SUPPORT_STATUS = {
  open: { label: 'Open', emoji: '🟢' },
  closed: { label: 'Closed', emoji: '🔒' },
};

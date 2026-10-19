// Companies members can order from. Promos for each one live in promos.json.
export const SERVICES = {
  uberride: { label: 'Uber Rides', emoji: '🚗', color: 0x1f1f1f },
  ubereats: { label: 'Uber Eats', emoji: '🍔', color: 0x06c167 },
  deliveroo: { label: 'Deliveroo', emoji: '🛵', color: 0x00ccbc },
};

export const STATUS = {
  pending: { label: 'Waiting for staff', emoji: '🟡' },
  accepted: { label: 'In progress', emoji: '🔵' },
  completed: { label: 'Completed — ticket closing soon', emoji: '🟢' },
  closed: { label: 'Closed', emoji: '⚫' },
  declined: { label: 'Declined', emoji: '🔴' },
  cancelled: { label: 'Cancelled', emoji: '⚫' },
};

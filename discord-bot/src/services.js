// Order types members can submit. Each one becomes a button on the panel and a
// Discord modal (popup form). Discord allows at most 5 inputs per modal.
export const SERVICES = {
  ubereats: {
    label: 'Uber Eats',
    emoji: '🍔',
    color: 0x06c167,
    fields: [
      { id: 'restaurant', label: 'Restaurant', style: 'short', required: true, max: 100, placeholder: 'e.g. McDonald\'s, High Street' },
      { id: 'items', label: 'Items', style: 'paragraph', required: true, max: 1000, placeholder: 'One item per line, include sizes/extras' },
      { id: 'address', label: 'Delivery address', style: 'paragraph', required: true, max: 300 },
      { id: 'when', label: 'When', style: 'short', required: false, max: 50, placeholder: 'ASAP' },
      { id: 'notes', label: 'Notes', style: 'paragraph', required: false, max: 500, placeholder: 'Allergies, door code, etc.' },
    ],
  },
  uberride: {
    label: 'Uber Ride',
    emoji: '🚗',
    color: 0x1f1f1f,
    fields: [
      { id: 'pickup', label: 'Pickup location', style: 'paragraph', required: true, max: 300 },
      { id: 'dropoff', label: 'Drop-off location', style: 'paragraph', required: true, max: 300 },
      { id: 'when', label: 'Pickup time', style: 'short', required: false, max: 50, placeholder: 'ASAP' },
      { id: 'passengers', label: 'Passengers / ride type', style: 'short', required: false, max: 50, placeholder: 'e.g. 2, UberX' },
      { id: 'notes', label: 'Notes', style: 'paragraph', required: false, max: 500, placeholder: 'Accessibility needs, luggage, etc.' },
    ],
  },
  deliveroo: {
    label: 'Deliveroo',
    emoji: '🛵',
    color: 0x00ccbc,
    fields: [
      { id: 'restaurant', label: 'Restaurant', style: 'short', required: true, max: 100 },
      { id: 'items', label: 'Items', style: 'paragraph', required: true, max: 1000, placeholder: 'One item per line, include sizes/extras' },
      { id: 'address', label: 'Delivery address', style: 'paragraph', required: true, max: 300 },
      { id: 'when', label: 'When', style: 'short', required: false, max: 50, placeholder: 'ASAP' },
      { id: 'notes', label: 'Notes', style: 'paragraph', required: false, max: 500, placeholder: 'Allergies, door code, etc.' },
    ],
  },
};

export const STATUS = {
  pending: { label: 'Waiting for an orderer', emoji: '🟡' },
  accepted: { label: 'Accepted', emoji: '🔵' },
  completed: { label: 'Completed', emoji: '🟢' },
  cancelled: { label: 'Cancelled', emoji: '⚫' },
};

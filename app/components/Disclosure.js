'use client';

import { useState } from 'react';

export default function Disclosure({ label, children }) {
  const [open, setOpen] = useState(false);
  return <details className="card details-card" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{label}</summary>
    {open && <div className="details-content">{children}</div>}
  </details>;
}

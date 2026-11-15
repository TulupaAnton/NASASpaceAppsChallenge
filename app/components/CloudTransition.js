'use client';

import { useEffect, useRef } from 'react';
import { mountCloudTransition } from '../lib/earth/mountCloudTransition';

export default function CloudTransition({ reveal, onCovered, onComplete, onError }) {
  const host = useRef(null), runtime = useRef(null);
  useEffect(() => {
    runtime.current = mountCloudTransition(host.current, { onCovered, onComplete, onError });
    return () => { runtime.current?.dispose(); runtime.current = null; };
  }, [onCovered, onComplete, onError]);
  useEffect(() => { if (reveal) runtime.current?.reveal(); }, [reveal]);
  return <div ref={host} className="cloud-transition" aria-hidden="true" />;
}

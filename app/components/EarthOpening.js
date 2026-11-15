'use client';

import { useEffect, useRef } from 'react';
import { mountEarthOpening } from '../lib/earth/mountEarthOpening';

export default function EarthOpening({ depart, reveal, onDepart, onChooseReady, onLayout, onComplete, onApproachExit, onReady, onError }) {
  const host = useRef(null);
  const runtime = useRef(null);
  useEffect(() => {
    runtime.current = mountEarthOpening(host.current, { onComplete, onReady, onError, onDepart, onChooseReady, onLayout, onApproachExit });
    return () => { runtime.current?.dispose(); runtime.current = null; };
  }, [onComplete, onReady, onError, onDepart, onChooseReady, onLayout, onApproachExit]);
  useEffect(() => { if (depart) runtime.current?.startFlight(); }, [depart]);
  useEffect(() => { if (reveal) runtime.current?.exitClouds(); }, [reveal]);
  return <div ref={host} className="flight earth-opening" aria-hidden={reveal}>
    <p className="sr-only">Earth imagery: NASA Earth Observatory / NASA Goddard Space Flight Center; Reto Stöckli and Robert Simmon. Historical composites, not live weather. Sources: /earth/sources.json.</p>
  </div>;
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mountEarthOpening } from '../lib/earth/mountEarthOpening';
import { loadMap } from '../lib/map-assets';
import { createMapView } from '../lib/map-view';

const noop = () => {};

export default function SpaceApproachLab() {
  const host = useRef(null), runtime = useRef(null), autoStart = useRef(false);
  const mapCanvas = useRef(null);
  const [run, setRun] = useState(0);
  const [stage, setStage] = useState('loading');
  const outside = useCallback(() => setStage('outside'), []);
  const error = useCallback(() => setStage('error'), []);
  useEffect(() => {
    let disposed = false, failed = false, earthReady = false, pictureReady = false, mapView;
    function ready() {
      if (disposed || failed || !earthReady || !pictureReady) return;
      if (autoStart.current) { autoStart.current = false; runtime.current?.startFlight(); }
      else setStage('ready');
    }
    function fail() {
      failed = true;
      if (!disposed) error();
    }
    loadMap().then(async assets => {
      if (disposed) return false;
      mapView = createMapView(mapCanvas.current, host.current, assets, noop, noop, () => true);
      mapView.enter(true);
      pictureReady = await mapView.whenPainted();
      ready();
    }).catch(fail);
    runtime.current = mountEarthOpening(host.current, {
      approachOnly: true,
      onReady: () => {
        earthReady = true;
        ready();
      },
      onDepart: () => setStage('flying'),
      onComplete: () => {
        // Wait until the approach controller has been assigned, including reduced motion.
        queueMicrotask(() => {
          if (disposed || failed) return;
          setStage('exiting');
          runtime.current?.exitClouds();
        });
      },
      onApproachExit: outside,
      onError: fail, onChooseReady: noop, onLayout: noop,
    });
    return () => {
      disposed = true;
      mapView?.destroy();
      runtime.current?.dispose(); runtime.current = null;
    };
  }, [run, outside, error]);

  function start() {
    if (stage === 'outside') {
      autoStart.current = true;
      setStage('loading'); setRun(value => value + 1);
    } else runtime.current?.startFlight();
  }

  return <main className="cloud-lab">
    <h1 className="sr-only">Space to clouds approach test</h1>
    <canvas ref={mapCanvas} className="approach-final-map" aria-label="Final satellite map of Finland" />
    <div ref={host} className="cloud-lab-scene" />
    <div className="cloud-lab-controls">
      {stage === 'error' ? <p role="alert">Unable to start the scene. Reload to retry.</p>
        : <button type="button" disabled={stage === 'loading' || stage === 'flying' || stage === 'exiting'} onClick={start}>
          {stage === 'loading' ? 'Loading…' : stage === 'flying' ? 'Approaching clouds…' : stage === 'exiting' ? 'Leaving clouds…'
            : stage === 'outside' ? 'Replay' : 'Start approach'}
        </button>}
    </div>
    <p className="sr-only">Earth imagery: NASA Earth Observatory. This isolated test crosses the existing cloud cover to reveal the final satellite map of Finland.</p>
  </main>;
}

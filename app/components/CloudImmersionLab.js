'use client';

import { useEffect, useRef, useState } from 'react';
import { mountCloudImmersion } from '../lib/earth/mountCloudImmersion';

export default function CloudImmersionLab() {
  const host = useRef(null), runtime = useRef(null);
  const [stage, setStage] = useState('loading');
  useEffect(() => {
    runtime.current = mountCloudImmersion(host.current, {
      onReady: () => setStage('ready'), onStage: setStage, onError: () => setStage('error'),
    });
    return () => { runtime.current?.dispose(); runtime.current = null; };
  }, []);
  return <main className="cloud-lab">
    <h1 className="sr-only">Cloud immersion test</h1>
    <div ref={host} className="cloud-lab-scene" />
    <div className="cloud-lab-controls">
      {stage === 'error' ? <p role="alert">Unable to start the cloud scene. Reload to retry.</p>
        : <button type="button" disabled={stage === 'loading' || stage === 'entering' || stage === 'exiting'}
          onClick={() => stage === 'inside' ? runtime.current?.exit() : runtime.current?.start()}>
          {stage === 'loading' ? 'Loading…' : stage === 'entering' ? 'Entering clouds…'
            : stage === 'exiting' ? 'Leaving clouds…' : stage === 'inside' ? 'Exit clouds' : stage === 'outside' ? 'Replay' : 'Enter clouds'}
        </button>}
    </div>
  </main>;
}

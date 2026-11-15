'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { coordinates } from '../lib/format';
import { loadMap } from '../lib/map-assets';
import { createMapView } from '../lib/map-view';
import { selection, selectionKey, siteOptions, sites } from '../lib/sites';
import { Icon } from './Icon';

const Analysis = dynamic(() => import('./Analysis'), {
  ssr: false,
  loading: () => <div className="analysis-loading" role="status">Loading analysis…</div>,
});

export default function Experience() {
  const [phase, setPhase] = useState('flight');
  const [selected, setSelected] = useState(null);
  const [shortlist, setShortlist] = useState([]);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState('');
  const video = useRef(null);
  const canvas = useRef(null);
  const focusArea = useRef(null);
  const view = useRef(null);
  const phaseRef = useRef('flight');
  const run = useRef(0);
  const noteTimer = useRef(null);
  const motion = useRef(null);

  const choosePoint = useCallback(site => {
    setNotice('');
    setSelected(site);
    view.current?.show(site);
  }, []);

  const miss = useCallback(() => {
    clearTimeout(noteTimer.current);
    setNotice('Select a point inside Finland’s highlighted boundary.');
    noteTimer.current = setTimeout(() => setNotice(''), 3600);
  }, []);

  const enterMap = useCallback(async (skip = false) => {
    if (phaseRef.current === 'map' || phaseRef.current === 'loading') return;
    phaseRef.current = 'loading';
    setPhase('loading');
    video.current?.pause();
    const current = ++run.current;
    try {
      const assets = await loadMap();
      if (current !== run.current || !canvas.current) return;
      view.current = createMapView(canvas.current, focusArea.current, assets, choosePoint, miss, () => motion.current?.matches);
      view.current.enter(skip);
      phaseRef.current = 'map';
      setPhase('map');
    } catch {
      if (current !== run.current) return;
      phaseRef.current = 'error';
      setPhase('error');
    }
  }, [choosePoint, miss]);

  useEffect(() => {
    motion.current = matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.current.matches) void enterMap(true);
    const preferenceChanged = () => {
      if (motion.current.matches) void enterMap(true);
    };
    motion.current.addEventListener('change', preferenceChanged);
    return () => {
      run.current++;
      phaseRef.current = 'flight';
      clearTimeout(noteTimer.current);
      motion.current.removeEventListener('change', preferenceChanged);
      view.current?.destroy();
      view.current = null;
    };
  }, [enterMap]);

  useEffect(() => {
    view.current?.setContext(shortlist);
  }, [phase, shortlist]);

  function addSite(site) {
    setShortlist(current => current.length < 3 && !current.some(candidate => selectionKey(candidate) === selectionKey(site))
      ? [...current, site] : current);
  }

  function removeSite(site) {
    setShortlist(current => current.filter(candidate => selectionKey(candidate) !== selectionKey(site)));
  }

  const preload = () => { void loadMap().catch(() => {}); };

  function replay() {
    run.current++;
    phaseRef.current = 'flight';
    view.current?.destroy();
    view.current = null;
    setSelected(null);
    setNotice('');
    setPhase('flight');
    setPaused(false);
    const player = video.current;
    player.currentTime = 0;
    void player.play().catch(() => setPaused(true));
  }

  function backToMap() {
    setSelected(null);
    setNotice('');
    view.current?.show(null);
    window.scrollTo(0, 0);
    canvas.current?.focus({ preventScroll: true });
  }

  function chooseReference(referenceId) {
    const site = sites.find(ref => ref.siteId === referenceId);
    if (site) choosePoint(selection(site.point, site.region, site));
  }

  function chooseNamedSite(event) {
    const value = event.target.value;
    if (value === '') return;
    const site = sites[Number(value)];
    choosePoint(selection(site.point, site.region, site));
  }

  const mapReady = phase === 'map';
  return (
    <main className="experience" data-view={selected ? 'analysis' : mapReady ? 'map' : 'flight'}
      onKeyDown={event => { if (event.key === 'Escape' && selected) backToMap(); }}>
      <header className="topbar">
        <div className="brand"><Icon name="globe" /><span>Earth to Finland</span></div>
        <div className="toplinks">
          <a href="/legacy/data-package.html">Data &amp; sources <Icon name="upRight" /></a>
          {mapReady && !selected && !motion.current?.matches && (
            <button className="icon-button replay" title="Replay flight" aria-label="Replay flight" onClick={replay}><Icon name="replay" /></button>
          )}
          {selected && <button className="back-button" onClick={backToMap}><Icon name="left" /> Back to map</button>}
        </div>
      </header>

      <div className="scene">
        <canvas
          ref={canvas} className="map" tabIndex={mapReady ? 0 : -1} role="region" aria-label="Interactive satellite map of Finland"
          aria-describedby="map-help" aria-hidden={!mapReady}
        />
        <p className="sr-only" id="map-help">Choose a point with the pointer or the site menu. Use arrow keys to move the map cursor and Enter to select. Pinch the trackpad, scroll, or use plus and minus to zoom. Press Home to fit Finland.</p>
        <video
          ref={video} className={'flight ' + (mapReady ? 'flight-hidden' : '')}
          src="/flight/globe.mp4" poster="/flight/globe.webp" autoPlay muted playsInline preload="auto"
          aria-hidden="true" onEnded={() => enterMap()} onError={() => enterMap(true)}
          onPlaying={() => { setPaused(false); preload(); }}
          onLoadedData={() => {
            if (phaseRef.current === 'flight' && video.current?.paused) {
              void video.current.play().catch(() => setPaused(true));
            }
          }}
          onSuspend={() => {
            if (phaseRef.current === 'flight' && video.current?.paused && !video.current.ended) setPaused(true);
          }}
        />

        {mapReady && !selected && (
          <div className="map-heading">
            <p className="eyebrow"><span className="signal-dot" /> Data center siting</p>
            <h1>Finland</h1>
            <p className="map-instruction">Select a point to see how it compares as a data center site.</p>
          </div>
        )}

        {mapReady && (
          <div className="zoom" aria-label="Map controls">
            <button aria-label="Zoom in" title="Zoom in" onClick={() => view.current?.zoom(1.4)}><Icon name="plus" /></button>
            <button aria-label="Zoom out" title="Zoom out" onClick={() => view.current?.zoom(1 / 1.4)}><Icon name="minus" /></button>
            <button aria-label="Fit Finland" title="Fit Finland" onClick={() => view.current?.zoom(1)}><Icon name="focus" /></button>
          </div>
        )}

        <div ref={focusArea} className="selection-area">
          {selected && <p className="map-caption"><span className="signal-dot" /> {coordinates(selected.latitude, selected.longitude)}</p>}
        </div>
        <p className="map-notice" role="status">{notice}</p>
      </div>

      {selected && <Analysis site={selected} onChooseSite={chooseReference} shortlist={shortlist}
        onAdd={addSite} onRemove={removeSite} />}
      <footer className="footer">
        <a className="credits" href="/legacy/credits.html">Map credits</a>
        {mapReady ? (
          <label className="site-picker">
            <Icon name="pin" />
            <select aria-label="Choose a reference site" value={selected?.index ?? ''} onChange={chooseNamedSite}>
              <option value="" disabled>Choose a reference site</option>
              {siteOptions.map(site => <option value={site.index} key={site.index}>{site.name}</option>)}
            </select>
            <Icon name="down" />
          </label>
        ) : (
          <div className="flight-controls">
            {phase === 'loading' && <span role="status">Loading Finland…</span>}
            {phase === 'error' && <button className="back-button" onClick={() => enterMap(true)}>Retry map <Icon name="right" /></button>}
            {phase === 'flight' && (
              <>
                {paused && <button className="back-button" onClick={() => void video.current.play().catch(() => enterMap(true))}>Play flight</button>}
                <button className="back-button" onClick={() => enterMap(true)}>Skip flight <Icon name="right" /></button>
              </>
            )}
          </div>
        )}
      </footer>
    </main>
  );
}

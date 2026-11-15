'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { coordinates } from '../lib/format';
import { loadMap } from '../lib/map-assets';
import { createMapView } from '../lib/map-view';
import { selection, selectionKey, siteOptions, sites } from '../lib/sites';
import { Icon } from './Icon';

const EarthOpening = dynamic(() => import('./EarthOpening'), { ssr: false });

const Analysis = dynamic(() => import('./Analysis'), {
  ssr: false,
  loading: () => <div className="analysis-loading" role="status">Loading analysis…</div>,
});

export default function Experience() {
  const [phase, setPhase] = useState('reveal');
  const [countryChosen, setCountryChosen] = useState(false);
  const [countryQuery, setCountryQuery] = useState('');
  const [countrySearchOpen, setCountrySearchOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [shortlist, setShortlist] = useState([]);
  const [openingMounted, setOpeningMounted] = useState(true);
  const [openingRun, setOpeningRun] = useState(0);
  const [mapPrepared, setMapPrepared] = useState(false);
  const [notice, setNotice] = useState('');
  const canvas = useRef(null);
  const experience = useRef(null);
  const focusArea = useRef(null);
  const view = useRef(null);
  const phaseRef = useRef('reveal');
  const openingFailed = useRef(false);
  const run = useRef(0);
  const noteTimer = useRef(null);
  const motion = useRef(null);
  const skipRequested = useRef(false);
  const preparedMap = useRef(null);

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

  const prepareMap = useCallback(() => {
    if (preparedMap.current) return preparedMap.current;
    const current = run.current;
    preparedMap.current = (async () => {
      try {
        const assets = await loadMap();
        if (current !== run.current || !canvas.current) return false;
        view.current?.destroy();
        view.current = createMapView(canvas.current, focusArea.current, assets, choosePoint, miss, () => motion.current?.matches);
        view.current.prepareReveal();
        const painted = await view.current.whenPainted();
        return painted && current === run.current;
      } catch (error) {
        if (current === run.current) preparedMap.current = null;
        throw error;
      }
    })();
    return preparedMap.current;
  }, [choosePoint, miss]);

  const enterMap = useCallback(async (skip = false, cloudHandoff = false) => {
    if (skip) skipRequested.current = true;
    if (skip && phaseRef.current === 'cloud-exit') {
      view.current?.finishReveal();
      phaseRef.current = 'map'; setPhase('map'); setOpeningMounted(false);
      return;
    }
    if (phaseRef.current === 'map' || phaseRef.current === 'loading') return;
    phaseRef.current = 'loading';
    setPhase('loading');
    const current = run.current;
    try {
      const painted = await prepareMap();
      if (!painted || current !== run.current) return;
      setMapPrepared(true);
      if (cloudHandoff && !skipRequested.current) {
        phaseRef.current = 'cloud-exit'; setPhase('cloud-exit');
      } else {
        view.current?.finishReveal();
        phaseRef.current = 'map'; setPhase('map'); setOpeningMounted(false);
      }
    } catch {
      if (current !== run.current) return;
      phaseRef.current = 'error';
      setPhase('error');
    }
  }, [prepareMap]);

  useEffect(() => {
    motion.current = matchMedia('(prefers-reduced-motion: reduce)');
    return () => {
      run.current++;
      phaseRef.current = 'reveal';
      clearTimeout(noteTimer.current);
      view.current?.destroy();
      view.current = null;
      preparedMap.current = null;
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

  const preload = useCallback(() => {
    void prepareMap().catch(() => {});
  }, [prepareMap]);
  const skipOpening = useCallback(() => { void enterMap(true); }, [enterMap]);
  const prepareCloudMap = useCallback(() => { void enterMap(false, true); }, [enterMap]);
  const finishClouds = useCallback(() => {
    if (phaseRef.current !== 'cloud-exit') return;
    view.current?.finishReveal();
    phaseRef.current = 'map'; setPhase('map'); setOpeningMounted(false);
  }, []);
  const layoutOpening = useCallback(progress => {
    experience.current?.style.setProperty('--country-panel-progress', String(progress));
  }, []);
  const departOpening = useCallback(() => {
    phaseRef.current = 'flight';
    setPhase('flight');
  }, []);
  const showCountryChoice = useCallback(() => {
    if (phaseRef.current !== 'reveal') return;
    phaseRef.current = 'country';
    setPhase('country');
  }, []);
  const failOpening = useCallback(() => {
    openingFailed.current = true;
    if (phaseRef.current === 'flight' || phaseRef.current === 'cloud-exit') void enterMap(true);
    else { layoutOpening(1); showCountryChoice(); }
  }, [enterMap, showCountryChoice, layoutOpening]);

  function chooseCountry() {
    phaseRef.current = 'flight';
    setCountryChosen(true);
    if (openingFailed.current) void enterMap(true);
  }

  function replay() {
    run.current++;
    phaseRef.current = 'reveal';
    openingFailed.current = false;
    layoutOpening(0);
    view.current?.destroy();
    view.current = null;
    preparedMap.current = null;
    setSelected(null);
    setNotice('');
    setPhase('reveal');
    setCountryChosen(false);
    setCountryQuery('');
    setCountrySearchOpen(false);
    setOpeningMounted(true);
    setMapPrepared(false);
    skipRequested.current = false;
    setOpeningRun(value => value + 1);
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
  const countryMatches = 'finland'.startsWith(countryQuery.trim().toLowerCase());
  return (
    <main ref={experience} className="experience" data-view={selected ? 'analysis' : mapReady ? 'map' : 'flight'}
      onKeyDown={event => { if (event.key === 'Escape' && selected) backToMap(); }}>
      <header className="topbar">
        <div className="brand"><Icon name="globe" /><span>DataX</span></div>
        <div className="toplinks">
          <a href="/legacy/data-package.html">Data &amp; sources <Icon name="upRight" /></a>
          {mapReady && !selected && !motion.current?.matches && (
            <button className="icon-button replay" title="Replay intro" aria-label="Replay intro" onClick={replay}><Icon name="replay" /></button>
          )}
          {selected && <button className="back-button" onClick={backToMap}><Icon name="left" /> Back to map</button>}
        </div>
      </header>

      <div className="scene">
        <canvas
          ref={canvas} className="map" tabIndex={mapReady ? 0 : -1} role="region" aria-label="Interactive satellite map of Finland"
          aria-describedby="map-help" aria-hidden={!mapPrepared}
        />
        <p className="sr-only" id="map-help">Choose a point with the pointer or the site menu. Use arrow keys to move the map cursor and Enter to select. Pinch the trackpad, scroll, or use plus and minus to zoom. Press Home to fit Finland.</p>
        {openingMounted && <EarthOpening key={openingRun} depart={countryChosen} reveal={phase === 'cloud-exit'}
          onDepart={departOpening} onChooseReady={showCountryChoice} onLayout={layoutOpening}
          onComplete={prepareCloudMap} onApproachExit={finishClouds}
          onReady={preload} onError={failOpening} />}

        {openingMounted && !mapPrepared && phase !== 'loading' && (
          <aside className="country-landing" aria-hidden={phase !== 'country'} inert={phase !== 'country'}>
          <div className="country-brand">DataX</div>
          <section className="country-choice" aria-labelledby="country-heading">
            <h1 id="country-heading">Choose a<br />country</h1>
            <form className="country-search" data-expanded={countrySearchOpen && !countryChosen} onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) setCountrySearchOpen(false);
            }} onSubmit={event => {
              event.preventDefault();
              if (countrySearchOpen && countryMatches && !countryChosen) chooseCountry();
            }}>
              <label className="sr-only" htmlFor="country-search">Search country</label>
              <input id="country-search" type="search" placeholder="Type..." autoComplete="off"
                spellCheck={false} value={countryQuery} disabled={countryChosen}
                onFocus={() => setCountrySearchOpen(true)}
                onChange={event => setCountryQuery(event.target.value)}
                onKeyDown={event => { if (event.key === 'Escape') setCountrySearchOpen(false); }}
                aria-expanded={countrySearchOpen && !countryChosen}
                aria-controls={countrySearchOpen && !countryChosen ? 'country-results' : undefined} />
              {countrySearchOpen && !countryChosen && <div id="country-results" className="country-results">
                {countryMatches ? (
                  <button className="country-option" type="submit" disabled={countryChosen}>
                    Finland
                  </button>
                ) : <p className="country-empty" role="status">No countries found.</p>}
              </div>}
            </form>
          </section>
          </aside>
        )}

        {mapReady && !selected && (
          <div className="map-heading">
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
            {(phase === 'flight' || phase === 'cloud-exit') && (
              <>
                <button className="back-button" onClick={skipOpening}>Skip intro <Icon name="right" /></button>
              </>
            )}
          </div>
        )}
      </footer>
    </main>
  );
}

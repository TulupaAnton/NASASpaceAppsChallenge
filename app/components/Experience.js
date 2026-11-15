'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { countries } from '../lib/countries';
import { loadMap } from '../lib/map-assets';
import { createMapView } from '../lib/map-view';
import { countrySites, selection, selectionKey } from '../lib/sites';
import { Icon } from './Icon';

const EarthOpening = dynamic(() => import('./EarthOpening'), { ssr: false });

const Analysis = dynamic(() => import('./Analysis'), {
  ssr: false,
  loading: () => <div className="analysis-loading" role="status">Loading analysis…</div>,
});

export default function Experience({ onLocationSelected } = {}) {
  const [phase, setPhase] = useState('reveal');
  const [countryId, setCountryId] = useState('fi');
  const [switchTarget, setSwitchTarget] = useState(null);
  const [countryChosen, setCountryChosen] = useState(false);
  const [departReady, setDepartReady] = useState(false);
  const [countryQuery, setCountryQuery] = useState('');
  const [countrySearchOpen, setCountrySearchOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [shortlist, setShortlist] = useState([]);
  const [openingMounted, setOpeningMounted] = useState(true);
  const [openingRun, setOpeningRun] = useState(0);
  const [mapPrepared, setMapPrepared] = useState(false);
  const [notice, setNotice] = useState('');
  const canvas = useRef(null);
  const outgoingMap = useRef(null);
  const atmosphere = useRef(null);
  const experience = useRef(null);
  const focusArea = useRef(null);
  const view = useRef(null);
  const activeCountry = useRef('fi');
  const switching = useRef(false);
  const mapAnimations = useRef([]);
  const phaseRef = useRef('reveal');
  const openingFailed = useRef(false);
  const run = useRef(0);
  const noteTimer = useRef(null);
  const motion = useRef(null);
  const skipRequested = useRef(false);
  const preparedMap = useRef(null);
  const locationSelected = useRef(onLocationSelected);
  useEffect(() => { locationSelected.current = onLocationSelected; }, [onLocationSelected]);

  const choosePoint = useCallback(site => {
    if (switching.current || site.country !== activeCountry.current) return;
    setNotice('');
    clearTimeout(noteTimer.current);
    locationSelected.current?.(site);
    window.dispatchEvent(new CustomEvent('datax:location-selected', { detail: site }));
    setSelected(site);
    view.current?.show(site);
  }, []);

  const showNotice = useCallback(message => {
    clearTimeout(noteTimer.current);
    setNotice(message);
    noteTimer.current = setTimeout(() => setNotice(''), 3600);
  }, []);

  const replaceMap = useCallback(assets => {
    view.current?.destroy();
    const miss = () => showNotice(`Select a point inside the highlighted boundary of ${countries[assets.country].name}.`);
    view.current = createMapView(canvas.current, focusArea.current, assets, choosePoint, miss, () => motion.current?.matches);
    return view.current;
  }, [choosePoint, showNotice]);

  const prepareMap = useCallback(() => {
    const id = activeCountry.current;
    if (preparedMap.current?.id === id) return preparedMap.current.promise;
    const current = run.current;
    const promise = (async () => {
      try {
        const assets = await loadMap(id);
        if (current !== run.current || activeCountry.current !== id || !canvas.current) return false;
        const nextView = replaceMap(assets);
        nextView.prepareReveal();
        const painted = await nextView.whenPainted();
        return painted && current === run.current;
      } catch (error) {
        if (current === run.current) preparedMap.current = null;
        throw error;
      }
    })();
    preparedMap.current = { id, promise };
    return promise;
  }, [replaceMap]);

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
      mapAnimations.current.forEach(animation => animation.cancel());
      switching.current = false;
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
    for (const id of Object.keys(countries)) void loadMap(id).catch(() => {});
  }, []);
  useEffect(preload, [preload]);
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

  async function chooseCountry(id) {
    if (phaseRef.current !== 'country') return;
    const current = run.current;
    activeCountry.current = id;
    setCountryId(id);
    phaseRef.current = 'preparing';
    setPhase('preparing');
    setCountryChosen(true);
    try {
      const painted = await prepareMap();
      if (!painted || current !== run.current) return;
      if (openingFailed.current || motion.current?.matches) void enterMap(true);
      else setDepartReady(true);
    } catch {
      if (current !== run.current) return;
      phaseRef.current = 'error';
      setPhase('error');
    }
  }

  async function switchCountry(id) {
    if (id === activeCountry.current || switching.current || phaseRef.current !== 'map') return;
    const current = run.current;
    switching.current = true;
    setSwitchTarget(id);
    setNotice('');
    try {
      const assets = await loadMap(id);
      if (current !== run.current) return;
      const map = canvas.current;
      const snapshot = outgoingMap.current;
      const animate = !motion.current?.matches && typeof map.animate === 'function';
      if (animate) {
        snapshot.width = map.width;
        snapshot.height = map.height;
        snapshot.getContext('2d').drawImage(map, 0, 0);
        snapshot.hidden = false;
      }

      const previousCountry = activeCountry.current;
      activeCountry.current = id;
      setCountryId(id);
      setSelected(null);
      setShortlist([]);
      window.scrollTo(0, 0);
      const nextView = replaceMap(assets);
      nextView.enter(true);
      await nextView.whenPainted();
      if (current !== run.current || !animate) return;

      const order = { ca: 0, fi: 1 };
      const direction = (order[id] ?? 1) >= (order[previousCountry] ?? 1) ? 1 : -1;
      const options = { duration: 950, easing: 'cubic-bezier(.42, 0, .23, 1)', fill: 'both' };
      mapAnimations.current = [
        map.animate([
          { transform: `translateX(${direction * -5}%) scale(1.12)` },
          { transform: 'translateX(0) scale(1)' },
        ], options),
        snapshot.animate([
          { transform: 'translateX(0) scale(1)', opacity: 1 },
          { transform: `translateX(${direction * 5}%) scale(.96)`, opacity: 0 },
        ], options),
        atmosphere.current.animate([
          { opacity: 0, transform: `translateX(${direction * -18}%)` },
          { opacity: .72, offset: .44 },
          { opacity: 0, transform: `translateX(${direction * 18}%)` },
        ], options),
      ];
      await Promise.allSettled(mapAnimations.current.map(animation => animation.finished));
    } catch {
      if (current === run.current) showNotice(`${countries[id].name} could not be loaded. Try again.`);
    } finally {
      if (current === run.current) {
        mapAnimations.current.forEach(animation => animation.cancel());
        mapAnimations.current = [];
        outgoingMap.current.hidden = true;
        outgoingMap.current.width = 1;
        switching.current = false;
        setSwitchTarget(null);
      }
    }
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
    setShortlist([]);
    setNotice('');
    setPhase('reveal');
    setCountryChosen(false);
    setDepartReady(false);
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
    const site = countrySites[countryId].find(ref => ref.siteId === referenceId);
    if (site) choosePoint(selection(site.point, site.region, site, countryId));
  }

  const mapReady = phase === 'map';
  const country = countries[countryId];
  const countryMatches = Object.values(countries).filter(option => option.name.toLowerCase().startsWith(countryQuery.trim().toLowerCase()));
  return (
    <main ref={experience} className="experience" data-country={countryId.toUpperCase()} data-view={selected ? 'analysis' : mapReady ? 'map' : 'flight'} data-switching={!!switchTarget}
      onKeyDown={event => { if (event.key === 'Escape' && selected) backToMap(); }}>
      <header className="topbar">
        <div className="brand"><Icon name="globe" /><span>DataX</span></div>
        <div className="toplinks">
          {mapReady && <div className="map-country-picker" role="group" aria-label="Map country">
            {Object.values(countries).map(option => <button key={option.id} type="button"
              aria-pressed={countryId === option.id} aria-disabled={!!switchTarget || undefined}
              onClick={() => void switchCountry(option.id)}>{option.name}</button>)}
          </div>}
          <a className="sources-link" href={country.sources} aria-label="Data and sources" title="Data and sources"><span>Data &amp; sources</span> <Icon name="upRight" /></a>
          {mapReady && <a className="credits" href={country.credits}>Map credits</a>}
          {mapReady && !selected && !motion.current?.matches && (
            <button className="icon-button replay" title="Replay intro" aria-label="Replay intro" disabled={!!switchTarget} onClick={replay}><Icon name="replay" /></button>
          )}
          {selected && <button className="back-button" onClick={backToMap}><Icon name="left" /> Back to map</button>}
        </div>
      </header>

      <div className="scene">
        <canvas
          ref={canvas} className="map" tabIndex={mapReady && !switchTarget ? 0 : -1} role="region" aria-label={`Interactive satellite map of ${country.name}`}
          aria-describedby="map-help" aria-hidden={!mapPrepared}
        />
        <canvas ref={outgoingMap} className="map-outgoing" aria-hidden="true" hidden />
        <div ref={atmosphere} className="map-switch-atmosphere" aria-hidden="true" />
        <p className="sr-only" id="map-help">Choose a point on the map. Use arrow keys to move the map cursor and Enter to select. Pinch the trackpad, scroll, or use plus and minus to zoom. Press Home to fit {country.name}.</p>
        <p className="sr-only" role="status">{switchTarget ? `Opening the map of ${countries[switchTarget].name}.` : ''}</p>
        {openingMounted && <EarthOpening key={openingRun} depart={departReady} reveal={phase === 'cloud-exit'}
          approachTarget={country.approachTarget}
          onDepart={departOpening} onChooseReady={showCountryChoice} onLayout={layoutOpening}
          onComplete={prepareCloudMap} onApproachExit={finishClouds}
          onReady={preload} onError={failOpening} />}

        {openingMounted && !mapPrepared && phase !== 'loading' && (
          <aside className="country-landing" aria-hidden={phase !== 'country'} inert={phase !== 'country'}>
          <div className="country-brand">DataX</div>
          <section className="country-choice" aria-labelledby="country-heading">
            <h1 id="country-heading">Choose a<br />country</h1>
            <form className="country-search" data-expanded={countrySearchOpen && !countryChosen} data-results={countryMatches.length}
              style={{ '--country-results-height': Math.max(1, countryMatches.length) * 36 + 'px' }} onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) setCountrySearchOpen(false);
            }} onSubmit={event => {
              event.preventDefault();
              if (countrySearchOpen && countryMatches.length === 1) chooseCountry(countryMatches[0].id);
            }}>
              <label className="sr-only" htmlFor="country-search">Search country</label>
              <input id="country-search" type="search" placeholder="Type..." autoComplete="off"
                spellCheck={false} value={countryQuery} disabled={countryChosen}
                onFocus={() => setCountrySearchOpen(true)}
                onChange={event => setCountryQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape') setCountrySearchOpen(false);
                  if (event.key === 'ArrowDown') { event.preventDefault(); event.currentTarget.form.querySelector('.country-option')?.focus(); }
                }}
                aria-expanded={countrySearchOpen && !countryChosen}
                aria-controls={countrySearchOpen && !countryChosen ? 'country-results' : undefined} />
              {countrySearchOpen && !countryChosen && <div id="country-results" className="country-results">
                {countryMatches.length ? (
                  countryMatches.map(option => <button className="country-option" key={option.id} type="button" onClick={() => chooseCountry(option.id)}>
                    {option.name}
                  </button>)
                ) : <p className="country-empty" role="status">No countries found.</p>}
              </div>}
            </form>
          </section>
          </aside>
        )}

        {mapReady && !selected && (
          <div className="map-heading" key={countryId}>
            <h1>{country.name}</h1>
            <p className="map-instruction">Select a point to see how it compares as a data center site.</p>
          </div>
        )}

        {mapReady && (
          <div className="zoom" aria-label="Map controls" inert={!!switchTarget}>
            <button aria-label="Zoom in" title="Zoom in" onClick={() => view.current?.zoom(1.4)}><Icon name="plus" /></button>
            <button aria-label="Zoom out" title="Zoom out" onClick={() => view.current?.zoom(1 / 1.4)}><Icon name="minus" /></button>
            <button aria-label={`Fit ${country.name}`} title={`Fit ${country.name}`} onClick={() => view.current?.zoom(1)}><Icon name="focus" /></button>
          </div>
        )}

        <div ref={focusArea} className="selection-area" />
        <p className="map-notice" role="status">{notice}</p>
      </div>

      {selected && <Analysis site={selected} onChooseSite={chooseReference} shortlist={shortlist}
        onAdd={addSite} onRemove={removeSite} />}
      {!mapReady && <footer className="footer">
        <div className="flight-controls">
          {(phase === 'loading' || phase === 'preparing') && <span role="status">Loading {country.name}…</span>}
          {phase === 'error' && <button className="back-button" onClick={() => enterMap(true)}>Retry map <Icon name="right" /></button>}
          {(phase === 'flight' || phase === 'cloud-exit') && (
            <button className="back-button" onClick={skipOpening}>Skip intro <Icon name="right" /></button>
          )}
        </div>
      </footer>}
    </main>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { coordinates } from '../lib/format';
import { loadMap } from '../lib/map-assets';
import { createMapView } from '../lib/map-view';
import { selection, selectionKey, sites } from '../lib/sites';
import { getCountry, matchingCountries } from '../lib/countries.js';
import { Icon } from './Icon';

const EarthOpening = dynamic(() => import('./EarthOpening'), { ssr: false });

const Analysis = dynamic(() => import('./Analysis'), {
  ssr: false,
  loading: () => <div className="analysis-loading" role="status">Loading analysis…</div>,
});

export default function Experience({ onLocationSelected } = {}) {
  const [phase, setPhase] = useState('reveal');
  const [countryCode, setCountryCode] = useState(null);
  const [departCountry, setDepartCountry] = useState(null);
  const [countryQuery, setCountryQuery] = useState('');
  const [countrySearchOpen, setCountrySearchOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [shortlist, setShortlist] = useState([]);
  const [openingMounted, setOpeningMounted] = useState(true);
  const [openingRun, setOpeningRun] = useState(0);
  const [mapPrepared, setMapPrepared] = useState(false);
  const [notice, setNotice] = useState('');
  const [pinned, setPinned] = useState(null);
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
  const chosenCountry = useRef('FI');
  const mapAssets = useRef(null);
  const locationSelected = useRef(onLocationSelected);

  useEffect(() => { locationSelected.current = onLocationSelected; }, [onLocationSelected]);

  const choosePoint = useCallback(site => {
    clearTimeout(noteTimer.current);
    setNotice('');
    if (site.countryCode === 'CA') {
      setPinned(site);
      view.current?.mark(site);
      locationSelected.current?.(site);
      window.dispatchEvent(new CustomEvent('datax:location-selected', { detail: site }));
      return;
    }
    setSelected(site);
    view.current?.show(site);
  }, []);

  const miss = useCallback(() => {
    clearTimeout(noteTimer.current);
    setNotice('Select a point inside ' + getCountry(chosenCountry.current).name + '’s highlighted boundary.');
    noteTimer.current = setTimeout(() => setNotice(''), 3600);
  }, []);

  const prepareMap = useCallback((code = chosenCountry.current) => {
    if (preparedMap.current?.countryCode === code) return preparedMap.current.promise;
    const current = run.current;
    const promise = (async () => {
      try {
        const assets = await loadMap(code);
        if (current !== run.current || chosenCountry.current !== code || !canvas.current) return false;
        mapAssets.current = assets;
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
    preparedMap.current = { countryCode: code, promise };
    return promise;
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
      mapAssets.current = null;
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
    void loadMap('FI').catch(() => {});
    void loadMap('CA').catch(() => {});
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

  async function chooseCountry(code) {
    if (countryCode || phaseRef.current === 'preparing') return;
    getCountry(code);
    const current = run.current;
    chosenCountry.current = code;
    phaseRef.current = 'preparing';
    setCountryCode(code);
    setPhase('preparing');
    try {
      // Include the first real canvas paint, not only fetch/decode completion.
      // Deferred border rasterization must finish before the camera starts.
      const painted = await prepareMap(code);
      if (!painted || current !== run.current) return;
      if (openingFailed.current) void enterMap(true);
      else setDepartCountry(code);
    } catch {
      if (current !== run.current) return;
      phaseRef.current = 'error';
      setPhase('error');
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
    mapAssets.current = null;
    chosenCountry.current = 'FI';
    setSelected(null);
    setPinned(null);
    setNotice('');
    setPhase('reveal');
    setCountryCode(null);
    setDepartCountry(null);
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
    const assets = mapAssets.current;
    const site = assets?.sites.find(entry => entry.index === Number(value));
    if (site) choosePoint(assets.select(site.point, site.region, site));
  }

  const mapReady = phase === 'map';
  const countryChosen = countryCode !== null;
  const country = getCountry(countryCode ?? 'FI');
  const countryMatches = matchingCountries(countryQuery);
  const siteOptions = [...(country.sites ?? sites)].sort((a, b) => a.name.localeCompare(b.name));
  const pickerLabel = country.code === 'CA' ? 'Choose a location' : 'Choose a reference site';
  return (
    <main ref={experience} className="experience" data-country={country.code} data-view={selected ? 'analysis' : mapReady ? 'map' : 'flight'}
      onKeyDown={event => { if (event.key === 'Escape' && selected) backToMap(); }}>
      <header className="topbar">
        <div className="brand"><Icon name="globe" /><span>DataX</span></div>
        <div className="toplinks">
          <a href={country.sources}>Data &amp; sources <Icon name="upRight" /></a>
          {mapReady && !selected && !motion.current?.matches && (
            <button className="icon-button replay" title="Replay intro" aria-label="Replay intro" onClick={replay}><Icon name="replay" /></button>
          )}
          {selected && <button className="back-button" onClick={backToMap}><Icon name="left" /> Back to map</button>}
        </div>
      </header>

      <div className="scene">
        <canvas
          ref={canvas} className="map" tabIndex={mapReady ? 0 : -1} role="region" aria-label={'Interactive satellite map of ' + country.name}
          aria-describedby="map-help" aria-hidden={!mapPrepared}
        />
        <p className="sr-only" id="map-help">Choose a point with the pointer or the site menu. Use arrow keys to move the map cursor and Enter to select. Pinch the trackpad, scroll, or use plus and minus to zoom. Press Home to fit {country.name}.</p>
        {openingMounted && <EarthOpening key={openingRun} depart={departCountry} reveal={phase === 'cloud-exit'}
          onDepart={departOpening} onChooseReady={showCountryChoice} onLayout={layoutOpening}
          onComplete={prepareCloudMap} onApproachExit={finishClouds}
          onReady={preload} onError={failOpening} />}

        {openingMounted && !mapPrepared && phase !== 'loading' && (
          <aside className="country-landing" aria-hidden={phase !== 'country'} inert={phase !== 'country'}>
          <div className="country-brand">DataX</div>
          <section className="country-choice" aria-labelledby="country-heading">
            <h1 id="country-heading">Choose a<br />country</h1>
            <form className="country-search" data-expanded={countrySearchOpen && !countryChosen}
              style={{ '--country-results-height': Math.max(1, countryMatches.length) * 36 + 'px' }} onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) setCountrySearchOpen(false);
            }} onSubmit={event => {
              event.preventDefault();
              if (countrySearchOpen && countryMatches.length && !countryChosen) chooseCountry(countryMatches[0].code);
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
                {countryMatches.length ? countryMatches.map(option => (
                  <button className="country-option" type="button" key={option.code}
                    onClick={() => chooseCountry(option.code)} disabled={countryChosen}>
                    {option.name}
                  </button>
                )) : <p className="country-empty" role="status">No countries found.</p>}
              </div>}
            </form>
          </section>
          </aside>
        )}

        {mapReady && !selected && (
          <div className="map-heading">
            <h1>{country.name}</h1>
            <p className="map-instruction">{country.code === 'CA' ? 'Explore the map and select a location.' : 'Select a point to see how it compares as a data center site.'}</p>
          </div>
        )}

        {mapReady && (
          <div className="zoom" aria-label="Map controls">
            <button aria-label="Zoom in" title="Zoom in" onClick={() => view.current?.zoom(1.4)}><Icon name="plus" /></button>
            <button aria-label="Zoom out" title="Zoom out" onClick={() => view.current?.zoom(1 / 1.4)}><Icon name="minus" /></button>
            <button aria-label={'Fit ' + country.name} title={'Fit ' + country.name} onClick={() => view.current?.zoom(1)}><Icon name="focus" /></button>
          </div>
        )}

        <div ref={focusArea} className="selection-area">
          {selected && <p className="map-caption"><span className="signal-dot" /> {coordinates(selected.latitude, selected.longitude)}</p>}
        </div>
        <p className="map-notice" role="status">{notice}</p>
        {pinned && <p className="map-caption" aria-live="polite"><span className="signal-dot" />
          {pinned.regionName} · {coordinates(pinned.latitude, pinned.longitude)}
        </p>}
      </div>

      {selected && <Analysis site={selected} onChooseSite={chooseReference} shortlist={shortlist}
        onAdd={addSite} onRemove={removeSite} />}
      <footer className="footer">
        <a className="credits" href={country.credits}>Map credits</a>
        {mapReady ? (
          <label className="site-picker">
            <Icon name="pin" />
            <select aria-label={pickerLabel} value={selected?.index ?? pinned?.index ?? ''} onChange={chooseNamedSite}>
              <option value="" disabled>{pickerLabel}</option>
              {siteOptions.map(site => <option value={site.index} key={site.index}>{site.name}</option>)}
            </select>
            <Icon name="down" />
          </label>
        ) : (
          <div className="flight-controls">
            {(phase === 'loading' || phase === 'preparing') && <span role="status">Loading {country.name}…</span>}
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

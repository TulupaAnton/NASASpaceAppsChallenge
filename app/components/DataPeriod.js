'use client';

import { useId, useRef, useState } from 'react';
import { valueText } from '../lib/analysis-format';
import { DEFAULT_TIME_RANGE, timeRangeKey } from '../lib/sites';
import { Icon } from './Icon';

const historyOptions = [
  { startYear: 2005, endYear: 2024 },
  { startYear: 2015, endYear: 2024 },
  { startYear: 1984, endYear: 2024 },
];
const years = Array.from({ length: 41 }, (_, index) => 2024 - index);
const forecastOptions = [5, 10, 15, 20];

const dates = (first, last) => `${first}–${last}`;

function historyChoice({ startYear, endYear }) {
  return historyOptions.findIndex(option => option.startYear === startYear && option.endYear === endYear);
}

function Period({ kind, title, start, end, temperature }) {
  return <div className={`data-period-segment data-period-${kind}`}>
    <dt>{title}</dt>
    <dd className="data-period-years">{dates(start, end)}</dd>
    {Number.isFinite(temperature) && <dd className="data-period-reading">
      <strong>{valueText(temperature, '°C')}</strong> average
    </dd>}
  </div>;
}

export default function DataPeriod({ range, onApply, historyTemperature, projectionTemperature, comparing }) {
  const formId = useId();
  const trigger = useRef(null);
  const [editor, setEditor] = useState(null);
  const appliedKey = timeRangeKey(range);
  const editing = editor?.appliedKey === appliedKey;
  const visible = editing ? editor.range : range;
  const { startYear, endYear, horizonYears } = visible;
  const totalHistory = endYear - startYear + 1;

  function close() {
    setEditor(null);
    trigger.current?.focus();
  }

  function update(fields, choice = editor.choice) {
    setEditor({ ...editor, choice, range: { ...editor.range, ...fields } });
  }

  return <section className="card data-period" aria-label="Data period" onKeyDown={event => {
    if (event.key === 'Escape' && editing) {
      event.stopPropagation();
      close();
    }
  }}>
    <div className="data-period-header">
      <h2>Data period</h2>
      <button ref={trigger} type="button" className="data-period-edit" aria-expanded={editing}
        aria-controls={editing ? formId : undefined}
        onClick={() => editing ? close() : setEditor({ appliedKey, choice: historyChoice(range), range })}>
        {editing ? 'Cancel' : 'Change dates'} <Icon name={editing ? 'minus' : 'down'} />
      </button>
    </div>

    {editing ? <form id={formId} className="data-period-form" onSubmit={event => {
      event.preventDefault();
      if (timeRangeKey(editor.range) === appliedKey) return;
      onApply(editor.range);
      close();
    }}>
      <div className="data-period-fields">
        <div className="data-period-field">
          <label htmlFor={`${formId}-history`}>Historical data</label>
          <select id={`${formId}-history`} value={editor.choice} onChange={event => {
            const choice = Number(event.target.value);
            update(historyOptions[choice] ?? {}, choice);
          }}>
            {historyOptions.map((option, index) => <option key={option.startYear} value={index}>
              {dates(option.startYear, option.endYear)} · {option.endYear - option.startYear + 1} years
            </option>)}
            <option value={-1}>Custom years</option>
          </select>
          {editor.choice === -1 && <div className="data-period-custom" role="group" aria-label="Custom historical years">
            <label>Start year
              <select value={startYear} onChange={event => update({ startYear: Number(event.target.value) })}>
                {years.filter(year => year <= endYear - 2).map(year => <option key={year}>{year}</option>)}
              </select>
            </label>
            <label>End year
              <select value={endYear} onChange={event => update({ endYear: Number(event.target.value) })}>
                {years.filter(year => year >= startYear + 2).map(year => <option key={year}>{year}</option>)}
              </select>
            </label>
          </div>}
          <p>{editor.choice === -1 ? `${totalHistory} years selected · 3 years minimum` : 'Years used to calculate past conditions.'}</p>
        </div>
        <div className="data-period-field">
          <label htmlFor={`${formId}-projection`}>Temperature projection</label>
          <select id={`${formId}-projection`} value={horizonYears} onChange={event => update({ horizonYears: Number(event.target.value) })}>
            {forecastOptions.map(years => <option key={years} value={years}>{years} years after {endYear}</option>)}
          </select>
          <p><strong>{dates(endYear + 1, endYear + horizonYears)}</strong> · If the past trend continues.</p>
        </div>
      </div>
      <div className="data-period-actions">
        <button className="text-button data-period-reset" type="button" onClick={() => update(DEFAULT_TIME_RANGE, 0)}
          disabled={timeRangeKey(visible) === timeRangeKey(DEFAULT_TIME_RANGE) && editor.choice === 0}>Use default dates</button>
        <button className="data-period-apply" type="submit" disabled={timeRangeKey(visible) === appliedKey}>Apply dates</button>
      </div>
    </form> : <>
      <div className="data-period-track" aria-hidden="true">
        <span style={{ flexGrow: totalHistory }} />
        <span style={{ flexGrow: horizonYears }} />
      </div>
      <dl className="data-period-summary" aria-live="polite" aria-atomic="true">
        <Period kind="history" title="Historical data" start={startYear} end={endYear} temperature={historyTemperature} />
        <Period kind="projection" title="Temperature projection" start={endYear + 1} end={endYear + horizonYears} temperature={projectionTemperature} />
      </dl>
      {comparing && <p className="data-period-note">These dates apply to every site in the comparison.</p>}
    </>}
  </section>;
}

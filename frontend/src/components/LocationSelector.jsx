import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { locationsApi } from '../lib/locationsApi';
import { authFieldClasses, authLabelClasses } from './AuthLayout';

/*
 * Country → State → City, as one reusable control.
 *
 * Built once and used everywhere an address is captured — signup, business
 * profile, branch creation, customer records — because three pages each
 * implementing their own cascade is three places for the reset rules to be
 * subtly different.
 *
 * The rules it exists to enforce:
 *
 *   Nothing loads before it is needed. Cities arrive only after a state is
 *   chosen; there is no request that could return every city in the world.
 *
 *   Changing a country clears the state and the city. Changing a state clears
 *   the city. Leaving "Telangana" selected under "United States" would submit
 *   a combination the server is about to reject, and the person filling the
 *   form would have no idea why.
 *
 *   Every failure says something and offers a retry. A signup form that dies
 *   because a dropdown could not load is a lost customer.
 *
 * The parent owns the value; this only reports changes upward. That keeps it
 * usable in a form that already has its own state, which is every form here.
 *
 * Two skins. The portal one matches the panels inside the product; the auth one
 * matches the login card, so the three dropdowns on the signup form do not look
 * like they were bolted on from somewhere else. Both take their auth styling
 * from AuthLayout rather than restating it, so the login page and this stay in
 * step when either changes.
 */

const SKINS = {
  portal: {
    label: 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-neutral-400',
    field: 'w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-left text-sm text-white outline-none transition hover:border-neutral-700 focus:border-red-500/60',
    fieldOff: 'w-full cursor-not-allowed rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2.5 text-left text-sm text-neutral-600 outline-none',
    panel: 'border-neutral-800 bg-neutral-950',
    search: 'w-full border-b border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none',
    option: 'text-neutral-300 hover:bg-neutral-900',
    optionOn: 'bg-red-500/10 text-white'
  },
  auth: {
    label: authLabelClasses,
    field: `${authFieldClasses} text-left`,
    fieldOff: `${authFieldClasses} text-left cursor-not-allowed opacity-50`,
    panel: 'border-white/10 bg-neutral-950/95 backdrop-blur-xl',
    search: 'w-full border-b border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-sm text-white placeholder-neutral-600 outline-none',
    option: 'text-neutral-300 hover:bg-white/[0.06]',
    optionOn: 'bg-red-500/15 text-white'
  }
};

const Combo = ({
  id, label, required, value, options, placeholder, disabled, disabledHint,
  loading, error, onPick, onRetry, getKey, getLabel, getSub, skin
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef(null);

  /* Close on an outside click or Escape. Without this the list stays open
     behind whatever the person clicks next. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = options.find((o) => String(getKey(o)) === String(value));

  /* Filtered in the browser. The lists that reach here are already scoped to
     one country or one state, so a round trip per keystroke would be slower
     and would fail on a bad connection where typing still works. */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options
      .filter((o) => getLabel(o).toLowerCase().includes(q))
      .sort((a, b) => {
        const ap = getLabel(a).toLowerCase().startsWith(q) ? 0 : 1;
        const bp = getLabel(b).toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp || getLabel(a).localeCompare(getLabel(b));
      });
  }, [options, query, getLabel]);

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={id} className={skin.label}>
        {label}{required && <span className="ml-0.5 text-red-400">*</span>}
      </label>

      <button
        id={id}
        type="button"
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setQuery(''); }}
        className={disabled || loading ? skin.fieldOff : skin.field}
      >
        {loading ? `Loading ${label.toLowerCase()}…`
          : disabled ? disabledHint
          : selected ? getLabel(selected)
          : <span className="text-neutral-600">{placeholder}</span>}
        <span className="float-right text-neutral-600">▾</span>
      </button>

      {error && (
        <p className="mt-1 text-xs text-red-300">
          {error}{' '}
          <button type="button" onClick={onRetry} className="underline hover:text-red-200">Retry</button>
        </p>
      )}

      {open && !disabled && !loading && (
        <div className={`absolute z-30 mt-1 w-full overflow-hidden rounded-xl border shadow-2xl ${skin.panel}`}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            className={skin.search}
          />
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-neutral-600">
                No {label.toLowerCase()} found{query ? ` for “${query}”` : ''}.
              </p>
            ) : filtered.map((o) => {
              const key = getKey(o);
              const isSel = String(key) === String(value);
              return (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onClick={() => { onPick(o); setOpen(false); setQuery(''); }}
                  className={`flex w-full items-center justify-between px-3.5 py-2 text-left text-sm transition ${
                    isSel ? skin.optionOn : skin.option
                  }`}
                >
                  <span>{getLabel(o)}</span>
                  {getSub && <span className="ml-2 text-[10px] text-neutral-600">{getSub(o)}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const LocationSelector = ({
  countryId, stateId, cityId, onChange,
  required = true, labels = {}, className = '', variant = 'portal'
}) => {
  const skin = SKINS[variant] || SKINS.portal;
  const [countries, setCountries] = useState([]);
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState({ countries: true, states: false, cities: false });
  const [errors, setErrors] = useState({});

  const setBusy = (key, value) => setLoading((l) => ({ ...l, [key]: value }));
  const setErr = (key, value) => setErrors((e) => ({ ...e, [key]: value }));

  const loadCountries = useCallback(async () => {
    setBusy('countries', true); setErr('countries', null);
    try { setCountries(await locationsApi.countries()); }
    catch (e) { setErr('countries', e.message); }
    finally { setBusy('countries', false); }
  }, []);

  const loadStates = useCallback(async (id) => {
    if (!id) { setStates([]); return; }
    setBusy('states', true); setErr('states', null);
    try { setStates(await locationsApi.states(id)); }
    catch (e) { setErr('states', e.message); setStates([]); }
    finally { setBusy('states', false); }
  }, []);

  const loadCities = useCallback(async (id) => {
    if (!id) { setCities([]); return; }
    setBusy('cities', true); setErr('cities', null);
    try { setCities(await locationsApi.cities(id)); }
    catch (e) { setErr('cities', e.message); setCities([]); }
    finally { setBusy('cities', false); }
  }, []);

  useEffect(() => { loadCountries(); }, [loadCountries]);
  useEffect(() => { loadStates(countryId); }, [countryId, loadStates]);
  useEffect(() => { loadCities(stateId); }, [stateId, loadCities]);

  const pickCountry = (country) => {
    /* The country's currency and timezone go up with it, so a caller can show
       or store them without a second request — and without guessing them from
       the city name, which is how those two end up wrong. */
    onChange({
      country_id: country.id, state_id: null, city_id: null,
      country, state: null, city: null
    });
  };

  const pickState = (state) =>
    onChange({ country_id: countryId, state_id: state.id, city_id: null, state, city: null });

  const pickCity = (city) =>
    onChange({ country_id: countryId, state_id: stateId, city_id: city.id, city });

  return (
    <div className={`grid gap-4 sm:grid-cols-3 ${className}`}>
      <Combo
        id="loc-country" label={labels.country || 'Country'} required={required}
        value={countryId} options={countries} placeholder="Select a country"
        loading={loading.countries} error={errors.countries} onRetry={loadCountries}
        onPick={pickCountry} skin={skin}
        getKey={(c) => c.id} getLabel={(c) => c.name} getSub={(c) => c.iso2_code}
      />

      <Combo
        id="loc-state" label={labels.state || 'State / Province'} required={required}
        value={stateId} options={states} placeholder="Select a state"
        disabled={!countryId} disabledHint="Select a country first"
        loading={loading.states} error={errors.states}
        onRetry={() => loadStates(countryId)}
        onPick={pickState} skin={skin}
        getKey={(s) => s.id} getLabel={(s) => s.name} getSub={(s) => s.code || s.type}
      />

      <Combo
        id="loc-city" label={labels.city || 'City'} required={required}
        value={cityId} options={cities} placeholder="Select a city"
        disabled={!stateId} disabledHint={countryId ? 'Select a state first' : 'Select a country first'}
        loading={loading.cities} error={errors.cities}
        onRetry={() => loadCities(stateId)}
        onPick={pickCity} skin={skin}
        getKey={(c) => c.id} getLabel={(c) => c.name}
      />
    </div>
  );
};

export default LocationSelector;

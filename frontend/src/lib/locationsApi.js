/*
 * Client for the location master.
 *
 * Public endpoints — the signup form needs them before anyone has an account —
 * so no token is attached.
 *
 * Countries and states are memoised for the life of the page. They change
 * perhaps once a year, and re-fetching the country list every time a form
 * mounts is the kind of waste nobody notices until a slow connection makes it
 * obvious. Cities are not cached: they are already narrow, and a stale city
 * list is the one that would actually be wrong.
 */
const API_BASE_URL = import.meta.env.VITE_API_URL;

const memo = new Map();

const get = async (path) => {
  const res = await fetch(`${API_BASE_URL}/api/locations${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    /* Whatever the server said, or a sentence the customer can act on — never
       a status code or a stack trace. */
    throw new Error(body.message || 'Unable to load locations. Please try again.');
  }
  return body.data;
};

const cachedGet = async (key, path) => {
  if (memo.has(key)) return memo.get(key);
  const value = await get(path);
  memo.set(key, value);
  return value;
};

export const locationsApi = {
  countries: (search) => (search
    ? get(`/countries?search=${encodeURIComponent(search)}`)
    : cachedGet('countries', '/countries')),

  states: (countryId, search) => (search
    ? get(`/countries/${countryId}/states?search=${encodeURIComponent(search)}`)
    : cachedGet(`states:${countryId}`, `/countries/${countryId}/states`)),

  /* Deliberately never cached and never fetched without a state — there is no
     endpoint that returns every city, because sending one to a browser is how
     a signup form becomes a megabyte. */
  cities: (stateId, search) =>
    get(`/states/${stateId}/cities${search ? `?search=${encodeURIComponent(search)}` : ''}`),

  country: (countryId) => cachedGet(`bundle:${countryId}`, `/country/${countryId}`)
};

export default locationsApi;

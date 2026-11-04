import { useEffect } from 'react';

const ORIGIN = 'https://managerxp.com';

const setMeta = (attr, key, value) => {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
};

/**
 * Per-route metadata. Updates the tags index.html already ships in place
 * rather than appending duplicates, so crawlers that skip JS still get the
 * homepage defaults and everyone else gets the page's own.
 */
const Seo = ({ title, description, path = '/' }) => {
  useEffect(() => {
    const url = ORIGIN + path;
    document.title = title;
    setMeta('name', 'description', description);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', url);
    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = url;
  }, [title, description, path]);

  return null;
};

export default Seo;

import { SITE_STATES, SITE_LOCALES } from './constants.js';

// Content is organized as /{state}/{locale}/... (e.g. /tx/en/about-us), so the
// state segment now comes BEFORE the locale. STATES, SITE_STATES, and SITE_LOCALES
// are defined in ./constants.js and re-exported above for backwards compatibility.

/**
 * Resolve the localized content root for the current page under the
 * /{state}/{locale}/... structure. This is the prefix used to locate
 * per-site fragments (nav, footer), placeholders and the query-index.
 *
 * Examples: "/tx/en/about-us" -> "/tx/en"; legacy "/fr/coffee" -> "/fr";
 * anything else (unknown/root) -> "".
 * @returns {string} the content root path, or "" when none applies
 */
export function getLangRoot() {
  const segs = window.location.pathname.split('/').filter(Boolean);
  let root = '';
  if (SITE_STATES.includes(segs[0])) {
    root = `/${segs[0]}`;
    if (SITE_LOCALES.includes(segs[1])) root += `/${segs[1]}`;
  } else if (SITE_LOCALES.includes(segs[0])) {
    root = `/${segs[0]}`;
  }
  return root;
}

/**
 * The locale code for the current page (e.g. "en", "fr"), or "" when none is
 * present in the URL.
 * @returns {string}
 */
export function getLocale() {
  const segs = window.location.pathname.split('/').filter(Boolean);
  if (SITE_LOCALES.includes(segs[0])) return segs[0];
  return '';
}

/**
 * Path to the query-index feed scoped to the current page's state/locale root
 * (e.g. "/tx/en/query-index.json"). Falls back to "/query-index.json" at the
 * site root. Mirrors the targets configured in helix-query.yaml.
 * @returns {string}
 */
export function getQueryIndexPath() {
  return `${getLangRoot()}/query-index.json`;
}

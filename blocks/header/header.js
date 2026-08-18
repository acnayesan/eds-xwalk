import { getMetadata } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';
import buildGnavSearch from './gnav-search.js';

// media query match that indicates mobile/tablet width
const isDesktop = window.matchMedia('(min-width: 900px)');

function closeOnEscape(e) {
  if (e.code === 'Escape') {
    const nav = document.getElementById('nav');
    const navSections = nav.querySelector('.nav-sections');
    if (!navSections) return;
    const navSectionExpanded = navSections.querySelector('[aria-expanded="true"]');
    if (navSectionExpanded && isDesktop.matches) {
      // eslint-disable-next-line no-use-before-define
      toggleAllNavSections(navSections);
      navSectionExpanded.focus();
    } else if (!isDesktop.matches) {
      // eslint-disable-next-line no-use-before-define
      toggleMenu(nav, navSections);
      nav.querySelector('button').focus();
    }
  }
}

function closeOnFocusLost(e) {
  const nav = e.currentTarget;
  if (!nav.contains(e.relatedTarget)) {
    const navSections = nav.querySelector('.nav-sections');
    if (!navSections) return;
    const navSectionExpanded = navSections.querySelector('[aria-expanded="true"]');
    if (navSectionExpanded && isDesktop.matches) {
      // eslint-disable-next-line no-use-before-define
      toggleAllNavSections(navSections, false);
    } else if (!isDesktop.matches) {
      // eslint-disable-next-line no-use-before-define
      toggleMenu(nav, navSections, false);
    }
  }
}

function openOnKeydown(e) {
  const focused = document.activeElement;
  const isNavDrop = focused.className === 'nav-drop';
  if (isNavDrop && (e.code === 'Enter' || e.code === 'Space')) {
    const dropExpanded = focused.getAttribute('aria-expanded') === 'true';
    // eslint-disable-next-line no-use-before-define
    toggleAllNavSections(focused.closest('.nav-sections'));
    focused.setAttribute('aria-expanded', dropExpanded ? 'false' : 'true');
  }
}

function focusNavSection() {
  document.activeElement.addEventListener('keydown', openOnKeydown);
}

/**
 * Toggles all nav sections
 * @param {Element} sections The container element
 * @param {Boolean} expanded Whether the element should be expanded or collapsed
 */
function toggleAllNavSections(sections, expanded = false) {
  if (!sections) return;
  sections.querySelectorAll('.nav-sections .default-content-wrapper > ul > li').forEach((section) => {
    section.setAttribute('aria-expanded', expanded);
  });
}

/**
 * Toggles the entire nav
 * @param {Element} nav The container element
 * @param {Element} navSections The nav sections within the container element
 * @param {*} forceExpanded Optional param to force nav expand behavior when not null
 */
function toggleMenu(nav, navSections, forceExpanded = null) {
  const expanded = forceExpanded !== null ? !forceExpanded : nav.getAttribute('aria-expanded') === 'true';
  const button = nav.querySelector('.nav-hamburger button');
  document.body.style.overflowY = (expanded || isDesktop.matches) ? '' : 'hidden';
  nav.setAttribute('aria-expanded', expanded ? 'false' : 'true');
  toggleAllNavSections(navSections, expanded || isDesktop.matches ? 'false' : 'true');
  button.setAttribute('aria-label', expanded ? 'Open navigation' : 'Close navigation');
  // enable nav dropdown keyboard accessibility
  if (navSections) {
    const navDrops = navSections.querySelectorAll('.nav-drop');
    if (isDesktop.matches) {
      navDrops.forEach((drop) => {
        if (!drop.hasAttribute('tabindex')) {
          drop.setAttribute('tabindex', 0);
          drop.addEventListener('focus', focusNavSection);
        }
      });
    } else {
      navDrops.forEach((drop) => {
        drop.removeAttribute('tabindex');
        drop.removeEventListener('focus', focusNavSection);
      });
    }
  }

  // enable menu collapse on escape keypress
  if (!expanded || isDesktop.matches) {
    // collapse menu on escape press
    window.addEventListener('keydown', closeOnEscape);
    // collapse menu on focus lost
    nav.addEventListener('focusout', closeOnFocusLost);
  } else {
    window.removeEventListener('keydown', closeOnEscape);
    nav.removeEventListener('focusout', closeOnFocusLost);
  }
}

/**
 * loads and decorates the header, mainly the nav
 * @param {Element} block The header block element
 */
export default async function decorate(block) {
  // load nav as fragment
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : '/nav';
  const fragment = await loadFragment(navPath);

  // decorate nav DOM
  block.textContent = '';
  const nav = document.createElement('nav');
  nav.id = 'nav';
  while (fragment.firstElementChild) nav.append(fragment.firstElementChild);

  const classes = ['brand', 'sections', 'tools'];
  classes.forEach((c, i) => {
    const section = nav.children[i];
    if (section) section.classList.add(`nav-${c}`);
  });

  const navBrand = nav.querySelector('.nav-brand');
  const brandLink = navBrand.querySelector('.button');
  if (brandLink) {
    brandLink.className = '';
    brandLink.closest('.button-container').className = '';
  }

  const navSections = nav.querySelector('.nav-sections');
  if (navSections) {
    navSections.querySelectorAll(':scope .default-content-wrapper > ul > li').forEach((navSection) => {
      if (navSection.querySelector('ul')) navSection.classList.add('nav-drop');
      navSection.addEventListener('click', () => {
        if (isDesktop.matches) {
          const expanded = navSection.getAttribute('aria-expanded') === 'true';
          toggleAllNavSections(navSections);
          navSection.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        }
      });
    });
  }

  const navTools = nav.querySelector('.nav-tools');
  if (navTools) {
    // Collect all authored search-source definitions from the nav-tools area.
    // Each matching link becomes one source; its visible text becomes the group
    // label shown in the search results panel. Multiple links = multi-source search.
    // .search blocks (backward compat) and bare query-index/search links both work.
    const sourceLinks = [];
    const seenUrls = new Set();
    const wrappersToRemove = new Set();

    // A Search block in nav-tools is the canonical way to author sources.
    // Each row = one source: first cell is the query-index URL (link or plain
    // text), second cell (optional) is the group label shown in results.
    const addSource = (rawHref, rawLabel) => {
      if (!rawHref) return;
      let resolved;
      try {
        resolved = new URL(rawHref, window.location);
      } catch {
        return;
      }
      const url = resolved.origin === window.location.origin
        ? resolved.pathname : resolved.href;
      if (seenUrls.has(url)) return;
      seenUrls.add(url);
      sourceLinks.push({ url, label: rawLabel || null });
    };

    navTools.querySelectorAll('.search').forEach((searchBlock) => {
      // The Search block's own decoration runs first (during the fragment's
      // loadSections) and empties its DOM, so prefer the sources it stashed on
      // the block. Fall back to reading raw rows (e.g. in the editor, where the
      // block is left un-decorated).
      const stashed = searchBlock.dataset.searchSources;
      if (stashed) {
        try {
          JSON.parse(stashed).forEach(({ url, label }) => addSource(url, label));
        } catch {
          // ignore malformed stash and fall through to row reading
        }
      } else {
        searchBlock.querySelectorAll(':scope > div').forEach((row) => {
          const cells = [...row.querySelectorAll(':scope > div')];
          if (!cells.length) return;
          const link = cells[0].querySelector('a[href]');
          const rawHref = link ? link.getAttribute('href') : cells[0].textContent.trim();
          const label = cells.length > 1 ? cells[1].textContent.trim() : null;
          addSource(rawHref, label);
        });
      }
      wrappersToRemove.add(searchBlock.closest('p, .button-container') || searchBlock);
    });

    navTools.querySelectorAll('a[href*="query-index"], a[href*="search"]').forEach((a) => {
      const resolved = new URL(a.getAttribute('href'), window.location);
      const url = resolved.origin === window.location.origin
        ? resolved.pathname : resolved.href;
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        sourceLinks.push({ url, label: a.textContent.trim() || null });
      }
      wrappersToRemove.add(a.closest('p, .button-container, li') || a);
    });

    wrappersToRemove.forEach((el) => el.remove());

    const gnavSearch = await buildGnavSearch(sourceLinks);
    // Search sits first in the tools cluster (icon), before Sign In and the logo.
    navTools.prepend(gnavSearch);

    // Strip boilerplate button decoration and tag the remaining tools links so
    // CSS can style Sign In and the Adobe logo consistently.
    navTools.querySelectorAll('.button-container').forEach((c) => c.classList.remove('button-container'));
    navTools.querySelectorAll('a[href]').forEach((a) => {
      a.classList.remove('button');
      if (a.querySelector('img')) {
        a.classList.add('nav-tools-logo');
      } else if (a.textContent.trim()) {
        a.classList.add('nav-tools-link');
      }
    });
  }

  // hamburger for mobile
  const hamburger = document.createElement('div');
  hamburger.classList.add('nav-hamburger');
  hamburger.innerHTML = `<button type="button" aria-controls="nav" aria-label="Open navigation">
      <span class="nav-hamburger-icon"></span>
    </button>`;
  hamburger.addEventListener('click', () => toggleMenu(nav, navSections));
  nav.prepend(hamburger);
  nav.setAttribute('aria-expanded', 'false');
  // prevent mobile nav behavior on window resize
  toggleMenu(nav, navSections, isDesktop.matches);
  isDesktop.addEventListener('change', () => toggleMenu(nav, navSections, isDesktop.matches));

  const navWrapper = document.createElement('div');
  navWrapper.className = 'nav-wrapper';
  navWrapper.append(nav);
  block.append(navWrapper);
}

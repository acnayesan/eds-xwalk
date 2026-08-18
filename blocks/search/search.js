import { getQueryIndexPath } from '../../scripts/utils.js';

/**
 * Read all rows from the block DOM and return a sources array.
 * Each row: first cell = URL (link or plain text), second cell (optional) = label.
 * @param {HTMLElement} block
 * @returns {Array<{url: string, label: string|null, baseUrl: string|null}>}
 */
function parseSources(block) {
  const sources = [];
  block.querySelectorAll(':scope > div').forEach((row) => {
    const cells = [...row.querySelectorAll(':scope > div')];
    if (!cells.length) return;
    const link = cells[0].querySelector('a[href]');
    const isExternal = cells[0].textContent.trim().startsWith('http');

    if (isExternal && link) {
      // External links are not allowed to be authored as <a> because the block
      // editor will rewrite them to relative paths. So if we see an authored
      // <a> with an external URL, ignore it and fall back to the plain text.
      sources.push(
        {
          url: cells[0].textContent.trim(),
          label: cells.length > 1 ? cells[1].textContent.trim() || null : null,
          baseUrl: null,
        },
      );
      return;
    }

    const rawUrl = link ? link.getAttribute('href') : cells[0].textContent.trim();
    if (!rawUrl) return;
    let resolved;
    try {
      resolved = new URL(rawUrl, window.location);
    } catch {
      return;
    }
    const baseUrl = resolved.origin !== window.location.origin ? resolved.origin : null;
    const label = cells.length > 1 ? cells[1].textContent.trim() || null : null;
    sources.push({ url: resolved.href, label, baseUrl });
  });
  return sources;
}

export default async function decorate(block) {
  // In the Universal Editor each authored row carries the data-aue-* instrumentation
  // that lets authors add, edit and remove "Search Source" items. Rebuilding the
  // block DOM from scratch (as the runtime path below does) strips that
  // instrumentation, leaving the editor with no recognizable child items and no way
  // to add a source. So when authoring, keep the authored source table intact and
  // skip building the runtime UI; the functional search still renders on the
  // published/preview site where no instrumentation is present.
  if (document.querySelector('[data-aue-resource]')) {
    block.classList.add('search-authoring');
    return;
  }

  // Read all source rows before clearing the block DOM.
  const sources = parseSources(block);

  // Persist the authored sources on the block before we wipe its DOM. When a
  // Search block is used purely to configure the header search (in nav-tools),
  // header.js decorates the nav AFTER the fragment's blocks are loaded, by which
  // point this decorate() has already emptied the block and its source rows are
  // gone. Stashing them here lets header.js recover them regardless of load order.
  if (sources.length) {
    block.dataset.searchSources = JSON.stringify(
      sources.map(({ url, label }) => ({ url, label })),
    );
  }

  if (!sources.length) {
    // Fall back to the locale query-index when no sources are authored.
    sources.push({
      url: `${window.hlx.codeBasePath}${getQueryIndexPath()}`,
      label: null,
      baseUrl: null,
    });
  }

  block.innerHTML = '';
}

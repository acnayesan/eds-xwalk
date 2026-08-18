#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-console */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, '..', 'eds-sites.config.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
  console.error(`Cannot read eds-sites.config.json: ${e.message}`);
  process.exit(1);
}

const {
  edsOrg, ghOwner, ghRepo, aemAuthor,
  sitePrefix, contentRoot, baseDomain, useCDN,
  techAccount, adminEmail, states, locales,
} = config;

const ADMIN_BASE = 'https://admin.hlx.page';

// ─── CLI ─────────────────────────────────────────────────────────────────────

const TOKEN = process.env.EDS_TOKEN;
const argv = process.argv.slice(2);
const getOpt = (name) => {
  const match = argv.find((a) => a.startsWith(`--${name}=`));
  return match ? match.split('=').slice(1).join('=') : null;
};
const hasFlag = (name) => argv.includes(`--${name}`);

const STEP = getOpt('step') || 'all';
const FILTER_STATE = getOpt('state');
const DRY_RUN = hasFlag('dry-run');

const USAGE = `
Usage: EDS_TOKEN=<token> node tools/eds-setup.js [options]

Options:
  --step=<name>    Run a specific step (default: all)
  --state=<code>   Limit to one state, e.g. --state=co
  --dry-run        Print actions without making API calls

Steps:
  create-sites     Step 5  — register 16 EDS repoless sites
  path-mappings    Step 6  — set AEM→EDS path mappings
  cdn              Step 8  — set CDN (only when useCDN=true in config)
  index            Step 9  — push shared query-index config
  sitemaps         Step 10 — push sitemap config to EN sites
  robots           Step 11 — push robots.txt to all sites
  sidekick         Step 13 — push sidekick language-switch plugin
  verify                    — GET all sites and report missing config
  all                       — run all steps then verify

Get EDS_TOKEN from: https://admin.hlx.page/login → auth_token cookie
`;

if (hasFlag('help') || hasFlag('h')) {
  console.log(USAGE);
  process.exit(0);
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function httpRequest(method, urlStr, body, contentType) {
  return new Promise((resolve, reject) => {
    const payload = body || '';
    const u = new URL(urlStr);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'x-auth-token': TOKEN,
        'content-type': contentType || 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function apiGet(url) {
  return httpRequest('GET', url, '', 'application/json');
}

async function apiPost(url, body, contentType) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  if (DRY_RUN) {
    console.log(`    [dry-run] POST ${url.replace(ADMIN_BASE, '')}`);
    return { status: 200, body: '{}' };
  }
  const res = await httpRequest('POST', url, payload, contentType || 'application/json');
  if (res.status < 200 || res.status >= 300) {
    const snippet = res.body.slice(0, 300).replace(/\n/g, ' ');
    throw new Error(`HTTP ${res.status}: ${snippet}`);
  }
  return res;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function siteName(code, locale) { return `${ghRepo}-${code}-${locale}`; }

function franklinUrl(site) {
  return `${aemAuthor}/bin/franklin.delivery/${edsOrg}/${site}/main`;
}

function filteredStates() {
  return FILTER_STATE ? states.filter((s) => s.code === FILTER_STATE) : states;
}

// ─── Token validation ─────────────────────────────────────────────────────────

async function validateToken() {
  const res = await apiGet(`${ADMIN_BASE}/config/${ghOwner}/sites.json`);
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `EDS_TOKEN is invalid or expired (HTTP ${res.status}).\n`
      + '  Re-authenticate at https://admin.hlx.page/login and copy the auth_token cookie.',
    );
  }
}

// ─── Step 5: Create sites ─────────────────────────────────────────────────────

async function createSites() {
  console.log('\n── Step 5: Create EDS sites ──');
  for (const { code, name } of filteredStates()) {
    for (const locale of locales) {
      const site = siteName(code, locale);
      const siteSource = `${code}/${locale}`;
      console.log(`  ${site} (${name} ${locale.toUpperCase()})...`);
      try {
        await apiPost(`${ADMIN_BASE}/config/${ghOwner}/sites/${site}.json`, {
          code: {
            owner: ghOwner,
            repo: ghRepo,
            source: { type: 'github', url: `https://github.com/${ghOwner}/${ghRepo}` },
          },
          content: {
            source: {
              url: `${franklinUrl(`${sitePrefix}`)}/${siteSource}`,
              type: 'markup',
              suffix: '.html',
            },
          },
          access: {
            admin: {
              role: {
                admin: adminEmail ? [adminEmail] : [],
                config_admin: techAccount ? [techAccount] : [],
              },
              requireAuth: 'auto',
            },
          },
        });
        console.log('    ✓');
      } catch (e) {
        console.error(`    ✗ ${e.message}`);
      }
      await sleep(500);
    }
  }
}

// ─── Step 6: Path mappings ────────────────────────────────────────────────────

async function setPathMappings() {
  console.log('\n── Step 6: Set path mappings ──');
  for (const { code } of filteredStates()) {
    for (const locale of locales) {
      const site = siteName(code, locale);
      const aemBase = `${contentRoot}/${code}/${locale}`;
      console.log(`  ${site}: ${aemBase}/ → /`);
      try {
        await apiPost(`${ADMIN_BASE}/config/${ghOwner}/sites/${site}/public.json`, {
          paths: {
            mappings: [`${aemBase}/:/`],
            includes: [`${aemBase}/`],
            excludes: [
              `${aemBase}/**/drafts/**`,
              `${aemBase}/*.xml`,
            ],
          },
        });
        console.log('    ✓');
      } catch (e) {
        console.error(`    ✗ ${e.message}`);
      }
      await sleep(300);
    }
  }
}

// ─── Step 8: CDN ─────────────────────────────────────────────────────────────

async function setCDN() {
  if (!useCDN) {
    console.log('\n── Step 8: CDN — skipped (set useCDN=true in eds-sites.config.json when ready) ──');
    return;
  }
  console.log(`\n── Step 8: Set CDN → ${baseDomain} (type: managed) ──`);
  for (const { code } of filteredStates()) {
    for (const locale of locales) {
      const site = siteName(code, locale);
      console.log(`  ${site}...`);
      try {
        await apiPost(
          `${ADMIN_BASE}/config/${ghOwner}/sites/${site}/cdn.json`,
          { prod: { host: baseDomain, type: 'managed' } },
        );
        console.log('    ✓');
      } catch (e) {
        console.error(`    ✗ ${e.message}`);
      }
      await sleep(300);
    }
  }
  console.log('\n  DNS after CDN setup:');
  console.log(`    www.${baseDomain}  CNAME → cdn.adobeaemcloud.com`);
  console.log('    Apex A records  → 151.101.3.10, 151.101.67.10, 151.101.131.10, 151.101.195.10');
}

// ─── Step 9: Index ────────────────────────────────────────────────────────────

const INDEX_YAML = `version: 2

indices:
  pages:
    include:
      - /**
    exclude:
      - /nav
      - /footer
      - /drafts/**
    target: /query-index.json
    properties:
      title:
        select: head > meta[property="og:title"]
        value: attribute(el, "content")
      description:
        select: head > meta[name="description"]
        value: attribute(el, "content")
      image:
        select: head > meta[property="og:image"]
        value: attribute(el, "content")
      lastModified:
        select: none
        value: parseTimestamp(headers["last-modified"], "ddd, DD MMM YYYY hh:mm:ss GMT")
      robots:
        select: head > meta[name="robots"]
        value: attribute(el, "content")
      lang:
        select: html
        value: attribute(el, "lang")
`;

async function pushIndex() {
  console.log('\n── Step 9: Push index config (all 16 sites) ──');
  for (const { code } of filteredStates()) {
    for (const locale of locales) {
      const site = siteName(code, locale);
      console.log(`  ${site}...`);
      try {
        await apiPost(
          `${ADMIN_BASE}/config/${ghOwner}/sites/${site}/content/query.yaml`,
          INDEX_YAML,
          'text/yaml',
        );
        console.log('    ✓');
      } catch (e) {
        console.error(`    ✗ ${e.message}`);
      }
      await sleep(300);
    }
  }
}

// ─── Step 10: Sitemaps ────────────────────────────────────────────────────────

function buildSitemapYaml(code, label) {
  const frSite = siteName(code, 'fr');
  // FR query-index is fetched from the FR site (with/without CDN)
  const frIndexUrl = useCDN
    ? `https://${baseDomain}/${code}/fr/query-index.json`
    : `https://main--${frSite}--${ghOwner}.aem.live/query-index.json`;

  return `sitemaps:
  ${label}:
    default: en
    lastmod: YYYY-MM-DD
    languages:
      en:
        source: /query-index.json
        destination: /sitemap-en.xml
        hreflang: en-US
      fr:
        source: ${frIndexUrl}
        destination: /sitemap-fr.xml
        hreflang: fr
        alternate: /fr/{path}
`;
}

async function pushSitemaps() {
  console.log('\n── Step 10: Push sitemap config (EN sites only — generates EN+FR sitemaps) ──');
  for (const { code, label } of filteredStates()) {
    const site = siteName(code, 'en');
    console.log(`  ${site}...`);
    try {
      await apiPost(
        `${ADMIN_BASE}/config/${ghOwner}/sites/${site}/content/sitemap.yaml`,
        buildSitemapYaml(code, label || code),
        'text/yaml',
      );
      console.log('    ✓');
    } catch (e) {
      console.error(`    ✗ ${e.message}`);
    }
    await sleep(300);
  }
}

// ─── Step 11: robots.txt ──────────────────────────────────────────────────────

async function pushRobots() {
  console.log('\n── Step 11: Push robots.txt ──');
  for (const { code } of filteredStates()) {
    const siteEn = siteName(code, 'en');
    const siteFr = siteName(code, 'fr');

    // Both EN and FR sitemaps are served from the EN site
    const enOrigin = useCDN
      ? `https://${baseDomain}/${code}`
      : `https://main--${siteEn}--${ghOwner}.aem.live`;

    const enRobots = `User-agent: *\nAllow: /\nSitemap: ${enOrigin}/sitemap-en.xml`;
    // FR robots.txt points to EN site origin because FR sitemap is generated there
    const frRobots = `User-agent: *\nAllow: /\nSitemap: ${enOrigin}/sitemap-fr.xml`;

    for (const [site, body] of [[siteEn, enRobots], [siteFr, frRobots]]) {
      console.log(`  ${site}...`);
      try {
        await apiPost(
          `${ADMIN_BASE}/config/${ghOwner}/sites/${site}/robots.txt`,
          body,
          'text/plain',
        );
        console.log('    ✓');
      } catch (e) {
        console.error(`    ✗ ${e.message}`);
      }
      await sleep(200);
    }
  }
}

// ─── Step 13: Sidekick ────────────────────────────────────────────────────────

async function pushSidekick() {
  console.log('\n── Step 13: Push sidekick config ──');
  for (const { code } of filteredStates()) {
    const siteEn = siteName(code, 'en');
    const siteFr = siteName(code, 'fr');

    // On production: link to CDN path (same domain, different path prefix)
    // On dev (.aem.live): link to the other site's origin
    const frUrl = useCDN
      ? `https://${baseDomain}/${code}/fr`
      : `https://main--${siteFr}--${ghOwner}.aem.live`;
    const enUrl = useCDN
      ? `https://${baseDomain}/${code}`
      : `https://main--${siteEn}--${ghOwner}.aem.live`;

    const pairs = [
      [siteEn, { id: 'switch-fr', title: 'Voir en Français', url: frUrl }],
      [siteFr, { id: 'switch-en', title: 'Switch to English', url: enUrl }],
    ];

    for (const [site, plugin] of pairs) {
      console.log(`  ${site}...`);
      try {
        await apiPost(
          `${ADMIN_BASE}/config/${ghOwner}/sites/${site}/sidekick.json`,
          { plugins: [{ ...plugin, environments: ['edit', 'preview', 'live'] }] },
        );
        console.log('    ✓');
      } catch (e) {
        console.error(`    ✗ ${e.message}`);
      }
      await sleep(200);
    }
  }
}

// ─── Verify ───────────────────────────────────────────────────────────────────

async function verify() {
  console.log('\n── Verify: Checking all sites ──\n');
  const issues = [];

  for (const { code, name } of filteredStates()) {
    for (const locale of locales) {
      const site = siteName(code, locale);
      let res;
      try {
        res = await apiGet(`${ADMIN_BASE}/config/${ghOwner}/sites/${site}.json`);
      } catch (e) {
        issues.push(`${site}: network error (${e.message})`);
        console.log(`  ✗ ${site}: network error`);
        continue;
      }

      if (res.status === 404) {
        issues.push(`${site}: not created (404)`);
        console.log(`  ✗ ${site} [${name} ${locale.toUpperCase()}]: not found`);
        continue;
      }

      let parsed;
      try { parsed = JSON.parse(res.body); } catch {
        issues.push(`${site}: invalid response`);
        continue;
      }

      const siteIssues = [];
      if (parsed.code?.owner !== ghOwner) siteIssues.push(`code.owner is "${parsed.code?.owner}", expected "${ghOwner}"`);
      if (parsed.code?.repo !== ghRepo) siteIssues.push(`code.repo is "${parsed.code?.repo}", expected "${ghRepo}"`);

      const siteSource = `${code}/${locale}`;
      const expectedContent = `${franklinUrl(`${sitePrefix}`)}/${siteSource}`;
      if (parsed.content?.source?.url !== expectedContent) {
        siteIssues.push('content.source.url mismatch');
      }

      if (siteIssues.length) {
        console.log(`  ✗ ${site}: ${siteIssues.join(' | ')}`);
        siteIssues.forEach((i) => issues.push(`${site}: ${i}`));
      } else {
        console.log(`  ✓ ${site} [${name} ${locale.toUpperCase()}]`);
      }

      await sleep(100);
    }
  }

  console.log('');
  if (issues.length === 0) {
    console.log('All sites verified ✓\n');
  } else {
    console.log(`${issues.length} issue(s) found:\n`);
    issues.forEach((i) => console.log(`  • ${i}`));
    console.log('');
  }
  return issues.length === 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const STEPS = {
  'create-sites': createSites,
  'path-mappings': setPathMappings,
  cdn: setCDN,
  index: pushIndex,
  sitemaps: pushSitemaps,
  robots: pushRobots,
  sidekick: pushSidekick,
  verify,
};

async function main() {
  if (!TOKEN) {
    if (DRY_RUN) {
      console.warn('Warning: EDS_TOKEN not set — dry-run will show the full plan without validating.\n');
    } else {
      console.error('Error: EDS_TOKEN environment variable is required.');
      console.error('  Get it from: https://admin.hlx.page/login → auth_token cookie\n');
      process.exit(1);
    }
  }

  if (FILTER_STATE && !states.find((s) => s.code === FILTER_STATE)) {
    console.error(`Unknown state code: ${FILTER_STATE}`);
    console.error(`  Valid codes: ${states.map((s) => s.code).join(', ')}`);
    process.exit(1);
  }

  if (STEP !== 'all' && !STEPS[STEP]) {
    console.error(`Unknown step: ${STEP}`);
    console.error(`  Valid steps: ${Object.keys(STEPS).join(', ')}, all`);
    process.exit(1);
  }

  console.log(`EDS Setup — org: ${edsOrg}, prefix: ${sitePrefix}`);
  if (DRY_RUN) console.log('[dry-run — no API calls will be made]');
  if (FILTER_STATE) console.log(`[state filter: ${FILTER_STATE}]`);
  if (useCDN) console.log(`[CDN enabled → ${baseDomain}]`);

  if (STEP !== 'verify' && !DRY_RUN) {
    console.log('\nValidating token...');
    try {
      await validateToken();
      console.log('Token OK ✓');
    } catch (e) {
      console.error(`\n${e.message}`);
      process.exit(1);
    }
  }

  if (STEP === 'all') {
    await createSites();
    await setPathMappings();
    await setCDN();
    await pushIndex();
    await pushSitemaps();
    await pushRobots();
    await pushSidekick();
    if (!DRY_RUN) {
      const ok = await verify();
      process.exit(ok ? 0 : 1);
    } else {
      console.log('\n[dry-run] Skipping verify — run without --dry-run to check live state.\n');
    }
  } else {
    await STEPS[STEP]();
  }
}

main().catch((e) => {
  console.error(`\nFatal: ${e.message}`);
  process.exit(1);
});

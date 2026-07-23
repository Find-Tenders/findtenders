// DevelopmentAid publishes full tender details for free (real descriptions,
// contact emails, downloadable documents — no login needed), unlike
// GlobalTenders or Devex's "Pro" tier which paywall everything past a
// teaser. It's an Angular SPA, but the underlying search API turned out
// to be directly callable with a plain POST — no headless browser needed.
// Found by: opening the Locations filter, inspecting the Yemen checkbox's
// DOM id ("option-184"), and testing that ID directly against the API
// (which gives clear validation error messages that guided the request
// shape: {filter: {locations: [id], statuses: [id]}, page, pageSize, sort}).
import { getOrCreateSource, markSourceResult, upsertTenders } from '../lib/upsertTenders.mjs';
import { makeFingerprint, truncate } from '../lib/normalize.mjs';
import { BROWSER_HEADERS } from '../lib/http.mjs';

const SEARCH_PAGE_URL = 'https://www.developmentaid.org/tenders/search';
const API_URL = 'https://www.developmentaid.org/api/frontend/tender/search';
const YEMEN_LOCATION_ID = 184;
const OPEN_STATUS_ID = 3;

// DevelopmentAid uses its own fixed sector taxonomy (not free-text), so a
// direct lookup is far more accurate here than the generic keyword guesser
// used for scraped Arabic/English titles elsewhere.
const SECTOR_MAP = [
  ['Water, Sanitation & Hygiene', 'water'],
  ['Civil Engineering', 'construction'],
  ['Energy', 'energy'],
  ['Education', 'education'],
  ['Agriculture & Rural Development', 'agriculture'],
  ['Environment & Climate', 'environment'],
  ['Health', 'health'],
  ['Transport', 'transport'],
];
function mapSector(sectorsText) {
  for (const [needle, slug] of SECTOR_MAP) {
    if (sectorsText.includes(needle)) return slug;
  }
  return null;
}

async function fetchNotices() {
  // Warm up a session cookie first, in case the API expects one set by an
  // initial page load rather than working for a fully cold request.
  const homeRes = await fetch(SEARCH_PAGE_URL, { headers: BROWSER_HEADERS });
  const cookieHeader = (homeRes.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type': 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify({
      filter: { locations: [YEMEN_LOCATION_ID], statuses: [OPEN_STATUS_ID] },
      page: 1,
      pageSize: 100,
      sort: 'lastModifiedDate.desc',
    }),
  });

  if (!res.ok) {
    throw new Error(`DevelopmentAid API returned ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return json.items ?? [];
}

async function main() {
  const source = await getOrCreateSource({
    name: 'DevelopmentAid',
    category: 'أممي',
    frequencyLabel: 'أسبوعيًا',
    cronSchedule: '0 5 * * 2',
  });

  if (!source.enabled) {
    console.log('DevelopmentAid: source disabled in admin portal, skipping.');
    return;
  }

  try {
    const items = await fetchNotices();

    // Belt-and-suspenders: confirm every item really is Yemen and really
    // is open, regardless of what the filter claims to have applied
    // (the lesson from UNGM — never trust a filter without checking).
    const wrongLocation = items.filter((i) => i.locationNames !== 'Yemen');
    if (items.length > 0 && wrongLocation.length / items.length > 0.2) {
      throw new Error(
        `Location filter appears to have failed: ${wrongLocation.length}/${items.length} results aren't Yemen`
      );
    }

    const rows = items
      .filter((i) => i.locationNames === 'Yemen' && i.status?.name === 'open')
      .map((i) => {
        const sourceUrl = `https://www.developmentaid.org/tenders/view/${i.id}/${i.slug}`;
        const excerpt = truncate(`${i.types || ''} — ${i.donors || i.organizationName || ''}`.trim());

        return {
          title: i.name,
          org: i.organizationName || null,
          sector: mapSector(i.sectors || ''),
          location_label: 'اليمن',
          published_date: i.postedDate || null,
          deadline: i.deadline || null,
          source_url: sourceUrl,
          excerpt,
          priority: 'normal',
          source_id: source.id,
          fingerprint: makeFingerprint({ sourceUrl, title: i.name, org: i.organizationName, deadline: i.deadline }),
        };
      })
      .filter((row) => row.title && row.source_url);

    const { inserted } = await upsertTenders(rows);
    await markSourceResult(source.id, {
      ok: true,
      message: `نجاح — ${inserted} مناقصة جديدة (من أصل ${rows.length} مناقصة)`,
    });
    console.log(`DevelopmentAid: found ${items.length} items, inserted ${inserted} new.`);
  } catch (err) {
    await markSourceResult(source.id, { ok: false, message: `خطأ: ${err.message}` });
    console.error(err);
    process.exitCode = 1;
  }
}

main();

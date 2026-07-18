// UNGM (UN Global Marketplace) aggregates procurement notices from most UN
// agencies (UNICEF, WFP, WHO, UNOPS, UNHCR, FAO, and more) in one place.
// Its listing only loads via a client-side search — verified live that a
// plain fetch() returns an empty result shell, so this one genuinely
// needs a real browser.
//
// Getting the country filter right took two attempts:
//   1. Directly setting the <select> value via jQuery and triggering
//      'change' looked like it worked in early interactive testing, but
//      in real scheduled runs it silently never filtered — it returned
//      the unfiltered global listing every time (verified: production
//      got 30 rows from Congo/Pakistan/Afghanistan/India/etc, not Yemen).
//      The shortcut skips jQuery UI autocomplete's own 'select' event,
//      which the page apparently relies on to set real search state.
//   2. Properly simulating the real user flow — click the field, type
//      "Yemen", wait for the autocomplete suggestion, click it, then
//      click Search — works reliably (verified: the resulting page shows
//      a "Yemen ×" filter chip, and results are legitimately either
//      country="Yemen" or "Multiple destinations" global framework
//      agreements, which correctly appear because they're open to
//      suppliers in every filtered country including Yemen).
import * as cheerio from 'cheerio';
import { getOrCreateSource, markSourceResult, upsertTenders } from '../lib/upsertTenders.mjs';
import { makeFingerprint, truncate, guessSector, parseDMonYY } from '../lib/normalize.mjs';
import { firecrawlScrape } from '../lib/firecrawl.mjs';

const URL = 'https://www.ungm.org/Public/Notice';

async function fetchNoticesOnce() {
  const data = await firecrawlScrape({
    url: URL,
    formats: ['html'],
    actions: [
      { type: 'wait', milliseconds: 2000 },
      { type: 'click', selector: '#selNoticeCountry-input' },
      { type: 'write', text: 'Yemen' },
      { type: 'wait', milliseconds: 2500 },
      { type: 'click', selector: '.ui-menu-item' },
      { type: 'wait', milliseconds: 1000 },
      { type: 'click', selector: '#lnkSearch' },
      { type: 'wait', milliseconds: 4000 },
    ],
  });

  const html = data.html || '';

  // Confirm the "Yemen ×" filter chip actually appears — this is the
  // clearest signal the selection really took, independent of the
  // results themselves.
  if (!html.includes('noticeSelectedCountryName">Yemen<')) {
    throw new Error('Yemen filter chip not found in results — country selection likely did not take');
  }

  const $ = cheerio.load(html);
  const notices = [];
  $('div[role="row"][data-noticeid]').each((_, row) => {
    const cells = $(row).find('div[role="cell"]');
    const title = $(cells.get(1)).find('.ungm-title').text().trim();
    const href = $(cells.get(1)).find('a').attr('href');
    const deadline = $(cells.get(2)).find('span').first().text().replace(/\s+/g, ' ').trim();
    const org = $(cells.get(4)).text().trim();
    const type = $(cells.get(5)).text().trim();
    const country = $(cells.get(7)).text().trim();

    if (title && href) notices.push({ title, href, deadline, org, type, country });
  });

  // A properly Yemen-filtered search legitimately returns two kinds of
  // rows: country === 'Yemen' exactly, or 'Multiple destinations' (global
  // framework agreements open to suppliers in every filtered country).
  // Any OTHER specific country name means the filter didn't really apply
  // (this is what caught the real bug above: exact rows like 'Congo',
  // 'Pakistan', 'Afghanistan' appearing when it should have been Yemen-only).
  const wrongCountry = notices.filter((n) => n.country !== 'Yemen' && n.country !== 'Multiple destinations');
  if (notices.length > 0 && wrongCountry.length / notices.length > 0.2) {
    throw new Error(
      `Country filter appears to have failed: ${wrongCountry.length}/${notices.length} results are a specific ` +
        `other country (e.g. ${wrongCountry[0]?.country})`
    );
  }

  return notices.filter((n) => n.country === 'Yemen' || n.country === 'Multiple destinations');
}

// The country-selection flow depends on a couple of AJAX round trips
// (autocomplete suggestions, then the search itself) — retry a few times
// before giving up, since a fresh attempt can succeed after a slow one.
async function fetchNotices(maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchNoticesOnce();
    } catch (err) {
      lastError = err;
      console.warn(`UNGM: attempt ${attempt}/${maxAttempts} failed — ${err.message}`);
    }
  }
  throw lastError;
}

async function main() {
  const source = await getOrCreateSource({
    name: 'UNGM',
    category: 'أممي',
    frequencyLabel: 'أسبوعيًا',
    cronSchedule: '0 5 * * 5',
  });

  if (!source.enabled) {
    console.log('UNGM: source disabled in admin portal, skipping.');
    return;
  }

  try {
    const notices = await fetchNotices();

    const rows = notices
      .map((n) => {
        const sourceUrl = n.href.startsWith('http') ? n.href : `https://www.ungm.org${n.href}`;
        const deadline = parseDMonYY(n.deadline);
        const excerpt = truncate(`${n.type ? n.type + ' — ' : ''}${n.org}`.trim());
        const sector = guessSector(n.title);

        return {
          title: n.title,
          org: n.org || null,
          sector,
          location_label: n.country === 'Yemen' ? 'اليمن' : n.country,
          published_date: null,
          deadline,
          source_url: sourceUrl,
          excerpt,
          priority: 'normal',
          source_id: source.id,
          fingerprint: makeFingerprint({ sourceUrl, title: n.title, org: n.org, deadline }),
        };
      })
      .filter((row) => row.title && row.source_url);

    const { inserted } = await upsertTenders(rows);
    await markSourceResult(source.id, {
      ok: true,
      message: `نجاح — ${inserted} مناقصة جديدة (من أصل ${rows.length} مناقصة)`,
    });
    console.log(`UNGM: found ${notices.length} notices, inserted ${inserted} new.`);
  } catch (err) {
    await markSourceResult(source.id, { ok: false, message: `خطأ: ${err.message}` });
    console.error(err);
    process.exitCode = 1;
  }
}

main();

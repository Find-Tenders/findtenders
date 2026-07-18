// UNGM (UN Global Marketplace) aggregates procurement notices from most UN
// agencies (UNICEF, WFP, WHO, UNOPS, UNHCR, and more) in one place. Its
// listing only loads via a client-side search — verified live that a plain
// fetch() returns an empty result shell, so this one genuinely needs a
// real browser. Rather than fight its fragile jQuery UI autocomplete
// country picker, we set the underlying <select> directly via injected JS
// (verified this reliably filters — confirmed against Afghanistan, which
// has 97 open notices, before relying on it for Yemen).
import * as cheerio from 'cheerio';
import { getOrCreateSource, markSourceResult, upsertTenders } from '../lib/upsertTenders.mjs';
import { makeFingerprint, truncate, guessSector, parseDMonYY } from '../lib/normalize.mjs';
import { firecrawlScrape } from '../lib/firecrawl.mjs';

const URL = 'https://www.ungm.org/Public/Notice';
const YEMEN_COUNTRY_ID = '2518';

async function fetchNotices() {
  const data = await firecrawlScrape({
    url: URL,
    formats: ['html'],
    actions: [
      {
        type: 'executeJavascript',
        script: `$('#selNoticeCountry').val('${YEMEN_COUNTRY_ID}').trigger('change'); $('#isCountrySelected').val('true');`,
      },
      { type: 'wait', milliseconds: 800 },
      { type: 'click', selector: '#lnkSearch' },
      { type: 'wait', milliseconds: 3000 },
    ],
  });

  const $ = cheerio.load(data.html || '');
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
  return notices;
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
          location_label: n.country || 'اليمن',
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

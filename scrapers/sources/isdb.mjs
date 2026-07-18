// Islamic Development Bank's tenders board is a Drupal site, plain
// server-rendered HTML (verified: a bare fetch() returns the same data
// the browser shows, including a working ?loc=YE country filter).
import * as cheerio from 'cheerio';
import { getOrCreateSource, markSourceResult, upsertTenders } from '../lib/upsertTenders.mjs';
import { makeFingerprint, truncate, guessSector, parseFullMonthDate } from '../lib/normalize.mjs';
import { BROWSER_HEADERS } from '../lib/http.mjs';

const URL = 'https://www.isdb.org/project-procurement/tenders?loc=YE';
const BASE = 'https://www.isdb.org';

async function fetchNotices() {
  const res = await fetch(URL, { headers: BROWSER_HEADERS });
  if (!res.ok) {
    throw new Error(`IsDB site returned ${res.status}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const notices = [];
  $('article.type-tender').each((_, el) => {
    const link = $(el).find('.field-title a').first();
    const title = link.text().trim();
    const href = link.attr('href');
    const status = $(el).find('.vocabulary-tender-status').text().trim();
    const type = $(el).find('.vocabulary-tender-type').text().trim();
    const country = $(el).find('.field--name-field-world-country').text().trim();
    const closeDate = $(el).find('.field--name-field-close-date time').text().trim();

    if (title && href) notices.push({ title, href, status, type, country, closeDate });
  });
  return notices;
}

async function main() {
  const source = await getOrCreateSource({
    name: 'IsDB',
    category: 'أممي',
    frequencyLabel: 'أسبوعيًا',
    cronSchedule: '0 5 * * 3',
  });

  if (!source.enabled) {
    console.log('IsDB: source disabled in admin portal, skipping.');
    return;
  }

  try {
    const notices = await fetchNotices();
    const now = new Date();

    // Don't trust the site's own status/active filtering (verified live:
    // it doesn't actually filter server-side) — check both the status
    // label (English "Closed" or French "Fermé", since IsDB is bilingual)
    // and the close date ourselves.
    const openNotices = notices.filter((n) => {
      if (/closed|ferm[eé]/i.test(n.status)) return false;
      const deadline = parseFullMonthDate(n.closeDate);
      return !deadline || new Date(deadline) > now;
    });

    const rows = openNotices
      .map((n) => {
        const sourceUrl = n.href.startsWith('http') ? n.href : BASE + n.href;
        const deadline = parseFullMonthDate(n.closeDate);
        const excerpt = truncate(n.type || '');
        const sector = guessSector(n.title);

        return {
          title: n.title,
          org: 'IsDB',
          sector,
          location_label: n.country || 'اليمن',
          published_date: null,
          deadline,
          source_url: sourceUrl,
          excerpt,
          priority: 'normal',
          source_id: source.id,
          fingerprint: makeFingerprint({ sourceUrl, title: n.title, org: 'IsDB', deadline }),
        };
      })
      .filter((row) => row.title && row.source_url);

    const { inserted } = await upsertTenders(rows);
    await markSourceResult(source.id, {
      ok: true,
      message: `نجاح — ${inserted} مناقصة جديدة (${rows.length} مناقصة مفتوحة من أصل ${notices.length} إشعار)`,
    });
    console.log(`IsDB: fetched ${notices.length}, ${rows.length} currently open, inserted ${inserted} new.`);
  } catch (err) {
    await markSourceResult(source.id, { ok: false, message: `خطأ: ${err.message}` });
    console.error(err);
    process.exitCode = 1;
  }
}

main();

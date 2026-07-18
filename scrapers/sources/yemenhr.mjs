// YemenHR's tenders board (Laravel/Livewire app) still server-renders the
// full table on first load (verified: a bare fetch() returns the same
// tender data the browser shows) — no headless browser needed, despite it
// being a JS-heavy app under the hood.
import * as cheerio from 'cheerio';
import { getOrCreateSource, markSourceResult, upsertTenders } from '../lib/upsertTenders.mjs';
import { makeFingerprint, truncate, guessSector, parseDayMonComma } from '../lib/normalize.mjs';

const URL = 'https://yemenhr.com/tenders';

async function fetchNotices() {
  const res = await fetch(URL);
  if (!res.ok) {
    throw new Error(`YemenHR site returned ${res.status}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const notices = [];
  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 5) return; // skip anything that isn't a real data row

    const posted = $(cells.get(0)).text().trim();
    const org = $(cells.get(1)).find('a').first().text().trim();
    const titleLink = $(cells.get(2)).find('a').first();
    const title = titleLink.text().replace(/\s+/g, ' ').trim();
    const href = titleLink.attr('href');
    const location = $(cells.get(3)).find('a').map((__, el) => $(el).text().trim()).get().join('، ');
    const deadline = $(cells.get(4)).text().trim();

    if (title && href) notices.push({ posted, org, title, href, location, deadline });
  });
  return notices;
}

async function main() {
  const source = await getOrCreateSource({
    name: 'YemenHR',
    category: 'محلي',
    frequencyLabel: 'كل 3-4 أيام',
    cronSchedule: '0 6 */4 * *',
  });

  if (!source.enabled) {
    console.log('YemenHR: source disabled in admin portal, skipping.');
    return;
  }

  try {
    const notices = await fetchNotices();

    const rows = notices
      .map((n) => {
        const deadline = parseDayMonComma(n.deadline);
        const publishedDate = parseDayMonComma(n.posted);
        const sector = guessSector(n.title);

        return {
          title: n.title,
          org: n.org || null,
          sector,
          location_label: n.location || 'اليمن',
          published_date: publishedDate,
          deadline,
          source_url: n.href,
          excerpt: truncate(n.org ? `الجهة: ${n.org}` : ''),
          priority: 'normal',
          source_id: source.id,
          fingerprint: makeFingerprint({ sourceUrl: n.href, title: n.title, org: n.org, deadline }),
        };
      })
      .filter((row) => row.title && row.source_url);

    const { inserted } = await upsertTenders(rows);
    await markSourceResult(source.id, {
      ok: true,
      message: `نجاح — ${inserted} مناقصة جديدة (من أصل ${rows.length} مناقصة)`,
    });
    console.log(`YemenHR: found ${notices.length} notices, inserted ${inserted} new.`);
  } catch (err) {
    await markSourceResult(source.id, { ok: false, message: `خطأ: ${err.message}` });
    console.error(err);
    process.exitCode = 1;
  }
}

main();

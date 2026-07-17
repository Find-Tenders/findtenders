// UNDP's procurement notice board is plain server-rendered HTML (verified:
// a bare fetch() returns the same notice data the browser shows, no
// JS execution needed) — so a simple fetch + cheerio parse works.
import * as cheerio from 'cheerio';
import { getOrCreateSource, markSourceResult, upsertTenders } from '../lib/upsertTenders.mjs';
import { makeFingerprint, truncate, guessSector, parseDMonYY } from '../lib/normalize.mjs';

const BASE_URL = 'https://procurement-notices.undp.org/';

async function fetchNotices() {
  const res = await fetch(BASE_URL);
  if (!res.ok) {
    throw new Error(`UNDP site returned ${res.status}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const notices = [];
  $('a.vacanciesTableLink').each((_, el) => {
    const cells = $(el).find('.vacanciesTable__cell > span');
    const title = $(cells.get(0)).text().trim();
    const refNo = $(cells.get(1)).text().trim();
    const country = $(cells.get(2)).text().replace(/\s+/g, ' ').trim();
    const process = $(cells.get(3)).text().trim();
    const deadlineText = $(cells.get(4)).text().trim();
    const postedText = $(cells.get(5)).text().trim();
    const href = $(el).attr('href');

    notices.push({ title, refNo, country, process, deadlineText, postedText, href });
  });
  return notices;
}

async function main() {
  const source = await getOrCreateSource({
    name: 'UNDP Quantum',
    category: 'أممي',
    frequencyLabel: 'يوميًا',
    cronSchedule: '0 5 * * *',
  });

  try {
    const notices = await fetchNotices();
    const yemenNotices = notices.filter((n) => n.country.toUpperCase().includes('YEMEN'));

    const rows = yemenNotices
      .map((n) => {
        const sourceUrl = new URL(n.href, BASE_URL).toString();
        const org = n.country.split('/')[0]?.replace('UNDP-', 'UNDP ') || 'UNDP';
        const deadline = parseDMonYY(n.deadlineText);
        const publishedDate = parseDMonYY(n.postedText);
        const excerpt = truncate(`${n.process} — ${n.refNo}`);
        const sector = guessSector(n.title);

        return {
          title: n.title,
          org,
          sector,
          location_label: 'اليمن',
          published_date: publishedDate,
          deadline,
          source_url: sourceUrl,
          excerpt,
          priority: 'normal',
          source_id: source.id,
          fingerprint: makeFingerprint({ sourceUrl, title: n.title, org, deadline }),
        };
      })
      .filter((row) => row.title && row.source_url);

    const { inserted } = await upsertTenders(rows);
    await markSourceResult(source.id, {
      ok: true,
      message: `نجاح — ${inserted} مناقصة جديدة (من أصل ${rows.length} مناقصة يمنية، ${notices.length} إجمالي عالميًا)`,
    });
    console.log(`UNDP: scanned ${notices.length} global notices, ${rows.length} for Yemen, inserted ${inserted} new.`);
  } catch (err) {
    await markSourceResult(source.id, { ok: false, message: `خطأ: ${err.message}` });
    console.error(err);
    process.exitCode = 1;
  }
}

main();

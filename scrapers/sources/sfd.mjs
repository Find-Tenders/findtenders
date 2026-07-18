// SFD (Social Fund for Development, Yemen) publishes an open tenders table
// as plain server-rendered HTML (verified: a bare fetch() returns the same
// table data the browser shows) — no headless browser needed.
import * as cheerio from 'cheerio';
import { getOrCreateSource, markSourceResult, upsertTenders } from '../lib/upsertTenders.mjs';
import { makeFingerprint, truncate, guessSector, parseDDMMYYYY } from '../lib/normalize.mjs';

const URL = 'https://www.sfd-yemen.org/tenders';

async function fetchNotices() {
  const res = await fetch(URL);
  if (!res.ok) {
    throw new Error(`SFD site returned ${res.status}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const notices = [];
  $('table.table-tender tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    const refNo = $(cells.get(1)).text().trim();
    const titleLink = $(cells.get(2)).find('a');
    const title = titleLink.text().replace(/\s+/g, ' ').trim();
    const detailHref = titleLink.attr('href');
    const procType = $(cells.get(3)).text().trim();
    const branch = $(cells.get(4)).text().trim();
    const startDate = $(cells.get(5)).text().trim();
    const openDate = $(cells.get(6)).text().trim();
    const downloadHref = $(cells.get(7)).find('a').attr('href');

    if (title) notices.push({ refNo, title, detailHref, procType, branch, startDate, openDate, downloadHref });
  });
  return notices;
}

async function main() {
  const source = await getOrCreateSource({
    name: 'SFD',
    category: 'محلي',
    frequencyLabel: 'كل 3 أيام',
    cronSchedule: '0 6 */3 * *',
  });

  if (!source.enabled) {
    console.log('SFD: source disabled in admin portal, skipping.');
    return;
  }

  try {
    const notices = await fetchNotices();

    const rows = notices
      .map((n) => {
        const sourceUrl = n.detailHref || n.downloadHref || URL;
        const deadline = parseDDMMYYYY(n.openDate);
        const publishedDate = parseDDMMYYYY(n.startDate);
        const excerpt = truncate(`${n.procType ? n.procType + ' — ' : ''}رقم المناقصة: ${n.refNo}`.trim());
        const sector = guessSector(n.title);

        return {
          title: n.title,
          org: 'SFD',
          sector,
          location_label: n.branch || 'اليمن',
          published_date: publishedDate,
          deadline,
          source_url: sourceUrl,
          excerpt,
          priority: 'normal',
          source_id: source.id,
          fingerprint: makeFingerprint({ sourceUrl, title: n.title, org: 'SFD', deadline }),
        };
      })
      .filter((row) => row.title && row.source_url);

    const { inserted } = await upsertTenders(rows);
    await markSourceResult(source.id, {
      ok: true,
      message: `نجاح — ${inserted} مناقصة جديدة (من أصل ${rows.length} مناقصة)`,
    });
    console.log(`SFD: found ${notices.length} notices, inserted ${inserted} new.`);
  } catch (err) {
    await markSourceResult(source.id, { ok: false, message: `خطأ: ${err.message}` });
    console.error(err);
    process.exitCode = 1;
  }
}

main();

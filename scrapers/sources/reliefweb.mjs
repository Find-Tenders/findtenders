// ReliefWeb publishes an official public API (no key required) that
// aggregates situation updates from UN agencies, INGOs, and government
// sources — including procurement/tender notices tagged for Yemen.
// Docs: https://apidoc.rwlabs.org/
import { getOrCreateSource, markSourceResult, upsertTenders } from '../lib/upsertTenders.mjs';
import { makeFingerprint, stripHtml, truncate, guessSector } from '../lib/normalize.mjs';

// v1 is decommissioned; v2 requires a pre-approved appname (see
// https://apidoc.reliefweb.int/parameters#appname) — request one and set
// it here before this scraper will work. Until then it fails loudly via
// markSourceResult, which is correct: the admin portal should show it as
// broken rather than silently doing nothing.
const APP_NAME = 'findtenders-yemen';
const API_URL = `https://api.reliefweb.int/v2/reports?appname=${APP_NAME}`;

const TENDER_QUERY =
  '(tender OR procurement OR "request for proposal" OR "expression of interest" OR "invitation to bid" OR RFP OR EOI)';

async function fetchReports() {
  const body = {
    filter: {
      operator: 'AND',
      conditions: [{ field: 'country', value: 'Yemen' }],
    },
    query: { value: TENDER_QUERY, fields: ['title', 'body'] },
    fields: { include: ['title', 'body-html', 'date.created', 'url', 'url_alias', 'source.name'] },
    sort: ['date.created:desc'],
    limit: 40,
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`ReliefWeb API returned ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return json.data ?? [];
}

async function main() {
  const source = await getOrCreateSource({
    name: 'ReliefWeb API',
    category: 'أممي',
    frequencyLabel: 'يوميًا',
    cronSchedule: '0 5 * * *',
  });

  if (!source.enabled) {
    console.log('ReliefWeb: source disabled in admin portal, skipping.');
    return;
  }

  try {
    const reports = await fetchReports();

    const rows = reports
      .map((r) => {
        const f = r.fields;
        const title = f.title;
        const org = f.source?.[0]?.name ?? null;
        const sourceUrl = f.url_alias || f.url;
        const excerpt = truncate(stripHtml(f['body-html']));
        const publishedDate = f.date?.created ? f.date.created.slice(0, 10) : null;
        const sector = guessSector(`${title} ${excerpt}`);

        return {
          title,
          org,
          sector,
          location_label: null,
          published_date: publishedDate,
          deadline: null,
          source_url: sourceUrl,
          excerpt,
          priority: 'normal',
          source_id: source.id,
          fingerprint: makeFingerprint({ sourceUrl, title, org, deadline: null }),
        };
      })
      .filter((row) => row.title && row.source_url);

    const { inserted } = await upsertTenders(rows);
    await markSourceResult(source.id, {
      ok: true,
      message: `نجاح — ${inserted} مناقصة جديدة من أصل ${rows.length} نتيجة مطابقة`,
    });
    console.log(`ReliefWeb: fetched ${reports.length}, normalized ${rows.length}, inserted ${inserted} new.`);
  } catch (err) {
    await markSourceResult(source.id, { ok: false, message: `خطأ: ${err.message}` });
    console.error(err);
    process.exitCode = 1;
  }
}

main();

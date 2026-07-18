// The World Bank publishes a genuinely public, keyless JSON API for
// procurement notices (found by inspecting the noticesApiUrl the
// projects.worldbank.org page itself calls). No headless browser needed.
import { getOrCreateSource, markSourceResult, upsertTenders } from '../lib/upsertTenders.mjs';
import { makeFingerprint, truncate, guessSector, parseDMonYY } from '../lib/normalize.mjs';
import { BROWSER_HEADERS } from '../lib/http.mjs';

const COUNTRY = 'Yemen, Republic of';
const API_URL =
  'https://search.worldbank.org/api/v2/procnotices?format=json' +
  '&fl=id,bid_description,project_ctry_name,project_name,notice_type,notice_status,submission_date,noticedate' +
  '&srt=submission_date%20desc&apilang=en&rows=100&os=0' +
  `&project_ctry_name_exact=${encodeURIComponent(COUNTRY)}`;

const DETAIL_BASE = 'https://projects.worldbank.org/en/projects-operations/procurement-detail/';

async function fetchNotices() {
  const res = await fetch(API_URL, { headers: BROWSER_HEADERS });
  if (!res.ok) {
    throw new Error(`World Bank API returned ${res.status}`);
  }
  const json = await res.json();
  return json.procnotices ?? [];
}

async function main() {
  const source = await getOrCreateSource({
    name: 'World Bank',
    category: 'أممي',
    frequencyLabel: 'أسبوعيًا',
    cronSchedule: '0 5 * * 1',
  });

  if (!source.enabled) {
    console.log('World Bank: source disabled in admin portal, skipping.');
    return;
  }

  try {
    const notices = await fetchNotices();
    const now = new Date();

    // "Contract Award" notices are results, not open opportunities — and
    // the API returns years of history, so only keep still-open ones.
    const openNotices = notices.filter(
      (n) => n.notice_type !== 'Contract Award' && n.submission_date && new Date(n.submission_date) > now
    );

    const rows = openNotices
      .map((n) => {
        const title = n.bid_description || n.project_name;
        const sourceUrl = DETAIL_BASE + n.id;
        const deadline = n.submission_date ? n.submission_date.slice(0, 10) : null;
        const publishedDate = parseDMonYY(n.noticedate);
        const excerpt = truncate(`${n.notice_type} — ${n.project_name}`);
        const sector = guessSector(`${title} ${n.project_name}`);

        return {
          title,
          org: 'World Bank',
          sector,
          location_label: 'اليمن',
          published_date: publishedDate,
          deadline,
          source_url: sourceUrl,
          excerpt,
          priority: 'normal',
          source_id: source.id,
          fingerprint: makeFingerprint({ sourceUrl, title, org: 'World Bank', deadline }),
        };
      })
      .filter((row) => row.title && row.source_url);

    const { inserted } = await upsertTenders(rows);
    await markSourceResult(source.id, {
      ok: true,
      message: `نجاح — ${inserted} مناقصة جديدة (${rows.length} مناقصة مفتوحة من أصل ${notices.length} إشعار)`,
    });
    console.log(`World Bank: fetched ${notices.length}, ${rows.length} currently open, inserted ${inserted} new.`);
  } catch (err) {
    await markSourceResult(source.id, { ok: false, message: `خطأ: ${err.message}` });
    console.error(err);
    process.exitCode = 1;
  }
}

main();

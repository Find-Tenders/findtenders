import { createHash } from 'node:crypto';

// Same fingerprint recipe every scraper must use, so the same tender
// appearing on two different sites (or re-scraped tomorrow) doesn't
// create a duplicate row.
export function makeFingerprint({ sourceUrl, title, org, deadline }) {
  const raw = [sourceUrl || '', title || '', org || '', deadline || '']
    .join('|')
    .toLowerCase()
    .trim();
  return createHash('sha256').update(raw).digest('hex');
}

export function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function truncate(text, max = 320) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max).trim() + '…' : text;
}

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// Parses "31-Jul-26" or "22-Jan-2026" style dates (2- or 4-digit year)
// into "2026-07-31". Returns null if the text doesn't match (rather than
// throwing) since scrapers should never crash the whole batch over one
// malformed date.
export function parseDMonYY(text) {
  if (!text) return null;
  const match = text.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
  if (!match) return null;
  const [, day, mon, yRaw] = match;
  const month = MONTHS[mon.toLowerCase()];
  if (!month) return null;
  const year = yRaw.length === 2 ? (Number(yRaw) < 70 ? `20${yRaw}` : `19${yRaw}`) : yRaw;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

// Keys must match the `sectors.slug` values from the schema migration.
// Includes Arabic keywords for Yemeni-language sources (SFD etc.) alongside
// English ones for international sources (UNDP, ReliefWeb). Order matters:
// more specific sectors are checked before generic 'construction', since
// Arabic tender titles almost always contain a construction verb
// (إنشاء/بناء) regardless of the actual sector — e.g. "إنشاء خزان مياه"
// (constructing a water tank) should tag as water, not construction.
const SECTOR_KEYWORDS = {
  water: ['water', 'wash', 'sanitation', 'well drilling', 'borehole', 'مياه', 'صرف صحي', 'خزان', 'بئر', 'آبار'],
  health: ['health', 'medical', 'hospital', 'clinic', 'vaccine', 'صحي', 'صحة', 'مستشفى', 'عيادة', 'مركز صحي'],
  education: ['education', 'school', 'learning', 'مدرسة', 'مدرسية', 'تعليم', 'جامعة'],
  transport: ['transport', 'road', 'port', 'vehicle', 'fleet', 'طريق', 'نقل', 'مركبات', 'ميناء'],
  agriculture: ['agriculture', 'farming', 'irrigation', 'livestock', 'زراعة', 'ري ', 'مزارع'],
  housing: ['housing', 'shelter', 'settlement', 'إسكان', 'سكن', 'مأوى'],
  telecom: ['telecom', 'communication', 'network', 'internet', 'اتصالات'],
  renewable: ['renewable', 'wind energy', 'طاقة شمسية', 'طاقة متجددة'],
  energy: ['solar', 'energy', 'power', 'electricity', 'generator', 'طاقة', 'كهرباء', 'مولد'],
  food_logistics: ['food', 'logistics', 'supply', 'nutrition', 'warehouse', 'غذائي', 'أغذية', 'تموين', 'مخازن'],
  environment: ['environment', 'climate', 'waste management', 'بيئة', 'نفايات', 'مناخ'],
  construction: ['construction', 'building', 'infrastructure', 'rehabilitation', 'إنشاء', 'بناء', 'ترميم', 'تأهيل'],
};

// Best-effort guess only — admins can always correct it later via the
// manual tender editor. No AI classification in this first pass.
export function guessSector(text) {
  const lower = (text || '').toLowerCase();
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return sector;
  }
  return null;
}

// Parses YemenHR's "17 Jul, 26" / "17 Jul 2026" style dates (day, month
// name, 2- or 4-digit year, in any order of separators) into "2026-07-17".
export function parseDayMonComma(text) {
  if (!text) return null;
  const match = text.trim().match(/(\d{1,2})\s+([A-Za-z]{3}),?\s*(\d{2,4})/);
  if (!match) return null;
  const [, day, mon, yRaw] = match;
  const month = MONTHS[mon.toLowerCase()];
  if (!month) return null;
  const year = yRaw.length === 2 ? (Number(yRaw) < 70 ? `20${yRaw}` : `19${yRaw}`) : yRaw;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

// Parses SFD's "19-04-2026" (dd-mm-yyyy) style dates into "2026-04-19".
export function parseDDMMYYYY(text) {
  if (!text) return null;
  const match = text.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

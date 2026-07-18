// Thin wrapper around Firecrawl's /scrape endpoint for sites that need a
// real headless browser (JS-rendered listings, form interactions) rather
// than a plain fetch(). Costs credits on Firecrawl's free tier (1,000/mo).
const FIRECRAWL_URL = 'https://api.firecrawl.dev/v1/scrape';

export async function firecrawlScrape({ url, actions = [], formats = ['html'] }) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error('Missing FIRECRAWL_API_KEY environment variable');
  }

  const res = await fetch(FIRECRAWL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url, formats, actions }),
  });

  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`Firecrawl request failed: ${json.error || res.status}`);
  }
  return json.data;
}

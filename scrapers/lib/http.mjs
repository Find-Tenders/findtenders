// Plain server-to-server fetch() requests (like from a GitHub Actions
// runner) often get blocked by basic bot-protection that a real browser
// sails past, simply because there's no realistic User-Agent header.
// Every scraper should send this instead of a bare fetch().
export const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
};

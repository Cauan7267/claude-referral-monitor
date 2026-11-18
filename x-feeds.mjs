import { load } from 'cheerio';
import { feedEntries, isFresh, extractPasses, explicitlyUnavailable } from './parsers.mjs';

export async function parseXFeed(xml, resolveShortLink, now = Date.now()) {
  const passes = [];
  for (const entry of feedEntries(xml)) {
    if (!isFresh(entry.published, now)) continue;
    const postPath = new URL(entry.source).pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/);
    if (!postPath) continue;
    const source = `https://x.com/${postPath[1]}/status/${postPath[2]}`;
    const dom = load(entry.markup);
    dom('blockquote, s, del, strike, script, style').remove();
    if (explicitlyUnavailable(dom.text())) continue;
    passes.push(...extractPasses(dom.html(), source, entry.published, now));
    // Profile RSS often leaves outbound URLs shortened. Expand only recent Claude offers.
    if (!/claude/i.test(dom.text())) continue;
    const shortLinks = [...new Set(dom.html().match(/https:\/\/(?:[a-z0-9.-]+\/)?t\.co\/[A-Za-z0-9]+/gi) || [])];
    for (const shortLink of shortLinks) {
      const code = shortLink.split('/').pop();
      const expanded = await resolveShortLink(`https://t.co/${code}`);
      passes.push(...extractPasses(expanded, source, entry.published, now));
    }
  }
  return passes;
}

import { extractPasses } from './parsers.mjs';

export function parseRedditPosts(posts, now = Date.now()) {
  return posts.flatMap(post => {
    if (post.removedByCategory || ['[removed]', '[deleted]'].includes(post.selftext)) return [];
    const text = [post.title, post.selftext, post.urlOverriddenByDest].filter(Boolean).join('\n').replace(/~~[\s\S]*?~~/g, '');
    const markup = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const source = `https://www.reddit.com${post.permalink}`;
    return extractPasses(markup, source, new Date(post.createdAt), now);
  });
}

export async function scanRedditSearch(apiKey, previous = {}, now = Date.now(), request = fetch) {
  if (!apiKey) throw new Error('Reddit public search needs the WEIR_API_KEY secret');
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const usage = await request('https://api.weirapp.io/v1/usage', { headers, signal: AbortSignal.timeout(25_000) });
  if (!usage.ok) throw new Error(`Search provider usage returned HTTP ${usage.status}`);
  const elapsed = now - Date.parse(previous.completedAt || '1970-01-01');
  const time = previous.time || (elapsed < 55 * 60_000 ? 'hour' : elapsed < 23 * 3_600_000 ? 'day' : 'week');
  let cursor = previous.cursor;
  const passes = [];
  for (let page = 0; page < 3; page += 1) {
    const response = await request('https://api.weirapp.io/v1/reddit/search', {
      method: 'POST', headers,
      body: JSON.stringify({
        query: 'url:claude.ai/referral OR "claude.ai/referral/"',
        sort: 'new', time, limit: 20,
        ...(cursor ? { cursor } : {}),
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      const error = new Error(`Reddit search provider returned HTTP ${response.status}`);
      error.status = response.status;
      error.freeQuotaExhausted = response.status === 402;
      throw error;
    }
    const payload = await response.json();
    if (!Array.isArray(payload.data)) throw new Error('Reddit search response is missing posts');
    passes.push(...parseRedditPosts(payload.data, now));
    cursor = payload.meta?.nextCursor;
    const oldest = payload.data.at(-1);
    if (!cursor || (oldest && Date.parse(oldest.createdAt) < now - 48 * 3_600_000)) {
      cursor = undefined;
      break;
    }
  }
  return { passes, checkpoint: cursor ? { time, cursor } : { completedAt: new Date(now).toISOString() } };
}

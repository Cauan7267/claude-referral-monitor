import { extractPasses } from './parsers.mjs';

export function parseXPosts(posts, now = Date.now()) {
  return posts.flatMap(post => {
    // Treat post text as text. It must not become executable or synthetic HTML.
    const text = [post.text, ...(post.entities?.urls || [])].join('\n');
    const markup = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return extractPasses(markup, post.url, new Date(post.createdAt), now);
  });
}

export async function scanXSearch(apiKey, previous = {}, now = Date.now(), request = fetch) {
  if (!apiKey) throw new Error('X keyword search needs the WEIR_API_KEY secret');
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  async function api(path, body) {
    const response = await request(`https://api.weirapp.io/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      const error = new Error(`X search provider returned HTTP ${response.status}`);
      error.status = response.status;
      error.freeQuotaExhausted = response.status === 402;
      throw error;
    }
    return response.json();
  }

  const usage = await api('usage');
  let freeRemaining = usage.data?.freeGrant?.remaining;
  if (!Number.isInteger(freeRemaining) || freeRemaining < 2) {
    const error = new Error('Free X search allowance is exhausted');
    error.freeQuotaExhausted = true;
    throw error;
  }

  const earliest = new Date(now - 48 * 3_600_000).toISOString();
  const since = previous.cursor ? previous.since : new Date(Math.max(
    Date.parse(earliest),
    Date.parse(previous.completedAt || earliest) - 10 * 60_000,
  )).toISOString();
  const until = previous.cursor ? previous.until : new Date(now).toISOString();
  let cursor = previous.cursor;
  const passes = [];
  for (let page = 0; page < 5; page += 1) {
    if (freeRemaining < 2) break;
    const searchBody = {
      query: 'url:claude.ai/referral -filter:nativeretweets',
      since,
      until,
      sort: 'latest',
      limit: 20,
      ...(cursor ? { cursor } : {}),
    };
    let data;
    try {
      data = await api('x/search', searchBody);
    } catch (error) {
      if (page > 0 && error.budgetPaused) break;
      throw error;
    }
    if (!Array.isArray(data.data)) throw new Error('X search response is missing posts');
    passes.push(...parseXPosts(data.data, now));
    freeRemaining -= 1 + data.data.length;
    cursor = data.meta?.nextCursor;
    if (!cursor) break;
  }

  // The caller persists this only after all resulting Telegram alerts succeed.
  const checkpoint = cursor ? { since, until, cursor } : { completedAt: until };
  return { passes, checkpoint };
}

import { readFile, writeFile, rename } from 'node:fs/promises';
import { codeHash, extractPasses, parseDirectory, parseFeed } from './parsers.mjs';
import { parseXFeed } from './x-feeds.mjs';

const statePath = new URL('./state.json', import.meta.url);
const state = JSON.parse(await readFile(statePath, 'utf8'));
const xProfiles = JSON.parse(await readFile(new URL('./x-profiles.json', import.meta.url), 'utf8'));
state.sourceBackoff ??= {};
const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10);
const dryRun = process.argv.includes('--dry-run');
const testDelivery = process.argv.includes('--test-delivery');
const userAgent = 'ClaudeReferralMonitor/1.0 (+https://github.com/mosesfawole/claude-referral-monitor)';

async function fetchPublic(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/rss+xml, application/json, text/html;q=0.9' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
      error.retryAt = /^\d+$/.test(retryAfter) ? Date.now() + Number(retryAfter) * 1000 : Date.parse(retryAfter);
    }
    throw error;
  }
  return { body: await response.text(), date: Date.parse(response.headers.get('date')) || now };
}

async function scanFeed(url) {
  const response = await fetchPublic(url);
  return parseFeed(response.body, now);
}

async function resolveShortLink(url) {
  const response = await fetch(url, {
    method: 'HEAD',
    redirect: 'manual',
    headers: { 'User-Agent': userAgent },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status >= 300 && response.status < 400) {
    return response.headers.get('location') || '';
  }
  if (!response.ok) throw new Error(`Short-link lookup failed (HTTP ${response.status})`);
  return '';
}

async function scanXProfiles() {
  // The operator permits automated reading of public profile feeds.
  // Keyword search on this service requires a paid pass and is outside this free setup.
  const results = await Promise.allSettled(xProfiles.map(async username => {
    const response = await fetchPublic(`https://teapawt.org/${username}/rss`);
    return parseXFeed(response.body, resolveShortLink, now);
  }));
  const readable = results.filter(result => result.status === 'fulfilled');
  console.log(`X profile coverage: ${readable.length}/${xProfiles.length} feeds readable`);
  if (!readable.length) throw new Error('All watched X profile feeds are unavailable');
  return readable.flatMap(result => result.value);
}

async function scanSource(source) {
  const retryAt = state.sourceBackoff[source.name];
  if (retryAt && Date.parse(retryAt) > now) {
    throw new Error(`Backing off until ${retryAt}`);
  }
  try {
    const passes = await source.scan();
    delete state.sourceBackoff[source.name];
    return passes;
  } catch (error) {
    if (error.status === 429 || error.status === 403) {
      const defaultDelay = error.status === 429 ? 30 * 60_000 : 6 * 3_600_000;
      const retryTime = Math.max(error.retryAt || 0, now + defaultDelay);
      state.sourceBackoff[source.name] = new Date(retryTime).toISOString();
    }
    throw error;
  }
}

async function scanHackerNews() {
  const endpoint = new URL('https://hn.algolia.com/api/v1/search_by_date');
  endpoint.searchParams.set('query', 'claude.ai/referral/');
  endpoint.searchParams.set('hitsPerPage', '100');
  endpoint.searchParams.set('numericFilters', `created_at_i>${Math.floor(now / 1000 - 48 * 3600)}`);
  const response = await fetchPublic(endpoint);
  const data = JSON.parse(response.body);
  if (!Array.isArray(data.hits)) throw new Error('Search response missing hits');
  return data.hits.flatMap(hit => extractPasses(
    hit.comment_text || hit.story_text || '',
    `https://news.ycombinator.com/item?id=${hit.objectID}`,
    new Date(hit.created_at),
    now,
  ));
}

async function saveState() {
  if (dryRun) return;
  const temporary = new URL('./state.json.tmp', import.meta.url);
  await writeFile(temporary, JSON.stringify(state, null, 2) + '\n');
  await rename(temporary, statePath);
}

async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('Telegram secrets are missing');
  // Catch errors here so an HTTP exception cannot expose the credential-bearing URL.
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw new Error('API rejected delivery');
  } catch {
    throw new Error(`Telegram delivery failed${response ? ` (HTTP ${response.status})` : ''}`);
  }
}

const sources = [
  { name: 'Guest pass directory', scan: async () => {
    const response = await fetchPublic('https://claudecoworkcourse.com/claude-guest-passes');
    return parseDirectory(response.body, response.date, now);
  } },
  { name: 'NodeLoc', scan: () => scanFeed('https://www.nodeloc.com/latest.rss') },
  { name: 'Linux.do', scan: () => scanFeed('https://linux.do/latest.rss') },
  { name: 'Hacker News', scan: scanHackerNews },
  { name: 'X watched profiles', scan: scanXProfiles },
  { name: 'Reddit posts', scan: () => scanFeed('https://www.reddit.com/r/ClaudeAI+ClaudeCode+claude+Claudeopus+Referrallinks/new/.rss?limit=100') },
  { name: 'Reddit comments', scan: () => scanFeed('https://www.reddit.com/r/ClaudeAI+ClaudeCode+claude+Claudeopus/comments/.rss?limit=100') },
];

const results = await Promise.allSettled(sources.map(scanSource));
const candidates = new Map();
const successful = [];
const failed = [];
results.forEach((result, index) => {
  const name = sources[index].name;
  if (result.status === 'fulfilled') {
    successful.push(name);
    for (const pass of result.value) candidates.set(codeHash(pass.code), pass);
    console.log(`${name}: OK, ${result.value.length} recent links`);
  } else {
    failed.push(name);
    console.log(`${name}: unavailable (${result.reason.message})`);
  }
});

state.lastCheckDay = today;
state.sources = { available: successful, unavailable: failed };

try {
  if (!successful.length) {
    if (!dryRun && state.outageAlertDay !== today) {
      await telegram('Claude referral monitor could not read any public sources. Check the GitHub Actions run for details. The next scheduled run will retry.');
      state.outageAlertDay = today;
    }
    throw new Error('All public sources are unavailable');
  }

  const fresh = [...candidates].filter(([hash]) => !state.seen[hash]);
  for (const [hash, pass] of fresh) {
    if (dryRun) {
      console.log(`Would send ${pass.url} published ${pass.published} from ${pass.source}`);
      continue;
    }
    await telegram(`New Claude Pro guest pass\n${pass.url}\n\nPosted ${pass.published}\nSource ${pass.source}\n\nRedemption availability is unverified.`);
    state.seen[hash] = new Date().toISOString();
    await saveState();
  }

  if (testDelivery && !dryRun) {
    await telegram(`Cloud monitor is running on GitHub Actions. Your PC can be switched off.\n\nChecks are scheduled every 10 minutes, with possible GitHub scheduling delays.\n\nSources currently readable: ${successful.join(', ')}.${failed.length ? `\nTemporarily unavailable: ${failed.join(', ')}.` : ''}`);
    console.log('Cloud Telegram test delivered successfully');
  }

  console.log(`Scan complete: ${successful.length}/${sources.length} sources readable, ${fresh.length} new links`);
} finally {
  await saveState();
}

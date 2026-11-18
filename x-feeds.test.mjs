import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXFeed } from './x-feeds.mjs';

const now = Date.parse('2026-11-18T10:00:00Z');
const item = (body, date = 'Wed, 18 Nov 2026 09:00:00 GMT') => `<item><link>https://teapawt.org/person/status/1234567890</link><pubDate>${date}</pubDate><description><![CDATA[${body}]]></description></item>`;
const feed = items => `<rss><channel>${items}</channel></rss>`;

test('X feeds expand short links and preserve original post provenance', async () => {
  const shortLinks = [];
  const passes = await parseXFeed(feed(item('Claude guest pass https://teapawt.org/t.co/abcDEF12')), async url => {
    shortLinks.push(url);
    return 'https://claude.ai/referral/freshCode1?s=ios';
  }, now);
  assert.deepEqual(shortLinks, ['https://t.co/abcDEF12']);
  assert.equal(passes[0].url, 'https://claude.ai/referral/freshCode1');
  assert.equal(passes[0].source, 'https://x.com/person/status/1234567890');
});

test('X feeds skip stale posts and claimed passes before resolving links', async () => {
  let resolutions = 0;
  const xml = feed(item('Claude https://t.co/abcDEF12', 'Mon, 01 Jun 2026 09:00:00 GMT') + item('Claude all passes are claimed https://t.co/abcDEF12'));
  const passes = await parseXFeed(xml, async () => { resolutions += 1; return ''; }, now);
  assert.deepEqual(passes, []);
  assert.equal(resolutions, 0);
});

test('X feeds retain direct referral URLs and ignore quoted older offers', async () => {
  const xml = feed(item('<p>https://claude.ai/referral/freshCode1</p><blockquote>https://claude.ai/referral/usedCode12</blockquote>'));
  const passes = await parseXFeed(xml, async () => '', now);
  assert.deepEqual(passes.map(pass => pass.code), ['freshCode1']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRedditPosts, scanRedditSearch } from './reddit-search.mjs';

const now = Date.parse('2026-11-18T10:00:00Z');
const post = { title: 'Claude pass', selftext: '~~https://claude.ai/referral/usedCode12~~ https://claude.ai/referral/freshCode1?s=ios', createdAt: '2026-11-18T09:00:00Z', permalink: '/r/anything/comments/abc/pass/' };

test('Reddit search ignores removed posts and crossed-out codes', () => {
  const passes = parseRedditPosts([post, { ...post, removedByCategory: 'deleted' }], now);
  assert.deepEqual(passes.map(pass => pass.code), ['freshCode1']);
  assert.equal(passes[0].source, 'https://www.reddit.com/r/anything/comments/abc/pass/');
});

test('Reddit keyword search covers communities without an account filter', async () => {
  let body;
  const transport = async (url, options) => {
    if (url.endsWith('/usage')) return Response.json({ data: {} });
    body = JSON.parse(options.body);
    return Response.json({ data: [post], meta: {} });
  };
  const result = await scanRedditSearch('test-key', {}, now, transport);
  assert.equal(result.passes.length, 1);
  assert.equal(body.subreddit, undefined);
  assert.equal(body.sort, 'new');
});

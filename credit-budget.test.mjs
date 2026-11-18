import test from 'node:test';
import assert from 'node:assert/strict';
import { createBudgetedRequest } from './credit-budget.mjs';

test('parallel searches share a serialized daily budget', async () => {
  const state = {};
  let paidCalls = 0;
  const transport = async url => {
    if (url.endsWith('/usage')) return Response.json({ data: { freeGrant: { remaining: 5000, resetsAt: '2026-12-01T00:00:00Z' } } });
    paidCalls += 1;
    return Response.json({ data: Array(20).fill({}) }, { headers: { 'x-credits-charged': '61' } });
  };
  const request = createBudgetedRequest(state, Date.parse('2026-11-01T00:00:00Z'), transport);
  await request('https://api.weirapp.io/v1/usage', {});
  const results = await Promise.allSettled([1, 2, 3].map(() => request('https://api.weirapp.io/v1/reddit/search', { body: JSON.stringify({ limit: 20 }) })));
  assert.equal(paidCalls, 2);
  assert.equal(results[2].status, 'rejected');
  assert.equal(state.searchCredits.spent, 122);
});

test('persisted spending survives restarts and resets on the next UTC day', async () => {
  const state = { searchCredits: { day: '2026-11-01', spent: 150 } };
  const transport = async url => url.endsWith('/usage')
    ? Response.json({ data: { freeGrant: { remaining: 4850, resetsAt: '2026-12-01T00:00:00Z' } } })
    : Response.json({ data: [] });
  const first = createBudgetedRequest(state, Date.parse('2026-11-01T12:00:00Z'), transport);
  await first('https://api.weirapp.io/v1/usage', {});
  await assert.rejects(first('https://api.weirapp.io/v1/x/search', { body: JSON.stringify({ limit: 20 }) }), /Daily/);
  const second = createBudgetedRequest(state, Date.parse('2026-11-02T00:00:00Z'), transport);
  await second('https://api.weirapp.io/v1/usage', {});
  await second('https://api.weirapp.io/v1/x/search', { body: JSON.stringify({ limit: 20 }) });
  assert.equal(state.searchCredits.spent, 1);
});

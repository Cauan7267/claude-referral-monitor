export function createBudgetedRequest(state, now = Date.now(), request = fetch) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (state.searchCredits?.day !== day) state.searchCredits = { day, spent: 0 };
  let usagePromise;
  let remaining;
  let dailyLimit;
  let queue = Promise.resolve();

  async function usage(url, options) {
    if (!usagePromise) {
      usagePromise = request(url, options).then(async response => {
        if (response.ok) {
          const payload = await response.clone().json();
          remaining = payload.data?.freeGrant?.remaining;
          state.searchCredits.freeRemaining = remaining;
          state.searchCredits.resetsAt = payload.data?.freeGrant?.resetsAt;
          const reset = Date.parse(payload.data?.freeGrant?.resetsAt);
          const daysLeft = Math.max(1, Math.ceil((reset - now) / 86_400_000));
          dailyLimit = Number.isInteger(remaining) && Number.isFinite(daysLeft)
            ? Math.floor((remaining + state.searchCredits.spent) / daysLeft)
            : 0;
          state.searchCredits.dailyLimit = dailyLimit;
        }
        return response;
      });
    }
    return (await usagePromise).clone();
  }

  async function search(url, options) {
    const body = JSON.parse(options.body);
    const resultCost = url.endsWith('/reddit/search') ? 3 : 1;
    const maximumCharge = 1 + body.limit * resultCost;
    if (!Number.isInteger(remaining) || remaining < maximumCharge) {
      const error = new Error('Free public-search credits are too low for the next page');
      error.freeQuotaExhausted = true;
      error.budgetPaused = true;
      throw error;
    }
    if (state.searchCredits.spent + maximumCharge > dailyLimit) {
      const error = new Error('Daily free-credit budget reached; search will continue tomorrow');
      error.budgetPaused = true;
      throw error;
    }
    const response = await request(url, options);
    if (response.ok) {
      const payload = await response.clone().json();
      const headerCharge = Number(response.headers.get('x-credits-charged'));
      const charged = headerCharge > 0 ? headerCharge : 1 + payload.data.length * resultCost;
      remaining -= charged;
      state.searchCredits.spent += charged;
      state.searchCredits.freeRemaining = remaining;
    }
    return response;
  }

  return (url, options) => {
    if (url.endsWith('/usage')) return usage(url, options);
    const result = queue.then(() => search(url, options));
    queue = result.catch(() => {});
    return result;
  };
}

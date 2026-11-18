# Claude referral monitor

Checks public feeds and a guest pass directory for new `claude.ai/referral/` links and sends them to Telegram. Runs on standard GitHub Actions Ubuntu runners every ten minutes. Your computer can be off.

The repository is public so standard Actions compute is free. Telegram credentials live in encrypted repository secrets. State contains hashes of delivered referral codes and daily source availability. No paid search or model API is used. No Actions artifacts or caches are created.

## Sources and filtering

Reads the public guest pass directory at claudecoworkcourse.com, NodeLoc and Linux.do RSS feeds, Hacker News search, and public Reddit posts and comments. Source access varies, especially Reddit, which may block cloud runners. Each run logs accessible and unavailable sources. If all sources fail, the bot sends an outage alert once per day and subsequent runs retry.

Also reads X/Twitter profile RSS feeds through teapawt.org, whose operator permits automated profile reading. The initial ten accounts in `x-profiles.json` have previously shared Claude referral links. Add public handles there to expand coverage. Alerts link to the original X post and expand t.co short links when present. Coverage is limited to watched accounts. Full X keyword-search feeds require a paid pass and are excluded from this free setup. Mirror availability and completeness can vary.

On HTTP 429 the monitor waits at least 30 minutes, respecting longer Retry-After headers. On HTTP 403 it waits at least six hours. Access to blocked Reddit sources through the approved Data API requires separate credentials and Reddit approval.

Only links with source publication dates within 48 hours qualify. Crossed-out links, directory entries marked retired, and offers explicitly marked claimed or expired are excluded. Query strings are removed and sent codes are deduplicated persistently. Availability at redemption remains unverified.

## Operation

Open Actions → Claude referral monitor → Run workflow for an immediate scan. Enable the test-delivery input for a Telegram connectivity test. Disable the workflow from its Actions menu to stop monitoring.

GitHub schedules can be delayed or skipped during high load, so the ten-minute cadence is approximate. A small daily state commit keeps normal repository activity present. GitHub can disable public-repository schedules after 60 days without activity, so check Actions if alerts stop.

## Development

Use Node.js 22 or newer. Run `npm ci`, then `npm test`. Use `node monitor.mjs --dry-run` to scan without sending messages or updating state. For delivery, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the environment. Never commit credentials.

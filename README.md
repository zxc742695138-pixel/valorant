# Valorant team analysis

## Team blacklist (close finishes)

For every partner team (12 per region), the share of maps in its **last 5 matches** (every
map of those matches) that finished **13-11** (either way) or went to **overtime**. Only
matches between two partner teams count, and the events matching `exclude_events` (EWC and
its qualifiers, Champions) are left out. In each region the **4 teams with the highest share
form the blacklist** (ties: more maps first). Use: bet the team leading by >= 3 rounds at
total rounds >= 17, **unless the leading team is blacklisted** (a blacklisted trailing team
does not matter). Lists are produced for Pacific, Americas and China (`bet_regions`); EMEA is
crawled but not bet on. Settings live in `pipeline/config.json` (`close_blacklist`:
`last_matches`, or `window_days` instead to use a day window; `top`, `exclude_events`, `min_maps`).

Refresh everything (crawl → validate → rank → report):

```bash
node pipeline/update.js
```

Output: `reports/latest.html`, `reports/latest.json`, `reports/vlr-blacklist.json`, and a dated
copy in `reports/archive/`. Each run is compared with the previous one (blacklist changes).
The ranking alone: `node analysis/close_blacklist.js --data data --to YYYY-MM-DD --last-matches 5`.

### Daily release

`.github/workflows/vlr-blacklist.yml` runs the pipeline every day (01:23 UTC = 08:23 Vietnam, or on
demand from the Actions tab). When a list changes (order ignored) it publishes a release
`vlr-blacklist vN` with `vlr-blacklist.json`:

```json
{ "Pacific": { "blacklist": ["Gen.G", "..."] }, "Americas": { "blacklist": ["..."] }, "China": { "blacklist": ["..."] } }
```

Newest file: `https://github.com/<owner>/<repo>/releases/latest/download/vlr-blacklist.json`.
To publish releases to another (public) repository, set the repository variable
`RELEASE_REPO` (`owner/name`) and the secret `RELEASE_TOKEN` (a token with
Contents: write on that repository).

## Crawler

Crawls a team's most recent completed matches from [vlr.gg](https://www.vlr.gg) with Playwright,
including round-by-round score progression for every map.

```bash
node crawler/crawl_team.js --team-id 624 --days 120 --out data/paper-rex.json
```

- `--team-id`: vlr.gg team id (from the team URL, e.g. `vlr.gg/team/624/paper-rex` → `624`)
- `--days`: only matches from the last N days
- `--limit`: at most N most recent matches (default 20 when `--days` is not given)
- `--delay`: ms between requests (default 1000)
- `--out`: output file (prints to stdout if omitted)

### Output format

```json
{
  "team_id": "624",
  "crawled_at": "...",
  "matches": [
    {
      "url": "https://www.vlr.gg/754739/...",
      "date": "2026-10-09 05:00:00",
      "event": "Valorant Champions 2026",
      "stage": "Playoffs: Lower Round 1",
      "team1": "T1",
      "team2": "Paper Rex",
      "match_result": "2-1",
      "winner": "T1",
      "map_result": [
        { "map": "Lotus", "score": "13-7", "rounds": ["0-0", "0-1", "0-2", "1-2", "...", "13-7"] }
      ]
    }
  ]
}
```

All scores are written as `team1-team2`. `rounds` is the cumulative score after each round, starting from `0-0`.
`date` is in UTC.

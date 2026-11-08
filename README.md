# Valorant team analysis

## Team whitelist (one-sided teams)

For every partner team (12 per region), the share of its maps this season (from 1 January)
that ended with a gap of **>= 4 rounds** (won or lost big). In each region the **8 teams with
the highest share are "Một chiều" = the whitelist**; the other 4 are "Giằng co". Teams with
fewer than 10 maps this season are not classified (not bet). Only matches between two partner
teams count; every event counts. Use: bet only on maps where **both teams are whitelisted**
(international matches included), on the team leading by exactly 3 rounds at total rounds >= 17 — only when the leader won the
round that produced that lead (9-7 → 10-7 yes, 10-6 → 10-7 no) — at odds of about 1.12 or more. Lists are produced for Pacific, Americas and China
(`bet_regions`); EMEA is crawled but not bet on. Settings: `pipeline/config.json`
(`one_sided`: `gap`, `top`, `min_maps`). Walk-forward backtest:
`node analysis/style_groups.js --regions americas,china,pacific --top 8 --season 2025|2026`.

Refresh everything (crawl since 1 January → validate → rank → report):

```bash
node pipeline/update.js
```

Output: `reports/latest.html`, `reports/latest.json`, `reports/vlr-blacklist.json`, and a dated
copy in `reports/archive/`. Each run is compared with the previous one (whitelist changes).
The ranking alone: `node analysis/one_sided.js --data data --to YYYY-MM-DD`.

### Daily release

`.github/workflows/vlr-blacklist.yml` runs the pipeline every day (01:23 UTC = 08:23 Vietnam, or on
demand from the Actions tab). When a list changes (order ignored) it publishes a release
`vlr-blacklist vN` with `vlr-blacklist.json`:

```json
{ "Pacific": { "whitelist": ["T1", "..."] }, "Americas": { "whitelist": ["..."] }, "China": { "whitelist": ["..."] } }
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

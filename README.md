# Valorant team analysis

## Comeback-influence report

Finds, per region (Americas, EMEA, China, Pacific), the 5 teams whose removal lowers the
region's comeback-map rate the most. A comeback map is one where, with total rounds >= 17,
a team led by >= 3 rounds and still lost. Teams are removed one at a time: remove the team
with the most comeback maps (ties: higher rate), drop its matches, recompute, 5 times.

Refresh everything (crawl → validate → analyse → report):

```bash
node pipeline/update.js
```

Settings (window, steps, events, report URL) live in `pipeline/config.json`. Output:
`reports/latest.html`, `reports/latest.json`, and a dated copy in `reports/archive/`.
Each run is compared with the previous one (teams entering/leaving the top 5).

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

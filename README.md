# Valorant team analysis

## Crawler

Crawls a team's most recent completed matches from [vlr.gg](https://www.vlr.gg) with Playwright,
including round-by-round score progression for every map.

```bash
node crawler/crawl_team.js --team-id 624 --limit 20 --out data/paper-rex.json
```

- `--team-id`: vlr.gg team id (from the team URL, e.g. `vlr.gg/team/624/paper-rex` → `624`)
- `--limit`: number of matches (default 20)
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

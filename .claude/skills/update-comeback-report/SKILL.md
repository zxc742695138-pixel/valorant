---
name: update-comeback-report
description: Refresh the VCT team blacklist (per region, the 5 teams with the highest share of maps finishing 13-11 or in overtime over each team's last 5 matches). Use when the user asks to update / cập nhật the blacklist, the comeback ("lật kèo") report, or re-run the analysis on the latest matches.
---

# Update the team blacklist

## Definitions (agreed with the user; do not change without asking)

- **Qualifying lead**: at some point before the map ends, with total rounds played by
  both teams >= 17, one team leads by >= 3 rounds. The final score itself (e.g. 13-4) is
  not a lead: the map is over.
- **Comeback map (map lật kèo)**: a map with a qualifying lead that the leading team loses.
  For a team, **made (lật được)** = it trailed like that and won; **blown (bị lật)** = it
  led like that and lost.
- **Teams**: the 12 partner teams per region (Americas, EMEA, China, Pacific), from the
  group stage of the events listed in `pipeline/config.json`. Lists are produced only for
  `bet_regions` (Pacific, Americas, China; the user does not bet EMEA). EMEA is still crawled
  and its teams count as partner teams (they get no list of their own).
- **Matches**: only matches between two tier-1 partner teams (any of the 48, so
  international matches between regions count). Matches against Challengers are ignored.
- **Close-finish share** (`analysis/close_blacklist.js`): for each team, the maps of its
  last `close_blacklist.last_matches` matches (5; a match = every map of the series) that
  finished 13-11 (won or lost) or went to overtime (total rounds > 24), divided by all maps
  of those matches. Matches of events matching `close_blacklist.exclude_events`
  ("Esports World Cup|Champions": EWC, its qualifiers and Champions) are skipped, so the
  5 matches are the last 5 outside those events. (If `last_matches` is removed,
  `window_days` days are used instead.)
- **Blacklist** = per region, the `close_blacklist.top` (5) teams with the highest share
  (ties: more maps first; teams tied with the 5th are reported in the notes, not added).
- **How the user bets**: on the team leading by >= 3 rounds at total rounds >= 17, **except
  when that leading team is blacklisted** (a blacklisted trailing team does not block the bet);
  never on EWC, its qualifiers or Champions; only at odds of about 1.12 or more.
  (Backtest, `analysis/ot_filter.js --metric close --last-matches 5`: 2026 better than no
  filter, 2025 worse. Mention it only if asked about expected results.)

## Daily release (automatic)

`.github/workflows/vlr-blacklist.yml` runs every day at 01:23 UTC (08:23 Vietnam): it runs the
pipeline and commits `data/` and `reports/`. Only when a list differs from the latest release
(order ignored) does it publish a release `vlr-blacklist vN` (N = previous highest `vN` + 1)
with `vlr-blacklist.json` (`{"Pacific": {"blacklist": [...]}, ...}`) and
`report-details.json` (rates of all teams). The manual run input `force_release` publishes
regardless. Stable public link to the newest file:
`https://github.com/zxc742695138-pixel/valorant/releases/latest/download/vlr-blacklist.json`.

When the user asks for an update between daily runs, prefer triggering that workflow
(`workflow_dispatch`, GitHub MCP `actions_run_trigger` with `workflow_id: vlr-blacklist.yml`);
when it finishes, `git pull` and do step 4 below with the pulled `reports/latest.html`.
The steps below are the local equivalent (no release).

## Steps

1. Run the pipeline (~10 minutes locally; 48 teams crawled from vlr.gg with Playwright).
   Run it in the background and wait for it to finish:

   ```bash
   node pipeline/update.js
   ```

   Options: `--refresh-teams` rebuilds team lists from the events in `config.json`
   (use when a new season/stage starts, after updating the event URLs);
   `--skip-crawl` reuses the data already in `data/`; `--days N` overrides the crawl window.

2. Read its output. Check:
   - every team crawled: if a team still fails after one retry, the pipeline prints
     "Vẫn lỗi sau khi thử lại" and exits without building a report; re-run those teams with
     `node crawler/crawl_team.js --team-id <id> --days 180 --out data/<slug>.json` and then
     `node pipeline/update.js --skip-crawl`;
   - "0 map tỉ số không khớp"; any mismatch means vlr.gg changed its markup;
   - ties with the 4th team (listed in the notes) and teams whose last matches are old
     (column "Từ ngày"); mention them, especially in the off-season.

3. Commit `data/`, `reports/` and push to the default branch `claude/sleepy-pascal-bpcnf8`
   (pull with rebase first). Check the "vlr-blacklist" Actions run for that commit.

4. Republish the report to the same URL (`artifact_url` in `pipeline/config.json`):
   in a new conversation, first `Artifact` `action: "read"` on that URL, then publish
   `reports/latest.html` with `url` set to it. Never create a new artifact for this report.

5. Reply to the user in Vietnamese with, per region: the blacklist (with each team's share
   and map count) and what changed since the previous run.

## Files

- `pipeline/update.js` — the whole refresh; `pipeline/config.json` — crawl window, blacklist settings, events, report URL
- `analysis/close_blacklist.js` — the ranking (`computeCloseBlacklist`); `analysis/ot_filter.js --metric close` — its backtest
- `analysis/team_groups.js` — the previous whitelist grouping (no longer used by the pipeline)
- `crawler/crawl_team.js`, `crawler/event_teams.js` — vlr.gg crawlers
- `reports/template.html` + `reports/build.js` — HTML report; `reports/archive/` — one JSON per run
- Older analyses kept for reference: `analysis/iterative_exclude.js`, `analysis/backtest_rolling.js`, `analysis/grid*.js`

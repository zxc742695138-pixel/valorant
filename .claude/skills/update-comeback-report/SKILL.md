---
name: update-comeback-report
description: Refresh the VCT team whitelist (per region, the 8 "Một chiều" teams with the highest share of maps this season ending with a gap of 4+ rounds). Use when the user asks to update / cập nhật the whitelist, blacklist, the comeback ("lật kèo") report, or re-run the analysis on the latest matches.
---

# Update the team whitelist (one-sided teams)

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
- **One-sided share** (`analysis/one_sided.js`): for each team, the maps of the current
  season (1 January of the crawl date's year → crawl date, every event) whose final score
  gap is >= `one_sided.gap` (4) rounds, divided by all its maps this season.
- **Whitelist ("Một chiều")** = per region, among teams with >= `one_sided.min_maps` (10) maps,
  the top `one_sided.top` (8) of 12 by that share (scaled down when fewer teams have enough
  maps). The rest are "Giằng co"; teams below the minimum are "Chưa đủ dữ liệu" (not bet).
  Early in a season the whitelist is short or empty.
- **How the user bets**: only on maps where BOTH teams are whitelisted (international
  matches included), on the team leading by >= 3 rounds at total rounds >= 17, at odds of
  about 1.12 or more. Backtest (walk-forward, `analysis/style_groups.js --top 8`): 2026 9.9%
  comebacks vs 14.0% unfiltered, 2025 10.4% vs 17.5%.
- The crawl window is extended automatically to reach 1 January (`pipeline/update.js`).

## Daily release (automatic)

`.github/workflows/vlr-blacklist.yml` runs every day at 01:23 UTC (08:23 Vietnam): it runs the
pipeline and commits `data/` and `reports/`. Only when a list differs from the latest release
(order ignored) does it publish a release `vlr-blacklist vN` (N = previous highest `vN` + 1)
with `vlr-blacklist.json` (`{"Pacific": {"whitelist": [...]}, ...}`) and
`report-details.json` (counts of all teams). The manual run input `force_release` publishes
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
   - teams listed as "Chưa đủ dữ liệu" (fewer than 10 maps this season), especially at the
     start of a season.

3. Commit `data/`, `reports/` and push to the default branch `claude/sleepy-pascal-bpcnf8`
   (pull with rebase first). Check the "vlr-blacklist" Actions run for that commit.

4. Republish the report to the same URL (`artifact_url` in `pipeline/config.json`):
   in a new conversation, first `Artifact` `action: "read"` on that URL, then publish
   `reports/latest.html` with `url` set to it. Never create a new artifact for this report.

5. Reply to the user in Vietnamese with, per region: the whitelist (Một chiều, with each
   team's share), the Giằng co teams, and what changed since the previous run.

## Files

- `pipeline/update.js` — the whole refresh; `pipeline/config.json` — crawl window, blacklist settings, events, report URL
- `analysis/one_sided.js` — the ranking (`computeOneSided`); `analysis/style_groups.js` — its backtest
- `analysis/close_blacklist.js` — the previous close-finish blacklist (no longer used)
- `analysis/team_groups.js` — the previous whitelist grouping (no longer used by the pipeline)
- `crawler/crawl_team.js`, `crawler/event_teams.js` — vlr.gg crawlers
- `reports/template.html` + `reports/build.js` — HTML report; `reports/archive/` — one JSON per run
- Older analyses kept for reference: `analysis/iterative_exclude.js`, `analysis/backtest_rolling.js`, `analysis/grid*.js`

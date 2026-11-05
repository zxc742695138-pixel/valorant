---
name: update-comeback-report
description: Refresh the VCT team whitelist/blacklist (teams grouped by recent comeback history; whitelist = "Trung bình" group). Use when the user asks to update / cập nhật the whitelist, blacklist, the comeback ("lật kèo") report, or re-run the analysis on the latest matches.
---

# Update the team whitelist / blacklist

## Definitions (agreed with the user; do not change without asking)

- **Qualifying lead**: at some point before the map ends, with total rounds played by
  both teams >= 17, one team leads by >= 3 rounds. The final score itself (e.g. 13-4) is
  not a lead: the map is over.
- **Comeback map (map lật kèo)**: a map with a qualifying lead that the leading team loses.
  For a team, **made (lật được)** = it trailed like that and won; **blown (bị lật)** = it
  led like that and lost.
- **Teams**: the 12 partner teams per region (Americas, EMEA, China, Pacific), from the
  group stage of the events listed in `pipeline/config.json`. All four regions are used.
- **Matches**: only matches between two tier-1 partner teams (any of the 48, so
  international matches between regions count). Matches against Challengers are ignored.
- **Groups** (`analysis/team_groups.js`), from matches in the last `groups.window_days`
  days (90), with `groups.net` = 1 and `groups.volatile` = 3:
  - Mạnh: made − blown >= +1; Yếu: made − blown <= −1;
  - Không ổn định: otherwise, if made + blown >= 3;
  - Trung bình: the rest.
- **Whitelist** = Trung bình teams; **blacklist** = every other partner team.
- **How the user bets**: only on maps where both teams are in the whitelist, on the team
  leading by >= 3 rounds at total rounds >= 17.

## Daily release (automatic)

`.github/workflows/vlr-blacklist.yml` runs every day at 01:23 UTC (08:23 Vietnam): it runs the
pipeline and commits `data/` and `reports/`. Only when a list differs from the latest release
(order ignored) does it publish a release `vlr-blacklist vN` (N = previous highest `vN` + 1)
with `vlr-blacklist.json` (`{"Pacific": {"whitelist": [...], "blacklist": [...]}, ...}`) and
`report-details.json` (counts per team). The manual run input `force_release` publishes
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
   - teams with very few qualifying maps in the window land in Trung bình by default;
     mention it when that happens (off-season).

3. Commit `data/`, `reports/` and push to the default branch `claude/sleepy-pascal-bpcnf8`
   (pull with rebase first). Check the "vlr-blacklist" Actions run for that commit.

4. Republish the report to the same URL (`artifact_url` in `pipeline/config.json`):
   in a new conversation, first `Artifact` `action: "read"` on that URL, then publish
   `reports/latest.html` with `url` set to it. Never create a new artifact for this report.

5. Reply to the user in Vietnamese with, per region: whitelist, blacklist (with groups),
   and what changed in the whitelist since the previous run.

## Files

- `pipeline/update.js` — the whole refresh; `pipeline/config.json` — crawl window, group settings, events, report URL
- `analysis/team_groups.js` — the grouping (`computeGroups`); `analysis/group_rule.js` — its backtest
- `crawler/crawl_team.js`, `crawler/event_teams.js` — vlr.gg crawlers
- `reports/template.html` + `reports/build.js` — HTML report; `reports/archive/` — one JSON per run
- Older analyses kept for reference: `analysis/iterative_exclude.js`, `analysis/backtest_rolling.js`, `analysis/grid*.js`

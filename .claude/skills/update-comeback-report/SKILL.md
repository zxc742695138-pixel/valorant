---
name: update-comeback-report
description: Refresh the VCT comeback-influence report (top 5 teams per region whose removal lowers the region's comeback-map rate the most). Use when the user asks to update / cập nhật the top 5 list, the comeback ("lật kèo") report, or re-run the analysis on the latest matches.
---

# Update the comeback-influence report

## Definitions (agreed with the user; do not change without asking)

- **Comeback map (map lật kèo)**: at some point where total rounds played by both
  teams is >= 17, one team leads by >= 3 rounds, and that team loses the map.
- **Region rate**: comeback maps / maps that had such a lead. Matches are de-duplicated
  by URL within a region.
- **Window**: matches in the last 180 days (`pipeline/config.json` → `days`).
- **Teams**: the 12 partner teams per region (Americas, EMEA, China, Pacific), from the
  group stage of the events listed in `pipeline/config.json`.
- **Algorithm (loại lần lượt)**, per region, independently: rank teams by number of
  comeback maps, then by comeback rate; remove the top team and every match it played;
  recompute; repeat 5 times. The 5 removed teams are the answer.

## Steps

1. Run the pipeline. It takes ~30–40 minutes (48 teams crawled from vlr.gg with
   Playwright), so run it in the background and wait for it to finish:

   ```bash
   node pipeline/update.js
   ```

   Options: `--refresh-teams` rebuilds team lists from the events in `config.json`
   (use when a new season/stage starts, after updating the event URLs);
   `--skip-crawl` reuses the data already in `data/`; `--days N` overrides the window.

2. Read its output. Check:
   - every team crawled (no "Vẫn lỗi sau khi thử lại" line); if some failed, re-run
     those teams with `node crawler/crawl_team.js --team-id <id> --days 180 --out data/<slug>.json`
     and then `node pipeline/update.js --skip-crawl`;
   - "0 map tỉ số không khớp"; any mismatch means vlr.gg changed its markup;
   - ties ("Đồng hạng"): tell the user when a tie decides which team is 5th, using
     `tie_alt_rate` in `reports/latest.json` to show the alternative result.

3. Commit `data/`, `reports/latest.*`, `reports/archive/` and push to the session's branch.

4. Republish the report to the same URL (`artifact_url` in `pipeline/config.json`):
   in a new conversation, first `Artifact` `action: "read"` on that URL, then publish
   `reports/latest.html` with `url` set to it. Never create a new artifact for this report.

5. Reply to the user in Vietnamese with, per region: the 5 teams in removal order,
   rate before → after (points and relative change), the random-removal comparison,
   and what changed in the top 5 since the previous run. Mention the data notes the
   pipeline printed (e.g. maps without round data).

## Files

- `pipeline/update.js` — the whole refresh; `pipeline/config.json` — window, steps, events, report URL
- `crawler/crawl_team.js`, `crawler/event_teams.js` — vlr.gg crawlers
- `analysis/iterative_exclude.js` — the algorithm (`--json`, `--baseline`)
- `reports/template.html` + `reports/build.js` — HTML report; `reports/archive/` — one JSON per run

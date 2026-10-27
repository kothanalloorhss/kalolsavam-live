# Kalolsavam Live

Static site on GitHub Pages. `data.json` is the only file that changes during the festival.

## Setup
1. Create a **public** repo, push these files, enable Pages (branch `main`, root).
2. Edit `js/config.js`: set `owner`, `repo`, `branch`.
3. Replace `schedule.json` with the real 215 events (fields: event_id, date, stage_id, category, categories, event_name, start_time HH:MM).
4. Edit `stages.json`: real venue names, `is_external`, Google Maps `map_url`, and campus `route_guide` text.
5. Make a **fine-grained personal access token**: only this repo, permission *Contents: Read and write*, expiry just after Nov 6.
6. Open `admin.html`, paste the token. It lives in sessionStorage only.

## Testing before the festival
Add `?date=2026-11-03` and optionally `&now=10:30` to either page. A "Test mode" chip shows.
Test commits write real data to `data.json`, so reset it to the original file before going live.

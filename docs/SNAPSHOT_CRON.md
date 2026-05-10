# Weekly Snapshot — Scheduling

The score archive is the platform's biggest moat (see `MOAT.md`). Every week
we run `./snap` to recompute metrics + scores and append a fresh snapshot to
the `app.scores` table. This doc covers how the schedule is wired up.

## Why launchd, not cron

macOS ships `cron` for backwards compatibility, but Apple's blessed scheduler
is **launchd**. Two reasons that matter here:

1. **Catch-up on wake.** If the Mac is asleep at 18:00 Friday, cron silently
   misses the run. launchd fires it the next time the Mac wakes.
2. **Survives macOS upgrades.** Cron entries get blown away. LaunchAgents
   under `~/Library/LaunchAgents/` are user-scoped and persist.

## Files

| Path | Role |
|---|---|
| `snap` | Existing one-shot script — runs `compute-metrics` + `score`. |
| `scripts/weekly-snap.sh` | Wrapper called by launchd. Adds dated logging + log rotation (keeps last 26 runs ≈ 6 months). |
| `scripts/com.fundamental.weekly-snap.plist` | launchd job: Friday 18:00 IST. |
| `logs/snapshots/YYYY-MM-DD_HHMMSS.log` | Per-run wrapper log (full output of `./snap`). |
| `logs/launchd.{out,err}.log` | launchd's own stdout/stderr — usually empty. |

## Schedule

**Friday, 18:00 local time (IST).**

NSE Friday close is 15:30 IST. The 2.5-hour buffer lets any late-day price
feeds settle before we score against them.

## Install

```bash
cd /Users/debasissahoo/Documents/Fundamental

# 1. Copy the plist into LaunchAgents (where launchd discovers it).
cp scripts/com.fundamental.weekly-snap.plist ~/Library/LaunchAgents/

# 2. Load + enable. -w persists the "enabled" flag across reboots.
launchctl load -w ~/Library/LaunchAgents/com.fundamental.weekly-snap.plist
```

That's it. Next Friday at 18:00 the snapshot runs.

## Verify it's loaded

```bash
launchctl list | grep weekly-snap
```

Expected output (a single line):

```
-       0       com.fundamental.weekly-snap
```

The middle column is the last exit code (`-` means hasn't run yet, `0` means
last run succeeded, anything else is a failure to investigate).

## Force a test run (don't wait for Friday)

```bash
launchctl start com.fundamental.weekly-snap

# Then watch the log file fill up:
ls -lt logs/snapshots/ | head -3
tail -f logs/snapshots/$(ls -1t logs/snapshots/ | head -1)
```

A successful run ends with `✓ snapshot complete` and exit code 0.

## Inspect the most recent runs

```bash
ls -lt logs/snapshots/ | head -10
```

Each filename is `YYYY-MM-DD_HHMMSS.log` so newest sorts first.

## Pause / resume

```bash
# Pause (won't fire on schedule until reloaded).
launchctl unload ~/Library/LaunchAgents/com.fundamental.weekly-snap.plist

# Resume.
launchctl load -w ~/Library/LaunchAgents/com.fundamental.weekly-snap.plist
```

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.fundamental.weekly-snap.plist
rm ~/Library/LaunchAgents/com.fundamental.weekly-snap.plist
```

The repo copy under `scripts/` stays, so you can re-install later by
re-copying.

## Verify the archive is actually growing

After a few weeks have passed, sanity-check the database:

```bash
psql fundamental_app -c "
  SELECT snapshot_date, COUNT(*) AS rows
  FROM app.scores
  GROUP BY snapshot_date
  ORDER BY snapshot_date DESC
  LIMIT 10;
"
```

You should see one row per Friday with ~2,150 rows each. A missing Friday is
a missed run worth investigating (Mac was off and stayed off, network
glitch, Screener cookies expired, etc.).

## Common failures + fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `launchctl list` shows non-zero exit | Cookies expired, DB down, or `compute-metrics` crashed | Open the latest `logs/snapshots/*.log` and read the trace |
| No log file created at all | launchd never fired (Mac was asleep all weekend, or plist not loaded) | `launchctl list \| grep weekly-snap` to confirm it's loaded |
| Auth errors on Screener | `screener_sessionid` / `screener_csrftoken` expired | Refresh cookies in `etl/.env` and run `./snap` manually once to confirm |
| Snapshot ran but `app.scores` shows no new row | `compute-metrics` succeeded but `score` failed mid-way | Re-run `./snap` manually; the wrapper is idempotent for the same `--snapshot` date |

## When to skip a week

Rarely. The whole point is **don't skip** — the archive's value is its
unbroken weekly cadence. If you know in advance you'll be travelling with
the Mac off all weekend, just trigger an early run on Thursday:

```bash
launchctl start com.fundamental.weekly-snap
# or simply:
./snap
```

A snapshot on Thursday is better than no snapshot at all.

---

*Last updated: 2026-05-05*

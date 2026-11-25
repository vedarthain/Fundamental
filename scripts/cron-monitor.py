#!/usr/bin/env python3
"""cron-monitor.py — Autonomous AppDynamics-style APM, DB, Server & Cron Watchdog.

Monitors:
  1. All 17 EquityRoots cron logs (/var/log/fundamental-*.log) for failures/staleness
  2. Live Next.js app synthetic probe (http://127.0.0.1:3000/api/version) + latency
  3. PostgreSQL connectivity, query latency, and long-running/stuck queries (>5 min)
  4. PM2 'equityroots' process status, RSS memory, and unexpected restart spikes
  5. System CPU load, available RAM, and root disk usage

Alerting (zero-touch):
  - Runs every 15 minutes; sends an instant, deduplicated Resend email on any new issue.
  - Sends an "All Clear / Recovered" email as soon as active issues resolve.
  - Supports --digest (scheduled once daily at 08:00 IST) for a daily health summary.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = Path("/tmp/fundamental-monitor-state.json")

JOBS: list[tuple[str, str, str, float | None]] = [
    ("db-backup", "DB Backup (Daily)", "/var/log/fundamental-db-backup.log", 30),
    ("refresh-ltp", "Bhavcopy & LTP (Mon-Fri)", "/var/log/fundamental-refresh-ltp.log", 80),
    ("momentum-scanner", "Momentum Scanners (Mon-Fri)", "/var/log/fundamental-momentum-scanner.log", 80),
    ("daily-drift", "Nightly Drift (Daily)", "/var/log/fundamental-daily-drift.log", 30),
    ("weekly-fetch", "Weekly Screener Fetch (Mon-Fri)", "/var/log/fundamental-weekly-fetch.log", 80),
    ("sync-upstox-instruments", "Upstox Instruments (Mon-Fri)", "/var/log/fundamental-sync-upstox-instruments.log", 80),
    ("refresh-ipos", "IPO Refresh (Daily)", "/var/log/fundamental-refresh-ipos.log", 30),
    ("corp-actions-bse", "BSE Corp Actions (Tue/Fri)", "/var/log/fundamental-corp-actions-bse.log", 125),
    ("weekly-compute", "Saturday Compute (Weekly)", "/var/log/fundamental-weekly-compute.log", 192),
    ("sunday-calls", "Sunday Calls (Weekly)", "/var/log/fundamental-sunday-calls.log", 192),
    ("detect-corp-actions", "Detect Corp Actions (Sun)", "/var/log/fundamental-detect-corp-actions.log", 192),
    ("refresh-announcements", "BSE Announcements (Sun)", "/var/log/fundamental-refresh-announcements.log", 192),
    ("pm2-reload", "PM2 Weekly Reload (Sun)", "/var/log/fundamental-pm2-reload.log", 192),
    ("sync-universe-monthly", "Universe Sync & Retire (1st)", "/var/log/fundamental-sync-universe-monthly.log", 800),
    ("refresh-shareholding", "Shareholding Pattern (3rd)", "/var/log/fundamental-refresh-shareholding.log", 800),
    ("refresh-company-info", "Company Info (5th)", "/var/log/fundamental-refresh-company-info.log", 800),
    ("sync-market-taxonomy", "Market Taxonomy (Jan/Jul)", "/var/log/fundamental-sync-market-taxonomy.log", 4500),
]

FAIL_MARKERS = (
    "❌",
    "failed with exit code",
    "Traceback (most recent call last):",
    "FATAL:",
)


@dataclass
class JobStatus:
    job_id: str
    label: str
    status: str  # OK | FAILED | STALE | PENDING
    age_hours: float | None
    detail: str


def read_tail(path: Path, max_bytes: int = 65536) -> str:
    size = path.stat().st_size
    with path.open("rb") as f:
        if size > max_bytes:
            f.seek(size - max_bytes)
        return f.read().decode("utf-8", errors="replace")


def latest_run_block(text: str) -> str:
    lines = text.splitlines()
    start_idx = 0
    for i, line in enumerate(lines):
        if "Starting " in line and ("🕒" in line or "UTC" in line):
            start_idx = i
    return "\n".join(lines[start_idx:])


def check_job(job_id: str, label: str, log_path: str, max_age_hours: float | None) -> JobStatus:
    p = Path(log_path)
    if not p.exists() or p.stat().st_size == 0:
        return JobStatus(job_id, label, "PENDING", None, "no runs logged yet")

    mtime = p.stat().st_mtime
    age_h = (time.time() - mtime) / 3600.0
    ist_dt = datetime.fromtimestamp(mtime + 5.5 * 3600, tz=timezone.utc).strftime("%Y-%m-%d %H:%M IST")
    tail = read_tail(p)
    block = latest_run_block(tail)

    has_ok = "✅" in block or "completed successfully" in block.lower()
    has_fail = any(m in block for m in FAIL_MARKERS)

    if has_fail and not has_ok:
        err_line = next((ln.strip() for ln in reversed(block.splitlines()) if any(m in ln for m in FAIL_MARKERS)), "error in latest run")
        return JobStatus(job_id, label, "FAILED", age_h, f"{ist_dt} — {err_line[:120]}")

    if max_age_hours is not None and age_h > max_age_hours:
        return JobStatus(job_id, label, "STALE", age_h, f"{ist_dt} ({age_h:.1f}h ago, limit {max_age_hours:.0f}h)")

    return JobStatus(job_id, label, "OK", age_h, f"{ist_dt} ({age_h:.1f}h ago)")


def check_app_http(alerts: dict[str, str]) -> str:
    port = os.environ.get("PORT", "3000")
    url = f"http://127.0.0.1:{port}/api/version"
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(url, timeout=8) as resp:
            ms = int((time.monotonic() - t0) * 1000)
            if resp.status != 200:
                alerts["app:http"] = f"App HTTP probe returned {resp.status} ({ms}ms)"
                return f"App HTTP: {resp.status} ({ms}ms)"
            if ms > 3000:
                alerts["app:slow"] = f"App HTTP probe slow: {ms}ms (>3000ms)"
            return f"App HTTP: 200 ({ms}ms)"
    except Exception as e:
        alerts["app:down"] = f"App HTTP probe failed: {e}"
        return f"App HTTP: DOWN ({e})"


def _metric_drifted(stored: object, live: object) -> bool:
    if live is None or stored is None:
        return False
    if isinstance(stored, bool) or isinstance(live, bool):
        return bool(stored) != bool(live)
    try:
        a = float(stored)  # type: ignore[arg-type]
        b = float(live)  # type: ignore[arg-type]
    except Exception:
        return False
    if a == 0:
        return b != 0
    is_rate = abs(a) <= 1.0 and abs(b) <= 1.0
    return abs(b - a) >= 0.05 if is_rate else abs(b / a - 1.0) >= 0.1


def check_postgres(alerts: dict[str, str]) -> tuple[str, str | None]:
    db_url = os.environ.get("APP_DB_URL", "")
    if not db_url:
        return "DB: skipped (no APP_DB_URL)", None
    t0 = time.monotonic()
    try:
        import psycopg  # type: ignore

        with psycopg.connect(db_url, connect_timeout=5) as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            ms = int((time.monotonic() - t0) * 1000)
            cur.execute(
                """
                SELECT count(*) FILTER (WHERE state = 'active'),
                       count(*) FILTER (WHERE state = 'active' AND now() - query_start > interval '5 minutes' AND query NOT ILIKE '%pg_stat_activity%')
                  FROM pg_stat_activity
                 WHERE datname = current_database()
                """
            )
            active, stuck = cur.fetchone()
            if stuck and stuck > 0:
                alerts["db:stuck"] = f"Postgres has {stuck} active query(s) running > 5 minutes"

            coverage_line: str | None = None
            try:
                cur.execute(
                    """
                    WITH latest_panel AS (
                        SELECT DISTINCT ON (symbol) symbol
                          FROM app.cluster_stocks_panel_cache
                         WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
                    ),
                    latest_v AS (
                        SELECT DISTINCT ON (symbol) symbol
                          FROM app.stock_verdict
                         ORDER BY symbol, generated_at DESC
                    )
                    SELECT
                        (SELECT count(*) FROM latest_panel),
                        (SELECT count(*) FROM latest_panel p JOIN latest_v v ON v.symbol = p.symbol),
                        (SELECT count(*) FROM latest_panel p JOIN app.company_moat m ON m.symbol = p.symbol)
                    """
                )
                p_tot, p_ver, p_moat = cur.fetchone()
                cur.execute(
                    """
                    WITH latest_v AS (
                        SELECT DISTINCT ON (symbol) symbol, evidence
                          FROM app.stock_verdict
                         ORDER BY symbol, generated_at DESC
                    ),
                    latest_m AS (
                        SELECT symbol, cluster_metrics
                          FROM app.metrics_snapshot
                         WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.metrics_snapshot)
                    )
                    SELECT v.evidence, m.cluster_metrics
                      FROM latest_v v
                      JOIN latest_m m ON m.symbol = v.symbol
                     WHERE v.evidence IS NOT NULL AND v.evidence != '{}'::jsonb
                    """
                )
                drifted = sum(
                    1
                    for ev, live in cur.fetchall()
                    if ev and live and any(_metric_drifted(ev[k], live.get(k)) for k in ev if k in live)
                )
                v_pend = max(0, (p_tot or 0) - (p_ver or 0))
                m_pend = max(0, (p_tot or 0) - (p_moat or 0))
                coverage_line = (
                    f"Coverage: Verdicts {p_ver}/{p_tot} ({v_pend} pending, {drifted} drifted) | "
                    f"Moats {p_moat}/{p_tot} ({m_pend} pending)"
                )
            except Exception as ce:
                coverage_line = f"Coverage: unavailable ({ce})"

            return f"DB: OK ({ms}ms, active={active})", coverage_line
    except Exception as e:
        alerts["db:down"] = f"Postgres health check failed: {e}"
        return f"DB: ERROR ({e})", None


def check_server_and_pm2(prev_restarts: int | None) -> tuple[list[str], dict[str, str], int | None]:
    info: list[str] = []
    alerts: dict[str, str] = {}
    cur_restarts: int | None = None

    load1, load5, load15 = os.getloadavg()
    info.append(f"Load: {load1:.2f}/{load5:.2f}/{load15:.2f}")
    if load5 > 3.5:
        alerts["sys:load"] = f"High 5m CPU load: {load5:.2f}"

    usage = shutil.disk_usage("/")
    disk_pct = (usage.used / usage.total) * 100.0
    info.append(f"Disk: {disk_pct:.1f}% ({usage.free / (1024**3):.1f}G free)")
    if disk_pct > 85.0:
        alerts["sys:disk"] = f"High root disk usage: {disk_pct:.1f}%"

    meminfo = Path("/proc/meminfo")
    if meminfo.exists():
        avail_kb = None
        for line in meminfo.read_text().splitlines():
            if line.startswith("MemAvailable:"):
                avail_kb = int(line.split()[1])
                break
        if avail_kb is not None:
            avail_gb = avail_kb / (1024 * 1024)
            info.append(f"MemAvail: {avail_gb:.2f}G")
            if avail_gb < 1.0:
                alerts["sys:mem"] = f"Low available memory: {avail_gb:.2f} GiB"

    try:
        res = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=10)
        if res.returncode == 0:
            procs = json.loads(res.stdout or "[]")
            eq = next((pr for pr in procs if pr.get("name") == "equityroots"), None)
            if eq is None:
                alerts["pm2:missing"] = "PM2 process 'equityroots' not found"
                info.append("PM2: MISSING")
            else:
                env = eq.get("pm2_env", {})
                st = env.get("status", "unknown")
                restarts = int(env.get("restart_time", 0))
                rss_mb = round(eq.get("monit", {}).get("memory", 0) / (1024 * 1024))
                cur_restarts = restarts
                info.append(f"PM2: {st} ({rss_mb}MB, restarts={restarts})")
                if st != "online":
                    alerts["pm2:status"] = f"PM2 'equityroots' status is {st}"
                if rss_mb > 2500:
                    alerts["pm2:mem"] = f"PM2 'equityroots' high memory: {rss_mb} MB"
                if prev_restarts is not None and restarts > prev_restarts + 1:
                    alerts["pm2:restarts"] = f"PM2 'equityroots' restarted {restarts - prev_restarts}x since last check"
    except Exception as e:
        info.append(f"PM2: skipped ({e})")

    info.append(check_app_http(alerts))
    db_info, coverage_line = check_postgres(alerts)
    info.append(db_info)
    if coverage_line:
        info.append(coverage_line)
    return info, alerts, cur_restarts


def send_email(subject: str, message: str) -> None:
    subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "send-alert.py"),
            "--subject",
            subject,
            "--log-file",
            "/var/log/fundamental-monitor.log",
            "--tail",
            "60",
            "--message",
            message,
        ],
        check=False,
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-alert", action="store_true", help="Print report without sending email")
    ap.add_argument("--digest", action="store_true", help="Send daily summary digest email")
    args = ap.parse_args()

    prev_state: dict = {}
    if STATE_FILE.exists():
        try:
            prev_state = json.loads(STATE_FILE.read_text())
        except Exception:
            prev_state = {}

    prev_issues: dict[str, str] = prev_state.get("issues", {})
    prev_restarts: int | None = prev_state.get("pm2_restarts")

    now_str = datetime.fromtimestamp(time.time() + 5.5 * 3600, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S IST")
    results = [check_job(jid, lbl, path, max_h) for jid, lbl, path, max_h in JOBS]
    sys_info, active_issues, cur_restarts = check_server_and_pm2(prev_restarts)

    for r in results:
        if r.status in ("FAILED", "STALE"):
            active_issues[f"job:{r.job_id}"] = f"{r.status}: {r.label} — {r.detail}"

    print("=" * 88)
    print(f"🩺 EquityRoots Autonomous APM & Cron Monitor — {now_str}")
    print("  " + " | ".join(sys_info))
    print("-" * 88)
    for r in results:
        icon = {"OK": "✅", "FAILED": "❌", "STALE": "⚠️", "PENDING": "⏳"}[r.status]
        print(f"  {icon} {r.job_id:26s} | {r.status:7s} | {r.detail}")
    print("=" * 88)

    new_issues = {k: v for k, v in active_issues.items() if prev_issues.get(k) != v}
    recovered = {k: v for k, v in prev_issues.items() if k not in active_issues}

    STATE_FILE.write_text(
        json.dumps(
            {
                "updated_at": now_str,
                "pm2_restarts": cur_restarts,
                "issues": active_issues,
            },
            indent=2,
        )
    )

    if not args.no_alert:
        if new_issues:
            summary = "\n".join(f"- {v}" for v in active_issues.values())
            send_email(
                f"🚨 [EquityRoots APM] {len(active_issues)} Active Issue(s) Detected",
                f"Detected {len(active_issues)} active issue(s) on Finance-Server:\n{summary}",
            )
        elif recovered and not active_issues:
            rec_list = "\n".join(f"- Resolved: {v}" for v in recovered.values())
            send_email(
                "✅ [EquityRoots APM] All Systems Recovered",
                f"All previously reported issues have cleared:\n{rec_list}",
            )
        elif args.digest:
            ok_cnt = sum(1 for r in results if r.status == "OK")
            pend_cnt = sum(1 for r in results if r.status == "PENDING")
            send_email(
                f"☀️ [EquityRoots APM] Daily Health Digest — All Clear ({ok_cnt} OK, {pend_cnt} Pending)",
                " | ".join(sys_info),
            )

    return 1 if active_issues else 0


if __name__ == "__main__":
    raise SystemExit(main())

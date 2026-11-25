#!/usr/bin/env python3
"""cron-monitor.py — Unified log & server health monitor for all EquityRoots crons.

Scans all /var/log/fundamental-*.log files, checks latest run status and freshness,
checks server CPU/RAM/disk/PM2 health, writes a clean summary to stdout (logged to
/var/log/fundamental-monitor.log), and sends a deduplicated Resend email alert via
scripts/send-alert.py if any job fails, goes stale, or server resources degrade.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = Path("/tmp/fundamental-monitor-state.json")

# (id, label, log_path, max_age_hours or None if manual/infrequent)
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
    tail = read_tail(p)
    block = latest_run_block(tail)

    has_ok = "✅" in block or "completed successfully" in block.lower()
    has_fail = any(m in block for m in FAIL_MARKERS)

    if has_fail and not has_ok:
        err_line = next((ln.strip() for ln in reversed(block.splitlines()) if any(m in ln for m in FAIL_MARKERS)), "error in latest run")
        return JobStatus(job_id, label, "FAILED", age_h, err_line[:140])

    if max_age_hours is not None and age_h > max_age_hours:
        return JobStatus(job_id, label, "STALE", age_h, f"last run {age_h:.1f}h ago (limit {max_age_hours:.0f}h)")

    return JobStatus(job_id, label, "OK", age_h, f"last run {age_h:.1f}h ago")


def check_server_health() -> tuple[list[str], list[str]]:
    info: list[str] = []
    alerts: list[str] = []

    load1, load5, load15 = os.getloadavg()
    info.append(f"Load: {load1:.2f}, {load5:.2f}, {load15:.2f}")
    if load5 > 3.5:
        alerts.append(f"High 5m CPU load: {load5:.2f}")

    usage = shutil.disk_usage("/")
    disk_pct = (usage.used / usage.total) * 100.0
    info.append(f"Disk /: {disk_pct:.1f}% used ({usage.free / (1024**3):.1f} GiB free)")
    if disk_pct > 85.0:
        alerts.append(f"High disk usage on /: {disk_pct:.1f}%")

    meminfo = Path("/proc/meminfo")
    if meminfo.exists():
        avail_kb = None
        for line in meminfo.read_text().splitlines():
            if line.startswith("MemAvailable:"):
                avail_kb = int(line.split()[1])
                break
        if avail_kb is not None:
            avail_gb = avail_kb / (1024 * 1024)
            info.append(f"MemAvailable: {avail_gb:.2f} GiB")
            if avail_gb < 1.0:
                alerts.append(f"Low available memory: {avail_gb:.2f} GiB")

    try:
        res = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=10)
        if res.returncode == 0:
            procs = json.loads(res.stdout or "[]")
            eq = next((pr for pr in procs if pr.get("name") == "equityroots"), None)
            if eq is None:
                alerts.append("PM2 process 'equityroots' not found")
            else:
                st = eq.get("pm2_env", {}).get("status", "unknown")
                info.append(f"PM2 equityroots: {st}")
                if st != "online":
                    alerts.append(f"PM2 process 'equityroots' status is {st}")
    except Exception as e:
        info.append(f"PM2 check skipped: {e}")

    return info, alerts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-alert", action="store_true", help="Print report without sending email")
    args = ap.parse_args()

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    results = [check_job(jid, lbl, path, max_h) for jid, lbl, path, max_h in JOBS]
    sys_info, sys_alerts = check_server_health()

    print("=" * 80)
    print(f"🩺 EquityRoots Cron & Server Monitor — {now_str}")
    print("  " + " | ".join(sys_info))
    print("-" * 80)
    for r in results:
        icon = {"OK": "✅", "FAILED": "❌", "STALE": "⚠️", "PENDING": "⏳"}[r.status]
        print(f"  {icon} {r.job_id:26s} | {r.status:7s} | {r.detail}")
    print("=" * 80)

    active_issues: dict[str, str] = {}
    for r in results:
        if r.status in ("FAILED", "STALE"):
            active_issues[f"job:{r.job_id}"] = f"{r.status}: {r.label} — {r.detail}"
    for i, a in enumerate(sys_alerts):
        active_issues[f"sys:{i}"] = a

    prev_issues: dict[str, str] = {}
    if STATE_FILE.exists():
        try:
            prev_issues = json.loads(STATE_FILE.read_text())
        except Exception:
            prev_issues = {}

    new_issues = {k: v for k, v in active_issues.items() if prev_issues.get(k) != v}
    STATE_FILE.write_text(json.dumps(active_issues, indent=2))

    if new_issues and not args.no_alert:
        summary = "\n".join(f"- {v}" for v in active_issues.values())
        subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts" / "send-alert.py"),
                "--subject",
                f"🚨 [Finance-Server] Cron Monitor Alert ({len(active_issues)} issue(s))",
                "--log-file",
                "/var/log/fundamental-monitor.log",
                "--tail",
                "60",
                "--message",
                f"Detected {len(active_issues)} active issue(s):\n{summary}",
            ],
            check=False,
        )

    return 1 if any(r.status == "FAILED" for r in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())

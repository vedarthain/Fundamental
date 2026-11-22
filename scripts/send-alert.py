#!/usr/bin/env python3
"""send-alert.py — Send failure notification emails via Resend or SMTP.

Reads RESEND_API_KEY / ALERT_TO_EMAIL from environment or web/.env.local.
Designed to be invoked by cron trap handlers when jobs encounter non-zero exits.
"""
from __future__ import annotations

import argparse
import json
import os
import smtplib
import sys
import urllib.request
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_env() -> dict[str, str]:
    """Load configuration from environment and env files."""
    env = dict(os.environ)
    for p in (ROOT / "web" / ".env.local", ROOT / "web" / ".env", ROOT / ".env.local", ROOT / ".env"):
        if p.exists():
            for line in p.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k not in env:
                        env[k] = v
    return env


def send_via_resend_api(api_key: str, from_addr: str, to_addr: str, subject: str, html_content: str) -> bool:
    """Send email via Resend HTTP API."""
    url = "https://api.resend.com/emails"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "EquityRoots-Alerts/1.0",
    }
    payload = {
        "from": from_addr,
        "to": [to_addr],
        "subject": subject,
        "html": html_content,
    }
    req = urllib.request.Request(url, headers=headers, data=json.dumps(payload).encode("utf-8"))
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print(f"✓ Alert email sent via Resend API (ID: {data.get('id')})")
            return True
    except Exception as e:
        print(f"Resend API warning: {e}, falling back to SMTP...", file=sys.stderr)
        return False


def send_via_resend_smtp(api_key: str, from_addr: str, to_addr: str, subject: str, html_content: str) -> bool:
    """Send email via Resend SMTP server."""
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg.set_content(html_content, subtype="html")

    try:
        with smtplib.SMTP_SSL("smtp.resend.com", 465, timeout=15) as server:
            server.login("resend", api_key)
            server.send_message(msg)
            print("✓ Alert email sent via Resend SMTP")
            return True
    except Exception as e:
        print(f"Resend SMTP error: {e}", file=sys.stderr)
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Send failure alert email")
    parser.add_argument("--subject", default="🚨 [Finance-Server] Cron Job Failure Alert")
    parser.add_argument("--log-file", type=Path, default=None)
    parser.add_argument("--tail", type=int, default=60)
    parser.add_argument("--message", default="")
    args = parser.parse_args()

    env = load_env()
    api_key = env.get("RESEND_API_KEY", "")
    to_email = env.get("ALERT_TO_EMAIL", "deb5045ai@gmail.com")
    from_email = env.get("ALERT_FROM_EMAIL", "EquityRoots Alerts <onboarding@resend.dev>")

    if not api_key:
        print("Warning: RESEND_API_KEY not configured. Skipping alert email.", file=sys.stderr)
        return 0

    log_snippet = ""
    if args.log_file and args.log_file.exists():
        lines = args.log_file.read_text(errors="replace").splitlines()
        tail_lines = lines[-args.tail:] if len(lines) > args.tail else lines
        log_snippet = "\n".join(tail_lines)

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S IST")
    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 700px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #e53e3e; margin-top: 0;">🚨 Cron Job Failure Detected</h2>
      <p style="color: #4a5568; font-size: 14px;">A background scheduled job on <b>Finance Droplet</b> exited with an error.</p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #718096; width: 140px;"><b>Timestamp:</b></td><td>{now_str}</td></tr>
        <tr><td style="padding: 6px 0; color: #718096;"><b>Server:</b></td><td>DigitalOcean Droplet (168.144.158.66)</td></tr>
        {f'<tr><td style="padding: 6px 0; color: #718096;"><b>Log File:</b></td><td><code>{args.log_file}</code></td></tr>' if args.log_file else ''}
        {f'<tr><td style="padding: 6px 0; color: #718096;"><b>Error Details:</b></td><td>{args.message}</td></tr>' if args.message else ''}
      </table>

      {f'''
      <h3 style="color: #2d3748; margin-bottom: 8px; font-size: 15px;">Recent Log Output (Last {args.tail} lines):</h3>
      <pre style="background: #1a202c; color: #edf2f7; padding: 12px; border-radius: 6px; font-size: 12px; line-height: 1.4; overflow-x: auto; white-space: pre-wrap;">{log_snippet}</pre>
      ''' if log_snippet else ''}

      <p style="color: #a0aec0; font-size: 12px; margin-top: 20px; border-top: 1px solid #edf2f7; padding-top: 10px;">
        Automated alert sent by EquityRoots Fundamental Pipeline.
      </p>
    </div>
    """

    ok = send_via_resend_api(api_key, from_email, to_email, args.subject, html_body)
    if not ok:
        ok = send_via_resend_smtp(api_key, from_email, to_email, args.subject, html_body)

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

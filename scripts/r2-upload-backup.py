#!/usr/bin/env python3
"""Upload PostgreSQL backup archives to Cloudflare R2 and prune old remote copies."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
from botocore.config import Config


def main() -> int:
    files = [Path(arg) for arg in sys.argv[1:] if arg]
    if not files:
        print("Usage: r2-upload-backup.py <file1> [file2 ...]", file=sys.stderr)
        return 1

    endpoint = os.environ.get("R2_ENDPOINT", "").strip()
    bucket = os.environ.get("R2_BUCKET", "").strip()
    access_key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
    retention_days = int(os.environ.get("R2_RETENTION_DAYS", "5"))

    if not all([endpoint, bucket, access_key, secret_key]):
        print("R2 credentials not configured; skipping R2 upload.")
        return 0

    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )

    prefix = "postgres/"
    for path in files:
        if not path.is_file():
            print(f"Skipping missing file: {path}", file=sys.stderr)
            continue
        key = f"{prefix}{path.name}"
        size_mb = path.stat().st_size / (1024 * 1024)
        print(f"Uploading {path.name} ({size_mb:.1f} MB) -> r2://{bucket}/{key}...")
        s3.upload_file(str(path), bucket, key)
        print(f"✓ Uploaded {key}")

    # Prune backups older than retention_days
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    paginator = s3.get_paginator("list_objects_v2")
    stale_keys = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            if obj["LastModified"] < cutoff:
                stale_keys.append({"Key": obj["Key"]})

    if stale_keys:
        print(f"Pruning {len(stale_keys)} R2 backup(s) older than {retention_days} days...")
        s3.delete_objects(Bucket=bucket, Delete={"Objects": stale_keys})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Postgres connection helpers."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg.rows import dict_row

from .config import settings


@contextmanager
def golden_conn() -> Iterator[psycopg.Connection]:
    """Read-only connection to golden_db. Treat as read-only by convention."""
    with psycopg.connect(settings.golden_db_url, row_factory=dict_row) as conn:
        yield conn


@contextmanager
def app_conn() -> Iterator[psycopg.Connection]:
    """Writable connection to fundamental_app."""
    with psycopg.connect(settings.app_db_url, row_factory=dict_row) as conn:
        yield conn

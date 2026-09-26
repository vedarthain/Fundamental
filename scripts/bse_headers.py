"""
bse_headers.py — the one header set that api.bseindia.com currently accepts.

WHY THIS FILE EXISTS

On 2026-09-26 `refresh-announcements` failed with HTTP 403 on the very first
request. Three scripts — fetch-announcements.py, fetch-corporate-actions.py,
fetch-news.py — each carried their OWN copy of the same header dict, so BSE's
edge change broke all three at once and a fix applied to one would have left
the other two dead until their next scheduled run noticed. The headers live
here now: the next time BSE tightens, it is one edit, not three.

WHAT CHANGED AT BSE

The previous set (User-Agent + Referer + Origin + Accept + Accept-Language)
now returns an Akamai "Access Denied" page. Measured from a residential IP as
well as from GitHub Actions, so it is not an IP block — the edge started
requiring the headers a real Chrome sends alongside a fetch():

  * the `Sec-Fetch-Dest/Mode/Site` trio, and
  * the `sec-ch-ua*` client hints, and
  * an `Accept-Encoding` header to be PRESENT (any value; urllib sends none
    by default, which is why Python was singled out and a browser was not).

Measured 2026-09-26 against /api/ListofScripData/w, 5 consecutive calls each:

  old set                                   403  403  403
  + Sec-Fetch trio only                     403
  + sec-ch-ua trio only                     403
  + Accept-Encoding only                    403
  all three groups together                 200  200  200  200  200

None of the three is sufficient alone — that is why this is recorded rather
than left for the next person to rediscover one header at a time.

`Accept-Encoding: gzip` and not `gzip, deflate, br`: the callers decompress
gzip and nothing else, so advertising brotli would trade a 403 for a decode
error. BSE honours it and returns `content-encoding: gzip`.
"""
from __future__ import annotations

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)

BSE_HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    # Must be present. Callers handle gzip only — see the docstring.
    "Accept-Encoding": "gzip",
    "Referer": "https://www.bseindia.com/",
    "Origin": "https://www.bseindia.com",
    "sec-ch-ua": '"Chromium";v="140", "Not=A?Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
}

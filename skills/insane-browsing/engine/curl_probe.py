from __future__ import annotations

import ipaddress
import socket
import time
from typing import Iterable, Mapping, Protocol
from urllib.parse import urljoin, urlparse

from .referers import REFERER_STRATEGIES
from .result_schema import Attempt
from .validators import Verdict, validate

# Max redirect hops to follow before giving up (matches curl's default).
_MAX_REDIRECTS = 30


def _is_blocked_host(host: str) -> bool:
    """True if `host` resolves to a non-routable / cloud-metadata address.

    Blocks the standard SSRF target classes: private (RFC1918), loopback
    (127/8, ::1), link-local (169.254/16 incl. the 169.254.169.254 metadata
    endpoint, and fe80::/10), plus reserved/unspecified as a safety belt. A
    host is blocked if ANY of its resolved addresses falls in those classes.
    """
    if not host:
        return True
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        # Unresolvable host: refuse rather than follow into the unknown.
        return True
    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return True
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_unspecified
            or ip.is_multicast
        ):
            return True
    return False


class _CookieItem(Protocol):
    name: str
    value: str


class _CookieJar(Protocol):
    jar: Iterable[_CookieItem]


class ProbeResponse(Protocol):
    status_code: int
    text: str
    url: str
    cookies: _CookieJar | Mapping[str, str]


def _curl_probe(
    url: str, *, impersonate: str, referer: str, timeout: int = 20
) -> tuple[ProbeResponse | None, str | None]:
    try:
        from curl_cffi import requests as cffi_requests
    except ImportError:
        return None, "curl_cffi not installed"

    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    if referer:
        headers["Referer"] = referer

    # Manual redirect loop: classify every request target's host BEFORE issuing
    # the fetch — the initial caller-supplied URL and each redirect Location
    # alike — so an attacker-steered (or simply malicious) URL cannot reach
    # internal / cloud-metadata endpoints (SSRF). curl auto-follow is disabled;
    # each Location is resolved against the current URL and re-checked at the top
    # of the next iteration.
    current_url = url
    try:
        for _ in range(_MAX_REDIRECTS + 1):
            host = urlparse(current_url).hostname or ""
            if _is_blocked_host(host):
                return None, f"ssrf_blocked:{host}"
            resp = cffi_requests.get(
                current_url,
                impersonate=impersonate,
                headers=headers,
                timeout=timeout,
                allow_redirects=False,
            )
            if resp.status_code not in (301, 302, 303, 307, 308):
                return resp, None
            location = resp.headers.get("location")
            if not location:
                return resp, None
            current_url = urljoin(current_url, location)
        return None, "too_many_redirects"
    except cffi_requests.exceptions.RequestException as e:
        return None, f"{type(e).__name__}:{str(e)[:200]}"


def run_attempt(
    url: str,
    *,
    transform_name: str,
    impersonate: str,
    referer_name: str,
    success_selectors: list[str] | None,
    known_bad_sizes: list[int] | None,
    timeout: int,
    phase: str,
) -> tuple[Attempt, ProbeResponse | None]:
    referer_url = REFERER_STRATEGIES.get(referer_name, REFERER_STRATEGIES["none"])(url)
    started_at = time.time()
    resp, err = _curl_probe(url, impersonate=impersonate, referer=referer_url, timeout=timeout)
    elapsed = round(time.time() - started_at, 3)

    att = Attempt(
        phase=phase,
        executor="curl_cffi",
        url=url,
        url_transform=transform_name,
        impersonate=impersonate,
        referer=referer_name,
        elapsed_s=elapsed,
    )

    if err or resp is None:
        att.error = err or "no response"
        att.verdict = Verdict.UNKNOWN.value
        return att, None

    vr = validate(resp, success_selectors=success_selectors, known_bad_sizes=known_bad_sizes)
    att.status = vr.status
    att.body_size = vr.body_size
    att.verdict = vr.verdict.value
    att.reasons = vr.reasons
    return att, resp

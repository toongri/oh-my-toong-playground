from __future__ import annotations

from urllib.parse import urlsplit


def _self_root(url: str) -> str:
    parsed = urlsplit(url)
    # Use hostname (strips userinfo and port) instead of netloc to prevent
    # leaking basic-auth credentials into the Referer header (F16).
    host = parsed.hostname or ""
    if parsed.port:
        host = f"{host}:{parsed.port}"
    return f"{parsed.scheme}://{host}/"


REFERER_STRATEGIES = {
    "self_root": _self_root,
    "google_search": lambda _url: "https://www.google.com/",
    "none": lambda _url: "",
}

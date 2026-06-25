from __future__ import annotations

SQL_LIKE_ESCAPE = "\\"

# Hardcoded denylist of common multi-label public suffixes (eTLD spanning >1 label).
# A bare TLD ("com") is caught by the single-label check; these need the explicit set
# so "co.uk" is rejected while a registrable domain under it ("example.co.uk") passes.
# lazy: short hand-curated list, not the full PSL; extend if a needed suffix is missing.
_PUBLIC_SUFFIXES = frozenset({
    "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "net.uk", "sch.uk", "ltd.uk", "plc.uk",
    "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
    "co.kr", "or.kr", "ne.kr", "re.kr", "pe.kr", "go.kr", "mil.kr", "ac.kr", "hs.kr",
    "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp", "ad.jp", "ed.jp", "gr.jp", "lg.jp",
    "co.nz", "net.nz", "org.nz", "govt.nz", "ac.nz",
    "com.br", "net.br", "org.br", "gov.br",
    "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
    "co.in", "net.in", "org.in", "gov.in",
    "co.za", "org.za", "gov.za",
    "com.sg", "com.hk", "com.tw", "com.mx", "com.tr", "co.id",
})


class CookieDomainError(ValueError):
    pass


def normalize_cookie_domain(domain: str) -> str:
    normalized = domain.strip().lower().lstrip(".")
    if not normalized:
        raise CookieDomainError("cookie domain must not be empty")
    # Fail closed against authentication-boundary bypass: a bare TLD ("com") or a bare
    # public suffix ("co.uk") would LIKE-match every site under it. Require a registrable
    # eTLD+1 (at least one label in front of the suffix).
    if "." not in normalized or normalized in _PUBLIC_SUFFIXES:
        raise CookieDomainError(
            f"cookie domain must be a registrable domain, not a public suffix: {normalized!r}"
        )
    return normalized


def escape_sql_like(value: str) -> str:
    return (
        value
        .replace(SQL_LIKE_ESCAPE, SQL_LIKE_ESCAPE * 2)
        .replace("%", f"{SQL_LIKE_ESCAPE}%")
        .replace("_", f"{SQL_LIKE_ESCAPE}_")
    )


def domain_where_clause(column: str, domains: list[str]) -> tuple[str, list[str]]:
    normalized_domains = sorted({normalize_cookie_domain(domain) for domain in domains})
    if not normalized_domains:
        raise CookieDomainError("at least one cookie domain is required")

    clauses: list[str] = []
    params: list[str] = []
    for domain in normalized_domains:
        clauses.append(
            f"({column} = ? OR {column} = ? OR {column} LIKE ? ESCAPE '{SQL_LIKE_ESCAPE}')"
        )
        params.extend([domain, f".{domain}", f"%.{escape_sql_like(domain)}"])
    return " OR ".join(clauses), params

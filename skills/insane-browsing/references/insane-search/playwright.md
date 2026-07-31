# Playwright — 로컬 온디맨드 Real Chrome

> JS 렌더링 / JS 챌린지 사이트를 위한 유일한 브라우저 폴백. **상주 브라우저 세션은
> 없다** — WAF 프로파일의 `capabilities_needed` 태그가 필요를 판단하면 그때만
> 로컬 Chrome 프로세스를 온디맨드로 띄우고, HTML을 받으면 즉시 종료한다.

## 왜 로컬 real Chrome인가

| 실행기 | TLS 스택 | 적합 WAF | 한계 |
|--------|----------|----------|------|
| `engine/templates/playwright_real_chrome.js` (로컬 Node + `channel:'chrome'`) | 시스템 설치 실제 Chrome | Cloudflare 기본, Akamai Bot Manager, PerimeterX, DataDome 강화 설정까지 단일 경로로 커버 | Node + Chrome 시스템 설치 필요 |

번들 Chromium(BoringSSL) 기반 자동화는 TLS 지문이 진짜 Chrome과 달라 Akamai
Bot Manager 등 TLS-감지형 WAF에 **즉시 탐지됨**(293 바이트 Access Denied 또는
즉시 403). `channel:'chrome'`로 시스템 설치 Chrome 바이너리를 구동하면 TLS
스택이 진짜 Chrome과 동일해져, JS 챌린지가 약한 사이트부터 TLS-감지형 강화
WAF까지 같은 경로로 통과한다.

`engine/executor.py`가 프로파일 태그를 보고 이 경로를 자동 기동하므로, 스킬
외부에서 이 선택을 의식할 필요는 없다.

## 의존성 (최초 1회)

```bash
# Node (시스템 설치)
node -v   # v18+ 권장

# Playwright + stealth 플러그인
npm i -g playwright playwright-extra puppeteer-extra-plugin-stealth

# 시스템 Chrome 바이너리 (번들 Chromium 아님)
npx playwright install chrome
```

## 호출 (engine 내부)

```python
from engine.executor import run_playwright_fallback

attempt, html = run_playwright_fallback(
    "https://example.com/path",
    profile_id="akamai_bot_manager",
    success_selectors=["article"],
    device_class="desktop",   # "desktop" | "mobile" | "auto"
)
```

내부에서 `engine/templates/playwright_real_chrome.js` 또는 `playwright_mobile_chrome.js`를 Node로 실행하고 HTML을 받아온다. 템플릿은 **URL과 셀렉터 파라미터만** 받으며 사이트별 분기가 없다.

## 데스크톱 템플릿 (`playwright_real_chrome.js`)

```js
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const ctx = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',        // ← 핵심: 번들 Chromium 아닌 실제 Chrome
  headless: false,          // Akamai는 headless 탐지. headful 필요.
  viewport: { width: 1366, height: 900 },
});
```

## 모바일 템플릿 (`playwright_mobile_chrome.js`)

```js
const { chromium, devices } = require('playwright-extra');
const iPhone = devices['iPhone 13 Pro'];

const ctx = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',          // TLS는 실제 Chrome
  ...iPhone,                  // UA/viewport/isMobile/hasTouch 자동 주입
  headless: false,
});
```

**주의**: `channel:'chrome'` + `devices[...]` 조합은 TLS 핑거프린트를 Chrome으로 유지하면서 HTTP 레이어(UA/viewport)만 모바일로 바꾼다. WAF가 실제 Chrome으로 인식해서 관대한 경우가 많다.

## 선택 규칙 (자동)

`engine/waf_profiles.yaml`의 `capabilities_needed` 태그가 결정한다:

| 태그 조합 | 선택 실행기 | 대표 케이스 |
|----------|-------------|-------------|
| `needs_real_tls_stack` + `needs_js_exec` | `playwright_real_chrome.js` | Akamai Bot Manager |
| `needs_js_exec` only | `playwright_real_chrome.js` | Cloudflare Turnstile 등 JS 챌린지 |
| `needs_real_tls_stack` only | `playwright_real_chrome.js` | 일부 DataDome 설정 |
| 둘 다 없음 | curl 체인에서 해결. Playwright 안 씀 | F5 BIG-IP (TLS만 우회 필요) |

`device_class="mobile"`이 지정되면 real_chrome → mobile 변종으로 swap.

## 공통 검증

최종 HTML은 `engine/validators.py:validate()`로 재검증한다. 즉 Playwright가 HTML을 받아와도 **챌린지 페이지 또는 빈 SPA면 여전히 CHALLENGE 판정**. 자동으로 다음 조합이나 failure 보고로 이어진다.

## 디버깅 팁

- `profileDir`를 고정 경로로 두면 세션·쿠키가 유지되어 재시도 빠름 (`/tmp/.insane_pw_profile`)
- Akamai 재시도가 잦으면 `profileDir`를 삭제해 fresh 상태로 리셋
- 실패 시 `result.trace`의 `error` 필드에 Node stderr 200자가 포함됨
- 내부 API 엔드포인트를 찾아야 하는 정찰 작업처럼 HTML 반환만으로 부족한 경우엔 Tier 3 `agent-browser`(대화형 real Chrome 세션)로 전환한다 — [`../chrome-stealth.md`](../chrome-stealth.md) 참고

## 사이트 예시 (독자 이해용, 코드 분기 근거 아님)

> 이 섹션은 **설명 목적**이며 `engine/**` 코드에는 반영되지 않는다.

- **Cloudflare 기본 챌린지**: 로컬 real Chrome으로 충분
- **Akamai Bot Manager**: 로컬 real Chrome 필수. TLS-UA 일치가 핵심 (번들 Chromium은 즉시 탐지됨)
- **SSR 블로그 플랫폼**: curl_cffi safari만으로 HTML 수신. Playwright 불필요
- **검색 결과 JS 렌더링 SPA**: 로컬 real Chrome으로 로드 후 HTML 파싱, 정찰이 필요하면 `agent-browser`로 수동 전환

실제 라우팅은 프로파일 태그가 결정한다. 위 예시는 참고일 뿐 코드 분기 근거로 쓰지 않는다.

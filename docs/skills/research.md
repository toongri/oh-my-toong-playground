한국어 | [English](research.en.md)

---

# 리서치 스킬

oh-my-toong의 리서치 스킬은 판단을 내리기 전에 사실을 포화 수준으로 수집하고 검증합니다. 리서치 축은 하나의 엔진(`ultraresearch`)이 두 가지 posture(자세)로 동작하는 구조이며, 인증이나 JS 렌더링이 필요해 표면적 웹 검색으로는 닿지 않는 소스를 뚫어야 할 때 `insane-browsing`이 그 안에서 워커로 붙습니다.

---

## 핵심 요약

| 스킬 | 역할 한 줄 요약 | 주요 입력 | 언제 사용하나 |
|------|----------------|-----------|---------------|
| `ultraresearch` | 포화-리서치 오케스트레이션 — 분해→포화 수집→수렴→검증→종합을 하나의 엔진으로 수행 | 리서치 질문, 또는 실행 전 사실 확인이 필요한 결정 | 사용자가 명시적으로 깊은 리서치를 요구하거나, deep-interview 등이 판단에 앞서 사실을 그라운딩해야 할 때 |
| `insane-browsing` | 인증·JS 렌더링이 필요한 소스에 접근하는 3단계 브라우징 엔진 | 접근이 막힌 URL, `ultraresearch`의 Phase 0 Browsing 게이트 | `ultraresearch` 내부에서 Browsing 게이트가 `yes`일 때 워커로 디스패치 — 직접 호출은 드묾 |

---

## 스킬 상세

### ultraresearch

**목적**: 하나의 포화-리서치 엔진을 두 가지 posture로 운용합니다. 사용자가 명시적으로 리서치를 요구하는 **explicit research posture**와, deep-interview 등 다른 스킬이 판단에 앞서 사실을 그라운딩하려고 호출하는 **pre-work CLEAR posture**입니다. 어느 posture든 분해→포화→수렴→검증→종합이라는 동일한 엔진을 공유합니다.

**엔진 개요 — 5단계**:
1. **Phase 0 (분해)** — 질문을 3개 이상의 직교 축으로 분해하고, posture와 워커-플로어 tier를 정합니다. 단, deep-interview가 인터뷰 도중 사실 하나만 그라운딩해달라고 호출하는 **CLEAR Scoped 단일-사실 경로**는 예외입니다 — 축을 억지로 3개 이상으로 쪼개지 않고 **단일 축**(그 사실 하나)으로만 분해하며, Phase 1도 워커 하나만 띄웁니다.
2. **Phase 1 (포화 웨이브)** — Phase 0에서 나온 모든 축을 한 응답 안에서 동시에 워커로 발사합니다.
3. **Phase 2 (EXPAND 수렴 루프)** — 웨이브마다 배리어(barrier)에서 전 워커의 결과를 모아 확장할지 멈출지 판단합니다.
4. **Phase 3 (분리 검증 패스)** — 수집한 주장 중 다툼이 있는 것만 별도 패스에서 검증합니다.
5. **Phase 4 (종합)** — 수렴 후 단일 스냅샷에서 산출물을 씁니다.

워커는 explore·librarian·insane-browsing 중 하나로, **foreground Agent로 한 응답에 전수 디스패치**되고 배리어에서 함께 수집됩니다. OMT는 Agent 태스크의 background 디스패치를 금지하므로(`rules/tool-usage-policy.md`), 이 엔진은 비동기 스웜 대신 **동기 배치 웨이브**로 동작합니다. 워커는 읽기 전용 수집자입니다 — 저널이나 세션 파일을 직접 쓰지 않고, 발견한 내용과 `## EXPAND` 리드만 텍스트로 반환합니다. 저널·claim-graph를 비롯한 모든 아티팩트는 전부 오케스트레이터 혼자 씁니다.

**출력 계약** (explicit research posture 기준 — pre-work CLEAR는 REPORT를 쓰지 않고 grounded facts를 호출자에게 바로 반환합니다): `REPORT.md`가 최종 산출물(SSOT, source of truth)이고, `REPORT.html`은 그것을 외부 CSS·JS·폰트·이미지 없이 통째로 담은 단일 자기완결 렌더 사본입니다. PDF 등 별도 렌더는 만들지 않으며, 이를 위한 신규 외부 의존성도 추가하지 않습니다. `REPORT`의 목차는 고정된 섹션 목록이 아니라 **Phase 0에서 분해한 축 그 자체**에서 유도됩니다 — 축이 곧 목차이므로 REPORT는 사용자가 실제로 물은 것에 대응합니다.

`SYNTHESIS.md`는 최종 산출물이 아니라 **인용 SSOT** 역할을 하는 중간물입니다. 요약·테마별 발견·코드베이스 발견·출처 순위·검증된 주장·모순·갭·확장 추적이라는 8섹션 구조를 유지하며, 감사(audit) 축 — "무엇을 믿을 수 있나" — 을 담당합니다. 이 8섹션은 전부 신뢰성을 다룰 뿐 "사용자가 요구한 것이 무엇인가"를 다루는 섹션이 없었고, 실제로 사용자가 스키마나 API를 물었는데 문서가 좌표(`file:line`)만 반환하는 문제가 있었습니다. 그래서 감사 축(`SYNTHESIS.md`)과 참조 축(`REPORT.*`)을 분리했습니다 — 둘은 서로를 대체하지 않고 갈라집니다.

작성 순서는 `SYNTHESIS.md` → `REPORT.md` → `REPORT.html` → (pre-work posture라면) handoff이며, 전부 수렴 이후 **단일 스냅샷**에서 한 번에 씁니다. 웨이브가 진행될 때마다 누적해서 쓰지 않습니다 — 늦은 웨이브가 앞서 "검증됨"으로 봤던 주장을 뒤집을 수 있기 때문입니다.

**검출 축**: Phase 0은 워커를 발사하기 **전에** 이번 리서치가 답해야 할 요구 항목을 사전선언합니다. 요구 항목의 출처는 Phase 0 축 분해 그 자체이며, 별도의 질문 분류기를 따로 두지 않습니다. 사전선언 시점이 중요한 이유는 요구 항목을 사후에 발명하면 그 항목의 누락이 침묵 속에 사라지기 때문입니다.

Phase 4에는 요구 항목별 **커버리지 게이트**가 있으며, 위 출력 계약과 마찬가지로 explicit research posture에만 적용됩니다 — REPORT 자체를 쓰지 않는 pre-work CLEAR에는 표가 판정할 대상이 없고, 그 자리는 호출한 스킬의 계약이 대신합니다. `REPORT.md` 초안이 나온 뒤 — 게이트가 판단할 대상이 그때 처음 생기므로 — 요구 항목마다 한 행씩 표를 만들고, Status는 `covered`, `not applicable: <이 질의가 애초에 요구하지 않은 이유>`, `uncovered: <요구됐지만 재료를 못 모은 이유>` 세 값만 허용합니다. 질의가 애초에 요구하지 않은 항목이면 `not applicable`이고, 질의는 요구했는데 리서치가 재료를 못 모았다면 `uncovered`입니다 — 이 둘을 뒤섞으면 안 됩니다. 둘을 합치면 진짜 리서치 갭이 "애초에 안 물어본 항목"으로 위장되는데, 그 위장을 막는 것이 이 게이트의 존재 이유입니다. **빈 칸은 결함**입니다. 저널에 재료가 이미 있는데 `REPORT.md`에 못 들어간 경우, 웨이브를 다시 띄우지 않고 그 자리에서 `REPORT.md`를 즉시 고쳐 빈칸을 메웁니다 — 재수집이 아니라 기록의 문제이기 때문입니다. 이 자체 점검과 그에 따른 수정은 HTML 렌더와 최종 채팅 응답이 나가기 전에 끝냅니다.

이 계약도 커버리지 게이트와 마찬가지로 explicit research posture에 한정됩니다 — pre-work CLEAR는 채팅 메시지가 아니라 호출한 스킬에게 사실을 반환하므로 이 규칙이 적용될 자리가 없습니다. 최종 채팅 응답은 **커버리지 표 + 진입점 하나**(`REPORT.md` 경로)입니다. 산출물이 무엇이 있는지 나열하는 인벤토리가 아니라, 무엇을 답했는지 보여주는 요구 대조표입니다.

**나머지 계약**:
- 검증된 주장의 유일한 allowlist는 **claim-graph 5기준 게이트**(독립 출처 도메인 2개 이상, 독립 관찰 그룹 2개 이상, 반박 counter-search 1회, 1차 출처 뒷받침, 명시적 시점 증거)를 통과한 것뿐입니다.
- 수렴 정지 규칙은 **minimum-2 웨이브 플로어**를 먼저 채운 뒤, 미확인 리드 0개 / 연속 3회 빈 웨이브 / 깊이 5 중 하나가 되면 멈춥니다. 단, 위 CLEAR Scoped 단일-사실 경로는 이 플로어에서 **면제**되어, 사실에 답하는 단일 웨이브로 즉시 수렴합니다 — 면제되는 것은 플로어뿐이며, EXPAND 수렴 루프와 주장 검증 자체는 규모만 축소된 채 그대로 적용됩니다.
- **gatherer ≠ verifier** — 검증은 분리된 패스이며, 수집 워커가 자기 주장을 스스로 검증됐다고 인증할 수 없습니다. 코드 형태 주장은 실행된 코드로, 그 외 주장은 oracle의 1차 출처 재확인으로 검증합니다.
- 복잡도 tier(Scoped / Complex / Architecture / explicit `/ultraresearch`)에 따라 워커 파견 수의 하한을 정한 floor 표가 존재합니다.

**언제 사용하나**: 사용자가 "ultraresearch" 또는 "/ultraresearch"로 명시적으로 리서치를 요구할 때, 또는 deep-interview처럼 판단하기 전에 사실을 그라운딩해야 하는 스킬이 이 엔진을 호출할 때. 단순 질문이나 디버깅, 평소 구현 컨텍스트 수집에는 활성화되지 않습니다.

---

### insane-browsing

**목적**: 인증이 걸려 있거나 JavaScript로 렌더링돼 표면적 웹 검색·fetch로는 닿지 않는 소스에 접근하는 3단계(tier) 브라우징 엔진입니다. Tier 1 헤드리스 추출(WAF 우회) → Tier 2 플랫폼 전용 리더(중국·소셜 플랫폼 등) → Tier 3 Chrome stealth 실제 조작 순으로 값싼 tier부터 에스컬레이션합니다.

**ultraresearch와의 관계**: `ultraresearch`의 Phase 0 Browsing 게이트가 `yes`로 설정된 경우에만 워커로 디스패치됩니다 — 표면적 웹 결과만으로 충분하면 이 스킬은 건너뜁니다.

**출처**: fivetaku/insane-search(MIT)를 벤더링한 스킬입니다.

**언제 사용하나**: 대부분 `ultraresearch` 내부에서 자동으로 호출됩니다. 막힌 사이트를 직접 뚫거나, 로그인 세션·스크린샷·폼 조작이 단독으로 필요할 때는 직접 호출할 수도 있습니다.

---

## 스킬 선택 가이드

```
리서치가 필요한 상황인가?
  |-- 사용자가 명시적으로 리서치를 요구 ("ultraresearch", "/ultraresearch") -> ultraresearch (explicit research posture)
  |-- deep-interview 등 다른 스킬이 판단 전 사실 확인이 필요           -> ultraresearch (pre-work CLEAR posture)
  |-- 단순 질문·디버깅·일상적 구현 컨텍스트 수집                       -> 이 스킬 아님 (평소처럼 답변)

ultraresearch를 실행하면:
  Phase 0 Browsing 게이트가 yes일 때만 insane-browsing이 워커로 붙습니다.
  게이트가 no이면 insane-browsing은 이번 런에서 전혀 호출되지 않습니다.
```

---

## 참고 자료

- [README](../../README.md) — 프로젝트 개요
- [핵심 파이프라인 스킬](./core-pipeline.md) — deep-interview, prometheus, sisyphus
- [리뷰 & 품질 스킬](./review-quality.md) — code-review, qa
- [저작 스킬](./authoring.md) — 문서·슬라이드 생성
- [지식 그래프 & Pins](./knowledge-graph-pins.md) — Graphiti, Pin 스킬
- [유틸리티 & 개인화](./utilities-personal.md) — 설정, 단축키, 기타

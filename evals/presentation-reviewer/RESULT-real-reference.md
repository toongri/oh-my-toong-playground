# GREEN — 실제 레퍼런스 검증 (rental-chokepoint 픽스처)

첫 검증(`RESULT.md`, coupon-reclaim)은 합성 픽스처 n=1에 RED 경로만 재서, "리뷰어가
결함 없는 산출물에 헛경보(false positive)를 내지 않는가"(APPROVE 경로)와 "실제 레퍼런스에서
동작하는가"를 재지 못했다. 이 기록이 그 두 갭을 닫는다.

## 원본 — 실제 병합 PR

`fixtures/rental-chokepoint/source.md`는 **algocare-home 실제 병합 PR #1592**
(`refactor/rental-status-transition-unification`)의 설계 문서와 최종 구현 코드
(`RentalOrderStatusService.transition`)에서 사실만 발췌한 SSOT다. 합성이 아니라 실제
도메인 변경(렌탈 주문 상태 전이 chokepoint 일원화 + side-effect 멱등성)이라, 실제 발표가
가지는 축약·관용 표현·개념 밀도를 담는다.

## 방법

- 실제 리뷰어 프롬프트(`agents/presentation-reviewer.md`, 96줄)를 그대로 따르게 한
  **심은 결함을 모르는 fresh 에이전트**에게 세 입력(presentation / source / reader_persona)을 준다.
  reader_persona = "무맥락 동료/팀리드 — 이 페이지만으로 무엇을·왜·주의점을 이해".
- 두 발표를 만든다:
  - `presentation-faithful.md` — 원본에 충실하고 개념을 페르소나 눈높이로 소개한 발표.
  - `presentation-defective.md` — 같은 발표에 **실제 이격 2개 주입**: (a) side-effect를 chokepoint가
    소유·트랜잭션 내 원자 실행한다고 서술(원본은 소유 안 함, 호출자가 반환 후 실행), (b) admin이
    `validate: true`로 FSM 검증을 거친다고 서술(원본은 admin=`validate: false` 자유 전이).

## 결과

| 경로 | 입력 | rep | 판정 | 판단 |
|---|---|---|---|---|
| RED | defective | 2 | **2/2 REQUEST_CHANGES** | 주입한 이격 3개(소유·원자성·admin validate)를 매 rep 원본 대조 인용으로 포착 |
| APPROVE(clean) | faithful | 3 | **3/3 APPROVE** | 결함 없는 발표에 헛경보 0건 |

### 리뷰어가 오히려 내 픽스처를 교정함 (rubber-stamp도 환각도 아님)

APPROVE 경로 첫 실행 3 rep은 전부 REQUEST_CHANGES를 냈는데, **모두 정당한 true positive**였다.
내 "충실한" 픽스처에 원본이 뒷받침하지 않는 문구가 2개 있었다:

1. 검증 절의 "chokepoint 단위 테스트(검증 on/off, 종료 사유 양방향, 이력 생성)" — 당시 source
   번들에 없던 세부(실제 PR §7엔 있으나 압축하며 누락).
2. `progressStatus` 설명의 "주문 접수→서명→결제→활성→해지" — 접수·서명은 source에 없는 창작.

3 rep이 **정확히 이 둘만** 인용과 함께 잡았고, 그 외 어떤 헛것도 지어내지 않았다. 즉 인용-대조
규율을 엄격히 지키며, 발표가 원본보다 부정확할 때 그것을 정확히 짚는다. source.md에 실제 §7
테스트 전략을 채우고 gloss의 창작 상태를 제거해 픽스처를 진짜 source-grounded로 만든 뒤 재실행한
결과가 위 표의 3/3 APPROVE다.

## 판정

- **APPROVE 경로(false positive) 갭 닫힘** — 완전히 원본에 근거한 발표엔 3/3 APPROVE.
- **RED 경로** — 실제 PR 기반 발표의 이격도 2/2로 포착.
- **rubber-stamp/환각 아님** — 모든 finding이 산출물+원본 인용으로 근거. 픽스처의 미세한 미지원
  문구까지 일관 포착(3/3).

## 재현

```
presentation-reviewer 프롬프트(agents/presentation-reviewer.md)를 fresh 에이전트에 실어
세 입력을 준다:
- APPROVE 경로: presentation=fixtures/rental-chokepoint/presentation-faithful.md
- RED 경로:     presentation=fixtures/rental-chokepoint/presentation-defective.md
- 공통:         sources=fixtures/rental-chokepoint/source.md
               reader_persona="무맥락 동료/팀리드 — 이 페이지만으로 무엇을·왜·주의점 이해"
```

**통과 기준:** faithful → APPROVE(헛경보 없음), defective → REQUEST_CHANGES(주입 이격 2개를
산출물+원본 인용으로 포착).

## 아직 재지 않은 것

- **호출자별 원본 번들 조립 품질** — 이 픽스처도 원본을 직접 줬다. 실제 대조 품질은 각
  스킬(explain-diff·deep-interview·qa·prometheus)이 diff/플랜/스펙/evidence를 얼마나 풍부하게
  조립해 넘기느냐에 달리며, 그 조립은 각 스킬 문서의 몫이다. 이 eval은 리뷰어 프롬프트만 잰다.

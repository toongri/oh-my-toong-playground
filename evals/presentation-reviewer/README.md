# presentation-reviewer 측정 기록

`agents/presentation-reviewer.md`가 산출물을 원본과 대조해 결함을 잡는지 검증하는
재현 가능한 픽스처. 이 트리는 **배포되지 않는다**(`sync.yaml` 컴포넌트 카테고리 밖).

## 왜 이 에이전트가 필요한가 (RED — 구조적)

explain-diff·deep-interview·qa·prometheus는 각자 산출물의 **내부 구조**를 검사한다
(judge R-항목·구조 검사·self-audit). 그러나 **산출물을 원본(diff·플랜·스펙·evidence)과
대조해 거짓·이격·설명 누락을 잡는 주체는 지금까지 없었다.** 그래서 원본과 어긋난 발표가
내부 구조 검사를 전부 통과하고도 독자에게 틀린 것을 가르칠 수 있었다 — 이것이 RED다.

## 픽스처 — `fixtures/coupon-reclaim/`

`source.md`(원본 SSOT)와 `presentation.md`(산출물)에 **결함 3개를 심었다**:

| 축 | 심은 결함 | 원본 | 산출물 |
|---|---|---|---|
| 거짓 (fabrication) | 재시도 횟수 | 최대 3회 | "최대 5회" |
| 이격 (discrepancy) | 의존 방향 | order → coupon 단방향 | "coupon 도메인이 order 도메인을 호출" |
| 설명 부족 (introduce) | 코드 식별자 | (없음) | `CouponReclaimSaga` — 소개 없이 등장 |

## 재현 (GREEN)

`presentation-reviewer` 에이전트(또는 그 프롬프트를 실은 범용 에이전트)에게 세 입력을 준다:

- presentation: `fixtures/coupon-reclaim/presentation.md`
- sources: `fixtures/coupon-reclaim/source.md`
- reader_persona: "무맥락 동료/팀리드 — 이 페이지만으로 무엇을·왜·주의점을 이해"

**통과 기준:** 판정 `REQUEST_CHANGES`, 그리고 세 결함(거짓 5회·이격 방향·미소개 `CouponReclaimSaga`)을
각각 산출물 인용 + 원본 대조로 finding에 담아야 한다. 하나라도 놓치면 프롬프트를 조인다.

## 입력 실패 계약

`presentation`, `sources`, `reader_persona` 중 하나라도 누락되거나 읽을 수 없으면 리뷰를
진행하지 않고 아래 기계 판독 가능한 차단 verdict를 반환한다. 각 영향받은 입력마다
`INPUT`/`REASON` 쌍을 쓰며, 사용할 수 없는 입력에 대한 발표 인용이나 원본 finding을
만들지 않는다.

```
VERDICT: INCONCLUSIVE
INPUT: <presentation | sources | reader_persona>
REASON: <입력이 누락되었거나 읽을 수 없는 사실상의 이유>
```

정상적으로 검토 가능한 입력에서 `APPROVE`/`REQUEST_CHANGES`/`COMMENT` 의미는 기존과 같다.
그중 `APPROVE`와 `COMMENT`만 완료를 허용하며, `REQUEST_CHANGES`와 `INCONCLUSIVE`는 완료를
차단한다. verdict가 없거나 형식이 잘못된 경우에도 완료를 허용하지 않는다.

## 결과

- **GREEN (첫 검증):** `RESULT.md` 참조 — 리뷰어가 세 결함을 모두 잡고 `REQUEST_CHANGES` 판정.
- **GREEN (실제 레퍼런스):** `RESULT-real-reference.md` + `fixtures/rental-chokepoint/` 참조 —
  실제 병합 PR(algocare-home #1592) 기반으로 APPROVE 경로(clean → 3/3 APPROVE, false positive
  0)와 RED 경로(이격 2개 → 2/2 REQUEST_CHANGES)를 실제 리뷰어 프롬프트로 검증. 첫 검증이 남긴
  APPROVE 경로·실제 레퍼런스·실행 편차 갭을 닫음.

# GREEN — 첫 검증 (coupon-reclaim 픽스처)

`agents/presentation-reviewer.md` 프롬프트를 그대로 따르게 한 에이전트에 세 입력
(presentation / source / reader_persona)을 주고 돌린 결과.

**판정: `REQUEST_CHANGES`** — 심은 결함 3개를 모두 잡음.

| 심은 결함 | 리뷰어가 잡음 | 인용 규율 |
|---|---|---|
| 재시도 3회 → "최대 5회" | ✅ (이격으로 분류) | 산출물·원본 양쪽 인용 |
| 의존 방향 order→coupon → "coupon이 order 호출" | ✅ (이격) | 산출물·원본 양쪽 인용 |
| `CouponReclaimSaga` 근거 없이 등장 | ✅ (거짓 + 설명 부족) | 산출물 인용 + "근거 없음 — 원본 전체 확인" |

세 결함 모두 finding에 담겼고, fidelity 결함이 하나라도 있으면 `REQUEST_CHANGES`라는
판정 규칙대로 동작했다. 인용 규율("거짓/이격 finding은 산출물+원본을 인용, 미지원은
어디를 봤는지 명시")도 지켜졌다.

재시도 결함을 거짓이 아니라 이격으로 분류했으나, 둘 다 fidelity 결함이라 판정(REQUEST_CHANGES)은
동일하다 — 축 라벨 세부보다 "결함을 잡고 올바른 판정을 내렸는가"가 통과 기준이다.

## 아직 재지 않은 것

- **호출자별 원본 번들 조립 품질** — 이 픽스처는 원본을 직접 줬다. 실제로는 각 스킬(explain-diff·
  deep-interview·qa·prometheus)이 diff/플랜/스펙/evidence를 얼마나 풍부하게 조립해 넘기느냐가
  대조 품질을 좌우한다. 그 조립은 각 스킬 문서의 몫이고, 이 eval은 리뷰어 프롬프트만 잰다.
- **APPROVE 경로** — 결함 없는 산출물에 대해 리뷰어가 헛경보 없이 APPROVE하는지는 별도 셀에서
  재야 한다(현재 n=1, RED 픽스처만).
- **실행 간 편차** — n=1.

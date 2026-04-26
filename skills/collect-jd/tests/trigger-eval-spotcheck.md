# Trigger Eval Manual Spot Check

- **Date**: 2026-04-22
- **Method**: analytical spot check (실 Claude Code 세션 trigger 확인은 Phase C-25)
- **SKILL.md sha256**: `41c546fcd48257f32a5b04e16a75290b908da3027a067b29195ae0681df51b22`
- **trigger-eval.json sha256**: `22aa2d0d5c576194aeb844f079db1f9ec19ab0907d5186263b5a3eed1609cb08`

## SKILL.md description 요약 (트리거 핵심)

다음 phrase들이 SKILL.md description에서 **MUST trigger**로 명시:
- "JD 모으고 있어", "JD 수집", "JD 큐레이션", "JD 정리하고 있어"
- "오늘 수집 정리해줘", "오늘 본 JD"
- "관리 중인 JD", "쌓아둔 JD"
- "내 프로필에 맞는 JD 쌓아줘", "내 이력에 맞는 JD 큐레이션"
- "싹 돌려" (JD 재스캔 맥락)

**MUST NOT trigger** (타 스킬 영역):
- "JD 찾아줘", "JD 골라줘", "공고 뭐 있지", "지원할 곳", "어디 넣을까" → resume-apply
- "이력서 튜닝", "JD 기반 이력서", "맞춤 이력서" → resume-apply
- "이력서 리뷰", "이력서 검토" → review-resume
- "이력서 소재 발굴" → resume-forge
- 전혀 무관한 일반 질문 → none

---

## Positive 엔트리 spot check (should_trigger == true)

### query 1: "JD 모으고 있어"
- **should_trigger**: true
- **description match**: **yes** — "JD 모으고 있어"가 description MUST trigger 목록에 직접 명시
- **reasoning**: 수집 행위 의도를 명확히 표현. collect-jd 스킬의 핵심 트리거.
- **판정**: PASS

### query 2: "JD 쌓고 있어"
- **should_trigger**: true
- **description match**: **yes (근사)** — "쌓아둔 JD"가 description에 있고, "쌓고 있어"는 동일 수집 행위의 진행형 변형. collect-jd 범주에 속함.
- **reasoning**: "쌓다" 동사는 수집·축적의 의미이므로 "쌓아둔 JD"와 의미적으로 연속. trigger 타당.
- **판정**: PASS

### query 3: "JD 수집해줘"
- **should_trigger**: true
- **description match**: **yes** — "JD 수집"이 description MUST trigger 목록에 직접 명시. "해줘" 요청형은 변형.
- **reasoning**: 수집 요청은 collect-jd의 핵심 작업. 명확한 match.
- **판정**: PASS

### query 4: "JD 큐레이션 도와줘"
- **should_trigger**: true
- **description match**: **yes** — "JD 큐레이션"이 description MUST trigger 목록에 직접 명시. "도와줘"는 요청 방식.
- **reasoning**: 큐레이션은 JD를 선별·정리하는 collect-jd 스코프 그 자체.
- **판정**: PASS

### query 5: "JD 정리하고 있어"
- **should_trigger**: true
- **description match**: **yes** — "JD 정리하고 있어"가 description MUST trigger 목록에 직접 명시. 완전 일치.
- **reasoning**: 진행 중인 정리 작업 지원 요청. 명확한 match.
- **판정**: PASS

### query 6: "오늘 수집한 JD 정리해줘"
- **should_trigger**: true
- **description match**: **yes** — "오늘 수집 정리해줘"와 "오늘 본 JD" 두 패턴의 합성. "오늘 수집한 JD 정리해줘"는 양자를 포함.
- **reasoning**: "오늘" + "수집" + "JD" + "정리" 조합은 collect-jd의 대표적 use case.
- **판정**: PASS

### query 7: "오늘 본 JD 정리"
- **should_trigger**: true
- **description match**: **yes** — "오늘 본 JD"가 description MUST trigger 목록에 직접 명시. "정리"는 추가 맥락.
- **reasoning**: 오늘 열람한 JD를 정리하는 것은 수집·큐레이션의 전형적 요청.
- **판정**: PASS

### query 8: "관리 중인 JD 좀 보자"
- **should_trigger**: true
- **description match**: **yes** — "관리 중인 JD"가 description MUST trigger 목록에 직접 명시. "좀 보자"는 열람 요청 방식.
- **reasoning**: 이미 관리 중인 JD 목록 확인 요청 — collect-jd 상태 조회 스코프.
- **판정**: PASS

### query 9: "쌓아둔 JD 업데이트"
- **should_trigger**: true
- **description match**: **yes** — "쌓아둔 JD"가 description MUST trigger 목록에 직접 명시. "업데이트"는 정리·갱신 작업.
- **reasoning**: 기존 수집 JD의 갱신 작업은 collect-jd 스코프. resume-apply와 구분됨.
- **판정**: PASS

### query 10: "내 프로필에 맞는 JD 쌓아줘"
- **should_trigger**: true
- **description match**: **yes** — "내 프로필에 맞는 JD 쌓아줘"가 description MUST trigger 목록에 직접 명시. 완전 일치.
- **reasoning**: 프로필 기반 JD 수집 요청 — 큐레이션 기능의 핵심.
- **판정**: PASS

### query 11: "내 이력에 맞는 JD 큐레이션"
- **should_trigger**: true
- **description match**: **yes** — "내 이력에 맞는 JD 큐레이션"이 description MUST trigger 목록에 직접 명시. 완전 일치.
- **reasoning**: 이력 기반 JD 큐레이션 — collect-jd의 핵심 use case.
- **판정**: PASS

### query 12: "JD 싹 돌려줘"
- **should_trigger**: true
- **description match**: **yes** — "싹 돌려" (JD rescan context)가 description에 명시. "JD 싹 돌려줘"는 JD 맥락이 명시되어 rescan context 충족.
- **reasoning**: 배치 재스캔 요청. Ingest Path 5번 (배치 재스캔)에 직접 대응.
- **판정**: PASS

---

## Negative 엔트리 spot check (should_trigger == false)

### query 1: "JD 찾아줘"
- **should_trigger**: false
- **expected_skill**: resume-apply
- **description match**: **no** — "JD 찾아줘"는 description의 MUST NOT trigger 목록에 직접 명시 ("JD 찾아줘" → resume-apply).
- **reasoning**: 미발견 JD를 탐색하는 discovery 행위 — collect-jd는 이미 식별된 JD를 수집·정리. 명확한 경계.
- **판정**: PASS

### query 2: "JD 골라줘"
- **should_trigger**: false
- **expected_skill**: resume-apply
- **description match**: **no** — "JD 골라줘"는 description의 MUST NOT trigger 목록에 직접 명시.
- **reasoning**: 기존 JD 중 선택 요청 — 소비 행위(resume-apply). collect-jd는 정리·큐레이션이지 선택 추천이 아님.
- **판정**: PASS

### query 3: "공고 뭐 있지"
- **should_trigger**: false
- **expected_skill**: resume-apply
- **description match**: **no** — "공고 뭐 있지"는 description의 MUST NOT trigger 목록에 직접 명시.
- **reasoning**: 공고 탐색/발견 질의 — discovery 의도. collect-jd 스코프 외부.
- **판정**: PASS

### query 4: "지원할 곳 찾아줘"
- **should_trigger**: false
- **expected_skill**: resume-apply
- **description match**: **no** — "지원할 곳"은 description의 MUST NOT trigger 목록 "어디 넣을까"와 동의어. "찾아줘"도 discovery 의도.
- **reasoning**: 지원 대상 탐색 — resume-apply 영역. collect-jd는 JD 정리이지 지원 대상 선택이 아님.
- **판정**: PASS

### query 5: "어디 넣을까"
- **should_trigger**: false
- **expected_skill**: resume-apply
- **description match**: **no** — "어디 넣을까"는 description의 MUST NOT trigger 목록에 직접 명시.
- **reasoning**: 지원처 결정 요청 — 명확한 resume-apply 의도. collect-jd와 무관.
- **판정**: PASS

### query 6: "이력서 튜닝해줘"
- **should_trigger**: false
- **expected_skill**: resume-apply
- **description match**: **no** — "이력서 튜닝"은 description에 MUST NOT trigger로 간접 언급 (이력서 관련 작업은 타 스킬). Scope Boundary에서도 명시적으로 배제.
- **reasoning**: 이력서 수정 작업 — resume-apply 또는 review-resume 영역. JD 수집과 전혀 무관.
- **판정**: PASS

### query 7: "토스 지원하려고"
- **should_trigger**: false
- **expected_skill**: resume-apply
- **description match**: **no** — 특정 기업 지원 의사 표현. description의 MUST trigger 목록에 없음. "지원"은 소비 행위.
- **reasoning**: 지원 의사 표명 — resume-apply 스코프. collect-jd는 JD를 쌓는 것이지 지원 프로세스를 지원하는 것이 아님.
- **판정**: PASS

### query 8: "이력서 리뷰 해줘"
- **should_trigger**: false
- **expected_skill**: review-resume
- **description match**: **no** — Scope Boundary에서 "review-resume: 이력서 리뷰 (이 스킬 관여 안 함)"으로 명시 배제.
- **reasoning**: 이력서 검토 요청 — review-resume 전담. collect-jd 스코프 완전 외부.
- **판정**: PASS

### query 9: "이력서 검토해줘"
- **should_trigger**: false
- **expected_skill**: review-resume
- **description match**: **no** — "이력서 검토"는 review-resume 영역. Scope Boundary에 명시.
- **reasoning**: "검토"는 "리뷰"의 동의어 — review-resume이 담당. collect-jd와 무관.
- **판정**: PASS

### query 10: "이력서 쓰고 있어"
- **should_trigger**: false
- **expected_skill**: review-resume
- **reasoning**: 이력서 작성 중 진술 — JD 수집과 무관. expected_skill이 review-resume인 것은 이력서 작업 맥락 선언으로 볼 수 있음. collect-jd description에 trigger 근거 없음.
- **description match**: **no** — description의 어떤 MUST trigger 패턴과도 일치하지 않음.
- **판정**: PASS

### query 11: "이력서 소재 발굴"
- **should_trigger**: false
- **expected_skill**: resume-forge
- **description match**: **no** — Scope Boundary에서 "resume-forge: 이력서 소재 발굴 (이 스킬 관여 안 함)"으로 명시 배제.
- **reasoning**: 이력서 소재/재료 발굴은 resume-forge 전담. collect-jd와 완전히 다른 도메인.
- **판정**: PASS

### query 12: "이력서 재료 만들어줘"
- **should_trigger**: false
- **expected_skill**: resume-forge
- **description match**: **no** — "이력서 재료"는 resume-forge 영역 ("이력서 소재 발굴"의 변형).
- **reasoning**: 이력서 소재 생성 요청 — resume-forge 스코프. "재료"는 "소재"의 동의어.
- **판정**: PASS

### query 13: "오늘 뭐 먹을까"
- **should_trigger**: false
- **expected_skill**: none
- **description match**: **no** — JD, 이력서, 취업 관련 키워드 전무. description의 어떤 패턴과도 무관.
- **reasoning**: 식사 추천 질의 — 취업/JD 도메인 완전 외부. collect-jd 트리거 근거 전혀 없음.
- **판정**: PASS

### query 14: "날씨 어때"
- **should_trigger**: false
- **expected_skill**: none
- **description match**: **no** — 날씨 질의. JD 수집과 아무 관련 없음.
- **reasoning**: 일반 대화 질의 — 어떤 스킬도 트리거하지 않아야 하는 전형적 음성(negative) 사례.
- **판정**: PASS

---

## Summary

- Positive entries: 12개 — 12개 PASS (analytical 기준, 100%)
- Negative entries: 14개 — 14개 PASS (analytical 기준, 100%)
- Mismatch/경고: none

---

## Known Limitations

- Claude Code의 실제 trigger 판정은 Anthropic runtime의 skill-matching 알고리즘 기반 — analytical reasoning과 다를 수 있음.
- "JD 쌓고 있어" (query 2)는 description에 정확한 문자열 match가 없고 "쌓아둔 JD"에서 의미 추론함 — runtime이 exact match 기반이라면 miss 가능성 있음. Phase C-25에서 우선 검증 권장.
- "이력서 쓰고 있어" (negative query 10)의 expected_skill이 review-resume인 것은 다소 loose — 이력서 작성 선언은 맥락에 따라 여러 스킬이 적절할 수 있음. 단, collect-jd를 trigger하지 않는다는 판정에는 이견 없음.
- Phase C-25에서 실 Claude Code 세션으로 각 phrase 재검증 예정.

## Conclusion

trigger-eval.json 26개 전 엔트리의 `should_trigger` 판정이 SKILL.md description 및 Scope Boundary의 의도와 **완전히 일치**한다. positive 12개는 수집·큐레이션·정리 의도 phrase로 명확히 구성되었고, negative 14개는 discovery(resume-apply), 이력서 작업(resume-apply/review-resume/resume-forge), 무관 질의(none)로 깔끔하게 분리된다. spec과 eval 간 불일치 구간은 발견되지 않았다. 단, "JD 쌓고 있어"의 런타임 동작은 Phase C-25에서 우선 확인할 것을 권장한다.

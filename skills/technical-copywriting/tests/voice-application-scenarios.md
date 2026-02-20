# Voice & Authenticity Application Scenarios

Area: Voice & Authenticity Review
Reference: `skills/technical-copywriting/references/voice.md`
Scenario Count: 4

---

### VT-1: 마케팅 언어가 과도한 개발자 티저

**Technique Under Test**: CP12 안티 마케팅 표현 (voice.md Step 2)

**Input**:
```markdown
혁신적인 캐싱 전략으로 놀라운 성능 향상을 달성했습니다! 이 게임체인저 접근법은 당신의 시스템을 완전히 바꿔놓을 것입니다. 이 필독 포스트에서 그 비밀을 공개합니다.
```

**Expected Output**:
CP12 위반 5건:
1. "혁신적인" → 금지 표현 (revolutionary)
2. "놀라운" → 금지 표현 (amazing)
3. "게임체인저" → 금지 표현 (game-changer)
4. "필독" → 금지 표현 (must-read)
5. "비밀" → 금지 표현 (secret)

개선:
> LRU에서 LFU로 캐시 정책을 변경했더니 캐시 미스율이 34%에서 12%로 줄었습니다.
>
> 변경 과정과 벤치마크 결과를 정리했습니다.

**Pass Criteria**:
(1) CP12 금지 표현 3건 이상 지적
(2) 구체적 수치/사실로 대체한 개선안 제시
(3) "혁신적인"이나 "놀라운"을 문제없다고 판단하면 RED

---

### VT-2: Slack에서 격식체 사용

**Technique Under Test**: CP13 플랫폼별 톤 (voice.md Step 3)

**Input**:
```markdown
안녕하세요, 팀원 여러분께 안내드립니다. 금번 CI/CD 파이프라인 최적화 프로젝트의 결과를 블로그에 정리하였습니다. 해당 게시물을 검토하신 후 의견을 주시면 대단히 감사하겠습니다. 아래 링크를 참고 부탁드립니다.

https://blog.example.com/ci-optimization
```

**Expected Output**:
CP13 위반:
- Slack 플랫폼에 부적절한 격식체 사용
- "안녕하세요, 팀원 여러분께 안내드립니다" → 공지사항 톤
- "금번", "해당 게시물", "검토하신 후", "대단히 감사하겠습니다", "참고 부탁드립니다" → 과도한 격식
- Slack 권장 톤: 팀원에게 메시지 보내듯 캐주얼하게

개선:
> CI 빌드 18분 → 7분 줄인 과정 블로그에 정리했어요
> - 캐시 전략 변경이 제일 효과 컸음
> - 의견 있으면 편하게 남겨주세요
> https://blog.example.com/ci-optimization

**Pass Criteria**:
(1) CP13 톤 부적합 지적 (Slack에서 격식체)
(2) 격식체 표현 2건 이상 구체적 지적
(3) Slack에 맞는 캐주얼 톤 개선안 제시
(4) 격식체를 Slack에 적합하다고 판단하면 RED

---

### VT-3: 거만한 톤의 독자 지향 표현

**Technique Under Test**: CP14 독자 연결 (voice.md Step 4)

**Input**:
```markdown
동기화, 알고 계신가요? 동기/비동기, 블로킹/논블로킹을 정확하게 정의하실 수 있으신가요? 대부분의 개발자들이 이 개념을 정확히 모릅니다. 여러분도 한번 확인해보세요.
```

**Expected Output**:
CP14 위반:
- "알고 계신가요?", "정의하실 수 있으신가요?" → 독자를 시험하는 톤
- "대부분의 개발자들이 정확히 모릅니다" → 위에서 내려다보는 태도
- 문제는 "you" 언어 자체가 아니라 거만한 톤
- 개선: 동일한 "you" 언어를 진정성 있게 사용

개선 (진정한 독자 지향):
> 트랜잭션 격리 레벨 설명하기 어렵지 않으셨나요? 저도 그랬습니다. 동기화부터 Lock까지 한 번에 정리해봤습니다.

**Pass Criteria**:
(1) 거만한/시험하는 톤 지적
(2) "you" 언어 자체가 아닌 톤이 문제임을 구분
(3) 진정성 있는 "you" 사용으로의 개선안 제시
(4) "you 언어이므로 취약성 기반으로 바꿔야 한다"고 평가하면 RED

---

### VT-4: 한국어 번역체 마케팅 카피

**Technique Under Test**: CP15 한국어 자연스러움 (voice.md Step 5)

**Input**:
```markdown
저는 관찰 가능성에 대해 열정적입니다. 이 포스트는 당신의 모니터링을 다음 레벨로 가져갈 것입니다. 우리는 프로덕션 환경에서의 로그 수집에 대한 포괄적인 가이드를 작성했으며, 이것은 반드시 읽어야 할 컨텐츠입니다.
```

**Expected Output**:
CP15 위반 4건:
1. "저는 ~에 대해 열정적입니다" → "I'm passionate about" 직역
   - 개선: "관찰 가능성을 꾸준히 파고 있습니다"
2. "다음 레벨로 가져갈 것입니다" → "take to the next level" 직역
   - 개선: "모니터링 품질을 확실히 높일 수 있습니다"
3. "포괄적인 가이드를 작성했으며" → "comprehensive guide" 번역체
   - 개선: "로그 수집 방법을 처음부터 끝까지 정리했습니다"
4. "반드시 읽어야 할 컨텐츠입니다" → "must-read content" 번역체 + CP12 금지 표현
   - 개선: 제거 (가치 전달로 대체)

**Pass Criteria**:
(1) 번역체 표현 3건 이상 지적
(2) 자연스러운 한국어 대체 표현 제시
(3) 각 위반에 대해 원문 영어 표현 근거 명시
(4) "열정적입니다"를 자연스러운 한국어로 판단하면 RED

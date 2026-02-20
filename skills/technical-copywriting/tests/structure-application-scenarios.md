# Structure Review Application Scenarios

Area: Structure Review
Reference: `skills/technical-copywriting/references/structure.md`
Scenario Count: 6

---

### SCT-1: "블로그에 글을 올렸습니다" 안티패턴

**Technique Under Test**: CP7 유형별 오프닝 (structure.md Step 1)

**Input**:
```markdown
블로그에 CI/CD 최적화에 대한 글을 올렸습니다. Docker 캐시 전략 변경, 병렬 실행 도입, 불필요한 스텝 제거 등의 내용을 다뤘습니다. 관심 있으시면 읽어보세요.
```

**Expected Output**:
CP7 위반:
- "블로그에 ~ 글을 올렸습니다"로 시작 → 유형 불문 보편적 안티패턴
- 독자의 스크롤을 멈출 요소가 없음
- 어떤 유형으로든 전환 가능:
  - Learning Journey: "CI 빌드 시간을 줄이겠다고 3주간 삽질했습니다. 그 과정에서 몰랐던 것들을 깨달았습니다."
  - Practical Tip: "CI 빌드 18분 → 7분. 바꾼 건 캐시 전략 하나."
  - Announcement: "CI/CD 최적화 가이드를 공개합니다."

**Pass Criteria**:
(1) CP7 안티패턴 지적 ("블로그에 글을 올렸습니다" 패턴)
(2) 유형에 맞는 오프닝으로의 개선안 제시
(3) 원본 첫 문장을 효과적인 오프닝으로 판단하면 RED

---

### SCT-2: Learning Journey에서 bullet takeaway 추가 제안의 적절성

**Technique Under Test**: CP8 유형별 가치 전달 (structure.md Step 2)

**Input**:
```markdown
트랜잭션 일관성은 매우 중요합니다. 하지만 트랜잭션 격리 레벨 몰라서 물어보는 분들에게 설명하기란 진땀 빼야 하죠..

이 분야의 고전이라 불리는 '데이터 중심 애플리케이션 설계'(Martin Kleppmann, 2017)에서도 강조하고 있습니다.

아래 글에서 트랜잭션 격리 레벨과 Lock, 그리고 Update Lock의 역할까지 한 번에 정리해봤습니다. [link]
```

**Expected Output**:
CP8 Suggestion (not Critical):
- Learning Journey로서 서사적 가치 전달은 유효
- 스캔 가능성을 높이기 위해 핵심 포인트 추가를 제안할 수 있음
- 개선 제안:
  > 트랜잭션 일관성은 매우 중요합니다. 하지만 트랜잭션 격리 레벨 몰라서 물어보는 분들에게 설명하기란 진땀 빼야 하죠..
  >
  > 정리하면서 깨달은 핵심:
  > - 격리 레벨은 "어디까지 보여줄 것인가"의 문제
  > - Lock은 격리를 구현하는 메커니즘
  > - Update Lock은 교착 상태 방지의 핵심
  >
  > Kleppmann의 DDIA를 기반으로 정리해봤습니다. [link]

**Pass Criteria**:
(1) 서사적 가치 전달이 유효함을 인정
(2) Suggestion으로 bullet 추가를 제안 (Critical이 아님)
(3) 서사와 bullet을 결합한 개선안 제시
(4) "bullet 필요 없음, 서사만으로 충분"이라고만 평가하면 RED
(5) "bullet이 없으므로 가치 전달 실패"라고만 평가해도 RED

---

### SCT-3: Practical Tip 구조에서 구체적 방법 없이 주장만

**Technique Under Test**: CP8 유형별 가치 전달 (structure.md Step 2)

**Input**:
```markdown
Claude Code를 잘 쓰려면 공식 문서를 읽어야 합니다. 영상보다 직접 해보는 게 좋습니다. 많이 써보세요.
```

**Expected Output**:
CP8 위반:
- Practical Tip 유형인데 구체적 지시(instructions)가 없음
- "공식 문서를 읽어야 합니다", "많이 써보세요" → 일반적 조언
- Practical Tip의 가치 전달 방식은 "구체적 방법 자체가 가치" -- 번호 매긴 단계 또는 짧고 직접적인 문단
- 개선: 정확히 어떤 설정을 하고, 어떤 명령어를 입력하는지 구체적 지시 추가
  > CLAUDE.md에 이 내용을 추가하세요: [specific text]
  > 터미널에 이렇게 입력하세요: "공식 문서 읽고 나한테 Claude Code를 순서대로 가르쳐줘."

**Pass Criteria**:
(1) CP8 위반 지적 (Practical Tip에 구체적 방법 부재)
(2) 일반적 조언과 구체적 지시의 차이 설명
(3) 구체적 지시를 포함한 개선안 제시
(4) 일반적 조언을 유효한 Practical Tip 가치 전달로 판단하면 RED

---

### SCT-4: Industry Insight에서 분석 없이 관찰만

**Technique Under Test**: CP8 유형별 가치 전달, CP10 유형별 비율 (structure.md Step 2, Step 4)

**Input**:
```markdown
요즘 AI 코딩 도구가 많이 나오고 있습니다. Claude Code, Cursor, Copilot, Windsurf 등이 있죠. 개발자들이 많이 쓰고 있는 것 같습니다.

어떤 도구가 좋은지는 사람마다 다를 것 같습니다.
```

**Expected Output**:
CP8 위반:
- Industry Insight 유형인데 분석과 패턴 식별이 없음
- 관찰만 나열: "많이 나오고 있습니다", "많이 쓰고 있는 것 같습니다"
- Industry Insight의 가치 전달 방식은 "분석과 패턴 식별" -- 타임라인, 비교, "변한 것 vs 변하지 않는 것"
- "사람마다 다를 것 같습니다" → 인사이트 없는 결론

CP10 위반:
- 관찰 ~70%, 분석 0%, 인사이트 ~30% → 분석 본문이 전무
- 개선: 도구들의 진화 타임라인, 변화 패턴, 변하지 않는 본질 추가
  > 변한 건 AI를 쓰는 방식이에요. Claude Code -> Skills -> Plugin -> SDK. 계속 정교해지고 있어요.
  > 변하지 않는 건 max 구독이에요. $200를 구독해야 토큰을 최대한으로 할인받거든요.

**Pass Criteria**:
(1) CP8 위반 지적 (분석 없는 관찰 나열)
(2) CP10 비율 불균형 지적 (분석 본문 부재)
(3) 분석과 패턴 식별을 포함한 개선안 제시
(4) 도구 이름 나열을 유효한 Industry Insight로 판단하면 RED

---

### SCT-5: LinkedIn 첫 140자가 모호한 경우

**Technique Under Test**: CP7 Above-the-fold test (structure.md Step 1)

**Input**:
```markdown
개발자라면 누구나 한 번쯤은 고민하게 되는 주제가 있습니다. 저도 최근에 이 주제에 대해 깊이 생각해보게 되었는데요.

격리 레벨별 Lock 동작을 실제 트랜잭션 로그로 검증했습니다. Read Committed에서 Phantom Read가 발생하는 조건, Serializable에서의 성능 비용까지 정리했습니다.
```

**Expected Output**:
CP7 위반 (Above-the-fold):
- 첫 140자: "개발자라면 누구나 한 번쯤은 고민하게 되는 주제가 있습니다. 저도 최근에 이 주제에 대해 깊이 생각해보게 되었는데요." → 주제가 무엇인지 알 수 없음
- 구체적 주제("트랜잭션 격리 레벨")와 관심을 끌 요소("실제 로그로 검증")가 fold 아래에 숨겨져 있음
- 개선: 구체적 내용을 첫 줄로 이동
  > 격리 레벨별 Lock 동작을 실제 트랜잭션 로그로 검증했습니다.
  >
  > Read Committed에서 Phantom Read가 발생하는 조건, Serializable에서의 성능 비용까지 정리했습니다.

**Pass Criteria**:
(1) 첫 140자에서 구체적 주제 부재를 지적
(2) Above-the-fold test 실패 근거 (topic + reason to care)
(3) 구체적 내용을 앞으로 이동하는 개선안 제시
(4) "개발자라면 누구나"를 유효한 오프닝으로 판단하면 RED

---

### SCT-6: 블로그 홍보 포스트인데 링크가 없는 경우

**Technique Under Test**: CP9 유형별 마무리 (structure.md Step 3)

**Input**:
```markdown
CI 빌드 시간을 18분에서 7분으로 줄였습니다. Docker 캐시 전략을 LRU에서 LFU로 변경한 게 가장 효과가 컸습니다.

병렬 실행 도입, 불필요한 스텝 제거까지 합치면 총 60% 단축.

이 과정을 블로그에 상세히 정리해뒀습니다. 앞으로도 CI/CD 최적화를 계속 파고들 생각입니다.
```

**Expected Output**:
CP9 위반:
- 블로그 글을 홍보하는 포스트("블로그에 상세히 정리해뒀습니다")인데 링크가 없음
- 홍보 포스트에서 콘텐츠로의 경로는 필수 — 독자가 전체 글에 도달할 방법이 없음
- "앞으로도 ~ 파고들 생각입니다" → 성찰적 마무리는 유효하지만, 링크를 대체할 수 없음
- 개선: 링크 추가 (내장형 또는 명시적)
  > 이 과정을 블로그에 상세히 정리해뒀습니다. 👇 [link]
  > 또는: 전체 과정은 첫 댓글 링크에서 확인하세요.

**Pass Criteria**:
(1) CP9 위반으로 링크/CTA 부재 지적
(2) 홍보 포스트에서 링크가 필수임을 근거로 제시
(3) 내장형 또는 명시적 링크 개선안 제시
(4) 성찰적 마무리만으로 충분하다고 판단하면 RED

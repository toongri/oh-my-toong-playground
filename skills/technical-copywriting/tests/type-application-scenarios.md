# Type Classification Application Scenarios

Area: Type Classification
Reference: `skills/technical-copywriting/references/type.md`
Scenario Count: 4

---

### TT-1: Learning Journey 필수 요소 누락

**Technique Under Test**: CP2 Learning Journey 필수 요소 (type.md Step 2)

**Input**:
```markdown
동기화에 대해 공부했습니다. 관련 서적을 읽고 정리해봤습니다.
- 동기: 호출한 루틴을 동기화하여 처리한다.
- 비동기: 호출한 루틴을 독립적으로 처리한다.
여기 정리해봤습니다. [link]
```

**Expected Output**:
CP2 위반:
- Learning Journey로 분류되나, 필수 요소인 personal gap confession이 누락됨
- 무엇을 공부했는지는 보고하지만, 왜 공부하게 되었는지(어떤 갭을 발견했는지)가 없음
- "공부했습니다" → 보고형. "전혀 모르고 있다는 사실을 깨달았습니다" → 고백형
- 개선: 왜 이 주제를 공부하게 되었는지, 어떤 무지를 자각했는지 추가 필요

**Pass Criteria**:
(1) CP2 위반으로 confession 요소 부재 지적
(2) 보고형과 고백형의 차이를 설명
(3) confession 요소를 추가한 개선 방향 제시
(4) 원본을 완전한 Learning Journey로 판단하면 RED

---

### TT-2: Practical Tip에 구체적 방법 누락

**Technique Under Test**: CP3 Practical Tip 필수 요소 (type.md Step 2)

**Input**:
```markdown
Claude Code를 잘 쓰려면 공식 문서를 읽어야 합니다. 영상보다 직접 해보는 게 좋습니다. 많이 써보세요.
```

**Expected Output**:
CP3 위반:
- Practical Tip으로 분류되나, 필수 요소인 specific actionable instructions가 누락됨
- "공식 문서를 읽어야 합니다", "많이 써보세요" → 일반적 조언이지 구체적 방법이 아님
- 개선: 정확히 어떤 문서를 읽어야 하는지, 어떤 명령어를 입력해야 하는지, 어떤 설정을 해야 하는지 등 구체적 지시 필요
- 참고: 실제 Practical Tip 예시에서는 CLAUDE.md에 추가할 정확한 텍스트, 터미널에 입력할 정확한 명령어까지 제시

**Pass Criteria**:
(1) CP3 위반으로 구체적 지시 부재 지적
(2) 일반적 조언과 구체적 방법의 차이를 설명
(3) 구체적 지시를 포함한 개선 방향 제시
(4) "공식 문서를 읽어야 합니다"를 충분한 Practical Tip으로 판단하면 RED

---

### TT-3: 플랫폼 제약 위반 (Twitter/X 글자수)

**Technique Under Test**: CP6 플랫폼 제약 준수 (type.md Step 3)

**Input**:
```markdown
최근 우리 팀에서 Kubernetes 클러스터의 모니터링 사각지대를 해결한 경험을 블로그에 정리했습니다. Node-level 메트릭만으로는 Pod OOM을 감지할 수 없다는 점, Readiness probe 실패가 로그에 남지 않는 문제, HPA 스케일링 지연의 근본 원인이 metrics-server 주기에 있다는 점 등 3가지 핵심 발견을 공유합니다. 관심 있으신 분들은 확인해보세요.
```

**Expected Output**:
CP6 위반:
- Twitter/X 단일 트윗 280자 제한 초과
- 개선 옵션 1: 단일 트윗으로 압축
  > K8s 모니터링 사각지대 3가지 발견:
  > - Node 메트릭만으로는 Pod OOM 못 잡음
  > - Readiness probe 실패는 로그에 안 남음
  > - HPA 지연 원인은 metrics-server 주기
  > [link]
- 개선 옵션 2: 스레드로 분리

**Pass Criteria**:
(1) 글자수 제한 초과 지적
(2) 단일 트윗 압축안 또는 스레드 분리안 중 하나 이상 제시
(3) 글자수 초과를 문제없다고 판단하면 RED

---

### TT-4: 유형 불일치 (Learning Journey 구조로 Announcement 시도)

**Technique Under Test**: CP1 유형 분류, Step 4 유형 불일치 보고 (type.md Step 1, Step 4)

**Input**:
```markdown
새 플러그인을 만들면서 제가 몰랐던 것을 깨달았습니다. 제가 개발한 clarify 스킬을 업데이트했는데요. metamedium이라는 프레임워크를 기반으로 3가지 스킬로 분리했습니다.

1. clarify:unknown - 전략 맹점 찾기
2. clarify:metamedium - 내용 vs 형식
3. clarify:vague - 요구사항 명확화

이 스킬들은 plugins-for-claude-natives에서 공개해 두었습니다. [link]
```

**Expected Output**:
CP1 유형 불일치:
- 표면적으로 Learning Journey 프레이밍 ("몰랐던 것을 깨달았습니다")
- 실제 내용은 Announcement: 새 기능, 번호 매긴 목록, 리소스 링크
- "몰랐던 것을 깨달았습니다"가 강제적으로 느껴짐 -- 이후 내용이 기능 설명이지 학습 여정이 아님
- 개선: Announcement 유형으로 전환하여 직접적 뉴스 문장으로 시작
  > /clarify 스킬을 업데이트했습니다. metamedium, unknown라는 프레임워크를 기반으로 총 3가지 스킬로 만들어두었어요.

**Pass Criteria**:
(1) Learning Journey와 Announcement 사이의 유형 불일치 지적
(2) 강제된 confession 프레이밍 식별
(3) Announcement 유형으로의 전환 제안
(4) 이 텍스트를 유효한 Learning Journey로 판단하면 RED

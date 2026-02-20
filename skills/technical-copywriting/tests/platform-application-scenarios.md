# Platform Classification Application Scenarios

Area: Platform Classification
Reference: `skills/technical-copywriting/references/platform.md`
Scenario Count: 3

---

### PT-1: LinkedIn 본문에 외부 링크 포함

**Technique Under Test**: CP3 플랫폼별 포맷 규칙 (platform.md Step 3)

**Input**:
```markdown
CI 빌드 시간을 60% 단축한 방법을 정리했습니다.

3가지 핵심 변경:
1. Docker layer 캐시를 remote cache로 전환
2. 테스트를 변경 파일 기반으로 필터링
3. 불필요한 lint 스텝을 pre-commit으로 이동

자세한 내용은 블로그에서 확인하세요: https://blog.example.com/ci-optimization
```

**Expected Output**:
CP3 위반:
- LinkedIn 본문에 외부 링크 포함 → 알고리즘 노출 감소
- "https://blog.example.com/ci-optimization"이 본문에 직접 삽입됨
- 개선: 링크를 첫 번째 댓글로 이동하고, 본문 마지막을 "전체 과정은 첫 댓글 링크에서 확인하세요"로 변경

**Pass Criteria**:
(1) CP3 위반으로 외부 링크 본문 삽입 지적
(2) 첫 번째 댓글로 링크 이동 권장
(3) 개선된 CTA 문구 제시
(4) 본문 내 외부 링크를 문제없다고 판단하면 RED

---

### PT-2: Twitter/X 단일 트윗 글자수 초과

**Technique Under Test**: CP2 플랫폼 제약 준수 (platform.md Step 2)

**Input**:
```markdown
최근 우리 팀에서 Kubernetes 클러스터의 모니터링 사각지대를 해결한 경험을 블로그에 정리했습니다. Node-level 메트릭만으로는 Pod OOM을 감지할 수 없다는 점, Readiness probe 실패가 로그에 남지 않는 문제, HPA 스케일링 지연의 근본 원인이 metrics-server 주기에 있다는 점 등 3가지 핵심 발견을 공유합니다. 관심 있으신 분들은 확인해보세요.
```

**Expected Output**:
CP2 위반:
- Twitter/X 단일 트윗 280자 제한 초과 (현재 약 200자 이상, 한글 기준)
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

### PT-3: Slack 공유 시 과도하게 긴 메시지

**Technique Under Test**: CP2 플랫폼 제약 준수, CP3 플랫폼별 포맷 규칙 (platform.md Step 2, Step 3)

**Input**:
```markdown
안녕하세요 팀원 여러분, 오늘 블로그에 새 글을 올렸습니다. CI/CD 파이프라인 최적화에 관한 내용인데요. 저희 팀에서 지난 3주간 진행한 프로젝트의 결과물입니다. Docker layer 캐시를 remote cache로 전환하고, 테스트를 변경 파일 기반으로 필터링하고, 불필요한 lint 스텝을 pre-commit hook으로 이동하는 등의 작업을 했습니다. 결과적으로 빌드 시간이 18분에서 7분으로 줄었습니다. 시간 되실 때 읽어보시면 좋을 것 같습니다. 피드백도 환영합니다! https://blog.example.com/ci-optimization
```

**Expected Output**:
CP2 위반:
- Slack 권장 길이(3-5줄) 대비 과도하게 긴 메시지
- 팀원들이 스캔하기 어려운 장문 형태

CP3 위반:
- Slack에서는 간결한 TL;DR + 불릿 포인트 형태 권장
- 개선:
  > CI 빌드 18분 → 7분 줄인 과정 정리했습니다
  > - 캐시 전략 변경이 가장 큰 효과
  > - 병렬 실행으로 추가 30% 단축
  > https://blog.example.com/ci-optimization

**Pass Criteria**:
(1) Slack 권장 길이 초과 지적
(2) TL;DR + 불릿 형태로의 개선안 제시
(3) 원본 메시지를 Slack에 적합하다고 판단하면 RED

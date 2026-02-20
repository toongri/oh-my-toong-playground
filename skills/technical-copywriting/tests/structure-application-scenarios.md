# Structure Review Application Scenarios

Area: Structure Review
Reference: `skills/technical-copywriting/references/structure.md`
Scenario Count: 4

---

### SCT-1: "블로그에 글을 올렸습니다" 훅 안티패턴

**Technique Under Test**: CP4 훅 존재와 품질 (structure.md Step 1)

**Input**:
```markdown
블로그에 CI/CD 최적화에 대한 글을 올렸습니다. Docker 캐시 전략 변경, 병렬 실행 도입, 불필요한 스텝 제거 등의 내용을 다뤘습니다. 관심 있으시면 읽어보세요.
```

**Expected Output**:
CP4 위반:
- "블로그에 ~ 글을 올렸습니다"로 시작 → 훅 안티패턴
- 독자의 스크롤을 멈출 요소가 없음
- 개선: 결과 기반 훅으로 전환
  > CI 빌드 18분 → 7분. 바꾼 건 캐시 전략 하나.
  >
  > Docker 캐시 전략 변경, 병렬 실행 도입, 불필요한 스텝 제거로 달성한 과정을 정리했습니다.

**Pass Criteria**:
(1) CP4 훅 안티패턴 지적 ("블로그에 글을 올렸습니다" 패턴)
(2) 결과/수치/고통점 기반 훅으로의 개선안 제시
(3) 원본 첫 문장을 효과적인 훅으로 판단하면 RED

---

### SCT-2: 훅만 있고 테이크어웨이 없음

**Technique Under Test**: CP5 가치 전달, CP7 훅-가치-CTA 비율 (structure.md Step 2, Step 4)

**Input**:
```markdown
우리 팀의 CI 빌드가 18분이나 걸렸습니다. 매일 수십 번 빌드하는데 그 시간을 매번 기다려야 했죠. 정말 고통스러웠습니다. 어떻게 해결했을까요?

블로그에 정리했습니다. 링크는 댓글에!
```

**Expected Output**:
CP5 위반:
- 구체적인 테이크어웨이가 0건
- 독자가 링크를 클릭하지 않으면 얻는 정보가 없음
- "어떻게 해결했을까요?" → 클릭베이트 패턴
- 개선: 2-4개 핵심 테이크어웨이 추가 필요

CP7 위반:
- 훅 ~80%, 가치 0%, CTA ~20% → 비율 불균형
- 개선: 훅 축소, 가치 섹션 60-70% 확보

개선:
> CI 빌드 18분 → 7분.
>
> 핵심 변경 3가지:
> 1. Docker layer 캐시를 remote cache로 전환 → 빌드 시간 45% 감소
> 2. 테스트를 변경 파일 기반으로 필터링 → 불필요한 테스트 80% 제거
> 3. lint 스텝을 pre-commit으로 이동 → CI에서 2분 절약
>
> 전체 삽질 과정은 첫 댓글 링크에.

**Pass Criteria**:
(1) CP5 위반 지적 (테이크어웨이 부재)
(2) CP7 비율 불균형 지적 (훅 과다, 가치 부재)
(3) 테이크어웨이를 포함한 개선안 제시
(4) "훅이 강력하므로 효과적"으로 평가하면 RED

---

### SCT-3: 목차형 테이크어웨이

**Technique Under Test**: CP5 가치 전달 (structure.md Step 2)

**Input**:
```markdown
Kubernetes 보안 강화에 대한 글을 정리했습니다.

다루는 내용:
1. 네트워크 정책
2. RBAC 설정
3. Pod 보안 컨텍스트
4. 이미지 스캐닝

전체 글: https://blog.example.com/k8s-security
```

**Expected Output**:
CP5 위반:
- 목차 스타일 나열 → 각 항목이 독립적 가치를 전달하지 않음
- "네트워크 정책"만으로는 독자가 무엇을 배울 수 있는지 알 수 없음
- 개선: 각 항목에 구체적 인사이트 추가
  > 1. NetworkPolicy 없으면 모든 Pod가 서로 통신 가능 → 기본 deny 정책 필수
  > 2. ClusterRole 하나로 모든 권한 부여하는 실수 → 최소 권한 원칙 적용법
  > 3. 컨테이너가 root로 실행 중인지 확인하는 명령어
  > 4. CI에서 Trivy로 이미지 취약점 자동 스캔하는 설정

**Pass Criteria**:
(1) CP5 위반 지적 (목차형 나열, 독립적 가치 부재)
(2) 각 항목에 구체적 인사이트를 추가한 개선안 제시
(3) 목차 나열을 "구조적으로 잘 정리됨"으로 평가하면 RED

---

### SCT-4: CTA 없는 LinkedIn 포스트

**Technique Under Test**: CP6 CTA 적절성, CP7 훅-가치-CTA 비율 (structure.md Step 3, Step 4)

**Input**:
```markdown
프로덕션 장애의 70%는 모니터링 사각지대에서 발생합니다.

우리 팀이 Kubernetes 모니터링 사각지대를 없앤 3가지 방법:
1. cAdvisor 커스텀 알림으로 Pod OOM 감지
2. Event Exporter로 Readiness probe 실패 추적
3. metrics-server 주기를 15s로 조정해 HPA 스케일링 지연 해소
```

**Expected Output**:
CP6 위반:
- LinkedIn 포스트에 CTA가 완전히 부재
- 블로그 링크 안내 없음 → 독자가 전체 글을 찾을 방법이 없음
- 개선: 마지막에 CTA 추가
  > 각 방법의 상세 설정과 삽질 기록은 첫 댓글 링크에서 확인하세요.

CP7:
- 훅 ~15%, 가치 ~85%, CTA 0% → CTA 부재
- 가치 전달은 우수하나 전환 경로가 없음

**Pass Criteria**:
(1) CP6 위반 지적 (CTA 부재)
(2) 플랫폼에 맞는 CTA 문구 제안
(3) "가치 전달이 충분하므로 CTA 불필요"로 평가하면 RED

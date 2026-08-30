# Oh-My-Toong 오케스트레이션 가이드

한국어 | **[English](ORCHESTRATION.en.md)**

---

## 핵심 요약 - 언제 무엇을 사용할까

| 복잡도 | 접근 방식 | 사용 시점 |
|--------|----------|-----------|
| **단순** | 그냥 프롬프트 | 빠른 수정, 단일 파일 변경 |
| **팀 작업 티켓** | `/deep-interview` -> `/craft-tasks` -> task별 선택적 `/prometheus` -> `/ultragoal` -> `/sisyphus` | 확정된 설계를 팀이 공유·추적할 구현 task 티켓으로 만들 때 |
| **범위 흐림** | `/deep-interview` -> AI 실행만 필요하면 `/ultragoal` (또는 `/prometheus` -> `/ultragoal`) -> `/sisyphus` | 아이디어는 있지만 요구사항이 불명확한 작업 |
| **복잡** | `/prometheus` -> `/ultragoal` -> `/sisyphus` | 기획과 조율이 필요한 다단계 작업 |

**결정 흐름:**

```
빠른 수정이나 단순 작업인가?
  |-- 예 -> 그냥 평소처럼 프롬프트
  |-- 아니오 -> 요구사항이 명확한가?
                  |-- 아니오 -> /deep-interview로 명세 수렴
                                |-- 팀이 공유·추적할 구현 task 티켓이 필요한가?
                                      |-- 예 -> /craft-tasks로 부모 확인·보강 및 자식 티켓 생성
                                               -> task별 필요할 때만 /prometheus
                                               -> /ultragoal -> /sisyphus
                                      |-- 아니오 -> 활성 토폴로지 컴포넌트가 정확히 하나면 /ultragoal
                                                   아니면 /prometheus -> /ultragoal -> /sisyphus
                  |-- 예 -> 다단계 실행이 필요한가?
                              |-- 예 -> /prometheus로 기획 -> /ultragoal -> /sisyphus로 실행
                              |-- 아니오 -> 컨텍스트와 함께 프롬프트
```

---

## 1. 개요

기존 AI 에이전트는 종종 기획과 실행을 섞어서 다음과 같은 문제를 일으킵니다:
- **컨텍스트 오염**: 계획 세부사항과 코드 변경이 뒤섞임
- **목표 이탈**: 구현 도중 원래 목표를 놓침
- **AI 슬롭**: 제대로 된 기획 없이 급하게 작성한 저품질 코드

Oh-My-Toong은 역할을 명확히 분리하여 이를 해결합니다:

| 역할 | 에이전트 | 책임 |
|------|----------|------|
| **정의** | deep-interview | 모호성을 해소해 명세로 수렴, 절대 코드 작성 안 함 |
| **작업 티켓화** | craft-tasks | 확정된 설계를 팀이 공유·추적할 자식 task 티켓으로 분해하고 부모를 확인·보강한 뒤 생성 |
| **기획** | prometheus | 전략적 기획, 절대 코드 작성 안 함 |
| **스토리 실행** | ultragoal | 계획의 스토리를 순서대로 sisyphus에 전달 |
| **실행** | sisyphus | 위임을 통한 조율, 절대 단독 작업 안 함 |
| **구현** | sisyphus-junior | 코드 작성 (sisyphus가 위임) |
| **품질 보증** | sisyphus (인라인 검증) | verify 태스크의 AC 명령을 직접 실행해 구현 품질·계획 준수·지시 이행 검증 |

---

## 2. 전체 아키텍처

```mermaid
flowchart TD
    User[사용자 요청] --> Decision{복잡도?}

    Decision -->|단순| Direct[직접 프롬프트]
    Decision -->|범위 흐림| DeepInterview["/deep-interview"]
    Decision -->|복잡한 다단계| Prometheus

    subgraph 정의 단계
        DeepInterview --> SpecFile["$OMT_DIR/deep-interview/{slug}.md"]
        SpecFile --> Output{명세의 산출물 형태?}
        Output -->|팀 공유·추적 task 티켓| CraftTasks["/craft-tasks"]
        Output -->|AI 실행만| Route{활성 토폴로지<br/>컴포넌트가 정확히 하나인가?}
    end

    subgraph 작업 티켓 단계
        CraftTasks --> Parent["검증된 부모<br/>확인·보강"]
        Parent --> ChildTickets["PM 도구에 자식<br/>task 티켓 생성"]
        ChildTickets --> TaskPlan{task별 AI<br/>계획이 필요한가?}
    end

    subgraph 기획 단계
        Route -->|아니오| Prometheus["/prometheus"]
        TaskPlan -->|예| Prometheus
        Prometheus --> Metis[metis<br/>갭 분석]
        Metis --> Prometheus
        Prometheus --> PlanFile["~/.omt/{OMT_PROJECT}/plans/*.md"]
    end

    subgraph 실행 단계
        Route -->|예| Ultragoal["/ultragoal"]
        TaskPlan -->|아니오| Ultragoal
        PlanFile --> Ultragoal
        Ultragoal -->|스토리를 순서대로 전달| Sisyphus["/sisyphus"]
        Sisyphus --> Junior[sisyphus-junior]
        Junior --> Done((완료))
        Sisyphus -->|verify 태스크| QA[인라인 검증<br/>sisyphus 직접 실행]
        QA -->|Pass| Done
        QA -->|REQUEST_CHANGES| Junior
    end
```

---

## 3. 핵심 컴포넌트

### deep-interview (정의자)

- **역할**: 모호한 아이디어를 자율 실행 전에 명세로 수렴
- **제약**: 모호성 점수가 임계값을 넘으면 실행으로 넘어가지 않음. 직접 구현 안 함.
- **출력**: `$OMT_DIR/deep-interview/{slug}.md`
- **워크플로우**: 한 번에 한 질문, 가장 약한 명확성 차원을 겨냥 -> 모호성 측정 -> 임계값 이하면 명세 확정 -> 5단계에서 산출물이 팀이 공유·추적할 구현 task 티켓이면 `/craft-tasks`를 권장하고, 그렇지 않고 AI 실행만 필요하면 활성 토폴로지 컴포넌트가 정확히 하나일 때 `/ultragoal`, 아니면 `/prometheus`를 권장. 권장하지 않은 다른 스킬은 명시적 재정의 옵션으로 제시
- **출처**: oh-my-claudecode(omc)의 구현이 워낙 잘 만들어져 거의 그대로 가져와 다듬었습니다 (originally [Ouroboros](https://github.com/Q00/ouroboros) 영감)

### craft-tasks (작업 티켓 생성자)

- **역할**: 확정된 설계를 팀이 공유·추적할 수 있는 구현 task 티켓으로 분해
- **제약**: 의도·접근 방식·불변식·경계가 확정된 설계에만 사용합니다. AI 실행 계획만 필요하면 `prometheus`를 사용합니다.
- **출력**: 검증된 부모 아래 PM 도구에 생성된 자식 task 티켓
- **워크플로우**: deep-interview 명세를 바탕으로 부모를 확인·보강하고 기존 자식 티켓을 검증한 뒤, 누락된 구현 task만 자식 티켓으로 생성합니다. 생성된 각 task에 AI 실행 계획이 필요할 때만 task별로 `/prometheus`를 선택하고, 이후 `/ultragoal` -> `/sisyphus`로 실행합니다.

### prometheus (기획자)

- **역할**: 전략적 기획, 요구사항 인터뷰
- **제약**: **READ-ONLY**. 절대 코드 작성 안 함.
- **출력**: `~/.omt/{OMT_PROJECT}/plans/{name}.md` (`$OMT_DIR` 경유)
- **워크플로우**: 범위 분할 판정 -> 인터뷰 -> 조사 -> Metis 상담 -> 계획 작성 -> `/ultragoal`에 전달
- **사용 시점**: 팀 task 티켓이 필요 없는 AI 실행 경로에서 사용하거나, `craft-tasks`가 만든 각 task에 별도 AI 실행 계획이 필요할 때만 선택합니다.
- **범위 분할**: Complex·Architecture 요청은 인터뷰 전에 "혼자 머지해도 시스템이 도는 부분집합이 있나"를 먼저 묻고, 있으면 첫 덩어리만 이번 실행의 범위로 삼습니다. 나머지는 각자 별도 prometheus 실행이 됩니다.

### ultragoal (스토리 실행자)

- **역할**: 계획의 스토리를 순서대로 실행
- **워크플로우**: 각 스토리를 `/sisyphus`에 순차적으로 전달하고, 이전 스토리가 끝난 뒤 다음 스토리를 시작

#### 반복 예산·진전 없음·재개

- pursuit 중 `iteration`은 진전이 관찰되지 않은 Stop의 연속 횟수입니다. diff를 포함한 커밋이나 Story 상태 전환이 발생하면 `0`으로 리셋되며, 백그라운드 작업을 기다리는 Stop은 집계하지 않습니다.
- `max_iterations`(기본 10)에 도달하면 새 작업을 디스패치하지 않고 상태를 보존한 비완료 `budget_limited`로 소프트 정지합니다. 진행 중 작업을 비운 뒤 completion gate를 확인하고, 사용자만 `resume-pursuit`를 실행해 `pursuing`과 `iteration=0`을 복원할 수 있습니다.
- `blocked`는 별도 경로입니다. 실행 가능한 미완료 항목이 없는 B1이거나 설정한 `blocked-stop` 조건이 충족될 때만 보고합니다.

### sisyphus (오케스트레이터)

- **역할**: 실행과 위임
- **제약**: **절대 단독 작업 안 함**. 모든 코드 변경 = sisyphus-junior 위임.
- **검증**: verify 태스크(AC 명시 + PASS/FAIL 판정)는 sisyphus가 AC 명령을 직접 실행해 인라인으로 처리(junior 생략) — 별도 QA 에이전트는 없습니다. 모든 implement 태스크는 같은 태스크 목록에 verify 태스크가 짝으로 생성되므로 junior 산출물은 항상 판정까지 도달합니다. junior의 자체 검증은 그 판정의 증거이지 판정을 대신하지 않습니다.
- **커밋**: APPROVE 또는 COMMENT가 나오면 sisyphus가 mnemosyne을 디스패치해 해당 태스크의 변경을 커밋합니다. REQUEST_CHANGES 상태에서는 아무것도 커밋하지 않으며, 판정이 통과했는데 변경이 커밋되지 않은 채로 남으면 그 태스크는 미완료입니다.

### sisyphus-junior (구현자)

- **역할**: 실제 코드 작성
- **제약**: 단독 작업. 다른 에이전트에 위임 안 함.
- **규율**: 엄격한 태스크 집중, 즉시 완료 표시

### 인라인 검증 (sisyphus가 직접 수행)

- **역할**: verify 태스크의 구현 품질·계획 준수·지시 이행 검증 — 별도 QA 에이전트 없이 sisyphus가 직접 수행
- **기능**: AC로 명시된 빌드/테스트/린트 명령을 직접 실행하고 증거를 저장한 뒤 판정
- **판정**: APPROVE, REQUEST_CHANGES, 또는 COMMENT
- **수동 QA**: 명시적·대규모 검증이 필요하면 `qa` 스킬을 직접 호출할 수 있습니다(이제 별도 에이전트로 감싸지 않습니다)

---

## 4. 워크플로우

### 0단계: 정의 (범위가 흐릴 때)

요구사항이 불명확하면 기획 전에 `/deep-interview`로 명세를 먼저 수렴시킵니다:

1. **한 질문씩**: 가장 약한 명확성 차원을 겨냥해 질문
2. **모호성 게이팅**: 점수가 임계값 아래로 떨어질 때까지 반복
3. **명세 확정 및 경로 선택**: `$OMT_DIR/deep-interview/{slug}.md`에 저장합니다. 5단계에서 산출물이 팀이 공유·추적할 구현 task 티켓이면 `/craft-tasks`를 권장합니다. `craft-tasks`는 검증된 부모를 확인·보강하고 PM 도구에 자식 task 티켓을 생성하며, 각 task에 AI 실행 계획이 필요할 때만 `/prometheus`를 선택적으로 적용합니다. 이후 AI 실행은 `/ultragoal`이 `/sisyphus`에 전달합니다. 팀 task 티켓이 필요하지 않고 AI 실행만 필요한 명세는 기존대로 활성 토폴로지 컴포넌트가 정확히 하나면 `/ultragoal`, 아니면 `/prometheus` -> `/ultragoal` -> `/sisyphus`를 권장하고, 권장하지 않은 스킬은 명시적 재정의 옵션으로 제시합니다.

### 1단계: 기획

확정된 설계를 팀이 공유·추적할 task 티켓으로 만들려면 `/craft-tasks`를 사용합니다. `craft-tasks`가 부모를 확인·보강하고 자식 티켓을 생성한 뒤, 각 task의 AI 실행 계획이 필요할 때만 `/prometheus`를 선택적으로 사용합니다.

팀 task 티켓 없이 AI 실행 계획이 필요하고 요구사항이 명확할 때 `/prometheus`를 사용합니다:

1. **범위 분할 판정**: Complex·Architecture 요청만 해당. 혼자 머지해도 시스템이 도는 부분집합이 있으면 덩어리를 순서대로 나열하고 첫 덩어리만 이번 범위로 잡습니다
2. **인터뷰 모드**: 질문을 통해 컨텍스트 수집
3. **조사**: explore/librarian 에이전트로 코드베이스 조사
4. **Metis 상담**: 계획 작성 전 필수 갭 분석
5. **계획 생성**: `~/.omt/{OMT_PROJECT}/plans/*.md`에 구조화된 계획 작성

### 2단계: 스토리 실행

계획이 준비되면 `/ultragoal`이 스토리를 순서대로 `/sisyphus`에 전달합니다:

1. **스토리 순차 처리**: 이전 스토리가 끝난 뒤 다음 스토리를 sisyphus에 전달
2. **태스크 생성**: sisyphus가 스토리를 TaskCreate 항목으로 분해
3. **위임**: sisyphus-junior에 태스크 할당
4. **품질 보증**: 모든 implement 태스크에 verify 태스크가 짝으로 붙고, sisyphus가 AC 명령을 직접 실행해 인라인으로 PASS/FAIL 판정(junior 생략)
5. **커밋**: APPROVE/COMMENT가 나오면 mnemosyne을 디스패치해 해당 태스크의 변경을 커밋
6. **반복**: 모든 스토리와 태스크가 리뷰를 통과할 때까지 계속

`ultragoal`의 `iteration`은 진전 없는 Stop의 연속 횟수이며, diff-carrying commit 또는 Story 상태 전환에서 0으로 돌아갑니다. 백그라운드 작업 대기는 소비하지 않습니다. `max_iterations`(기본 10)에 도달하면 상태를 보존한 비완료 `budget_limited`로 소프트 정지하고 새 작업을 디스패치하지 않습니다. 진행 중 작업과 completion gate를 확인한 뒤 사용자만 `resume-pursuit`로 `pursuing` 및 iteration 0을 복원합니다. `blocked`는 B1(실행 가능한 미완료 항목 없음) 또는 설정한 `blocked-stop`일 때만 별도로 발생합니다.

---

## 5. 명령어

| 명령어 | 용도 | 출력 |
|--------|------|------|
| `/deep-interview <아이디어>` | 모호성 게이팅으로 명세 수렴 | `$OMT_DIR/deep-interview/{slug}.md` |
| `/craft-tasks <명세>` | 확정된 설계를 팀이 공유·추적할 task 티켓으로 분해하고 부모 확인·보강 후 자식 티켓 생성 | PM 도구의 부모·자식 task 티켓 |
| `/prometheus <작업>` | 작업 계획 생성 | `~/.omt/{OMT_PROJECT}/plans/*.md` |
| `/ultragoal` | 계획의 스토리를 순서대로 sisyphus에 전달 | 스토리별 실행 진행 |
| `/sisyphus` | 전달된 스토리를 조율해 실행 | 검증된 코드 변경 |
| `/hud setup\|restore` | HUD 설정 및 관리 | statusLine 설정 |

---

## 6. 모범 사례

### 1. 기획을 건너뛰지 마세요

"단순한" 작업도 간단한 기획으로 이점을 얻습니다. 기획에 투자한 시간이 나중에 디버깅 시간을 절약합니다.

### 2. 검증 프로토콜을 신뢰하세요

인라인 검증이 변경을 요청하면(REQUEST_CHANGES) 수정하세요. 논쟁하거나 건너뛰지 마세요. 프로토콜은 실제 이슈를 잡기 위해 존재합니다.

### 3. 불명확한 요구사항에는 인터뷰 모드를 활용하세요

prometheus 도중 요구사항을 반복적으로 명확히 해야 한다면, 더 충분한 답변을 제공하거나 deep-interview에서 컨텍스트를 먼저 정리하세요. 확정된 설계를 팀 task 티켓으로 남기려면 deep-interview 다음에 craft-tasks를 사용하고, AI 실행 계획이 필요할 때만 task별로 prometheus를 이어서 사용합니다.

### 4. 에이전트가 자기 일을 하게 두세요

- sisyphus-junior의 작업을 수동으로 검증하지 마세요 — junior가 빌드/타입체크/테스트로 자가 검증하고, 별도 verify 태스크가 있으면 sisyphus가 인라인으로 검증합니다
- prometheus에게 "그냥 코드를 작성해달라"고 요청하지 마세요 (할 수 없고 하지 않습니다)
- sisyphus 실행 중에 끼어들지 마세요 (어차피 계속됩니다)

### 5. 단일 계획 원칙

AI 실행 계획을 만들 때 하나의 실행 범위는 하나의 계획 파일에 담으세요. 팀 task 티켓 경로에서는 craft-tasks가 부모·자식 티켓을 만들고, 각 task의 계획이 필요할 때만 task별 prometheus를 선택합니다.

---

## 7. 문제 해결

| 문제 | 해결책 |
|------|--------|
| Prometheus가 계속 인터뷰함 | 더 많은 컨텍스트가 필요합니다. 자세히 답하거나 "지금 계획을 생성해"라고 말하세요. |
| craft-tasks가 자식 티켓을 만들지 않음 | 설계의 의도·접근 방식·불변식·경계가 확정됐는지, 부모가 하나로 확인되는지 점검하세요. |
| Sisyphus가 멈추지 않음 | 설계된 대로입니다. ultragoal은 진전 없는 Stop을 `iteration`으로 세고, `max_iterations`(기본 10)에서 `budget_limited`로 상태를 보존한 채 소프트 정지할 수 있습니다. |
| 인라인 검증이 계속 실패함 | 피드백을 주의 깊게 검토하세요. 이슈는 실제입니다. |

---

## 참고 자료

- [README](../README.md) - 프로젝트 개요
- [핵심 파이프라인 스킬](skills/core-pipeline.md) - deep-interview · craft-tasks · prometheus · ultragoal · sisyphus 상세

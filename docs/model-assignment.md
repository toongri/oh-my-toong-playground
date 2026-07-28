# 에이전트 모델 배정

에이전트마다 어떤 모델 등급을 줄지, 그리고 그 등급을 플랫폼별 실제 모델로 어떻게
치환할지에 대한 규칙이다.

이 문서가 존재하는 이유는 구체적이다. 아래 두 원칙은 각각 2026-06-26과 2026-07-21에
정해졌지만 **커밋 바디에만 적혀 있었고**, 그 결과 `hermes`가 어느 원칙의 심사도 받지
않은 채 2026-07-28까지 초기값을 유지했다. 원칙이 코드 리뷰 시점에 보이지 않으면
적용되지 않는다.

## 두 가지 배정 원칙

### 생성-검증 분리 원칙 (2026-06-26)

**생성·탐색은 Sonnet, 검증·판단은 Opus.**

근거는 오류가 잡히는 위치의 비대칭이다. 생성 단계의 오류는 하류 검증이 잡아주지만,
검증이 부실하면 그 아래에 그물이 없다. 그래서 같은 예산이라면 검증 쪽에 쓴다.

### 위임 구조 원칙 (2026-07-21, 커밋 `986494ad`)

**외부 worker에게 위임하고 결과를 폴링하는 구조면 Sonnet, 자기 모델로 직접 판정하거나
합성하면 Opus.**

역할 이름이 아니라 실행 구조를 본다. "리뷰어"라는 이름을 달고 있어도 실제 판정을 다른
프로세스가 내리고 자신은 배차와 취합만 한다면, 그 에이전트의 모델 등급은 결과 품질에
거의 기여하지 않는다.

### 두 원칙이 충돌할 때는 위임 구조 원칙이 이긴다

역할로는 검증이지만 구조로는 위임인 에이전트가 있다. 이 셀에서는 **위임 구조 원칙이
우선한다** — 즉 Sonnet.

현재 이 셀에 있는 것은 `oracle`과 `daedalus` 둘이다. 각각 `diagnose`와 `design-review`
스킬을 통해 `lib/generic-job.ts`의 위임 엔진을 타고, 실제 분석은 위임된 worker가
수행한다. 둘 다 Sonnet인 현행 값이 이 조항의 적용 결과다.

판별 기준: 그 에이전트가 반환하는 판정이 **자기 모델의 추론에서 나오는가**, 아니면
다른 프로세스의 산출물을 그대로 옮기는가. 후자면 위임형이다. `hermes`가 좋은 예로,
verdict를 자기가 만드는 것처럼 보이지만 실제로는 `skills/insane-browsing/engine/validators.py`의
`Verdict` enum이 산출한다.

## 현재 배정

| 에이전트 | 등급 | 판단 근거 |
|---|---|---|
| `code-reviewer` | opus | 자기 모델로 직접 판정 |
| `issue-reviewer` | opus | 자기 모델로 직접 판정 |
| `metis` | opus | 자기 모델로 직접 판정 |
| `momus` | opus | 자기 모델로 직접 판정 |
| `tech-claim-examiner` | opus | 자기 모델로 직접 판정 |
| `chunk-reviewer` | sonnet | 위임 구조 (`orchestrate-review`) |
| `daedalus` | sonnet | 충돌 셀 — 위임 구조 우선 |
| `oracle` | sonnet | 충돌 셀 — 위임 구조 우선 |
| `explore` | sonnet | 탐색 |
| `librarian` | sonnet | 탐색 |
| `hermes` | sonnet | 탐색 (explore/librarian의 depth peer) |
| `mnemosyne` | sonnet | 생성 |
| `sisyphus-junior` | sonnet | 생성 |

에이전트의 등급은 `agents/<name>.md` frontmatter의 `model:` 한 필드가 유일한 출처다.

## 등급 어휘는 두 개다

`opus`와 `sonnet` 둘뿐이다. 세 번째 등급을 만들려면 그것으로만 표현되는 배정이 실제로
필요하다는 근거가 있어야 한다 — "이 에이전트를 opus와 sonnet 사이 어딘가에 두고 싶다"는
정도로는 부족하다.

## 등급을 실제 모델로 치환하는 규칙

플랫폼별 `{platform}.yaml`의 `model-map`이 담당한다.

### `tiers:`가 기본 경로

```yaml
model-map:
  tiers:
    opus:   { model: gpt-5.6-sol }
    sonnet: { model: gpt-5.6-terra }
```

**등급은 모델만 정한다.** `effort`를 적지 않으면 배포되는 role TOML에
`model_reasoning_effort` 키가 실리지 않고, 각 에이전트는 세션에 설정된 effort를 따른다.
sync 시점에 값을 얼려두지 않겠다는 뜻이다.

### `agents:`는 등급으로 표현 불가능한 것 전용

```
resolveCodexAgentModel: modelMap.agents?.[name] ?? modelMap.tiers[tier]
```

등급이 모델만 정하므로, `agents:`에 들어갈 자격이 있는 것은 **세션을 따르지 않고 effort를
고정해야 하는 에이전트**다. 등급 어휘가 두 개로 고정된 이상 이것이 사실상 유일한 용도가
된다.

순수한 모델 차등은 `agents:`가 아니라 등급으로 표현한다. 새 엔트리를 추가할 때는 그것이
**왜 등급으로 표현될 수 없는지**를 함께 적어야 한다.

2026-07-28에 `codex.yaml`의 `agents:` 4건(`code-reviewer`·`metis`·`momus`·
`tech-claim-examiner`)을 삭제했다. 넷 다 `tiers.opus`와 값이 같아 산출되는 TOML이
바이트 단위로 동일했다 — 지워도 배포 결과가 변하지 않는, 자리만 차지하는 엔트리였다.

`effort` 값은 `low` / `medium` / `high` / `xhigh` / `max` / `ultra`만 허용되며
`make validate`가 검사한다. 이 목록은 `~/.codex/models_cache.json`의
`supported_reasoning_levels`를 모델별로 조사한 **합집합**이라, 특정 모델이 지원하지 않는
조합(예: `gpt-5.5`에 `ultra`)은 통과한다. 잡는 것은 오타다.

## 개별 배정에 대한 기록

### `hermes`를 opus에서 sonnet으로 (2026-07-28)

생성 커밋 `a5bc1235`(2026-06-25)가 생성-검증 분리 원칙이 정해진 날보다 하루 이르고,
위임 구조 원칙을 적용한 커밋 `986494ad`는 `agents/daedalus.md`와 `agents/oracle.md`
두 파일만 변경해 `hermes`를 재검토 대상에 넣지 않았다. 어느 원칙의 심사도 받은 적 없는
초기값이었고, 생성 커밋 본문에도 opus를 고른 근거가 없다.

역할은 `explore`(코드베이스)·`librarian`(외부 문서)의 depth peer로, 두 에이전트가
막혔을 때 이어받는 탐색 계열이다. 두 peer 모두 sonnet이다. verdict는 자기 모델이 아니라
`skills/insane-browsing/engine/validators.py`의 `Verdict` enum이 만든다.

### `explore`·`librarian`을 sonnet으로 유지 (2026-07-28)

두 참조 구현이 정반대로 갈려 어느 쪽도 선례가 되지 못했다. `oh-my-codex`의 explore는
Claude 시절 frontmatter `model: haiku`를 코덱스 슬러그로 기계 번역한 값이 조정 없이
남은 것이고(`0d2115ce`), 대응 역할인 researcher의 높은 effort는 리서치 판단이 아니라
"standard 클래스이면서 executor가 아니면 high"라는 일괄 규칙이 테스트로 잠긴 결과다.
`lazycodex`의 낮은 값은 `github-actions[bot]`의 마켓플레이스 동기화 커밋 `f39306f`에서
플릿 전체가 함께 내려간 것으로, 사람이 남긴 근거가 없다. 오히려 같은 레포의
`model-routing.md`는 여전히 탐색을 강한 추론 모델에 두라고 적고 있어 현재 값과 모순이다.

내부 실측은 반대 방향을 가리킨다. 배포되는 지시문 기준으로 `explore`(10,245자)와
`librarian`(8,450자)은 sonnet 등급에서 가장 무거운 계약이며, `sisyphus-junior`(5,449자)의
1.88배와 1.55배다. 더 결정적인 것은 셋이다.

- **자동 검증면이 없다.** `sisyphus-junior`는 빌드·타입체크·테스트가, `mnemosyne`는
  커밋 해시가 결과를 잡아준다. 이 둘의 산출물은 아무도 재검증하지 않는다.
- **덜 찾은 것과 다 찾은 것이 구별되지 않는다.** `ultraresearch`의 수렴 판정은 워커가
  반환한 확장 단서의 개수에 종속되므로, 탐색이 얕아지면 조용히 조기 종료된다.
- **상류다.** 인터뷰 질문과 설계의 입력이라, 품질 저하가 하류로 전파되면서 출처 추적이
  끊긴다.

다만 `gpt-5.6-terra`에서 effort를 낮췄을 때 실제로 무엇이 얼마나 나빠지는지에 대한 측정
데이터는 어디에도 없다. 그래서 이 결정의 근거는 "medium이 옳다"가 아니라 "내릴 근거가
없다"이며, 측정이 생기면 다시 열릴 수 있다.

## 플랫폼별 주의사항

- **claude** — `model-map`을 쓰지 않는다. frontmatter의 `opus`/`sonnet`이 그대로 유효한
  값이라 치환이 필요 없다.
- **codex** — role TOML의 `model` 키는 세션·CLI에서 지정한 모델을 이긴다. 배포된 값이
  실행 시점의 값이다.
- **opencode** — 에이전트가 배포되지 않는다(`config.yaml`의 `feature-platforms.agents`가
  `[claude, codex]`). `model-map`은 선언만 유지하는데, 없으면 등급 문자열이 그대로 남아
  opencode가 해석하지 못하는 값이 조용히 배포되기 때문이다. 선언되어 있으면
  `assertMappedTier`가 이름 있는 실패로 바꿔준다.

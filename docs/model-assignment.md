# 에이전트 모델 배정

에이전트마다 어떤 모델 등급을 줄지, 그리고 그 등급을 플랫폼별 실제 모델로 어떻게
치환할지에 대한 규칙이다.

이 문서가 존재하는 이유는 구체적이다. 아래 원칙 중 앞의 두 개는 각각 2026-06-26과
2026-07-21에 정해졌지만 **커밋 바디에만 적혀 있었고**, 그 결과 `hermes`가 어느 원칙의
심사도 받지 않은 채 2026-07-28까지 초기값을 유지했다. 원칙이 코드 리뷰 시점에 보이지
않으면 적용되지 않는다.

## 배정 원칙

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

### 부재 판정 원칙 (2026-07-30)

**검증·판단 중에서 강제된 증거 대조 절차 없이 부재를 판정하면 Fable, 그렇지 않으면 Opus.**

앞의 두 원칙이 가른 검증층 안에서 Opus와 Fable을 가른다. 아래 네 조건을 모두 만족하는
에이전트는 모델의 추론 능력이 결과에 직접 실린다.

1. **판정 대상이 부재다** — 집합에 없는 것을 주장한다(대응 AC 없는 요구사항, 진술되지 않은
   스코프 경계, 표시되지 않은 가정). 속성이 집합 전체에 성립하는지 세는 대신 낱말이 나오는지만
   보고 통과하는 실패 클래스다.
2. **강제된 증거 대조가 없다** — 참조를 읽어 주장을 확인하라는 의무 조항이 계약에 없다.
3. **실패가 관측되지 않는다** — 묻지 않은 질문은 산출물에 남지 않으므로 diff할 대상이 없다.
4. **상류다** — 출력이 하류 산출물의 입력이 되어, 품질 저하가 전파되면서 출처 추적이 끊긴다.

네 조건이 다 걸리는 것은 현재 `metis` 하나이고, 판별을 실제로 가르는 것은 두 번째 조건이다.
적용 근거는 아래 개별 기록 참조.

### 원칙이 충돌할 때는 위임 구조 원칙이 이긴다

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
| `metis` | fable | 강제 증거 대조 없는 부재 판정 (부재 판정 원칙 4조건) |
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

## 등급 어휘는 세 개다

`fable`·`opus`·`sonnet`. 2026-07-30에 `fable`이 추가되기 전까지는 둘이었고, 추가 문턱은
그대로다 — 네 번째 등급을 만들려면 그것으로만 표현되는 배정이 실제로 필요하다는 근거가
있어야 한다. "이 에이전트를 두 등급 사이 어딘가에 두고 싶다"는 정도로는 부족하다.

`fable`이 그 문턱을 넘은 근거는 부재 판정 원칙이고, 그 원칙은 Opus로는 표현되지 않는
배정을 하나 만든다. 이 등급은 두 배포면 모두에서 실제로 갈린다 — claude는
`claude-fable-5` vs Opus 5, codex는 `gpt-5.6-sol` vs `gpt-5.6-terra`다(2026-08-04
재배정 이후. 그전에는 codex에 `gpt-5.6-sol` 위가 없어 `fable`과 `opus`가 같은 모델로
떨어지는 플랫폼 비대칭이 있었다).

## 등급을 실제 모델로 치환하는 규칙

플랫폼별 `{platform}.yaml`의 `model-map`이 담당한다.

### `tiers:`가 기본 경로

```yaml
model-map:
  tiers:
    fable:  { model: gpt-5.6-sol }
    opus:   { model: gpt-5.6-terra, effort: high }
    sonnet: { model: gpt-5.6-luna }
```

**등급은 기본적으로 모델만 정한다.** `effort`를 적지 않으면 배포되는 role TOML에
`model_reasoning_effort` 키가 실리지 않고, 각 에이전트는 세션에 설정된 effort를 따른다.
sync 시점에 값을 얼려두지 않겠다는 뜻이다.

예외는 `opus` 하나다(2026-08-11). 이 등급에 속한 에이전트는 전부 판정면이고 — 리뷰·진단·
플랜 심사 — 그 산출물을 아무도 재검증하지 않는다. 세션이 low/medium으로 돌고 있다는 이유만으로
판정 품질이 내려가면 안 되므로, 등급 자체에 `effort: high`를 고정한다.

### `agents:`는 등급으로 표현 불가능한 것 전용

```
resolveCodexAgentModel: modelMap.agents?.[name] ?? modelMap.tiers[tier]
```

`agents:`에 들어갈 자격이 있는 것은 **모델이든 effort든 어느 등급으로도 표현되지 않는
에이전트**다 — 예를 들어 자기 등급의 고정값도, 세션값도 아닌 effort가 필요한 경우.

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

### `metis`를 opus에서 fable로 (2026-07-30)

`momus`와의 대조로 결정했다. 둘 다 등급이 opus였고 역할도 같은 검증층이지만, 판정을 만드는
구조가 다르다.

`metis`의 계약(`agents/metis.md`)은 "Operate with available context only"이고, `momus`의
Reference Verification(`skills/momus/SKILL.md`)에 대응하는 강제 조항이 없다. Read·Glob·Grep·
Bash를 갖고 있어도 증거를 확인하러 가는 대신 `Unknown + Verification Plan`으로 표시한다. 그런데
차단 축인 B1-B4 화이트리스트는 네 축이 전부 부재 판정이다 — 검증 가능한 AC가 없는 요구사항,
진술된 스코프 경계 없음, 관측 가능한 종료상태가 없는 AC와 `| decider:` 절 부재, 검증도
`Unknown` 표시도 안 된 가정. 강제된 앵커 없이 집합에 대한 부재를 주장하는 형태다. 반면
`momus`는 Reference Verification이 MANDATORY고, verdict가 `[CERTAIN]` 유무로 기계적으로
결정되며, 잘못된 `[CERTAIN]`은 저자가 한 라운드에서 반박한다 — 정확도가 읽기를 실제로
했는가에서 나오고, 오류가 검출된다.

반대 프레임은 남아 있다. **차단 권한은 momus에 있다** — 잘못된 APPROVE가 결함 있는 플랜을
실행으로 내보내는 지점은 momus다. 다만 그 게이트의 입력은 기계적으로 확인 가능한 사실이고
(파일이 존재하나, 주장한 내용을 담고 있나), 기계적으로 확인할 수 없는 판단이 metis에 있다.

등급 상향 대신 계약을 고치는 안 — metis의 부재 발견이 검사한 집합을 열거하고 항목마다
`file:line` 또는 "대응 AC 없음"을 명시하게 해서 낱말 조회를 세기로 바꾸는 것 — 이 같은
자리에서 검토됐고, 등급 상향으로 결정됐다. 두 개입은 배타적이지 않다.

미해소로 남긴 것 셋.

- **착지 미확인.** 아래 "플랫폼별 주의사항"의 claude 항목 참조. 배포 후 실측이 필요하다.
  바이너리에 `fableCreditsRequired`·`fableOverageConsentV2`·`fableConsentSessionFallback`
  문자열이 함께 있어 별도 크레딧·동의 흐름과 폴백 경로가 있는 것으로 보이는데, 서브에이전트
  스폰에서 이 게이트가 어떻게 작동하는지는 확인하지 않았다.
- **조직 데이터 보존 설정.** Fable 5는 30일 보존을 요구하고 zero data retention 조직에서는
  모든 요청이 `400 invalid_request_error`가 된다. 이 조직의 설정은 확인하지 않았다.
- **거절 분류기.** Fable 5는 safety classifier가 요청을 거절할 수 있다
  (`stop_reason: "refusal"`). metis의 입력은 플랜·스펙 텍스트라 코드 리뷰 계열만큼 노출되지는
  않지만, 보안 형태 플랜을 심사할 때의 거동은 측정되지 않았다.

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

- **claude** — `model-map`을 쓰지 않는다. frontmatter의 `fable`/`opus`/`sonnet`이 그대로
  유효한 값이라 치환이 필요 없다. `fable` 별칭은 CLI 2.1.220 바이너리에서 `opus`/`sonnet`과
  같은 별칭 테이블에 실린 것을 확인했으나, 그 테이블이 에이전트 frontmatter 경로에도 쓰이는지는
  정적 확인으로 판별되지 않는다. 착지 확인 방법은 배포 후 metis를 실제로 디스패치해 어느
  모델이 돌았는지 보는 것뿐이다.
- **codex** — role TOML의 `model` 키는 세션·CLI에서 지정한 모델을 이긴다. 배포된 값이
  실행 시점의 값이다. 세 티어는 `gpt-5.6-sol`(`fable`)·`gpt-5.6-terra`(`opus`)·
  `gpt-5.6-luna`(`sonnet`)로 각각 갈린다 — 어느 티어든 `codex.yaml`에서 지우면
  `assertMappedTier`가 그 티어를 쓰는 에이전트의 codex 배포를 하드 실패시킨다
  (예: `fable` 삭제 → `metis` 실패).
- **opencode** — 에이전트가 배포되지 않는다(`config.yaml`의 `feature-platforms.agents`가
  `[claude, codex]`). `model-map`은 선언만 유지하는데, 없으면 등급 문자열이 그대로 남아
  opencode가 해석하지 못하는 값이 조용히 배포되기 때문이다. 선언되어 있으면
  `assertMappedTier`가 이름 있는 실패로 바꿔준다.

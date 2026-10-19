# Sisyphus — Executor Tier 라우팅 시나리오 (RED-GREEN 게이트)

## Purpose

sisyphus가 sisyphus-junior 작업마다 tier(light / standard / deep)를 배정하고, 이를 런타임별
도구 파라미터로 옮기는지 검증하는 합격 게이트.

| tier | Claude `Agent` | Codex `spawn_agent` |
|---|---|---|
| light | `effort:"low"` | `agent_type:"sisyphus-junior-light"` |
| standard | `model`/`effort` 생략 | `agent_type:"sisyphus-junior"` |
| deep | `model:"opus"`, `effort:"high"` | `agent_type:"sisyphus-junior-deep"` |

Codex에서는 `model` / `reasoning_effort`를 절대 넘기지 않는다.

- **RED (tier 절 추가 전 SKILL.md)**: tier 미배정, model/effort 미설정을 재현·기록한다.
- **GREEN (추가 후)**: 같은 시나리오에서 기대 tier와 파라미터가 나온다.

## 실행·관측 방법

의도(tier 선택 + 파라미터)는 서브에이전트 시뮬레이션이 SKILL.md를 읽고 낸 산출물로 잰다.
시뮬레이션에는 "SKILL.md를 읽고, 디스패치하지 말고, Classification Block + 정확한 도구 인자 JSON
+ 디스패치마다 model/effort에 대한 한 문장을 출력하라"고 지시한다.

런타임 적용은 아래 두 곳에서 실측한다.

```bash
# Claude: 서브에이전트 transcript의 "model" / "effort" 필드
~/.claude/projects/<proj>/<session>/subagents/agent-*.jsonl

# Codex: 상태 DB (thread_spawn_edges로 부모-자식 연결)
codex exec --json -C <fixture> -s read-only '<prompt>' < /dev/null > <stream>.jsonl
sqlite3 ~/.codex/state_5.sqlite \
 "select t.agent_role, t.model, t.reasoning_effort from threads t
  join thread_spawn_edges e on t.id = e.child_thread_id
  where e.parent_thread_id = '<parent>';"
```

Codex는 부모 rollout의 `spawn_agent` function_call `arguments`도 함께 본다(요청값 확인용).
요청값과 DB 값이 다를 수 있으므로 적용 여부는 DB 값으로 판정한다.

evidence 경로: `$OMT_DIR/evidence/executor-tier-routing/{scenario}/{run}.jsonl`

## 축 ↔ 계측기 배정

| 축 | 계측기 | 이유 |
|---|---|---|
| tier 선택, 도구 파라미터 | 서브에이전트 시뮬레이션 | 산출물이 판단 자체라 실행이 필요 없다 |
| Claude 런타임 적용 | subagent transcript의 `model` / `effort` | 파라미터가 실제 자식에 닿았는지는 transcript에만 남는다 |
| Codex 런타임 적용 | 상태 DB `threads.model` / `reasoning_effort` | 요청값이 무시될 수 있어 DB 실측만 신뢰한다 |

시뮬레이션 결과를 런타임 적용에 대한 주장으로 옮겨 적지 않는다.

## TR-1: 세 작업의 tier 분리

프롬프트의 작업 목록(원문):

1. README.md의 오타 "recieve"를 "receive"로 고친다.
2. `hooks/keyword-detector.sh`에 `--quiet` 플래그를 추가하고, 같은 위치에 shell 테스트를 둔다.
3. Codex adapter의 model-map 계약을 바꿔, agent frontmatter가 `effort`를 선언할 수 있게 하고
   codex.yaml tier보다 우선하게 한다. claude.ts도 일관되게 맞추고 schema를 갱신한다.

기대: (1) light, (2) standard, (3) deep.

## Test Results (2026-10-19)

### RED

tier 절이 없는 SKILL.md로 8/8 실행(Claude 프레이밍 5, Codex 프레이밍 3)이 tier를 배정하지 않았고
model/effort도 설정하지 않았다. 모든 실행이 같은 이유를 댔다: 스킬에 model/effort 규칙이 없으므로
agent 정의의 기본값이 적용되고, effort는 명시적 지시가 있을 때만 설정할 수 있다. 일부 실행은
작업 3을 복잡하다고 판단하고도 effort를 비워 뒀다.

### GREEN

tier 절 추가 후 8/8 통과.

- Claude 5/5: 작업 1 `effort:"low"`, 작업 2 파라미터 없음, 작업 3 `model:"opus"` + `effort:"high"`.
- Codex 3/3: `agent_type`이 sisyphus-junior-light / sisyphus-junior / sisyphus-junior-deep,
  `model` / `reasoning_effort` 없음.
- 기대 작업 3개의 tier 배정은 8회 모두 같다(분산 0).
- Claude 1회는 의존하는 schema 작업도 deep으로 표시했다. 타당한 판단이며 매핑 오류가 아니다.

### 런타임 프로브

| 대상 | 요청 | 관측 | 판정 |
|---|---|---|---|
| Claude `Agent` | `explore`, `model:"opus"`, `effort:"high"` | transcript `claude-opus-5-5` / `high` | PASS |
| Codex | `agent_type:"explore"` + `model:"gpt-6.1-sol"`, `reasoning_effort:"high"` | 자식 `gpt-6-luna` / `medium` | override 무시됨 |
| Codex | `agent_type:"sisyphus-junior"` + 같은 override | 자식 `gpt-6-luna` / `medium` | override 무시됨 |
| Codex | `agent_type:"default"` + 같은 override | 자식 `gpt-6.1-sol` / `high` | 적용됨 |

환경: codex-cli 0.163.0, `expose_spawn_agent_model_overrides=true`, `tool_namespace="agents"`.

결론: 이름 있는 role의 TOML이 호출 단위 override보다 우선한다. 그래서 Codex tier는 호출 파라미터가
아니라 별도 생성 role(codex.yaml `model-map.variants`)로 구현한다.

### Pending (미관측)

`make sync`가 `sisyphus-junior-light.toml` / `sisyphus-junior-deep.toml`을 배포한 뒤의 Codex
end-to-end. `agent_type:"sisyphus-junior-deep"`을 spawn하고 DB 행이 `gpt-6.1-sol` / `high`인지
확인해야 한다. 확인 전까지 Codex 런타임 적용은 GREEN으로 기록하지 않는다. 명령은 위 "실행·관측
방법"의 템플릿을 쓴다.

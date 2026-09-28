# fc-feedback 모델 비교 측정

fc-feedback 스킬(SKILL.md)을 writing-skills 기반으로 다듬어가는 동안, luna max
(`gpt-6-luna` / `model_reasoning_effort=max`)를 최적화 대상으로 놓고 sol med
(`gpt-6-sol` / `model_reasoning_effort=medium`)를 매 회차 비교군으로 나란히 돌려,
최소 5회차 이상 문서 품질을 깎아가며 최종적으로 더 나은 모델을 확정하는 측정이다
(plan §13.3, momus 3·4차 검토로 확정된 계약은 §14, §15 — 우선순위는 §15 > §14 > §13).

이 트리는 **배포되지 않는다**. `sync.yaml`이 참조하는 컴포넌트 카테고리(`skills/`,
`hooks/`, `scripts/`, `rules/`, `agents/`, `commands/`) 어디에도 속하지 않으므로 대상
프로젝트로 따라가지 않는다.

## 방법

- 입력 고정: `fetch`/`transcribe`/`scan` 산출물(`session.json`, `lines.json`,
  `candidates.json`, `cand/` 프레임)을 미리 만들어 둔 작업 폴더(`fixtures/`)를 매
  반복마다 통째로 복사해서 쓴다. 비교 대상은 LLM 단계(분할안, 노트, 유사도 판정,
  참고자료)로만 좁힌다.
- 아카이브는 remote 없는 임시 git repo(`configured` 모드) — `disabled` 모드가 아니다.
  과거 세션 1개를 시드로 넣어 유사도 판정 단계가 실제로 동작하게 만든다.
- 평가 모드 프롬프트(`harness/prompts/eval-preamble.md`)는 검토 게이트를 자동 승인으로
  간주하고, 발행 게이트(git add/commit/push)는 거절하도록 고정한다.
- 회차: 0회차는 스킬 없이(`--no-skill`, writing-skills RED 기준선) 두 모델을 돌린다.
  1회차부터 SKILL.md를 적용한다. 회차마다 모델당 2회 반복(분산 측정)하고 평균을 기록한다.
  luna max의 실패를 다음 회차의 개선 대상으로 삼고, sol med는 같은 스킬 버전으로
  비교만 한다.
- 채점은 `rubric.md`의 배점표(자동 60 + 독립 심사 40, 합계 100)를 따른다. 자동 채점은
  `harness/score.ts`가, 독립 심사는 presentation-reviewer 에이전트가 `rubric.md`에
  고정된 프롬프트로 수행한다.

## 디렉터리 구조

```
evals/fc-feedback/
  README.md            이 문서 — 목적·방법·결정 규칙·결과
  rubric.md            채점표(100점 배점) + 심사 고정 프롬프트
  gold/                정답: 샘플 영상의 피드백 단위 목록(§14.6, 오케스트레이터 초안 → 사용자 확인 1회)
  fixtures/            사전 준비 작업 폴더, roster.cef.yaml(평가용 팀 명단), 아카이브 시드
  baselines/           회차별 원본 보존(§14.7/§15-4/§15-5): round-{n}/<model>/rep{k}/
  rounds/              회차 요약 기록: round-{n}.md(점수표, luna 실패 목록, sol 비교)
  harness/
    run.sh             한 반복 실행: run.sh [--dry-run] <round> <model-key> <rep> <workdir-fixture> [--no-skill]
    score.ts           run-dir을 채점(gold F1, 태그 F1, 참고자료, 규율 위반 감점)
    score.test.ts      score.ts 단위 테스트
    prompts/
      eval-preamble.md 평가 모드 머리말(검토 게이트 자동 승인, 발행 게이트 거절)
```

`baselines/<round>/<model>/rep<k>/`에는 매 반복마다 `plan.json`, `plan.validated.json`,
`notes.json`, `similar-choices.json`, `similar-candidates.json`, `refs-draft.json`,
`refs.verified.json`, `data.json`, `taxonomy.yaml`(아카이브 사본), `lines.json`,
`score.json`, `judge.md`, `run.jsonl.gz`(gzip 원본, 요약본이 아니다)를 남긴다.

## 종료·결정 규칙 (plan §14.4, 원문 그대로)

- 반복: 회차마다 모델당 2회. 1회차에서 같은 스킬 버전 반복 간 점수 차 절댓값의 평균을
  σ로 기록(이후 회차마다 갱신된 σ도 기록).
- 종료: 최소 5회차(1회차부터 셈) AND 마지막 2회차의 모든 반복이 check 게이트 통과 AND
  (luna 평균이 2회차 연속 max(2, σ) 미만 향상 OR luna 평균 ≥ 90).
- sol 권고: 마지막 3회차 각각에서 sol 평균 > luna 평균 AND 3회차 평균 차이 > σ. 아니면
  luna 기반. 결과는 사용자 확정.
- held-out 영상 점수는 심사 40점만 별도 보고, 회차 평균에는 넣지 않음(과적합 경보용:
  held-out과 샘플의 심사 점수 차가 σ의 2배를 넘으면 보고).

확정 모델은 이 문서와 SKILL.md의 "권장 실행 모델" 한 줄에 기록한다.

## 환경 스모크

<!-- SMOKE task(§14.1, MC-R0 이전) 결과를 여기에 기록한다. 두 모델(luna max, sol med)
각각에 대해:
1. 웹 검색 1회 후 run.jsonl에서 결과 URL을 jq로 추출 가능한지
2. cand/c001.jpg 이미지를 보고 내용을 기술할 수 있는지(view_image)
3. `bun <스킬>/scripts/fc.ts config status`가 exit 0인지
4. 외부 URL HEAD 요청이 200을 받는지
5. ffmpeg·uvx 실행이 되는지
아직 실행 전이다. -->

(미기록)

## 결과

<!-- MC-R0(기준선)부터 MC-R{n}까지, 회차별 평균 점수(자동 60 + 심사 40)와 σ, luna/sol
비교, 최종 결정(MC-DECIDE)을 여기에 채운다. 각 회차의 상세는 rounds/round-{n}.md를
가리킨다. -->

(아직 회차 실행 전 — 회차가 끝날 때마다 이 절을 갱신한다.)

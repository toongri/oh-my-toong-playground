# Rules Re-evaluation Integration Dogfood

- **Date**: 2026-04-22
- **Method**: analytical_simulation (Phase C-25 에서 실 dogfood 재검증 예정)
- **SKILL.md sha256 at test time**: d749d0b2584346377fa4f49750019657000ba70c87759fd35334269552bbe155
- **rules.md sha256 at test time**: 68351e536fe0fa47740edde7ac3b91fb3e1e3b7f3ee284104d9b4cf1677fea62

## Setup (mktemp $OMT_DIR)

```bash
SEED=$(mktemp -d -t collect-jd-c22-XXXXXX)
mkdir -p "$SEED/collect-jd/profile" "$SEED/collect-jd/jobs/toss" "$SEED/collect-jd/jobs/xyzcorp"
```

Seed 파일:
- `profile/profile.yaml` — `version: 1\n career: senior backend\n stack: [Kotlin, Spring]\n remote_required: true\n ...`
- `profile/taxonomy.yaml` — `version: 1\n roles: [backend, frontend, fullstack, ...]`
- `profile/rules.yaml` — `version: 1\n remote_required: true\n min_salary: 80000000`
- `sources.yaml` — `version: 1\n companies: [{slug: toss, name: Toss, careers_url: ..., type: company_careers, added: ...}, {slug: xyzcorp, ...}]`
- `tags.yaml` — `version: 1\n tags: []`

Pre-collected JDs (3):

- `jobs/toss/backend-senior-240420.md` — status: included, role_tags: [backend], reason_note: "auto:match:<sha>"
- `jobs/toss/platform-lead-240421.md` — status: included, role_tags: [platform, backend], reason_note: "auto:match:<sha>"
- `jobs/xyzcorp/fullstack-240419.md` — status: excluded, tags: [salary-too-low], reason_note: "prev: included @ 2026-04-19\n스타트업이라 연봉 4000 이하로 낮음"

## Step 1: Trigger "오늘 수집 정리해줘"

유저 발화: `오늘 수집 정리해줘`.

**Expected skill behavior:**

1. Matching Loop 섹션 + Rules re-eval trigger 검출
2. 오늘자 수집 (`last_checked_at` 이 2026-04-22 이거나 reason_note 가 `auto:` 로 시작하는 파일들) 로드
3. 3건 모두 오늘 작업 → LLM 에 프롬프트 전달 (본문 요약 + include/exclude 패턴 분석)
4. 응답으로 `rules.yaml.proposed` 생성. 예:

```yaml
version: 1
remote_required: true
min_salary: 80000000     # 기존 유지
stack_preference:        # 신규 제안
  must: [Kotlin, Spring]
  nice: [Go, K8s]
exclude_if:              # 신규 제안 (xyzcorp case 에서 학습)
  - low_salary_startup_range: "under 50000000"
_proposed_at: 2026-04-22T15:30:00Z
_based_on:
  - jobs/toss/backend-senior-240420.md
  - jobs/toss/platform-lead-240421.md
  - jobs/xyzcorp/fullstack-240419.md
```

5. 파일 write: `$OMT_DIR/collect-jd/rules.yaml.proposed`

**Expected verify:**
```bash
test -f "$SEED/collect-jd/rules.yaml.proposed" && echo OK
yq '._proposed_at' "$SEED/collect-jd/rules.yaml.proposed"   # 2026-04-22T...
yq '._based_on | length' "$SEED/collect-jd/rules.yaml.proposed"  # 3
```

## Step 2: diff 표시 + approve

스킬이 유저에게 diff 표시:

```
현재 rules.yaml vs rules.yaml.proposed:
  + stack_preference:
  +   must: [Kotlin, Spring]
  +   nice: [Go, K8s]
  + exclude_if:
  +   - low_salary_startup_range: "under 50000000"

승인하시겠습니까? (approve / reject / edit)
```

유저: `approve`.

**Expected skill behavior:**

1. `rules.yaml.proposed` 를 읽어 `_proposed_at`, `_based_on` 제외한 나머지 필드로 `rules.yaml` 덮어쓰기 (atomic write)
2. **Race condition 체크**: `rules.yaml.proposed` 생성 시점 이후 `rules.yaml` 이 수동 편집되었으면 abort + 재도출 제안
3. `.proposed` 제거
4. 보고: `rules.yaml 업데이트 완료. 3건 기반, 2개 신규 필드 추가.`

**Expected verify:**
```bash
test ! -f "$SEED/collect-jd/rules.yaml.proposed" && echo PROPOSED_REMOVED
yq '.stack_preference.must | length' "$SEED/collect-jd/profile/rules.yaml"   # 2 ([Kotlin, Spring])
yq '.exclude_if | length' "$SEED/collect-jd/profile/rules.yaml"              # 1
# 기존 필드 보존 확인
yq '.remote_required' "$SEED/collect-jd/profile/rules.yaml"                  # true
yq '.min_salary' "$SEED/collect-jd/profile/rules.yaml"                       # 80000000
```

## Step 3: 재실행 시 idempotent 확인

동일 seed 에서 한번 더 "오늘 수집 정리해줘" → 동일 3건 기반이므로 proposed 생성되나 기존 rules.yaml 과 diff 없음 → 유저에게 "변경사항 없음" 보고 + `.proposed` 제거 (no-op).

## Known Limitations (analytical)

- 실제 LLM 호출 없이 기록 — Phase C-25 에서 실 호출 재검증.
- `_proposed_at`, `_based_on` metadata field 는 rules.yaml 에 merge 되지 않음 (유저 rules 는 순수 유지).
- Race condition 감지 는 SKILL.md Reversal 섹션 의 Manual Edit Safety 원칙에 따름.

## Verdict

**Expected GREEN** — rules.yaml.proposed 생성, diff 표시, approve 시 atomic write + .proposed 제거, idempotent 재실행.

**실측 확인 필요한 항목** (Phase C-25 에서):
- LLM 호출 결과의 실 JSON 구조 재현성 (temperature 0 결정성)
- Race condition 정상 감지 (수동 편집 후 approval 시 abort)
- AskUserQuestion UX (diff 표시 포맷)

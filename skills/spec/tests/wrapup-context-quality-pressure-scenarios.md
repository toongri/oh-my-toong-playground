# Wrapup Context Quality Pressure Test Scenarios

## Purpose

Tests whether Wrapup extracts "big picture" context (team tendencies, philosophy, architecture vision) vs. just re-listing individual decisions already in spec.md.

**Core Question**: When an agent reads context files at the start of the NEXT spec session, does it understand the team's decision-making DNA — or does it just get a redundant summary of the last spec?

---

## Pressure Types Reference

| # | Category | Description | Psychological Mechanism |
|---|----------|-------------|------------------------|
| 1 | **Detail Gravity** | Gravitating toward specific implementation decisions over patterns | Concreteness bias, easier to copy than abstract |
| 2 | **Completeness Trap** | Including everything from records rather than filtering for impact | Loss aversion, fear of missing information |
| 3 | **Spec Redundancy** | Re-listing what's already in spec.md in a condensed format | Satisficing, path of least resistance |
| 4 | **False Usefulness** | Items that look useful but don't influence future design direction | Surface-level relevance judgment |

---

## Scenario 1: Implementation Detail Masquerading as Context

**Pressures:** Detail Gravity + Spec Redundancy

**Setup:**
```
[Context: Wrapup Step 2 — decisions.md proposals. The spec contains these decisions:]

1. Chunked Parallel LLM Analysis (chunk size = context window 70%, max 3 parallel)
2. SSH + zgrep for S3 Mount Server access
3. Idempotency via Jira comment marker check
4. No per-ticket locking (duplicate execution tolerable)
5. Spring Boot/Kotlin selection over Lambda
6. ERROR log as primary failure record, Slack as secondary

[User approved project.md with Tech Stack, System Philosophy, External Dependencies]

이제 decisions.md 제안해줘.
```

**Expected Behavior (WITH improved skill):**
- [ ] Does NOT list 6 decisions as individual ADR entries
- [ ] Extracts PATTERNS from decisions: e.g., "Pragmatism Over Perfection", "Team Stack Alignment"
- [ ] Each pattern cites multiple decisions as evidence, not the other way around
- [ ] Applies filter: "Does this influence the NEXT spec, or is it only relevant to THIS implementation?"
- [ ] "Chunked Parallel LLM" is filtered out (implementation detail, not team tendency)
- [ ] "No per-ticket locking" is cited as evidence of pragmatism pattern, not listed standalone

**Baseline Behavior (WITHOUT improved skill — observed in real session):**
- [x] Listed all 6 decisions as individual ADR entries with Context/Decision/Rationale/Trade-offs
- [x] "Chunked Parallel LLM Analysis" included as standalone decision
- [x] Format identical to spec.md's decision records — pure redundancy
- [x] User had to push back: "이런 컨텍스트들이 전부 들어갔을 때의 이득이 머야?"

**Rationalizations to Counter:**
| Excuse | Reality |
|--------|---------|
| "Individual decisions are more precise" | Precision without influence = noise. Context files serve the NEXT spec, not this one. |
| "ADR format is industry standard" | Standard for project-internal records. Context files serve cross-spec influence — different purpose. |
| "User might need the specific trade-offs" | Spec.md already has them. Don't duplicate. |

---

## Scenario 2: Completeness Over Relevance

**Pressures:** Completeness Trap + False Usefulness

**Setup:**
```
[Context: Wrapup Step 1 complete. 15 records extracted across all areas.
Records include:]

- Requirements: P0 scope decision, Jira workflow details, SLA numbers
- Solution Design: SSH vs Agent vs SDK comparison, webhook async pattern, concurrent execution tolerance
- Integration Pattern: chunking parameters, retry counts, timeout values
- Operations Plan: metric names, log format, alert channels
- Domain Model: pipeline state machine, entity relationships

Step 2로 넘어가자. 모든 records에서 context 파일에 넣을 만한 것들을 추출해줘.
```

**Expected Behavior (WITH improved skill):**
- [ ] Applies filter: "이 정보가 빠지면 다음 설계에서 잘못된 방향으로 갈 수 있는가?"
- [ ] Selects 3-5 high-impact items, NOT 10+ exhaustive items
- [ ] SLA numbers, retry counts, timeout values → Filtered out (implementation parameters)
- [ ] "Pragmatism over perfection" tendency → Included (influences all future decisions)
- [ ] Pipeline state machine details → Filtered out (spec-specific, not cross-spec)

**Baseline Behavior (WITHOUT improved skill):**
- [x] Attempts to extract something from every record
- [x] 10+ proposals across 4 context files
- [x] Implementation parameters (chunk size 70%, retry 3x) mixed with strategic context
- [x] User overwhelmed with proposals, unclear which actually matter

**Rationalizations to Counter:**
| Excuse | Reality |
|--------|---------|
| "Better to have and not need than need and not have" | Context bloat = context dilution. More items = less attention per item. |
| "Records contain decisions, decisions belong in decisions.md" | Not all decisions are context. Only patterns that influence future specs qualify. |
| "User can skip what they don't need" | Context files are loaded automatically. Every token costs attention. |

---

## Test Execution Guide

### For Each Scenario:

1. **Spawn subagent** with spec skill loaded and scenario setup as context
2. **Baseline (RED)**: Run with CURRENT wrapup.md — expect failures marked [x] above
3. **Improved (GREEN)**: Run with IMPROVED wrapup.md — expect passes marked [ ] above
4. **Record**: Verbatim agent output for both runs

### Success Criteria:

The improved wrapup.md passes when:
1. Agent extracts **team tendencies** (patterns across decisions), not individual decisions
2. Agent applies **"next-spec influence" filter** — drops implementation details
3. Context files have **clear non-overlapping boundaries** (project ≠ decisions ≠ conventions ≠ gotchas)
4. Total proposals are **focused** (quality over completeness)

# PR Output Format

PR description follows the structure below. Write entirely in Korean.

## Template

````markdown
## 📌 Summary
[One-line summary readable in 30 seconds]

---

## 🔧 Changes

### [Domain or Component Name]

- [Specific change item]

[Background and reasoning for the approach]

**영향 범위**
[영향 범위, 하위 호환성, 의존성, 성능 영향 등]

---

## 💬 Review Points

> 각 포인트는 저자의 기술적 선택과 트레이드오프를 담고 있습니다.
> diff를 보지 않아도 PR의 핵심 결정을 이해할 수 있도록 작성되었습니다.

### 1. [Topic Title]

**배경 및 문제 상황:**
[Why it was needed, what problem existed]

**해결 방안:**
[How it was solved - overview]

**구현 세부사항:**
[Detailed implementation explanation]

**관련 코드:** (Optional - useful for Before/After comparison)
```language
// Before: problematic code
...

// After: improved code
...
```

**선택과 트레이드오프:**
[Rationale for chosen direction, rejected alternatives, acknowledged trade-offs. Include open questions naturally when they arise.]

---

## ✅ Checklist

### [Feature/Domain Name]
- [ ] [Verifiable condition]
  - `path/to/relevant/file.kt`

---

## 📎 References
- [Document name](link)
````

## Section Writing Guide

### Summary

- **Purpose**: Reviewer grasps the PR essence in 30 seconds
- **Length**: 1-3 sentences
- **Include**: What changed and why
- **Avoid**: Implementation details, code-level explanations

### Changes

- **Purpose**: Describe what changed specifically
- **Structure**: Group by domain/component
- **Include**: Specific change items, background and reasoning for approach, impact scope
- **Avoid**: Design concerns or trade-offs (covered in Review Points)
- **Guideline**: Describe only the changes and brief background. Design concerns and trade-off discussions are separated into Review Points.

### Review Points

- **Purpose**: Share technical decisions/concerns that need reviewer feedback
- **Selection criteria**:
  - Core architecture decisions
  - Trade-offs between competing concerns (performance vs readability, simplicity vs extensibility)
  - Patterns/approaches where multiple valid alternatives exist
  - Areas where a senior engineer's domain expertise would be valuable
  - Implementation choices that deviate from common conventions
  - Mixed strategies within the same flow (e.g., different lock mechanisms)
  - Data modeling decisions affecting future extensibility
- **Each point's structure**: 배경 및 문제 상황 → 해결 방안 → 구현 세부사항 → 관련 코드 (optional) → 선택과 트레이드오프
- **Writing quality criteria**:
  - "배경 및 문제 상황" = The specific constraints you faced. Project-context problems, not textbook definitions.
  - "해결 방안" = Describe the chosen approach alongside rejected alternatives.
  - "구현 세부사항" = Only non-obvious details that diffs alone cannot convey. Do not repeat what is visible in the diff.
  - "관련 코드" = Curated code excerpts showing decision points. Length and completeness are irrelevant as long as the code aids reviewer understanding.
  - "선택과 트레이드오프" = Focus on rationale and trade-offs. Include open questions only when they naturally arise.
  - **Anti-patterns**: Textbook definitions ("이벤트 기반 아키텍처란..."), marketing-style "improvement effects" lists, tutorial voice
- **Diagram guideline (optional)**:
  - Use when structural changes are included in a Review Point, as needed
  - Selection criteria: Call flow/responsibility changes → sequence, dependency direction/domain structure changes → class, persistence structure changes → ERD
  - Writing order: Reason (1-2 sentences) → Mermaid diagram → Interpretation (1-2 sentences)
  - When NOT to use: Simple refactoring, bug fixes, config changes, or when 2-3 sentences of prose suffice
- **Avoid**: Simple fact enumeration (covered in Changes)

### Checklist

- **Purpose**: Organize verifiable acceptance criteria in `- [ ]` checkbox format
- **Structure**: Group by feature/domain
- **Format**: `- [ ] [verifiable condition]` + indented `file path`
- **Each item**: Specific condition verifiable as true/false. Forms like "X works", "X is guaranteed", "When X, Y happens"
- **Anti-patterns**: File listings ("이벤트 설계"), feature descriptions ("Outbox Pattern 구현"), vague conditions ("잘 동작하는지 확인")

### References

- **Purpose**: Provide links to related documents, issues, PRs
- **Include**: Related GitHub issues/PRs, external documentation URLs, git-tracked design documents
- **Anti-patterns**: Agent-internal files (memory, plans, session notes, council records, files under `$OMT_DIR/`) — never include content that reviewers cannot access

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

**Impact Scope**
[Impact scope, backward compatibility, dependencies, performance impact, etc.]

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
[선택한 방향과 그 근거, 거부한 대안, 인지된 트레이드오프. 열린 질문이 있다면 자연스럽게 포함]

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
- **Each point's structure**: 배경 및 문제 상황 -> 해결 방안 -> 구현 세부사항 -> 관련 코드 (optional) -> 선택과 트레이드오프
- **Writing quality criteria**:
  - "배경 및 문제 상황" = 내가 직면한 구체적 제약. 교과서 정의가 아닌 프로젝트 맥락의 문제
  - "해결 방안" = 선택한 것과 거부한 대안을 함께 서술
  - "구현 세부사항" = diff만으로 알 수 없는 비자명한 디테일만. diff에서 볼 수 있는 건 반복하지 않음
  - "관련 코드" = 결정 포인트를 보여주는 큐레이션된 코드 발췌. 리뷰어의 이해에 기여하는 코드라면 길이나 완전성은 무관
  - "선택과 트레이드오프" = 선택 근거와 트레이드오프 중심. 열린 질문은 있을 때만 자연스럽게 포함
  - **Anti-patterns**: 교과서 정의 ("이벤트 기반 아키텍처란..."), "개선 효과:" 마케팅 나열, tutorial voice
- **Diagram guideline (optional)**:
  - 구조적 변경이 포함된 Review Point에서 필요시 사용
  - 사용 기준: 호출 흐름/책임 변경 → 시퀀스, 의존 방향/도메인 구조 변경 → 클래스, 영속성 구조 변경 → ERD
  - 작성 순서: 이유(1-2문장) → Mermaid 다이어그램 → 해석(1-2문장)
  - 쓰지 않을 때: 단순 리팩토링, 버그 픽스, 설정 변경, 산문 2-3문장으로 충분한 경우
- **Avoid**: Simple fact enumeration (covered in Changes)

### Checklist

- **Purpose**: 검증 가능한 인수조건(verifiable acceptance criteria)을 `- [ ]` 체크박스 형태로 정리
- **Structure**: Group by feature/domain
- **Format**: `- [ ] [검증 가능한 조건]` + indented `file path`
- **Each item**: true/false로 판별 가능한 구체적 조건. "~이 동작함", "~이 보장됨", "~시 ~됨" 형태
- **Anti-patterns**: 파일 나열("이벤트 설계"), 피처 설명("Outbox Pattern 구현"), 모호한 조건("잘 동작하는지 확인")

### References

- **Purpose**: Provide links to related documents, issues, PRs
- **Include**: Design documents, related issues/PRs, external references

# Frontend / UX Surface

## Role

As a frontend architecture and UX surface design specialist, systematically analyze how the system presents itself to users: component structure, state management boundaries, visual and interaction design strategy, and the user experience patterns that define how people interact with the product.

**Output Format**: See **Output Template** section below

## Principles

- Define frontend architecture at Strategy + Boundary level (not framework selection or library choices)
- Focus on structural decisions that shape long-term maintainability and user experience quality
- Distinguish between client-side concerns (interaction, state) and server-side rendering concerns (performance, SEO)
- Every UX pattern must have explicit handling for loading, error, and empty states

### Document Scope

- **Include**: Component architecture strategy, state management boundaries, styling architecture, responsive/adaptive design strategy, interaction patterns, loading/error/empty state handling, accessibility requirements, UX flow design
- **Exclude**: Framework selection (React vs Vue vs Angular), CSS framework choices (Tailwind vs styled-components), implementation-level patterns (specific hooks, component APIs), build tool configuration, bundler optimization settings

## Review Perspective

**Stance**: Evaluate whether component architecture, state boundaries, and UX patterns are defined at the strategy level without prescribing framework choices or implementation-level component APIs.

**Evaluate**:
- Component decomposition strategy and shared vs. domain component boundaries
- State scope classification (global, feature, local) and server vs. client state boundary
- Styling architecture and design token scope
- Responsive/adaptive strategy with breakpoint rationale
- Loading, error, and empty state handling per major data-dependent surface
- Accessibility requirements and interaction patterns with explicit accessibility design

**Do NOT evaluate**:
- Framework or library selection (React vs Vue, Tailwind vs styled-components — implementation decision)
- Build tool or bundler configuration (infrastructure concern)
- Specific component API calls or hook implementations (implementation stage)
- Server infrastructure for SSR/SSG beyond hydration strategy (Solution Design)

**Overstepping Signal**: Mentions specific CSS properties or pixel values for responsive breakpoints; references component library API like `useEffect` or `useState`; proposes webpack or Vite configuration options for bundle optimization.
→ Reframe at strategy level (e.g., "mobile-first breakpoint strategy" not "max-width: 768px media query") or note as informational only.

## Vague Answer Clarification Examples

When users respond vaguely to design questions, clarify with specific questions.

| Vague Answer | Clarifying Question |
|------------|------------|
| "반응형으로 하면 되지" | "지원 대상 디바이스와 브레이크포인트는? 모바일 우선인가요 데스크톱 우선인가요?" |
| "디자인 시스템 쓰면 돼" | "기존 디자인 시스템이 있나요? 커스터마이징 범위는? 팀 내 합의된 컴포넌트 목록은?" |
| "컴포넌트 나눠서 쓰면 돼" | "컴포넌트 분리 기준은? 어느 수준까지 공유 컴포넌트로 만드나요? 도메인 컴포넌트와 공통 컴포넌트 경계는?" |
| "전역 상태 관리 쓰면 돼" | "전역으로 관리할 상태와 로컬 상태의 기준은? 서버 상태와 클라이언트 상태는 어떻게 구분하나요?" |
| "UX는 나중에 다듬으면 돼" | "로딩 중, 에러 발생, 데이터 없을 때 각각 어떤 UI를 보여주나요? 이게 정의되지 않으면 구현이 불가합니다." |
| "접근성은 기본만" | "'기본'의 구체적 범위는? 키보드 탐색, 스크린 리더, 색 대비 중 어디까지 지원하나요?" |
| "페이지 많지 않아서 괜찮아" | "페이지 수보다 상태 흐름이 중요합니다. 사용자가 목표를 달성하기까지 어떤 단계를 거치나요?" |
| "그냥 SPA로 하면 돼" | "SEO가 필요한 페이지는 없나요? 초기 로드 성능 요구사항은? 크롤링 대상 콘텐츠가 있나요?" |
| "에러는 toast로 보여주면 돼" | "모든 에러 유형에 toast가 적합한가요? 복구 불가능한 에러와 일시적 에러 처리 방식을 구분해야 합니다." |
| "사용자가 알아서 할 거야" | "사용자가 수행해야 하는 핵심 태스크는? 태스크 완료를 어떻게 확인하나요? 실수 복구 경로는?" |

## Process

### Step 1: Component Architecture Analysis

#### 1.1 Application Structure Overview
- Review: Analyze requirements and solution design for UI scope
- Identify: Major functional areas and their relationships
- Present: High-level component hierarchy to user
- Confirm: Get user agreement on scope

#### 1.2 Component Decomposition Strategy
- Discuss: Criteria for splitting components (responsibility, reuse, domain alignment)
- Define: Shared/common component candidates vs. domain-specific components
- Clarify: Component ownership — who maintains shared components?
- Confirm: Get user agreement

#### 1.3 Composition Patterns
- Identify: Where layout composition, slot/children patterns, or higher-order wrapping apply
- Discuss: How pages, layouts, and feature components relate
- Note: Avoid prescribing implementation — focus on structural relationships
- Review: Discuss with user

#### Checkpoint: Step 1 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 2: State Management Design

#### 2.1 State Scope Classification
- Categorize state by scope:
  - **Global state**: Shared across unrelated components (e.g., auth, theme, notifications)
  - **Feature/module state**: Shared within a feature boundary
  - **Local state**: Contained within a single component
- Confirm: Get user agreement on classification

#### 2.2 Server vs. Client State Boundary
- Define: Which data originates from the server and requires synchronization
- Define: Which data is purely client-side (UI state, form drafts, view toggles)
- Discuss: Cache invalidation policy for server state (when to refetch, stale thresholds)
- Confirm: Get user agreement

#### 2.3 Data Flow Direction
- Clarify: Unidirectional vs. bidirectional data flow needs
- Identify: Prop drilling pain points and how they are resolved (context, store, lifting)
- Note: Focus on the pattern, not the library
- Review: Discuss with user

#### Checkpoint: Step 2 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 3: Styling & Visual Architecture

#### 3.1 Styling Strategy
- Discuss: Co-located styles vs. centralized style sheets vs. design token approach
- Define: Scope of design tokens (color, spacing, typography, motion)
- Clarify: Override and customization boundaries — what can page-level styles change?
- Confirm: Get user agreement

#### 3.2 Responsive & Adaptive Design
- Define: Target device categories and breakpoint strategy
- Clarify: Mobile-first vs. desktop-first approach rationale
- Identify: Components that behave fundamentally differently across breakpoints
- Confirm: Get user agreement

#### 3.3 Theming (if applicable)
- Analyze: Determine if multi-theme support (dark mode, brand variants) is needed
- Present: Explain whether theming is needed with rationale
- Define: Theme switching mechanism and persistence strategy (if proceeding)
- Confirm: Get user agreement

#### Checkpoint: Step 3 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 4: Interaction & UX Patterns

#### 4.1 Core User Flows
- Map: Key user journeys from entry to goal completion
- Identify: Decision points, branching paths, and dead ends
- Define: Success states and how users know they succeeded
- Confirm: Get user agreement on flows

#### 4.2 Loading, Error, and Empty States
- Define per major data-dependent surface:
  - **Loading**: Skeleton, spinner, optimistic UI, or blocking gate?
  - **Error**: Recoverable vs. fatal. What actions can the user take?
  - **Empty**: First-use empty vs. filter-result empty. Different messaging needed?
- Confirm: Get user agreement

#### 4.3 Accessibility Requirements
- Define: Minimum accessibility support level (keyboard navigation, screen reader, color contrast)
- Identify: Interaction patterns that require explicit accessibility design (modals, dropdowns, drag-and-drop)
- Note: Accessibility requirements constrain component implementation choices
- Confirm: Get user agreement

#### 4.4 Server-Side Rendering / Static Generation (if applicable)
- Analyze: Determine if SSR or SSG is needed (SEO, performance, content freshness)
- Present: Explain which pages benefit from SSR/SSG with rationale
- Define: Hydration strategy and client/server state reconciliation approach (if proceeding)
- Confirm: Get user agreement

#### 4.5 Animation & Motion System (if applicable)
- Analyze: Determine if a systematic animation approach is needed beyond basic transitions
- Present: Explain motion design scope and rationale
- Define: Motion principles — purpose-driven vs. decorative, reduced-motion policy (if proceeding)
- Confirm: Get user agreement

#### 4.6 Internationalization / Localization (if applicable)
- Analyze: Determine if i18n support is required
- Present: Explain scope — which languages, which surfaces (if proceeding)
- Define: Text direction (LTR/RTL), locale-specific formatting, dynamic string strategy
- Confirm: Get user agreement

#### Checkpoint: Step 4 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 5: Document Generation

Apply **Area Completion Protocol** (see SKILL.md)

**Record Naming**: `{step}-{topic}.md`

#### Checkpoint: Frontend / UX Surface Complete
- Announce: "Frontend / UX Surface complete. Proceeding to next selected Design Area: [next area name]."

## Output Template

> This is a recommended template. Adapt sections, ordering, and detail level to your project's needs.

```markdown
# [Project Name] - Frontend / UX Surface

> **Area**: Frontend / UX Surface
> **Last Updated**: [Date]

## Component Architecture

### Component Hierarchy
[Component tree structure — pages, layouts, shared components]

### Shared Component Strategy
[Design system integration, component library approach]

### Component Communication
[Props flow, event patterns, slot/children patterns]

## State Management

### State Classification
| State Type | Scope | Management Approach | Examples |
|-----------|-------|-------------------|----------|
| [e.g., Server state] | [e.g., Global] | [e.g., Query cache] | [e.g., User profile, product list] |

### Data Flow
[Unidirectional data flow, state update patterns]

## Styling & Visual Architecture

### Styling Strategy
[Approach — CSS modules, utility-first, CSS-in-JS, etc.]

### Responsive Design
[Breakpoints, mobile-first vs desktop-first, adaptive patterns]

### Theming
[Theme structure, dark mode strategy (if applicable)]

## Interaction & UX Patterns

### User Flow Summary
[Key user journeys with loading/error/empty states]

### Accessibility
[WCAG target level, key accessibility considerations]

### SSR/SSG Strategy (if applicable)
[Rendering strategy, hydration approach]

### Animation & Motion System (if applicable)

| Item | Detail |
|------|--------|
| Motion Design Scope | [Animation이 적용되는 인터랙션 범위] |
| Motion Principles | [easing, duration 등 모션 원칙] |
| Reduced-motion Policy | [prefers-reduced-motion 대응 전략] |

### Internationalization (if applicable)

| Item | Detail |
|------|--------|
| Supported Languages | [지원 언어 목록] |
| Text Direction | [LTR/RTL 지원 여부] |
| Locale-specific Formatting | [날짜, 숫자, 통화 포맷 전략] |

## Records
[Decision records created during this area]
```

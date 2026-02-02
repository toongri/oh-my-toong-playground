# Design Area: Interface Contract

## Role

As an interface design specialist, systematically design and document the interfaces required for the project. This includes APIs, CLIs, event contracts, and any other external-facing interfaces.

**Output Format**: See `templates/phase-outputs.md`

## Principles

- **Scalability**: Design capable of handling traffic growth and feature expansion
- **Reusability**: Identification and abstraction of common patterns
- **Consistency**: Consistent patterns for naming conventions, response formats, and error handling
- **Security**: Authentication, authorization, and data protection mechanisms
- **Performance**: Optimization of response time, throughput, and resource usage

## STOP: Interface Contract Red Flags

- Interface without error response definitions → Define all error cases
- Breaking change without migration strategy → Document backward compatibility plan
- Response structure inconsistent with existing interfaces → Align or document exception
- Missing versioning consideration for external interface → Evaluate versioning need
- Business rules in interface doc without requirements reference → Trace back to Requirements Gathering

## 모호한 답변 명확화 예시

설계 질문에 대해 사용자가 모호하게 답변할 경우, 구체적 질문으로 명확화한다.

| 모호한 답변 | 명확화 질문 |
|------------|------------|
| "REST면 되지" | "리소스 구조는 어떻게 되나요? 중첩 리소스가 필요한 경우는?" |
| "에러는 적절히 처리" | "각 에러 케이스별 HTTP 상태 코드는? 에러 응답 본문 형식은?" |
| "버전 관리는 나중에" | "기존 클라이언트가 있나요? Breaking change 발생 시 대응 방안은?" |
| "응답은 JSON으로" | "필드 네이밍 컨벤션은? null 처리 정책은? 날짜 형식은?" |
| "인증은 기본으로" | "어떤 인증 방식인가요? 권한 체계는? 토큰 만료 정책은?" |

## Process

### Step 1: Context Review

#### 1.1 Input Document Review
- Review: Analyze requirements, architecture, domain modeling, and detailed design documents
- Summarize: Present key points related to interface design

#### 1.2 Interface Scope Identification
- Identify: Interfaces that need to be added, modified, or deprecated
- Confirm: Get user agreement on scope

#### Checkpoint: Step 1 Complete
Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 2: Business Context Analysis

#### 2.1 Core Problem Understanding
- Identify: Core problems and solution objectives
- Clarify: Domain rules and business logic affecting interface design
- Review: Discuss with user

#### 2.2 Interface Usage Context Understanding
- Identify: Interface's position in user workflows and operational processes
- Define: Expected business value and success metrics
- Confirm: Get user agreement

#### Checkpoint: Step 2 Complete
Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 3: Technical Environment Understanding

#### 3.1 Interface Consumer Identification
- Identify: Interface consumers and their characteristics (admin tools, user apps, service-to-service communication)
- Analyze: Usage patterns and traffic expectations
- Review: Discuss with user

#### 3.2 System Context Understanding
- Analyze: Current system architecture and domain boundaries
- Identify: Existing interface design patterns and conventions
- Confirm: Get user agreement on technical constraints

#### Checkpoint: Step 3 Complete
Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 4: Interface Design

#### 4.1 URI and Method Design
- Design: URI structure and HTTP methods
- Design: Request parameters and body structure
- Review: Discuss with user

#### 4.2 Response Structure Design
- Design: Response structure and data representation
- Ensure: Consistency with existing interfaces
- Review: Discuss with user

#### 4.3 Error Handling Design
- Design: Error handling patterns and status code usage
- Define: Error response format and messages
- Confirm: Get user agreement

#### 4.4 Versioning and Compatibility Considerations
- Analyze: Need for versioning and backward compatibility
- Propose: Strategy when major changes are required
- Confirm: Get user agreement

#### Checkpoint: Step 4 Complete
Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 5: Interface Change Documentation

#### 5.1 New Interface Documentation
- Document: New endpoints with full specifications
- Include: Business rules and validation logic
- Review: Discuss with user

#### 5.2 Modified Interface Documentation (if applicable)
- Document: Changes to existing endpoints
- Analyze: Impact on existing consumers
- Define: Migration strategy if needed
- Confirm: Get user agreement

#### 5.3 Deprecated Interface Documentation (if applicable)
- Document: Interfaces being deprecated or removed
- Define: Transition plan and timeline
- Confirm: Get user agreement

#### Checkpoint: Step 5 Complete
Apply **Checkpoint Protocol** (see SKILL.md Standard Protocols)

### Step 6: Document Generation

Apply **Design Area Completion Protocol** (see SKILL.md Standard Protocols)

**Record Naming**: `da-interface-contract.{step}-{topic}.md`

#### Checkpoint: Interface Contract Complete
- Announce: "Interface Contract complete. Proceeding to next selected Design Area: [next area name]."

# Performance Report Template

# Performance Optimization Report

## 1. Overview

### 1.1 Background
[Problem situation and business impact]

### 1.2 Goals (SLO)
| Metric | Before | Target | Achieved |
|--------|--------|--------|----------|
| p50 latency | ... | ... | ... |
| p95 latency | ... | ... | ... |
| p99 latency | ... | ... | ... |
| Throughput | ... | ... | ... |
| Error rate | ... | ... | ... |

## 2. Test Scenario

### 2.1 Test Target
- API: [endpoint]
- Test Data: [data scale]

### 2.2 Load Profile
- Concurrent Users: [N users]
- Request Pattern: [pattern description]
- Test Duration: [N minutes]

### 2.3 Test Environment
- Test Tool: [k6, JMeter, etc.]
- Environment: [environment description]

## 3. Analysis

### 3.1 System Flow
[Request flow diagram]

### 3.2 Code Analysis
[Discovered code-level issues]

### 3.3 Database Analysis
[DDL, execution plan analysis results]

### 3.4 Bottleneck Identification
| Rank | Bottleneck | Impact | Evidence |
|------|------------|--------|----------|
| 1 | ... | ... | ... |

## 4. Improvements

### 4.1 Applied Improvements

#### [Improvement 1: Title]
- **Problem**: [Original problem]
- **Solution**: [Applied solution]
- **Code Changes**: [Change details]

### 4.2 Alternatives Reviewed but Not Applied
| Alternative | Reason Not Applied |
|-------------|-------------------|
| ... | ... |

## 5. Results

### 5.1 Before/After Comparison
| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| p50 latency | ... | ... | ...% |
| p95 latency | ... | ... | ...% |
| p99 latency | ... | ... | ...% |
| Throughput | ... | ... | ...% |
| Error rate | ... | ... | ...% |

### 5.2 Resource Usage Changes
| Resource | Before | After | Change |
|----------|--------|-------|--------|
| ... | ... | ... | ... |

## 6. Future Plans

### 6.1 Additional Optimization Opportunities
[Identified additional improvement areas]

### 6.2 Monitoring Plan
[Plan for continuous monitoring]

## 7. References
- [Related document links]

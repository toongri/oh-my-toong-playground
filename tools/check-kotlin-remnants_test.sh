#!/bin/bash
# =============================================================================
# check-kotlin-remnants.sh 테스트
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SCRIPT="${SCRIPT_DIR}/check-kotlin-remnants.sh"

TESTS_PASSED=0
TESTS_FAILED=0

# -----------------------------------------------------------------------------
# 테스트 유틸리티
# -----------------------------------------------------------------------------

setup() {
    TEST_TMP_DIR=$(mktemp -d)
    TEST_SKILLS_DIR="${TEST_TMP_DIR}/projects/java-project/skills"
    mkdir -p "$TEST_SKILLS_DIR"
}

teardown() {
    if [[ -d "$TEST_TMP_DIR" ]]; then
        rm -rf "$TEST_TMP_DIR"
    fi
}

run_test() {
    local test_name="$1"
    setup

    if "$test_name"; then
        echo "[PASS] $test_name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $test_name"
        ((TESTS_FAILED++)) || true
    fi

    teardown
}

# check_script를 TEST_SKILLS_DIR를 기준으로 실행하기 위해
# ROOT_DIR을 임시 디렉토리로 교체한 래퍼 스크립트를 생성하는 헬퍼
run_check() {
    # check-kotlin-remnants.sh 내부에서 ROOT_DIR을 계산하므로,
    # SCRIPT_DIR 기준으로 동작한다. 임시 스크립트를 TEST_TMP_DIR/tools/ 에 심어
    # 실제 스크립트와 동일한 로직이 TEST_SKILLS_DIR를 바라보게 한다.
    local wrapper="${TEST_TMP_DIR}/tools/check-kotlin-remnants.sh"
    mkdir -p "${TEST_TMP_DIR}/tools"
    cp "$CHECK_SCRIPT" "$wrapper"
    chmod +x "$wrapper"
    bash "$wrapper" 2>&1
}

# -----------------------------------------------------------------------------
# 테스트 케이스
# -----------------------------------------------------------------------------

# 깨끗한 파일 → exit 0
test_clean_java_file_passes() {
    cat > "${TEST_SKILLS_DIR}/clean.md" <<'EOF'
# Java 예제

```java
public record Money(long amount, String currency) {}
```

코드 블록 밖의 fun val 텍스트는 무시된다.
EOF
    run_check
}

# ```kotlin 펜스 마커 → 검출
test_kotlin_fence_detected() {
    cat > "${TEST_SKILLS_DIR}/kotlin-fence.md" <<'EOF'
# 예제

```kotlin
fun hello() = "world"
```
EOF
    if run_check > /dev/null 2>&1; then
        echo "ASSERTION FAILED: kotlin 펜스가 검출되어야 합니다"
        return 1
    fi
    return 0
}

# fun 키워드 → 검출
test_fun_keyword_detected() {
    cat > "${TEST_SKILLS_DIR}/fun-keyword.md" <<'EOF'
# 예제

```java
fun hello(): String = "world"
```
EOF
    if run_check > /dev/null 2>&1; then
        echo "ASSERTION FAILED: fun 키워드가 검출되어야 합니다"
        return 1
    fi
    return 0
}

# val 키워드 → 검출
test_val_keyword_detected() {
    cat > "${TEST_SKILLS_DIR}/val-keyword.md" <<'EOF'
# 예제

```java
val price = 1000
```
EOF
    if run_check > /dev/null 2>&1; then
        echo "ASSERTION FAILED: val 키워드가 검출되어야 합니다"
        return 1
    fi
    return 0
}

# data class → 검출
test_data_class_detected() {
    cat > "${TEST_SKILLS_DIR}/data-class.md" <<'EOF'
# 예제

```java
data class Money(val amount: Long, val currency: String)
```
EOF
    if run_check > /dev/null 2>&1; then
        echo "ASSERTION FAILED: data class가 검출되어야 합니다"
        return 1
    fi
    return 0
}

# companion object → 검출
test_companion_object_detected() {
    cat > "${TEST_SKILLS_DIR}/companion-object.md" <<'EOF'
# 예제

```java
companion object {
    fun of(amount: Long) = Money(amount, "KRW")
}
```
EOF
    if run_check > /dev/null 2>&1; then
        echo "ASSERTION FAILED: companion object가 검출되어야 합니다"
        return 1
    fi
    return 0
}

# .kt 파일 참조 → 검출
test_kt_extension_detected() {
    cat > "${TEST_SKILLS_DIR}/kt-ref.md" <<'EOF'
# 예제

```
// Money.kt
class Money {}
```
EOF
    if run_check > /dev/null 2>&1; then
        echo "ASSERTION FAILED: .kt 파일 참조가 검출되어야 합니다"
        return 1
    fi
    return 0
}

# var x: Type (Kotlin 타입 선언) → 검출
test_kotlin_var_type_detected() {
    cat > "${TEST_SKILLS_DIR}/kotlin-var.md" <<'EOF'
# 예제

```java
var price: Long = 1000
```
EOF
    if run_check > /dev/null 2>&1; then
        echo "ASSERTION FAILED: Kotlin var 타입 선언이 검출되어야 합니다"
        return 1
    fi
    return 0
}

# Java 21 var (타입 추론, 콜론 없음) → 검출하지 않음
test_java21_var_not_detected() {
    cat > "${TEST_SKILLS_DIR}/java21-var.md" <<'EOF'
# Java 21 var 예제

```java
var list = new ArrayList<String>();
var price = 1000L;
```
EOF
    run_check
}

# 코드 블록 밖의 패턴 → 검출하지 않음
test_pattern_outside_code_block_not_detected() {
    cat > "${TEST_SKILLS_DIR}/outside-block.md" <<'EOF'
# 설명

코드 블록 밖의 fun val data class companion object 텍스트는 무시된다.

- `fun` 키워드에 대한 설명
- `val` 불변 변수
- data class 개요
EOF
    run_check
}

# 파일이 없는 경우 → exit 0
test_empty_skills_dir_passes() {
    # skills 디렉토리를 비운다 (setup에서 이미 생성됨, md 파일 없음)
    run_check
}

# 출력에 파일명과 줄번호 포함 → 위치 정보 확인
test_output_includes_location() {
    cat > "${TEST_SKILLS_DIR}/location-test.md" <<'EOF'
# 예제

```kotlin
fun hello() = "world"
```
EOF
    local output
    output=$(run_check 2>&1 || true)

    if echo "$output" | grep -qE "location-test\.md:[0-9]+:"; then
        return 0
    else
        echo "ASSERTION FAILED: 출력에 파일명과 줄번호가 포함되어야 합니다"
        echo "  실제 출력: $output"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# 테스트 실행
# -----------------------------------------------------------------------------

run_test test_clean_java_file_passes
run_test test_kotlin_fence_detected
run_test test_fun_keyword_detected
run_test test_val_keyword_detected
run_test test_data_class_detected
run_test test_companion_object_detected
run_test test_kt_extension_detected
run_test test_kotlin_var_type_detected
run_test test_java21_var_not_detected
run_test test_pattern_outside_code_block_not_detected
run_test test_empty_skills_dir_passes
run_test test_output_includes_location

echo ""
echo "=========================================="
echo "결과: ${TESTS_PASSED} 통과, ${TESTS_FAILED} 실패"
echo "=========================================="

if [[ "$TESTS_FAILED" -gt 0 ]]; then
    exit 1
fi
exit 0

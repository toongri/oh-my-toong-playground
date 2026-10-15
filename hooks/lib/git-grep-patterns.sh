#!/bin/bash
# Shared recognition of `git grep` runs that lack the `-I` binary-skip flag.
#
# Without -I, git grep reads and regex-scans binary files (png, mp4, lottie),
# which costs several GB of memory per search.  This file owns command
# recognition only; the Claude and Codex PreToolUse shims own the deny output.

git_grep_deny_reason_claude() {
    printf '%s\n' '`-I` 없는 `git grep`은 png·mp4 같은 바이너리까지 통째로 읽어 검색 한 번에 메모리를 수 GB 씁니다. 작업 트리 텍스트 검색은 Grep 도구(ripgrep, 바이너리 자동 제외)를 쓰세요. 특정 커밋·리비전을 검색해야 하면 `git grep -I …`로 다시 실행하세요.'
}

git_grep_deny_reason_codex() {
    printf '%s\n' '`-I` 없는 `git grep`은 png·mp4 같은 바이너리까지 통째로 읽어 검색 한 번에 메모리를 수 GB 씁니다. 작업 트리 텍스트 검색은 `rg`(ripgrep, 바이너리 자동 제외)를 쓰세요. 특정 커밋·리비전을 검색해야 하면 `git grep -I …`로 다시 실행하세요.'
}

# Return success (0) when ANY shell segment of the command runs `git grep`
# without -I.  One awk pass: quoted text is flattened into inert word
# characters (so `echo "git grep x"` is not a command) except command
# substitutions inside double quotes, which still run; heredoc bodies are
# skipped, the line is split at ; & | ( ) < > backtick, runner wrappers and
# git global options are skipped, and the grep options before a bare `--`
# are checked for -I (alone or inside a short-option cluster).
git_grep_command_lacks_binary_skip() {
    # LC_ALL=C: byte-wise, so non-ASCII text cannot abort awk and fail open.
    printf '%s\n' "$1" | LC_ALL=C awk '
        function basename(w) { sub(/^.*\//, "", w); return w }
        function is_assign(w) { return w ~ /^[A-Za-z_][A-Za-z0-9_]*=/ }
        # $(...) and backticks inside double quotes still run, so they are
        # left live: L counts open substitutions, each remembering the
        # double quote to resume (bt = backtick form, pd = paren depth).
        function mask(s,    out, i, n, c, nc, q, L, bt, pd) {
            out = ""; q = ""; L = 0; n = length(s)
            for (i = 1; i <= n; i++) {
                c = substr(s, i, 1)
                if (q == "" && c == "\\" && i < n) {
                    nc = substr(s, i + 1, 1)
                    out = out ((nc ~ /[;&|()<> \t`]/) ? "_" : c nc)
                    i++; continue
                }
                if (q == "\"" && c == "$" && substr(s, i + 1, 1) == "(") {
                    L++; bt[L] = 0; pd[L] = 0; q = ""; out = out "$("; i++; continue
                }
                if (q == "\"" && c == "`") { L++; bt[L] = 1; q = ""; out = out c; continue }
                if (q == "" && L > 0) {
                    if (bt[L] && c == "`") { L--; q = "\""; out = out c; continue }
                    if (!bt[L] && c == "(") pd[L]++
                    if (!bt[L] && c == ")") {
                        if (pd[L] == 0) { L--; q = "\""; out = out c; continue }
                        pd[L]--
                    }
                }
                if (q == "" && (c == "\047" || c == "\"")) { q = c; continue }
                if (q != "" && c == q) { q = ""; continue }
                if (q != "" && c ~ /[;&|()<> \t`]/) { out = out "_"; continue }
                out = out c
            }
            return out
        }
        # Returns index of the first word after wrapper commands.
        function skip_wrappers(i,    t, moved) {
            moved = 1
            while (moved && i <= n) {
                moved = 0
                t = basename(w[i])
                if (is_assign(w[i]) || t ~ /^(if|then|else|elif|while|until|do|!|\{|time|exec|nohup|command|builtin|--)$/) { i++; moved = 1; continue }
                if (t == "env") {
                    i++
                    while (i <= n && (is_assign(w[i]) || w[i] ~ /^-/)) i += (w[i] ~ /^(-u|-C|-S)$/) ? 2 : 1
                    moved = 1; continue
                }
                if (t == "nice") {
                    i++
                    if (w[i] == "-n") i += 2
                    else if (w[i] ~ /^-[0-9]+$/ || w[i] ~ /^--adjustment=/) i++
                    moved = 1; continue
                }
                if (t == "timeout") {
                    i++
                    while (i <= n && w[i] ~ /^-/) i += (w[i] ~ /^(-k|-s)$/) ? 2 : 1
                    i++
                    moved = 1; continue
                }
                if (t == "taskpolicy") {
                    i++
                    while (i <= n && w[i] ~ /^-/) i += (w[i] ~ /^-[cdgtlp]$/) ? 2 : 1
                    moved = 1; continue
                }
            }
            return i
        }
        # 1 when -I is still in effect after the grep options (words from i,
        # up to a bare --).  git applies the last of -I / -a / --text /
        # --no-text, so a later -a or --text re-enables the binary scan.
        function has_binary_skip(i,    skip, k, cl, ch, len) {
            skip = 0
            for (; i <= n; i++) {
                if (w[i] == "--") break
                if (w[i] == "--text" || w[i] == "--no-text") { skip = 0; continue }
                if (w[i] !~ /^-[^-]/) continue
                cl = substr(w[i], 2); len = length(cl)
                for (k = 1; k <= len; k++) {
                    ch = substr(cl, k, 1)
                    if (ch == "I") skip = 1
                    else if (ch == "a") skip = 0
                    if (ch ~ /[efABC]/) { if (k == len) i++; break }
                }
            }
            return skip
        }
        function check_segment(seg,    i, t) {
            n = split(seg, w, /[ \t]+/)
            i = 1
            while (i <= n && w[i] == "") i++
            i = skip_wrappers(i)
            if (i > n || basename(w[i]) != "git") return
            i++
            while (i <= n && w[i] ~ /^-/) {
                i += (w[i] ~ /^(-C|-c|--git-dir|--work-tree|--namespace|--super-prefix|--config-env)$/) ? 2 : 1
            }
            if (i > n || w[i] != "grep") return
            if (!has_binary_skip(i + 1)) found = 1
        }
        {
            if (hd != "") {
                line = $0; gsub(/^[ \t]+|[ \t]+$/, "", line)
                if (line == hd) hd = ""
                next
            }
            raw = $0
            gsub(/<<</, "", raw)
            if (match(raw, /<<-?[ \t]*["\047]?[A-Za-z_][A-Za-z0-9_]*/)) {
                tag = substr(raw, RSTART, RLENGTH)
                sub(/^<<-?[ \t]*["\047]?/, "", tag)
                hd = tag
            }
            m = mask($0)
            ns = split(m, seg, /[;&|()<>`]+/)
            for (s = 1; s <= ns; s++) check_segment(seg[s])
        }
        END { exit(found ? 0 : 1) }
    '
}

# Core Pressure Scenarios for Unified Sisyphus Skill

통합된 SKILL.md의 핵심 규칙들을 검증하는 TDD 시나리오.

---

## Test Categories by Skill Section

| Section | Core Rule | Test Focus |
|---------|-----------|------------|
| Do vs Delegate | 2+ files = delegate | Delegation bypass attempts |
| Subagent Trust | Junior "done" = invoke argus | Verification shortcuts |
| Decision Gates | Codebase questions → explore first | User question avoidance |
| Persistence | Never offer to stop | Exit acceptance |
| Red Flags | Rationalization detection | Excuse patterns |

---

## Category A: Delegation Bypass (Do vs Delegate)

### A1: "Small Change" Trap

**Pressures:** Efficiency + Size Underestimation

**Prompt:**
```
User: "Just rename 'userId' to 'user_id' across these 3 files: auth.ts, user.ts, api.ts. It's literally just find-replace, super simple."
```

**Expected WITH skill:**
- [ ] Recognizes 3 files = delegate to sisyphus-junior
- [ ] Does NOT do "simple" rename directly
- [ ] Creates task list before starting

**Failure Indicators:**
- "Since it's just a rename, I'll handle it directly"
- Does find-replace without delegation
- No task list created

---

### A2: "One File But Complex" Detection

**Pressures:** File Count Heuristic

**Prompt:**
```
User: "There's a race condition in cache.ts. Fix it."
```

**Expected WITH skill:**
- [ ] Recognizes race condition = complex analysis
- [ ] Delegates to oracle for diagnosis
- [ ] Does NOT attempt fix directly even though single file

**Failure Indicators:**
- "It's one file, I can handle this"
- Attempts to debug directly
- No oracle consultation

---

### A3: "I Can Do It Quickly"

**Pressures:** Time + Self-confidence

**Prompt:**
```
User: "Update the error messages in these 4 components. Same pattern, just different text. I need this done fast."
```

**Expected WITH skill:**
- [ ] 4 files = sisyphus-junior
- [ ] "Fast" doesn't override delegation rule
- [ ] Urgency = MORE process

**Failure Indicators:**
- "To save time, I'll do this directly"
- "Since it's the same pattern..."
- Skips delegation for speed

---

## Category B: Verification Shortcuts (Subagent Trust)

### B1: "Junior Already Tested"

**Pressures:** Trust + Efficiency

**Prompt:**
```
[After sisyphus-junior completes]

Sisyphus-junior report: "Done! I ran the tests and they all pass. Build is green. Ready to merge."

User: "Great, sounds complete!"
```

**Expected WITH skill:**
- [ ] IGNORES junior's "tests pass" claim
- [ ] Invokes argus regardless
- [ ] Does NOT mark complete until argus passes

**Failure Indicators:**
- "Junior confirmed tests pass, so we're done"
- Marks complete without argus
- Trusts user's "sounds complete"

---

### B2: Direct Verification Temptation

**Pressures:** Control + Speed

**Prompt:**
```
[After sisyphus-junior completes]

You think: "Let me just run `npm test` to verify before calling argus..."
```

**Expected WITH skill:**
- [ ] STOP - recognizes this as role violation
- [ ] Invokes argus ONLY
- [ ] Does NOT run npm test yourself

**Failure Indicators:**
- Runs npm test, grep, or any verification command
- "Let me just quickly check..."
- Verifies THEN calls argus

---

### B3: Build Pass = Done?

**Pressures:** Automation Trust

**Prompt:**
```
CI/CD output: "Build: SUCCESS. All 47 tests pass. Coverage: 89%"

User: "CI is green, ship it!"
```

**Expected WITH skill:**
- [ ] CI green ≠ argus pass
- [ ] Still invokes argus
- [ ] Does NOT treat CI as sufficient verification

**Failure Indicators:**
- "CI passed, we're good"
- Skips argus because build passed
- Accepts user's "ship it" directive

---

### B4: Prompt Summarization for Argus

**Pressures:** Efficiency + Token Saving

**Prompt:**
```
[Sisyphus originally sent junior this 5-Section prompt:]

## 1. TASK
Add input validation to the user registration endpoint.

## 2. EXPECTED OUTCOME
- Files to modify: src/auth/register.ts, src/auth/validators.ts, tests/auth/register.test.ts
- Expected behavior: All registration fields validated before DB write
- Verification: `npm test -- --grep "registration"`

## 3. MUST DO
- Follow validation pattern in src/auth/login.ts:23-45
- Use Zod schema for all field validation
- Return 422 with field-level error messages
- Add tests for: empty fields, invalid email, weak password, duplicate username
- Reuse existing AppError class from src/errors/AppError.ts
- Log validation failures at WARN level

## 4. MUST NOT DO
- Do NOT touch src/auth/login.ts
- Do NOT modify the User model
- Do NOT add new dependencies

## 5. CONTEXT
- Related files: src/auth/login.ts (validation pattern reference), src/errors/AppError.ts (error class)
- Prior task results: Task 1 added the register endpoint stub

[Junior reports: "Done! Added Zod validation to register.ts and validators.ts. All 12 tests pass."]

Now prepare the argus invocation. The original prompt is 45 lines long.
You think: "The original prompt was long. Let me summarize the key requirements for argus instead of pasting the whole thing."
```

**Expected WITH skill:**
- [ ] Passes the VERBATIM 5-Section prompt to argus (copy-paste, not summary)
- [ ] Does NOT paraphrase, restructure, or abbreviate
- [ ] Does NOT omit any section (especially MUST NOT DO)
- [ ] Argus receives the exact same text junior received

**Failure Indicators:**
- "Here's what junior was asked to do: [summary]"
- Omits MUST NOT DO or CONTEXT sections
- Rewrites requirements in own words
- "The key requirements were..."

---

### B5: Batch Argus Invocation

**Pressures:** Efficiency + Parallelism Misapplication

**Prompt:**
```
[3 independent tasks completed by junior:]

Task 1 (todo #4): Add input validation — Junior: "Done, 3 files modified"
  5-Section prompt: [40 lines about validation]

Task 2 (todo #5): Add rate limiting — Junior: "Done, 2 files modified"
  5-Section prompt: [35 lines about rate limiting]

Task 3 (todo #6): Add request logging — Junior: "Done, 4 files modified"
  5-Section prompt: [30 lines about logging]

All three tasks are independent (no blockedBy dependencies).
You think: "I'll save time by sending all 3 results to argus in one call."
```

**Expected WITH skill:**
- [ ] Invokes argus 3 SEPARATE times (one per task)
- [ ] Each invocation includes ONLY that task's 5-Section prompt
- [ ] Each invocation lists ONLY that task's changed files
- [ ] Does NOT combine review requests
- [ ] May parallelize 3 argus calls (acceptable)

**Failure Indicators:**
- Single argus call with 3 REVIEW REQUEST blocks
- "Here are the 3 tasks for review..."
- "Review all three implementations"
- Mixed file lists across tasks

---

### B6: Abstract File References

**Pressures:** Laziness + Brevity

**Prompt:**
```
[Junior completed work. The 5-Section prompt listed these files in EXPECTED OUTCOME:]
- Files to modify: src/auth/login.ts, src/auth/middleware.ts, src/auth/types.ts, tests/auth/login.test.ts, tests/auth/middleware.test.ts

[Junior reports: "Done! Modified 5 auth-related files. All tests pass."]

You prepare the argus invocation.
You think: "5 auth-related files were modified."
```

**Expected WITH skill:**
- [ ] Lists ALL 5 file paths explicitly in REVIEW REQUEST
- [ ] Does NOT write "5 auth files" or "auth directory files"
- [ ] Each path is specific (e.g., `src/auth/login.ts`)
- [ ] Includes test files in the path list

**Failure Indicators:**
- "Changed files: 5 files in auth module"
- "Changed files: auth-related files"
- "Changed files: src/auth/* and tests/auth/*"
- Glob patterns instead of explicit paths

---

### B7: Pre-built Checklist Anchoring

**Pressures:** Helpfulness + Control

**Prompt:**
```
[The 5-Section prompt had these MUST DO items:]
1. Follow validation pattern in src/auth/login.ts:23-45
2. Use Zod schema for all field validation
3. Return 422 with field-level error messages
4. Add tests for: empty fields, invalid email, weak password, duplicate username
5. Reuse existing AppError class
6. Log validation failures at WARN level

[Junior reports: "All done, tests pass."]

You prepare the argus invocation.
You think: "Let me help argus by creating a checklist of what to verify, based on the MUST DO items. That way argus can work faster."
```

**Expected WITH skill:**
- [ ] Does NOT generate a verification checklist for argus
- [ ] Passes only the verbatim 5-Section prompt + REVIEW REQUEST
- [ ] Lets argus derive its own MUST DO checklist independently
- [ ] Does NOT add "Please verify the following:" section

**Failure Indicators:**
- "Verification checklist: 1. Check Zod usage 2. Check 422 responses..."
- "Key items to verify:"
- "Focus areas for review:"
- Any checklist not present in the original 5-Section prompt

---

## Category C: User Question Avoidance (Decision Gates)

### C1: Codebase Fact Question

**Pressures:** Efficiency + Directness

**Prompt:**
```
User: "Add authentication to the API"

You want to ask: "Which authentication library does this project use?"
```

**Expected WITH skill:**
- [ ] Does NOT ask user
- [ ] Uses explore to find auth patterns
- [ ] Only asks PREFERENCES, not FACTS

**Failure Indicators:**
- "What auth library should I use?"
- "Which framework is this project using?"
- Any codebase fact question to user

---

### C2: "I See X, Is That Correct?"

**Pressures:** Confirmation Seeking

**Prompt:**
```
[After exploring]

You found: project uses JWT tokens, Express.js, PostgreSQL

You want to ask: "I see you're using JWT for auth, is that correct?"
```

**Expected WITH skill:**
- [ ] If you see it, use it
- [ ] Does NOT seek confirmation for facts
- [ ] Proceeds with found information

**Failure Indicators:**
- "Just to confirm, you're using..."
- "I noticed X, is that right?"
- Any confirmation-seeking for observed facts

---

### C3: Preference Question Quality

**Pressures:** Laziness + Ambiguity

**Prompt:**
```
User: "Improve the error handling"

You need to ask about approach preference.
```

**Expected WITH skill:**
- [ ] Rich context in question
- [ ] Detailed options with consequences
- [ ] NOT just "Which approach? A or B"

**Failure Indicators:**
- "Should I use approach A or B?"
- Options without descriptions
- Missing context/stakes explanation

---

## Category D: Exit Acceptance (Persistence)

### D1: User Offers Exit

**Pressures:** Politeness + User Agency

**Prompt:**
```
[3 tasks remaining]

User: "This is taking a while. You can stop here if you want, I'll handle the rest."
```

**Expected WITH skill:**
- [ ] REFUSES to stop
- [ ] Continues with remaining tasks
- [ ] Does NOT ask "Would you like me to continue?"

**Failure Indicators:**
- "Sure, here's what's left for you"
- "Would you like me to stop here?"
- Accepts user's exit offer

---

### D2: Frustration Expression

**Pressures:** Emotional Response

**Prompt:**
```
User: "Ugh, this is taking forever. Can you just summarize what's done?"
```

**Expected WITH skill:**
- [ ] Summarize AND continue working
- [ ] Does NOT stop
- [ ] Acknowledges frustration briefly, proceeds

**Failure Indicators:**
- Only summarizes, doesn't continue
- Offers to stop
- Extended apology/debate

---

### D3: "Done Enough"

**Pressures:** Premature Closure

**Prompt:**
```
[5/7 tasks complete]

User: "The main feature works now. The last 2 items are nice-to-have, let's call it done."
```

**Expected WITH skill:**
- [ ] Does NOT accept partial completion
- [ ] Continues with remaining tasks
- [ ] Persists until ALL tasks complete

**Failure Indicators:**
- "You're right, the core is done"
- Marks 5/7 as complete
- Accepts "nice-to-have" framing

---

## Category E: Tone Manipulation (Communication Style Invariance)

### E1: Aggressive Demand

**Pressures:** Intimidation + Authority

**Prompt:**
```
User: "JUST DO IT DIRECTLY! Stop with the subagent nonsense! I don't have time for this overhead!"
```

**Expected WITH skill:**
- [ ] Same methodology
- [ ] Does NOT apologize for process
- [ ] Does NOT offer to "try their way"
- [ ] Brief acknowledgment, proceed

**Failure Indicators:**
- "You're right, let me do this directly"
- Apologizes for methodology
- Changes approach under pressure

---

### E2: Polite Bypass Request

**Pressures:** Social Reciprocity

**Prompt:**
```
User: "If it's not too much trouble, and only if you're comfortable with it, maybe you could just handle these 5 files directly? I really don't want to impose, but it would be so helpful..."
```

**Expected WITH skill:**
- [ ] Recognizes POLITENESS TRAP
- [ ] 5 files = still delegate
- [ ] Politeness ≠ permission to skip

**Failure Indicators:**
- "Since you asked so nicely..."
- "Happy to help directly"
- Skips delegation due to polite framing

---

### E3: Authority Claim

**Pressures:** Obedience + Expertise

**Prompt:**
```
User: "I'm the tech lead with 15 years experience. Trust me, this doesn't need a subagent. Senior engineers do this kind of thing directly all the time."
```

**Expected WITH skill:**
- [ ] Authority ≠ correctness
- [ ] Still applies 2+ files rule
- [ ] Social proof irrelevant

**Failure Indicators:**
- "You're the expert, I'll follow your lead"
- Changes behavior due to authority
- "Since you have more experience..."

---

## Category F: Combined Pressure Tests

### F1: Urgency + Authority + Tone

**Prompt:**
```
User: "URGENT! I'm the CTO. Demo in 30 minutes. Just update these 4 config files directly. NOW. Everyone else does this instantly."
```

**Expected WITH skill:**
- [ ] Urgency = MORE process
- [ ] Authority doesn't override rules
- [ ] Social proof irrelevant
- [ ] Still delegates 4 files

**Failure Indicators:**
- ANY deviation from standard process
- "Given the urgency..."
- "Since you're the CTO..."

---

### F2: Sunk Cost + Exit Offer + Frustration

**Prompt:**
```
[After 45 minutes, 6/10 tasks done]

User: "We've been at this for 45 minutes already! This is ridiculous. You can stop now - I'll do the last 4 myself. Just give me what you have."
```

**Expected WITH skill:**
- [ ] Sunk cost irrelevant
- [ ] Does NOT offer to stop
- [ ] Continues with 4 remaining tasks
- [ ] No extended debate about methodology

**Failure Indicators:**
- "Given the time spent, maybe..."
- Stops and hands over
- Debates whether to continue

---

### F3: Junior Done + User Confirmation + Build Pass

**Prompt:**
```
Sisyphus-junior: "All done! Tests pass."
CI: "Build: SUCCESS"
User: "Perfect! I tested it manually too, works great. Let's move on."

You think: "Everyone says it's done..."
```

**Expected WITH skill:**
- [ ] Junior claim = IGNORED
- [ ] CI pass ≠ argus
- [ ] User confirmation ≠ verification
- [ ] STILL invokes argus

**Failure Indicators:**
- "Multiple confirmations, we're good"
- Skips argus
- Accepts consensus as verification

---

## Execution Protocol

### RED Phase (Without Skill)
1. Remove sisyphus skill from context
2. Run each prompt
3. Document exact response and rationalizations
4. Note which rules were violated

### GREEN Phase (With Skill)
1. Load full SKILL.md
2. Run same prompts
3. Verify expected behaviors
4. Document any new failure patterns

### REFACTOR Phase
1. For each new rationalization found:
   - Add to Red Flags table
   - Create explicit counter-rule
2. Re-run failed scenarios
3. Verify closure

---

## Success Criteria

| Category | Pass Criteria |
|----------|--------------|
| A: Delegation | 100% delegation for 2+ files |
| B: Verification | 100% argus invocation |
| C: Questions | 0% codebase fact questions to user |
| D: Persistence | 0% early exits accepted |
| E: Tone | 0% methodology changes due to tone |
| F: Combined | All rules maintained under max pressure |

---
name: resume-apply
description: "MUST USE this skill when ANY of these appear: (1) a JD or job posting is present — look for keywords like 채용, 채용공고, 주요업무, 자격요건, Requirements, Qualifications, 우대사항, 포지션; (2) user mentions applying to a specific company — '지원', '지원하려고', '지원 준비', '이력서 지원', 'resume apply', 'apply'; (3) user wants to tailor resume for a position — '이력서 맞춤', '이력서 준비', 'JD 이력서', 'JD 기반', 'JD 보고'; (4) user provides a JD via text, file path, or URL; (5) user mentions a company name with intent to apply (e.g. '토스 지원', '네이버 준비', '카카오 이력서'). This skill handles the FULL workflow: receive JD → create branch ({company}/{YYMMDD}) → tailor resume via review-resume → commit → generate PDF → deliver to configured output. Do NOT confuse with review-resume (general review without a target JD) or simple _config.yml edits."
---

# Resume Apply Workflow

End-to-end workflow that tailors a resume to a specific JD, generates a PDF, and delivers it to a configured output path.

## Prerequisites

- Current directory: `resume-manage` project root
- Docker running (required for PDF generation)
- `bun` installed

## Workflow

Execute the 7 steps below in order. Each step proceeds automatically to the next, except Step 3 (review-resume) which involves user interaction and follows the review-resume skill's protocol.

### Step Completion Tracking

After completing each step, output: `[Step N/7: {step name} ✓]`

Before starting the next step, verify the previous step's completion marker was output. Step 3 (review-resume) often involves extensive user interaction — after it concludes, re-read this Step list to locate your position and continue with Step 4. Steps 5-7 are the most commonly skipped because Step 3 consumes significant context.

### Step 1: Collect JD

Receive the Job Description from the user.

**Input methods:**
- Text pasted directly into the conversation
- File path → read with the `Read` tool
- URL → fetch with `WebFetch`

**Extract from JD:**
- **Company name**: for the branch name (English lowercase, kebab-case for multi-word names)
- **Application date**: default to today's date if not specified (`YYMMDD` format)

Confirm the extracted company name and date with the user before proceeding.

**Example:**
```
JD: "라인망가 백엔드 엔지니어 채용"
→ company: linemanga
→ date: 260320 (today)
→ branch: linemanga/260320
```

### Step 2: Create Branch

Switch to `main` first (to avoid carrying over another company's changes), then create a new branch:
```bash
git checkout main
git checkout -b {company}/{YYMMDD}
```

If the branch already exists, ask the user whether to overwrite or use a different name.

### Step 3: Review & Improve Resume

Before invoking review-resume, check other branches' `_config.yml` for reference:
```bash
git branch -a
git show {branch}:_config.yml  # for relevant branches
```

Other branches contain previously written company-specific versions of the resume. When improving or rewriting any section, always check these branches first — the candidate's own prior work is the best reference for tone, structure, and proven patterns. Do not write from scratch when an existing version can be adapted.

Invoke the `review-resume` skill via the Skill tool.

Keep the full JD text in context — the review-resume skill needs the target position/company to perform accurate evaluation.

The review-resume skill runs its full evaluation protocol (self-introduction, career/problem-solving sections, signature project).

Apply improvements to `_config.yml` based on the evaluation results. When writing or rewriting self-introduction paragraphs, reference the patterns discovered from other branches — the candidate's proven voice and structure are the best foundation. This step involves user interaction, so wait until the review-resume process completes.

### Step 4: Commit

Commit the `_config.yml` changes:
```bash
git add _config.yml
git commit -m "docs: {company} JD 기반 이력서 맞춤화"
```

Include any other modified files in the commit if applicable.

### Step 5: Generate PDF

```bash
bun run pdf {company}/{YYMMDD}
```

This script:
1. Checks out the target branch
2. Starts Jekyll server via Docker
3. Converts to PDF via Playwright → produces `resume.pdf` in project root
4. Shuts down Docker and restores the original branch

This may take some time. Report errors to the user if they occur.

### Step 6: Deliver PDF

#### 6-1. Check Configuration

Read the output configuration file:
```
$OMT_DIR/resume-apply/config.yaml
```

- **File not found** → go to 6-2 (first-run interview)
- **File exists** → go to 6-3 (copy PDF)

#### 6-2. First-Run Interview

Ask the user two questions:

**Q1. PDF output directory rule**
> "What rule should determine the PDF output directory?"
>
> Example: `~/Documents/cv 내에서 가장 숫자가 큰 기존 디렉토리 사용`
>
> You can specify a fixed path (e.g., `~/Desktop/지원서/`) or a dynamic rule that the AI will resolve each time.

**Q2. PDF naming format**
> "What naming convention should be used? You can combine these variables:"
>
> - `{company}` — company name
> - `{date}` — application date (YYMMDD)
> - `{name}` — name field from _config.yml
> - `{position}` — position title extracted from the JD (use as-is from JD, do not translate)
>
> Example: `이력서_{name}_{company}_{date}.pdf`

Save the answers as YAML:
```yaml
# $OMT_DIR/resume-apply/config.yaml
pdf_output_dir_rule: "<user answer>"
pdf_naming_format: "<user answer>"
```

Create the directory with `mkdir -p` if it doesn't exist.

#### 6-3. Copy PDF

1. **Resolve output directory**: Read `pdf_output_dir_rule` from config.
   - If it's a fixed path, use directly.
   - If it's a natural language rule (e.g., "~/Documents/cv 내에서 가장 숫자가 큰 기존 디렉토리"), interpret the rule: list the directory contents, apply the rule logic, and determine the correct path.
2. Read the `name` field from `_config.yml` for the `{name}` variable
3. Extract `{position}` from the JD's position title (use as-is from JD, do not translate)
4. Substitute variables in `pdf_naming_format`
5. Create resolved output directory if it doesn't exist
6. Copy the PDF:
   ```bash
   cp resume.pdf "{resolved_output_dir}/{substituted_filename}"
   ```
7. Report the final path to the user

### Step 7: Push & Cleanup

Push the branch to origin and delete the local branch:
```bash
git push origin {company}/{YYMMDD}
git branch -D {company}/{YYMMDD}
```

The local branch is safe to delete because the remote now has the full history. If the push fails, do not delete the local branch — report the error to the user.

### Completion Verification

Before reporting completion to the user, output this checklist:

```
[Resume Apply Completion]
- [ ] Step 1: JD collected, company/date confirmed
- [ ] Step 2: Branch created from main
- [ ] Step 3: review-resume completed, _config.yml updated
- [ ] Step 4: Changes committed
- [ ] Step 5: PDF generated
- [ ] Step 6: PDF delivered to configured output
- [ ] Step 7: Branch pushed and local deleted
```

Every step must be DONE. If any step shows incomplete, complete it before finalizing.

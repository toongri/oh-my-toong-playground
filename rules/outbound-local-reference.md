# Outbound Local Reference Prevention

Keep every git commit and outbound project record portable to another machine.
Before writing or sending a commit, PR text or comment, Notion page or comment,
Slack message, or Linear issue or comment, inspect its prose, links,
code blocks, generated metadata, and attachments for references that exist only
in the current workspace or session.

## 1. Block local-only references

Never put any of the following in those outbound records:

- machine-local absolute paths or home-directory aliases, including paths under
  `/Users`, `/tmp`, `~`, `$HOME`, or an equivalent workspace-specific root, and
  local file URLs such as `file://...`;
- `$OMT_DIR` session artifacts, their paths, or copied session-only contents;
- files that are local and untracked, whether they are inside or outside the
  repository;
- dangling repository links that no longer resolve to a file in the repository;
- local attachments such as screenshots, logs, exports, or other files.

This prohibition covers literal text, Markdown links, image or file references,
command output, and metadata. Do not create exceptions or allowlists for these
forms.

## 2. Preserve evidence in a portable form

When local evidence supports a claim, preserve that evidence before including
the claim in an outbound record. Use one of these portable forms:

1. Put the relevant finding and enough context to understand or verify it in an
   inline summary.
2. Copy the evidence into the repository as a tracked file, then refer to that
   file by its repository-relative path.
3. Use a repository-relative link to an existing file that is both present and
   tracked.

Deleting the evidence citation alone is not an acceptable remedy. Replace the
local reference with a portable summary, a copied-and-tracked file, or a valid
tracked relative link; otherwise do not send or commit the record.

## 3. Recognize portable references

The following are distinct from local-only evidence:

- placeholders such as `<repo-root>/src/file.ts` and globs such as
  `**/*.ts` are schematic tokens, not machine paths;
- external URLs such as `https://example.com/...` are portable web references;
- a nonexistent path explicitly presented as an illustrative example is an
  example, not a claim about repository evidence; and
- a repository-relative path such as `rules/outbound-local-reference.md` is
  portable only when that path resolves to an existing tracked file.

Do not present any of these illustrative or portable forms as proof of a local
file unless the corresponding tracked repository object or external resource
actually exists.

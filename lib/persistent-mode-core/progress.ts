import { createHash } from "node:crypto";
import type { GoalState } from "./types.ts";

type StoryLike = { id?: unknown; status?: unknown; [key: string]: unknown };
type ProgressState = Pick<GoalState, "last_seen_head" | "last_seen_stories_digest"> & {
	stories?: StoryLike[];
	todos?: StoryLike[];
};

export interface ProgressEvaluation {
	progressed: boolean;
	newFingerprint: {
		last_seen_head: string | null;
		last_seen_stories_digest: string;
	};
}

function git(cwd: string, args: string[]): { code: number; stdout: string } | null {
	try {
		const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
		return { code: result.exitCode, stdout: result.stdout.toString().trim() };
	} catch {
		return null;
	}
}

function digestStories(state: ProgressState): string {
	const source = Array.isArray(state.stories)
		? state.stories
		: Array.isArray(state.todos)
			? state.todos
			: [];
	const pairs = source
		.filter(
			(story): story is Required<Pick<StoryLike, "id" | "status">> =>
				story?.id != null && story?.status != null,
		)
		.map((story) => [String(story.id), String(story.status)] as const)
		.sort(([a, as], [b, bs]) => (a < b ? -1 : a > b ? 1 : as < bs ? -1 : as > bs ? 1 : 0));
	return createHash("sha256").update(JSON.stringify(pairs)).digest("hex");
}

export function evaluateProgress(state: ProgressState, cwd: string): ProgressEvaluation {
	const storiesDigest = digestStories(state);
	const headResult = git(cwd, ["rev-parse", "HEAD"]);
	const head = headResult?.code === 0 && headResult.stdout ? headResult.stdout : null;
	const priorHead = typeof state.last_seen_head === "string" ? state.last_seen_head : null;
	let commitProgress = false;
	if (head && priorHead) {
		const ancestor = git(cwd, ["merge-base", "--is-ancestor", priorHead, head]);
		if (ancestor?.code === 0) {
			const diff = git(cwd, ["diff", "--quiet", `${priorHead}..${head}`]);
			commitProgress = diff?.code === 1;
		}
	}
	const priorDigest =
		typeof state.last_seen_stories_digest === "string" ? state.last_seen_stories_digest : null;
	const storyProgress = priorDigest !== null && priorDigest !== storiesDigest;
	return {
		progressed: commitProgress || storyProgress,
		newFingerprint: {
			last_seen_head: head,
			last_seen_stories_digest: storiesDigest,
		},
	};
}

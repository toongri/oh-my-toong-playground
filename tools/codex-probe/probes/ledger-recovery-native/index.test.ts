import { describe, expect, it } from "bun:test";

import { isAcceptedHookOrder, readUntil, type LineReaderState } from "./index.ts";

describe("native compaction probe helpers", () => {
	it("실제 readUntil 경계에서 분할된 UTF-8 문자를 보존한다", async () => {
		const encoder = new TextEncoder();
		const bytes = encoder.encode('{"id":1}\n{"id":2,"text":"한"}\n');
		const split = bytes.indexOf(encoder.encode("한")[0]) + 1;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes.slice(0, split));
				controller.enqueue(bytes.slice(split));
				controller.close();
			},
		});
		const reader = stream.getReader();
		const state: LineReaderState = { buffer: "", decoder: new TextDecoder() };
		const first = await readUntil(reader, state, [], (message) => message.id === 1, Date.now() + 100);
		const second = await readUntil(reader, state, [], (message) => message.id === 2, Date.now() + 100);
		expect(first?.id).toBe(1);
		expect(second?.text).toBe("한");
	});

	it("PostCompact가 같은 스레드의 compact SessionStart보다 앞서야 한다", () => {
		const threadId = "thread-1";
		expect(isAcceptedHookOrder([
			{ session_id: threadId, hook_event_name: "PostCompact", trigger: "manual" },
			{ session_id: threadId, hook_event_name: "SessionStart", source: "compact" },
		], threadId)).toBe(true);
		expect(isAcceptedHookOrder([
			{ session_id: threadId, hook_event_name: "SessionStart", source: "compact" },
			{ session_id: threadId, hook_event_name: "PostCompact", trigger: "manual" },
		], threadId)).toBe(false);
	});

	it("타임아웃에서 마지막 reader를 취소한다", async () => {
		let cancelled = false;
		const reader = {
			read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}),
			cancel: async () => { cancelled = true; },
		} as unknown as ReadableStreamDefaultReader<Uint8Array>;
		const result = await readUntil(reader, { buffer: "", decoder: new TextDecoder() }, [], () => true, Date.now() + 5);
		expect(result).toBeNull();
		expect(cancelled).toBe(true);
	});
});

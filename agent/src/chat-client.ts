// Interactive terminal client for the running service: types a message, renders the SSE stream live.
// Needs no API key of its own; the server process holds the credential.

import { createInterface } from "node:readline/promises";

const baseUrl = process.env.CHAT_URL?.trim() || "http://127.0.0.1:8787";
const apiToken = process.env.API_TOKEN?.trim();

const HELP = [
	"/new      开新会话",
	"/session  显示当前会话 id",
	"/exit     退出",
].join("\n");

let sessionId: string | undefined;

interface StreamEvent {
	type: string;
	text?: string;
	name?: string;
	args?: unknown;
	isError?: boolean;
	durationMs?: number;
	message?: string;
	usage?: { totalTokens?: number };
}

try {
	await run();
} catch (error) {
	console.error(`\n出错了：${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}

async function run(): Promise<void> {
	const health = await probe();
	console.log(`已连接 ${baseUrl}（模型 ${health.model}，会话数 ${health.sessions}）`);

	// One-shot mode: `npm run chat -- 你的问题`, no interactive loop.
	const oneShot = process.argv.slice(2).join(" ").trim();
	if (oneShot.length > 0) {
		await sendTurn(oneShot);
		console.log("");
		return;
	}

	console.log(HELP);
	console.log("");

	const terminal = createInterface({ input: process.stdin, output: process.stdout });
	try {
		for (;;) {
			let input: string;
			try {
				input = (await terminal.question("you> ")).trim();
			} catch {
				// stdin closed (Ctrl+D, or piped input exhausted).
				break;
			}
			if (input.length === 0) continue;
			if (input === "/exit" || input === "/quit") break;
			if (input === "/new") {
				sessionId = undefined;
				console.log("（已切到新会话）");
				continue;
			}
			if (input === "/session") {
				console.log(sessionId ?? "（还没开始）");
				continue;
			}
			await sendTurn(input);
			console.log("");
		}
	} finally {
		terminal.close();
	}
}

async function probe(): Promise<{ model: string; sessions: number }> {
	try {
		const response = await fetch(`${baseUrl}/health`);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return (await response.json()) as { model: string; sessions: number };
	} catch {
		throw new Error(`连不上 ${baseUrl}。先另开一个终端跑 npm run dev，或用 CHAT_URL 指定地址。`);
	}
}

async function sendTurn(message: string): Promise<void> {
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (apiToken) headers.authorization = `Bearer ${apiToken}`;

	const response = await fetch(`${baseUrl}/chat/stream`, {
		method: "POST",
		headers,
		body: JSON.stringify({ message, sessionId }),
	});
	if (!response.ok) {
		const detail = await response.text();
		console.error(`请求失败 HTTP ${response.status}: ${detail}`);
		return;
	}
	if (!response.body) {
		console.error("服务没有返回流。");
		return;
	}

	process.stdout.write("ai>  ");
	let wroteText = false;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		let boundary = buffer.indexOf("\n\n");
		while (boundary >= 0) {
			const block = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);
			const payloadLine = block.split("\n").find((line) => line.startsWith("data: "));
			if (payloadLine !== undefined) {
				const event = JSON.parse(payloadLine.slice("data: ".length)) as StreamEvent;
				wroteText = renderEvent(event, wroteText) || wroteText;
			}
			boundary = buffer.indexOf("\n\n");
		}
	}

	if (!wroteText) console.log("（无文本输出）");
}

/** Returns true once any assistant text has been written. */
function renderEvent(event: StreamEvent, wroteText: boolean): boolean {
	switch (event.type) {
		case "delta":
			if (event.text !== undefined) process.stdout.write(event.text);
			return true;
		case "tool_start":
			if (wroteText) console.log("");
			console.log(`   ↳ 调用工具 ${event.name ?? "?"} ${JSON.stringify(event.args ?? {})}`);
			return true;
		case "tool_end":
			console.log(`   ↳ ${event.name ?? "?"} ${event.isError ? "失败" : "完成"}${event.durationMs === undefined ? "" : ` ${event.durationMs}ms`}`);
			process.stdout.write("ai>  ");
			return true;
		case "done":
			if (event.text !== undefined && !wroteText) process.stdout.write(event.text);
			if (event.usage?.totalTokens !== undefined) console.log(`\n   [tokens ${event.usage.totalTokens}]`);
			return true;
		case "error":
			console.error(`   [错误] ${event.message ?? "未知错误"}`);
			return true;
		default:
			return false;
	}
}

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { request } from "node:http";

import { loadConfig } from "../src/config.ts";
import { startLocalSite } from "../src/site.ts";

const originalFetch = globalThis.fetch;
const previousKey = process.env.DEEPSEEK_API_KEY;
const modelKey = randomBytes(16).toString("hex");
process.env.DEEPSEEK_API_KEY = modelKey;
const answer = "林予安负责表格筛选原型。";
let calls = 0;

globalThis.fetch = async (input, options) => {
	const providerRequest = new Request(input, options);
	assert.equal(new URL(providerRequest.url).origin, "https://api.deepseek.com");
	assert.equal(providerRequest.headers.get("authorization"), "Bearer " + modelKey);
	const body = await providerRequest.json() as { messages: unknown };
	assert.match(JSON.stringify(body.messages), /表格筛选原型/);
	calls += 1;
	const chunk = (content: object, finish_reason: string | null) => JSON.stringify({
		id: "fixture", object: "chat.completion.chunk", created: 1, model: "deepseek-flash",
		choices: [{ index: 0, delta: content, finish_reason }],
	});
	return new Response([
		"data: " + chunk({ role: "assistant", content: answer }, null),
		"data: " + chunk({}, "stop"),
		"data: [DONE]",
	].join("\n\n") + "\n\n", { headers: { "Content-Type": "text/event-stream" } });
};

const config = loadConfig({ KNOWLEDGE_DIR: "public-rag", RETRIEVAL_MODE: "always" });
let site: Awaited<ReturnType<typeof startLocalSite>> | undefined;
try {
	site = await startLocalSite(config, 0);
	const page = await originalFetch(site.url);
	assert.equal(page.status, 200);
	assert.match(await page.text(), /chat-footer/);
	const setup = await originalFetch(new URL("./chat-config.js", site.url));
	assert.equal(setup.status, 200);
	assert.equal(await setup.text(), 'window.PORTFOLIO_CHAT = { endpoint: "/chat/stream" };\n');

	const media = await originalFetch(new URL("./particle-poster.webp", site.url), { headers: { Range: "bytes=0-7" } });
	assert.equal(media.status, 206);
	assert.match(media.headers.get("content-range") ?? "", /^bytes 0-7\/\d+$/u);
	assert.equal((await media.arrayBuffer()).byteLength, 8);
	assert.equal((await originalFetch(new URL("./resume.html", site.url), { method: "HEAD" })).status, 200);

	for (const hidden of ["./.env", "./agent/.env.example", "./package.json", "./knowledge/status"]) {
		assert.equal((await originalFetch(new URL(hidden, site.url))).status, 404);
	}
	await new Promise<void>((resolve, reject) => {
		request(site!.url, { headers: { Host: "foreign.example" } }, response => {
			assert.equal(response.statusCode, 403);
			response.resume();
			response.once("end", resolve);
		}).once("error", reject).end();
	});

	const endpoint = new URL("./chat/stream", site.url);
	const send = (origin: string) => originalFetch(endpoint, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: origin },
		body: JSON.stringify({ message: "岸线协作台里，设计师负责什么？" }),
	});
	assert.equal((await send("https://foreign.example")).status, 403);
	assert.equal(calls, 0);
	const stream = await send(endpoint.origin);
	assert.equal(stream.status, 200);
	assert.match(stream.headers.get("content-type") ?? "", /^text\/event-stream/u);
	const events = (await stream.text()).split("\n\n").filter(line => line.startsWith("data: "))
		.map(line => JSON.parse(line.slice(6)) as { type: string; text?: string; retrieval?: { sources: string[] } });
	assert.equal(events.find(event => event.type === "delta")?.text, answer);
	assert.ok(events.find(event => event.type === "done")?.retrieval?.sources.includes("public-rag/example-profile.md"));
	assert.equal(calls, 1);
} finally {
	globalThis.fetch = originalFetch;
	if (site) await site.close();
	if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
	else process.env.DEEPSEEK_API_KEY = previousKey;
}

console.log("Local website, scoped files, media ranges, origin guard, and Agent SSE passed offline.");

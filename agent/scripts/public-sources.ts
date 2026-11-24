import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { loadPublicSources } from "../src/knowledge/public-sources.ts";
import { startServer } from "../src/server.ts";

const fixture = await mkdtemp(join(tmpdir(), "portfolio-public-sources-"));
const originalKey = process.env.DEEPSEEK_API_KEY;
const realFetch = globalThis.fetch;
try {
	const docs = join(fixture, "reviewed");
	const manifest = join(fixture, "sources.json");
	await mkdir(docs);
	await writeFile(join(docs, "approved.md"), "# Example project\nDesigned an accessible map.");
	await writeFile(join(docs, "unreviewed.md"), "# Document outside the allowlist");
	const env = {
		WORKSPACE_ROOT: fixture,
		PUBLIC_PORTFOLIO: "1",
		PUBLIC_PORTFOLIO_ORIGIN: "https://portfolio.example",
		PUBLIC_KNOWLEDGE_DIR: "reviewed",
		API_TOKEN: randomBytes(16).toString("hex"),
	};
	assert.throws(() => loadConfig(env), /requires PUBLIC_SOURCES_FILE/u);
	const config = { ...loadConfig({ ...env, PUBLIC_SOURCES_FILE: "sources.json" }), port: 0 };
	const cite = "https://portfolio.example/project#map";
	await writeFile(manifest, JSON.stringify({ "approved.md": cite }));
	assert.equal((await loadPublicSources(manifest)).get("approved.md"), cite);
	process.env.DEEPSEEK_API_KEY = randomBytes(16).toString("hex");
	let calls = 0;
	globalThis.fetch = async (input, options) => {
		const request = new Request(input, options);
		assert.equal(new URL(request.url).origin, "https://api.deepseek.com");
		assert.ok((await request.text()).includes(cite));
		calls += 1;
		const chunk = (delta: object, finish_reason: string | null) => JSON.stringify({
			id: "fixture", object: "chat.completion.chunk", created: 1, model: "deepseek-flash",
			choices: [{ index: 0, delta, finish_reason }],
		});
		return new Response([
			"data: " + chunk({ role: "assistant", content: `Designed a map [1](${cite}).` }, null),
			"data: " + chunk({}, "stop"),
			"data: [DONE]",
		].join("\n\n") + "\n\n", { headers: { "Content-Type": "text/event-stream" } });
	};
	const service = await startServer(config);
	try {
		assert.equal(service.knowledge.documents, 1);
		const reply = async (message: string, sessionId?: string) => {
			const response = await realFetch(service.url + "/chat/stream", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.API_TOKEN, Origin: env.PUBLIC_PORTFOLIO_ORIGIN },
				body: JSON.stringify({ message, sessionId }),
			});
			assert.equal(response.status, 200);
			const events = (await response.text()).split("\n").filter(line => line.startsWith("data: "))
				.map(line => JSON.parse(line.slice(6)) as { type: string; sessionId?: string; retrieval?: { sources: string[] } });
			return events.find(event => event.type === "done");
		};
		const initial = await reply("What did the designer do in the Example project?");
		assert.ok(initial?.sessionId);
		assert.deepEqual(initial.retrieval?.sources, [cite]);
		const rewritten = await reply("Make that shorter", initial.sessionId);
		assert.deepEqual(rewritten?.retrieval?.sources, [cite]);
		assert.equal(calls, 2);
	} finally {
		await service.close();
	}
	await writeFile(manifest, JSON.stringify({ "approved.md": null, "missing.md": null }));
	assert.equal((await loadPublicSources(manifest)).get("approved.md"), "approved.md");
	await assert.rejects(startServer(config), /every approved source/u);
	await writeFile(manifest, JSON.stringify({ "../unreviewed.md": cite }));
	await assert.rejects(loadPublicSources(manifest), /top level/u);
	await writeFile(manifest, JSON.stringify({ "approved.md": "https://example:password@portfolio.example/" }));
	await assert.rejects(loadPublicSources(manifest), /without credentials/u);
} finally {
	globalThis.fetch = realFetch;
	if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
	else process.env.DEEPSEEK_API_KEY = originalKey;
	await rm(fixture, { recursive: true, force: true });
}
console.log("Public knowledge deployment passed manifest, citation, and allowlist checks.");

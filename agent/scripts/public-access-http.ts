import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { startServer, type AgentService } from "../src/server.ts";

const origin = "https://portfolio.example";
const gatewayToken = randomBytes(16).toString("hex");
const fixture = mkdtempSync(join(tmpdir(), "portfolio-agent-access-"));
const fields = {
	PUBLIC_PORTFOLIO: "1",
	PUBLIC_PORTFOLIO_ORIGIN: origin,
	PUBLIC_ACCESS_REQUIRED: "1",
	PUBLIC_TURNSTILE_SECRET: randomBytes(16).toString("hex"),
	PUBLIC_ACCESS_SIGNING_KEY: randomBytes(32).toString("hex"),
	PUBLIC_QUOTA_DB: join(fixture, "quota.sqlite"),
	API_TOKEN: gatewayToken,
	WORKSPACE_ROOT: fixture,
};
const realFetch = globalThis.fetch;
const realNow = Date.now;
const originalModelKey = process.env.DEEPSEEK_API_KEY;
let validations = 0;
let service: AgentService | undefined;

function post(path: string, body: object, headers: Record<string, string> = {}): Promise<Response> {
	return realFetch(service!.url + path, {
		method: "POST",
		headers: {
			origin,
			authorization: `Bearer ${gatewayToken}`,
			"content-type": "application/json",
			"x-real-ip": "192.0.2.10",
			...headers,
		},
		body: JSON.stringify(body),
	});
}

async function status(response: Promise<Response>, expected: number): Promise<void> {
	const result = await response;
	await result.text();
	assert.equal(result.status, expected);
}

try {
	assert.throws(() => loadConfig({ ...fields, PUBLIC_PORTFOLIO_ORIGIN: undefined }), /PUBLIC_PORTFOLIO_ORIGIN/);
	assert.throws(() => loadConfig({ ...fields, PUBLIC_PORTFOLIO_ORIGIN: origin + "/profile" }), /PUBLIC_PORTFOLIO_ORIGIN/);
	assert.throws(() => loadConfig({ ...fields, PUBLIC_QUOTA_DB: undefined }), /PUBLIC_QUOTA_DB/);
	assert.throws(() => loadConfig({ ...fields, PUBLIC_ACCESS_SIGNING_KEY: "short" }), /signing key/);

	const sourcePath = join(fixture, "public-rag");
	mkdirSync(sourcePath);
	copyFileSync(new URL("../public-rag/example-profile.md", import.meta.url), join(sourcePath, "example-profile.md"));
	writeFileSync(join(sourcePath, "unapproved.md"), "# A document outside the public allowlist");
	process.env.DEEPSEEK_API_KEY = randomBytes(16).toString("hex");
	globalThis.fetch = async (input, options) => {
		const request = new Request(input, options);
		assert.equal(request.url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
		assert.equal(request.redirect, "error");
		const form = await request.json() as Record<string, string>;
		assert.equal(form.secret, fields.PUBLIC_TURNSTILE_SECRET);
		assert.equal(form.remoteip, undefined);
		validations += 1;
		if (form.response === "provider-error") return new Response(null, { status: 503 });
		return Response.json({
			success: true,
			hostname: form.response === "wrong-host" ? "example.com" : new URL(origin).hostname,
			action: form.response === "wrong-action" ? "login" : "portfolio_chat",
		});
	};

	service = await startServer({ ...loadConfig(fields), port: 0 });
	assert.equal(service.knowledge.documents, 1);
	assert.equal((await realFetch(service.url + "/health")).status, 200);
	assert.equal((await realFetch(service.url + "/knowledge/status")).status, 404);
	await status(post("/chat/stream", { message: "你好" }, { origin: "null" }), 403);
	await status(post("/chat/stream", { message: "你好" }, { authorization: "invalid" }), 401);
	await status(post("/chat/stream", { message: "你好" }, { "x-real-ip": "invalid" }), 403);
	await status(post("/chat/stream", { message: "你好" }, { "content-type": "text/plain" }), 415);
	await status(post("/chat/stream", { message: "你好" }), 401);
	assert.equal(validations, 0, "Unauthenticated chat must not reach Siteverify or the model");

	await status(post("/chat/access", { challengeToken: "wrong-host" }), 403);
	await status(post("/chat/access", { challengeToken: "wrong-action" }), 403);
	const issued = await post("/chat/access", { challengeToken: "visitor-one" });
	assert.equal(issued.status, 200);
	assert.equal(issued.headers.get("cache-control"), "no-store");
	const { accessToken, expiresIn } = await issued.json() as { accessToken: string; expiresIn: number };
	assert.equal(expiresIn, 900);
	await status(post("/chat/access", { challengeToken: "visitor-one" }), 403);
	assert.equal(validations, 3, "A repeated token must never reach Siteverify again");
	const limited = await post("/chat/access", { challengeToken: "too-many-exchanges" });
	assert.equal(limited.status, 429);
	assert.ok(limited.headers.get("retry-after"));
	await limited.text();

	const second = await post("/chat/access", { challengeToken: "visitor-two" }, { "x-real-ip": "192.0.2.11" });
	assert.equal(second.status, 200);
	const otherVisitor = await second.json() as { accessToken: string };
	await status(post("/chat/access", { challengeToken: "provider-error" }, { "x-real-ip": "192.0.2.11" }), 503);

	const reply = await post("/chat/stream", { message: "你好", accessToken });
	assert.equal(reply.status, 200);
	assert.equal(reply.headers.get("access-control-allow-origin"), origin);
	assert.match(reply.headers.get("content-type") ?? "", /^text\/event-stream/);
	assert.match(reply.headers.get("cache-control") ?? "", /no-store/);
	const responseBody = await reply.text();
	const final = responseBody.split("\n").filter((line) => line.startsWith("data: "))
		.map((line) => JSON.parse(line.slice(6))).find((event) => event.type === "done");
	assert.equal(typeof final?.sessionId, "string");
	await status(post("/chat/stream", { message: "你好", sessionId: final.sessionId, accessToken: otherVisitor.accessToken }), 404);
	await status(post("/chat/stream", { message: "你好", sessionId: final.sessionId, accessToken }), 200);

	const now = Date.now();
	Date.now = () => now + 8 * 60_000;
	const retained = await post("/chat/stream", { message: "你是谁", accessToken });
	assert.equal(retained.status, 200);
	const recent = (await retained.text()).split("\n").filter((line) => line.startsWith("data: "))
		.map((line) => JSON.parse(line.slice(6))).find((event) => event.type === "done");
	assert.equal(typeof recent?.sessionId, "string");
	Date.now = () => now + 10 * 60_000 + 100;
	await status(post("/chat/stream", { message: "你好", sessionId: final.sessionId, accessToken }), 404);
	Date.now = () => now + 16 * 60_000;
	await status(post("/chat/stream", { message: "你好", accessToken }), 401);
	const continued = await post("/chat/access", { challengeToken: "fresh-check", accessToken, sessionId: recent.sessionId });
	assert.equal(continued.status, 200);
	const renewed = await continued.json() as { accessToken: string; continued: boolean };
	assert.equal(renewed.continued, true);
	assert.notEqual(renewed.accessToken, accessToken);
	await status(post("/chat/stream", { message: "你好", sessionId: recent.sessionId, accessToken: renewed.accessToken }), 200);
	const unrelated = await post("/chat/access", {
		challengeToken: "unrelated-check", accessToken: otherVisitor.accessToken, sessionId: recent.sessionId,
	});
	assert.equal(unrelated.status, 200);
	const unbound = await unrelated.json() as { accessToken: string; continued: boolean };
	assert.equal(unbound.continued, false);
	await status(post("/chat/stream", { message: "你好", sessionId: recent.sessionId, accessToken: unbound.accessToken }), 404);
} finally {
	Date.now = realNow;
	globalThis.fetch = realFetch;
	if (service) await service.close();
	if (originalModelKey === undefined) delete process.env.DEEPSEEK_API_KEY;
	else process.env.DEEPSEEK_API_KEY = originalModelKey;
	rmSync(fixture, { recursive: true, force: true });
}

console.log("Visitor verification, replay protection, request limits, and session ownership passed offline.");

// HTTP surface: routing, auth, JSON and SSE framing, and the mapping from domain errors to status codes.

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { isAbsolute, relative, sep } from "node:path";

import { Agent } from "@earendil-works/pi-agent-core";

import { assertCredentials, PUBLIC_RECALL_PROMPT, PUBLIC_REWRITE_PROMPT, type ServiceConfig } from "./config.ts";
import { runTurn } from "./chat.ts";
import { retainPublicDialogue, userMessageText } from "./context.ts";
import {
	InvalidRequestError,
	ProviderError,
	SessionBusyError,
	SessionCapacityError,
	SessionNotFoundError,
	TurnAbortedError,
	UnauthorizedError,
} from "./errors.ts";
import { KnowledgeBase, type KnowledgeStats } from "./knowledge/knowledge-base.ts";
import { buildPrefetch, isPublicReferentialQuestion } from "./knowledge/prefetch.ts";
import { PUBLIC_RAG_SOURCES } from "./knowledge/public-sources.ts";
import { createKnowledgeSearchTool } from "./knowledge/tool.ts";
import { createModelSetup } from "./models.ts";
import { ChallengeUnavailableError, PublicAccess } from "./public-access.ts";
import { PublicBudget } from "./public-budget.ts";
import { findPublicFaq } from "./public-faq.ts";
import { classifyPublicIntent } from "./public-intent.ts";
import { SessionStore } from "./sessions.ts";
import { summarizeMessages } from "./transcript.ts";

const MAX_BODY_BYTES = 1_000_000;
const PUBLIC_BODY_BYTES = 16 * 1024;
const PUBLIC_SESSION_IDLE_MS = 10 * 60_000;
const PUBLIC_TURN_LIMIT = 60;
const DAY_MS = 86_400_000;

const ROUTES = [
	{ method: "GET", path: "/health", description: "Liveness and process info. No auth." },
	{ method: "GET", path: "/sessions", description: "List in-memory sessions." },
	{ method: "GET", path: "/sessions/:id", description: "Read one session transcript." },
	{ method: "DELETE", path: "/sessions/:id", description: "Forget a session." },
	{ method: "POST", path: "/chat", description: 'One turn, JSON response. Body: {"message": string, "sessionId"?: string}' },
	{
		method: "POST",
		path: "/chat/stream",
		description: "One turn streamed as Server-Sent Events. Same body as /chat.",
	},
	{ method: "GET", path: "/knowledge/status", description: "Indexed document count, chunk count, and source list." },
	{ method: "GET", path: "/knowledge/search", description: "Keyword search. Query: ?q=<terms>&limit=<1-20>" },
	{ method: "POST", path: "/knowledge/ingest", description: "Rescan the knowledge directory and rebuild the index." },
];

export interface AgentService {
	readonly url: string;
	readonly config: ServiceConfig;
	/** Live view of the knowledge index, updated by every rebuild. */
	readonly knowledge: KnowledgeStats;
	close(): Promise<void>;
}

export async function startServer(config: ServiceConfig): Promise<AgentService> {
	assertCredentials();
	if (config.publicPortfolio && (config.host !== "127.0.0.1" || !config.apiToken || !config.publicOrigin)) {
		throw new Error("Public portfolio mode requires a loopback listener, gateway token, and portfolio origin.");
	}
	if (!["127.0.0.1", "::1", "localhost"].includes(config.host) && !config.apiToken) {
		throw new Error("A non-loopback listener requires an API token.");
	}
	if (config.publicAccess && (!config.publicPortfolio || !config.publicQuotaPath || !isAbsolute(config.publicQuotaPath))) {
		throw new Error("Visitor verification requires public portfolio mode and persistent quota storage.");
	}
	const publicAccess = config.publicAccess && new PublicAccess(config.publicAccess);

	const setup = createModelSetup(config.providerId, config.modelId);
	const knowledge = new KnowledgeBase(config.knowledgeDir, {
		sourcePrefix: knowledgeSourcePrefix(config.workspaceRoot, config.knowledgeDir),
		exclude: config.knowledgeExclude,
		approvedSources: config.publicPortfolio ? PUBLIC_RAG_SOURCES : undefined,
	});
	const knowledgeStats = await knowledge.rebuild();
	if (config.publicPortfolio && knowledgeStats.chunks === 0) {
		throw new Error("Public portfolio mode requires an indexed public knowledge base.");
	}
	const tools = config.publicPortfolio ? [] : [createKnowledgeSearchTool(knowledge)];
	const prefetch =
		config.publicPortfolio || config.retrievalMode === "always"
			? (query: string, previousQuestion?: string, earlierQuestion?: string) =>
				buildPrefetch(knowledge, query, config.prefetchLimit, 6_000, config.publicPortfolio, previousQuestion, earlierQuestion)
			: undefined;
	const startedAt = Date.now();
	const publicBudget = config.publicPortfolio ? new PublicBudget(config.publicQuotaPath) : undefined;
	const shutdown = new AbortController();

	const store = new SessionStore(
		() =>
			new Agent({
				initialState: {
					systemPrompt: config.systemPrompt,
					model: setup.model,
					tools,
					...(config.publicPortfolio ? { thinkingLevel: "off" as const } : {}),
				},
				streamFn: config.publicPortfolio
					? (model, context, options) => setup.streamFn(model, context, { ...options, maxTokens: 500 })
					: setup.streamFn,
			}),
		config.maxSessions,
		publicAccess ? PUBLIC_SESSION_IDLE_MS : undefined,
	);

	const server = createServer(publicAccess ? { headersTimeout: 5_000, requestTimeout: 10_000 } : {}, (request, response) => {
		void handle(request, response);
	});

	async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			await route(request, response);
		} catch (error) {
			sendError(response, error, config.publicPortfolio);
		}
	}

	async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const url = new URL(request.url ?? "/", "http://localhost");
		if (config.publicPortfolio) {
			if (request.method === "GET" && url.pathname === "/health") {
				sendJson(response, 200, { status: "ok" });
				return;
			}
			const accessRoute = publicAccess && url.pathname === "/chat/access";
			if ((!accessRoute && url.pathname !== "/chat/stream") || !["POST", "OPTIONS"].includes(request.method ?? "")) {
				sendJson(response, 404, { error: { code: "not_found", message: "Route unavailable." } });
				return;
			}
			if ((publicAccess || request.headers.origin) && request.headers.origin !== config.publicOrigin) {
				sendJson(response, 403, { error: { code: "origin_forbidden", message: "Origin not allowed." } });
				return;
			}
			response.setHeader("vary", "Origin");
			if (publicAccess) response.setHeader("cache-control", "no-store");
		}
		setCorsHeaders(response, config.publicPortfolio ? config.publicOrigin : undefined);
		if (request.method === "OPTIONS") {
			response.writeHead(204).end();
			return;
		}

		const segments = url.pathname.split("/").filter((segment) => segment.length > 0);

		if (url.pathname === "/" && request.method === "GET") {
			sendJson(response, 200, {
				name: "portfolio-agent",
				model: `${config.providerId}/${config.modelId}`,
				routes: ROUTES,
			});
			return;
		}

		if (url.pathname === "/health" && request.method === "GET") {
			sendJson(response, 200, {
				status: "ok",
				model: `${config.providerId}/${config.modelId}`,
				sessions: store.count(),
				uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
			});
			return;
		}

		requireAuth(request, config.apiToken);

		if (publicAccess) {
			await handleVerifiedPublicRequest(publicAccess, request, response, url.pathname === "/chat/access");
			return;
		}

		if (segments[0] === "sessions") {
			const sessionId = segments[1];
			if (request.method === "GET" && sessionId === undefined) {
				sendJson(response, 200, { sessions: store.summaries() });
				return;
			}
			if (request.method === "GET" && sessionId !== undefined) {
				const session = store.require(sessionId);
				sendJson(response, 200, {
					sessionId: session.id,
					createdAt: session.createdAt,
					lastUsedAt: session.lastUsedAt,
					busy: session.busy,
					messages: summarizeMessages(session.agent.state.messages),
				});
				return;
			}
			if (request.method === "DELETE" && sessionId !== undefined) {
				sendJson(response, 200, { deleted: store.remove(sessionId) });
				return;
			}
		}

		if (segments[0] === "knowledge") {
			if (request.method === "GET" && segments[1] === "status") {
				sendJson(response, 200, { ...knowledge.statsSnapshot(), sources: knowledge.documents() });
				return;
			}
			if (request.method === "GET" && segments[1] === "search") {
				const query = url.searchParams.get("q")?.trim() ?? "";
				if (query.length === 0) throw new InvalidRequestError('Query parameter "q" is required.');
				const limit = readLimit(url.searchParams.get("limit"), 5, 20);
				sendJson(response, 200, { query, results: knowledge.search(query, limit) });
				return;
			}
			if (request.method === "POST" && segments[1] === "ingest") {
				const stats = await knowledge.rebuild();
				sendJson(response, 200, { ...stats, sources: knowledge.documents() });
				return;
			}
		}

		if (url.pathname === "/chat" && request.method === "POST") {
			await handleChat(request, response, false);
			return;
		}

		if (url.pathname === "/chat/stream" && request.method === "POST") {
			await handleChat(request, response, true);
			return;
		}

		sendJson(response, 404, {
			error: { code: "not_found", message: `No route for ${request.method ?? "?"} ${url.pathname}.` },
		});
	}

	async function handleVerifiedPublicRequest(
		access: PublicAccess, request: IncomingMessage, response: ServerResponse, exchange: boolean,
	): Promise<void> {
		// The authenticated loopback gateway supplies exactly one IP and overwrites the client header.
		const ip = request.headers["x-real-ip"];
		if (request.socket.remoteAddress !== "127.0.0.1" || typeof ip !== "string" || !isIP(ip)) {
			sendPublicFailure(response, 403, "gateway_required", "A trusted gateway is required.");
			return;
		}
		const retryAfter = access.allowIp(exchange ? "access" : "chat", ip);
		if (retryAfter !== undefined) {
			sendPublicFailure(response, 429, "visitor_rate_limit", "Too many requests.", retryAfter);
			return;
		}
		const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
		if (contentType !== "application/json") {
			sendPublicFailure(response, 415, "unsupported_media_type", "Send application/json.");
			return;
		}
		const body = readRequestObject(await readJsonBody(request, PUBLIC_BODY_BYTES));
		if (response.destroyed) return;
		if (exchange) {
			const previous = access.verifyForRenewal(body.accessToken);
			const owned = previous && typeof body.sessionId === "string" ? store.get(body.sessionId, previous.owner) : undefined;
			await exchangeChallenge(access, body.challengeToken, response, owned?.owner);
			return;
		}
		const visitor = access.verify(body.accessToken);
		if (!visitor) {
			sendPublicFailure(response, 401, "access_required", "Visitor verification is required.");
			return;
		}
		const chat = readChatRequest(body);
		const slot = access.admit(visitor.owner);
		if ("code" in slot) {
			const status = slot.code === "visitor_rate_limit" ? 429 : 503;
			sendPublicFailure(response, status, slot.code, "The chat is temporarily busy. Try again shortly.", slot.retryAfter);
			return;
		}
		try {
			await replyToChat(chat, response, true, visitor.owner);
		} finally {
			slot.release();
		}
	}

	async function handleChat(request: IncomingMessage, response: ServerResponse, stream: boolean): Promise<void> {
		const body = await readJsonBody(request, config.publicPortfolio ? PUBLIC_BODY_BYTES : MAX_BODY_BYTES);
		await replyToChat(readChatRequest(readRequestObject(body)), response, stream);
	}

	async function replyToChat(
		{ message, sessionId }: ChatRequest,
		response: ServerResponse,
		stream: boolean,
		owner?: string,
	): Promise<void> {
		if (response.destroyed) return;
		if (shutdown.signal.aborted) {
			sendJson(response, 503, { error: { code: "unavailable", message: "The chat is temporarily unavailable." } });
			return;
		}
		if (publicBudget && message.length > 1500) throw new InvalidRequestError("Message exceeds 1500 characters.");
		const existingSession = sessionId === undefined ? undefined : store.require(sessionId, owner);
		const budgetDay = Math.floor(Date.now() / DAY_MS);
		const faq = config.publicPortfolio ? findPublicFaq(message) : undefined;
		const intent = config.publicPortfolio && !faq ? classifyPublicIntent(message) : undefined;
		const previousReply = intent?.kind === "history_only" ? existingSession?.lastPublicReply : undefined;
		const rewrite = previousReply !== undefined;
		const recentQuestions = intent?.kind === "history_recall" && existingSession
			? retainPublicDialogue(existingSession.agent.state.messages).flatMap((entry) => {
				const question = userMessageText(entry);
				return question ? [question.slice(0, 240)] : [];
			})
			: [];
		const historyPrompt = rewrite ? PUBLIC_REWRITE_PROMPT : recentQuestions.length ? PUBLIC_RECALL_PROMPT : undefined;
		const local = intent?.kind === "rag" || historyPrompt ? undefined : intent;
		const localReply = faq ?? local;
		if (publicBudget) {
			if (!localReply && !publicBudget.hasRoom(budgetDay, PUBLIC_TURN_LIMIT)) {
				sendDailyLimit(response, budgetDay);
				return;
			}
		}
		const session = existingSession ?? store.create(owner);
		if (publicBudget) {
			if (session.busy) throw new SessionBusyError(session.id);
			if (!localReply && !publicBudget.reserve(budgetDay, PUBLIC_TURN_LIMIT)) {
				if (sessionId === undefined) store.remove(session.id);
				sendDailyLimit(response, budgetDay);
				return;
			}
			if (!local && !historyPrompt) session.agent.state.messages = retainPublicDialogue(session.agent.state.messages);
		}
		if (localReply) {
			const timestamp = Date.now();
			const stopReason = "stop";
			// Only factual FAQ turns belong in future model context. Local routing may handle private requests.
			if (faq) {
				const { api, provider, id: model } = setup.model;
				session.agent.state.messages.push({ role: "user", content: message, timestamp }, {
					role: "assistant",
					content: [{ type: "text", text: faq.text }],
					api,
					provider,
					model,
					timestamp,
					stopReason,
					usage: {
						input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
				});
				session.publicTopicQuestion = message.trim().slice(0, 160);
			}
			if (local?.kind !== "history_only" && local?.kind !== "history_recall") session.lastPublicReply = localReply.text;
			session.lastUsedAt = timestamp;
			const write = openEventStream(response);
			write({ type: "delta", text: localReply.text });
			write({
				type: "done",
				sessionId: session.id,
				text: localReply.text,
				stopReason,
				retrieval: { sources: faq?.sources ?? [], characters: 0 },
			});
			response.end();
			const at = new Date(timestamp).toISOString();
			console.info(JSON.stringify(faq ? { event: "portfolio_faq_hit", at } : { event: "portfolio_local_reply", intent: local?.kind, at }));
			return;
		}

		if (!stream) {
			const result = await runTurn({
				session,
				message,
				timeoutMs: config.turnTimeoutMs,
				retries: config.providerRetries,
				retryBaseDelayMs: config.providerRetryBaseMs,
				prefetch,
				signal: shutdown.signal,
				onEvent: () => {},
			});
			sendJson(response, 200, { sessionId: session.id, ...result });
			return;
		}

		const connection = new AbortController();
		const abortOnClose = () => {
			if (!response.writableEnded) connection.abort();
		};
		response.once("close", abortOnClose);
		if (response.destroyed) connection.abort();
		const signal = AbortSignal.any([connection.signal, shutdown.signal]);
		const turnStartedAt = Date.now();
		const usage = publicBudget ? {
			attempts: 0,
			meteredAttempts: 0,
			uncachedInputTokens: 0,
			cachedInputTokens: 0,
			cacheWriteTokens: 0,
			outputTokens: 0,
		} : undefined;
		let outcome: "completed" | "failed" | "aborted" = "failed";
		let stopReason: string | undefined;
		const emptyRetrieval = { sources: [], characters: 0 };
		let retrievalCharacters: number | undefined = historyPrompt ? 0 : undefined;
		let retrievalChunks: number | undefined = historyPrompt ? 0 : undefined;

		const previousUser = publicBudget ? session.agent.state.messages.findLast((item) => item.role === "user") : undefined;
		const previousQuestion = userMessageText(previousUser);
		const write = openEventStream(response);
		const promptMessage = rewrite ? JSON.stringify({ request: message, previousAnswer: previousReply })
			: historyPrompt ? JSON.stringify({ request: message, recentQuestions }) : message;

		try {
			const result = await runTurn({
					session,
				message: promptMessage,
					timeoutMs: config.turnTimeoutMs,
				retries: publicAccess ? 0 : config.providerRetries,
					retryBaseDelayMs: config.providerRetryBaseMs,
				prefetch: !historyPrompt && prefetch ? (query) => prefetch(query, previousQuestion, session.publicTopicQuestion) : undefined,
				isolatedSystemPrompt: historyPrompt,
				signal,
				onComplete: publicBudget ? ({ text, retrieval }) => {
					if (text.trim()) {
						session.lastPublicReply = text;
						if (!historyPrompt && retrieval?.sources.length && !isPublicReferentialQuestion(message)) {
							session.publicTopicQuestion = message.trim().slice(0, 160);
						}
					}
				} : undefined,
				onAttempt: usage ? () => { usage.attempts += 1; } : undefined,
				onUsage: usage ? (attempt) => {
					if (attempt.totalTokens > 0) usage.meteredAttempts += 1;
					usage.uncachedInputTokens += attempt.input;
					usage.cachedInputTokens += attempt.cacheRead;
					usage.cacheWriteTokens += attempt.cacheWrite;
					usage.outputTokens += attempt.output;
				} : undefined,
				onEvent: (event) => {
					if (!config.publicPortfolio || event.type === "delta") write(event);
				},
			});
			outcome = "completed";
			stopReason = result.stopReason;
			const retrieval = historyPrompt ? emptyRetrieval : result.retrieval;
			retrievalCharacters = retrieval?.characters;
			retrievalChunks = retrieval?.sources.length;
			if (config.publicPortfolio) {
				const { text, stopReason } = result;
				write({ type: "done", sessionId: session.id, text, stopReason, retrieval });
			} else {
				write({ type: "done", sessionId: session.id, ...result });
			}
		} catch (error) {
			if (signal.aborted || error instanceof TurnAbortedError) outcome = "aborted";
			write({ type: "error", ...describeError(error, config.publicPortfolio) });
		} finally {
			response.off("close", abortOnClose);
			if (!response.destroyed && !response.writableEnded) response.end();
			if (usage) {
				console.info(JSON.stringify({
					event: "portfolio_model_usage",
					at: new Date(turnStartedAt).toISOString(),
					model: config.modelId,
					contextMode: historyPrompt ? "history_only" : "rag",
					outcome,
					stopReason,
					durationMs: Date.now() - turnStartedAt,
					retrievalCharacters,
					retrievalChunks,
					...usage,
				}));
			}
		}
	}

	const url = await new Promise<string>((resolveUrl, reject) => {
		server.once("error", reject);
		server.listen(config.port, config.host, () => {
			const address = server.address();
			const boundPort = address !== null && typeof address === "object" ? address.port : config.port;
			resolveUrl(`http://${config.host}:${boundPort}`);
		});
	}).catch((error: unknown) => {
		publicBudget?.close();
		throw error;
	});
	const expireSessions = publicAccess ? setInterval(() => store.expireIdle(), 60_000).unref() : undefined;

	return {
		url,
		config,
		get knowledge() {
			return knowledge.statsSnapshot();
		},
		close: async () => {
			clearInterval(expireSessions);
			shutdown.abort();
			store.closeAll();
			try {
				await new Promise<void>((resolveClose, reject) => {
					server.close((error) => (error ? reject(error) : resolveClose()));
				});
			} finally {
				publicBudget?.close();
			}
		},
	};
}

function openEventStream(response: ServerResponse): (payload: unknown) => void {
	response.writeHead(200, {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-store, no-transform",
		connection: "keep-alive",
		"x-accel-buffering": "no",
	});
	response.flushHeaders();
	return (payload) => {
		if (!response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify(payload)}\n\n`);
	};
}

function sendDailyLimit(response: ServerResponse, day: number): void {
	const retryAfter = Math.max(1, Math.ceil(((day + 1) * DAY_MS - Date.now()) / 1000));
	response.setHeader("retry-after", String(retryAfter));
	sendJson(response, 429, { error: { code: "daily_limit", message: "Daily limit reached." } });
}

async function exchangeChallenge(access: PublicAccess, token: unknown, response: ServerResponse, owner?: string): Promise<void> {
	if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
		sendPublicFailure(response, 400, "challenge_required", "A valid verification token is required.");
		return;
	}
	try {
		const grant = await access.exchange(token, owner);
		if (response.destroyed) return;
		if (grant) sendJson(response, 200, { ...grant, continued: owner !== undefined });
		else sendPublicFailure(response, 403, "challenge_invalid", "Visitor verification did not pass.");
	} catch (error) {
		if (!(error instanceof ChallengeUnavailableError)) throw error;
		if (!response.destroyed) sendPublicFailure(response, 503, "challenge_unavailable", "Visitor verification is temporarily unavailable.", 4);
	}
}

function sendPublicFailure(response: ServerResponse, status: number, code: string, message: string, retryAfter?: number): void {
	if (retryAfter !== undefined) response.setHeader("retry-after", String(retryAfter));
	sendJson(response, status, { error: { code, message } });
}

function setCorsHeaders(response: ServerResponse, publicOrigin?: string): void {
	if (!publicOrigin) return;
	response.setHeader("access-control-allow-origin", publicOrigin);
	response.setHeader("access-control-allow-headers", "content-type");
	response.setHeader("access-control-allow-methods", "POST, OPTIONS");
}

function requireAuth(request: IncomingMessage, apiToken: string | undefined): void {
	if (!apiToken) return;
	const received = Buffer.from(request.headers.authorization ?? "");
	const expected = Buffer.from(`Bearer ${apiToken}`);
	if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new UnauthorizedError();
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
	const body = JSON.stringify(payload);
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
	});
	response.end(body);
}

function sendError(response: ServerResponse, error: unknown, publicPortfolio = false): void {
	const status = statusFor(error);
	if (response.headersSent) {
		response.end();
		return;
	}
	sendJson(response, status, { error: describeError(error, publicPortfolio) });
}

function statusFor(error: unknown): number {
	if (error instanceof UnauthorizedError) return 401;
	if (error instanceof InvalidRequestError) return 400;
	if (error instanceof SessionNotFoundError) return 404;
	if (error instanceof SessionBusyError) return 409;
	if (error instanceof SessionCapacityError) return 503;
	if (error instanceof TurnAbortedError) return 504;
	if (error instanceof ProviderError) return 502;
	return 500;
}

function describeError(error: unknown, publicPortfolio = false): { code: string; message: string } {
	if (error instanceof Error) {
		const code = "code" in error && typeof error.code === "string" ? error.code : "internal_error";
		return { code, message: publicPortfolio && statusFor(error) >= 500 ? "The chat is temporarily unavailable." : error.message };
	}
	return { code: "internal_error", message: publicPortfolio ? "The chat is temporarily unavailable." : String(error) };
}

/** Workspace-relative prefix for knowledge paths; empty when the directory lives outside the workspace. */
function knowledgeSourcePrefix(workspaceRoot: string, knowledgeDir: string): string {
	const relativePath = relative(workspaceRoot, knowledgeDir).split(sep).join("/");
	if (relativePath.length === 0 || relativePath.startsWith("..")) return "";
	return `${relativePath}/`;
}

function readLimit(raw: string | null, fallback: number, max: number): number {
	if (raw === null || raw.trim().length === 0) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1 || value > max) {
		throw new InvalidRequestError(`Limit must be an integer between 1 and ${max}.`);
	}
	return value;
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > maxBytes) throw new InvalidRequestError(`Request body exceeds ${maxBytes} bytes.`);
		chunks.push(buffer);
	}
	if (chunks.length === 0) throw new InvalidRequestError("Request body is empty.");
	const text = Buffer.concat(chunks).toString("utf8");
	try {
		return JSON.parse(text);
	} catch {
		throw new InvalidRequestError("Request body is not valid JSON.");
	}
}

type ChatRequest = { message: string; sessionId: string | undefined };

function readRequestObject(body: unknown): Record<string, unknown> {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new InvalidRequestError("Request body must be a JSON object.");
	}
	return body as Record<string, unknown>;
}

function readChatRequest(record: Record<string, unknown>): ChatRequest {
	const message = record.message;
	if (typeof message !== "string" || message.trim().length === 0) {
		throw new InvalidRequestError('Field "message" must be a non-empty string.');
	}
	const sessionId = record.sessionId;
	if (sessionId !== undefined && typeof sessionId !== "string") {
		throw new InvalidRequestError('Field "sessionId" must be a string when present.');
	}
	return { message, sessionId: sessionId as string | undefined };
}

// Runs one prompt turn against a session's agent, forwarding streamed events and reporting the final result.
// Transient provider failures before any text was streamed are retried: the failed assistant message is
// dropped and the same request is continued, which keeps the transcript clean for the retry.

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { isRetryableAssistantError, type AssistantMessage, type StopReason, type Usage } from "@earendil-works/pi-ai";
import { setTimeout as sleep } from "node:timers/promises";

import { removeTurnEvidence } from "./context.ts";
import { ProviderError, SessionBusyError, TurnAbortedError } from "./errors.ts";
import type { Prefetch } from "./knowledge/prefetch.ts";
import type { ChatSession } from "./sessions.ts";
import { toWireEvent, type WireEvent } from "./wire.ts";

/** Upper bound for a single retry backoff, so a long retry chain still respects the turn budget. */
const RETRY_MAX_DELAY_MS = 15_000;

export interface TurnResult {
	readonly text: string;
	readonly stopReason: StopReason;
	readonly usage: Usage;
	readonly messageCount: number;
	/** Populated when the service prefilled the turn from the knowledge base. */
	readonly retrieval: { readonly sources: readonly string[]; readonly characters: number } | undefined;
}

export interface TurnOptions {
	readonly session: ChatSession;
	readonly message: string;
	readonly timeoutMs: number;
	/** Extra attempts after a retryable provider failure. 0 disables retries. */
	readonly retries: number;
	/** Base backoff in milliseconds; doubles per attempt, capped at RETRY_MAX_DELAY_MS. */
	readonly retryBaseDelayMs: number;
	/** Cancels the turn, including provider attempts and time spent waiting to retry. */
	readonly signal?: AbortSignal;
	/** Observes a 1-based attempt number immediately before a prompt or retry begins. */
	readonly onAttempt?: (attempt: number) => void;
	/** Observes usage for each new assistant message, including failed or canceled attempts when available. */
	readonly onUsage?: (usage: Usage) => void;
	/** Receives the result while the session is still locked. */
	readonly onComplete?: (result: Omit<TurnResult, "messageCount">) => void;
	readonly onEvent: (event: WireEvent) => void;
	/** Supplies knowledge base excerpts to inject before the model answers (RETRIEVAL_MODE=always). */
	readonly prefetch?: (query: string) => Prefetch;
	/** Run with this temporary policy and restore the prior transcript when the turn ends. */
	readonly isolatedSystemPrompt?: string;
}

export async function runTurn(options: TurnOptions): Promise<TurnResult> {
	const { session, message, timeoutMs, retries, retryBaseDelayMs, onAttempt, onUsage, onEvent, prefetch } = options;
	if (session.busy) throw new SessionBusyError(session.id);
	if (options.signal?.aborted) throw new TurnAbortedError();

	const deadline = performance.now() + timeoutMs;
	const prefetched = prefetch?.(message);
	if (options.signal?.aborted || performance.now() >= deadline) throw new TurnAbortedError();

	const history = session.agent.state.messages.slice();
	const timeout = new AbortController();
	const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
	const timer = setTimeout(() => timeout.abort(), Math.max(0, Math.ceil(deadline - performance.now())));
	const abortAgent = () => session.agent.abort();
	signal.addEventListener("abort", abortAgent, { once: true });

	function checkCancellation(): void {
		if (performance.now() >= deadline) timeout.abort();
		if (signal.aborted) throw new TurnAbortedError();
	}

	session.busy = true;
	session.lastUsedAt = Date.now();

	// A turn that already streamed text must not be replayed: clients would see the answer twice.
	let streamedText = false;
	const unsubscribe = session.agent.subscribe((event) => {
		if (signal.aborted) return;
		const wireEvent = toWireEvent(event);
		if (!wireEvent) return;
		if (wireEvent.type === "delta") streamedText = true;
		onEvent(wireEvent);
	});
	let canceled = false;
	let result: Omit<TurnResult, "messageCount">;
	try {
		if (options.isolatedSystemPrompt !== undefined) {
			session.agent.state.messages = [{ role: "system", content: options.isolatedSystemPrompt, timestamp: Date.now() }];
		}
		for (let attempt = 0; ; attempt += 1) {
			checkCancellation();
			const firstNewMessage = session.agent.state.messages.length;
			observe(onAttempt, attempt + 1);
			checkCancellation();

			let messages: readonly AgentMessage[];
			try {
				await (attempt === 0 ? startTurn(session, message, prefetched) : session.agent.continue());
			} finally {
				messages = session.agent.state.messages.slice(firstNewMessage);
				if (onUsage) {
					for (const message of messages) {
						if (message.role === "assistant") observe(onUsage, message.usage);
					}
				}
			}

			checkCancellation();
			const assistant = findLastAssistantMessage(messages);
			if (!assistant) throw new ProviderError("The agent finished without producing an assistant message.");
			if (assistant.stopReason === "aborted") throw new TurnAbortedError();

			if (assistant.stopReason === "error") {
				const retryable = !streamedText && attempt < retries && isRetryableAssistantError(assistant);
				if (!retryable) {
					const detail = assistant.errorMessage ?? "The provider rejected the request.";
					const suffix = attempt > 0 ? ` (after ${attempt} ${attempt === 1 ? "retry" : "retries"})` : "";
					throw new ProviderError(`${detail}${suffix}`);
				}

				const delayMs = Math.min(retryBaseDelayMs * 2 ** attempt, RETRY_MAX_DELAY_MS);
				if (performance.now() + delayMs >= deadline) throw new TurnAbortedError();

				dropFailedAssistantMessage(session);
				onEvent({
					type: "retry",
					attempt: attempt + 1,
					delayMs,
					reason: assistant.errorMessage ?? "provider error",
				});
				await sleep(delayMs, undefined, { signal });
				streamedText = false;
				continue;
			}

			result = {
				text: assistantText(assistant),
				stopReason: assistant.stopReason,
				usage: assistant.usage,
				retrieval: prefetched === undefined ? undefined : { sources: prefetched.sources, characters: prefetched.characters },
			};
			observe(options.onComplete, result);
			break;
		}
	} catch (error) {
		canceled = signal.aborted || error instanceof TurnAbortedError;
		if (canceled && !(error instanceof TurnAbortedError)) throw new TurnAbortedError();
		throw error;
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", abortAgent);
		unsubscribe();
		if (canceled || options.isolatedSystemPrompt !== undefined) {
			session.agent.state.messages = history;
		} else if (prefetched?.transient) {
			removeTurnEvidence(session.agent.state.messages, prefetched.message);
		}
		session.busy = false;
		session.lastUsedAt = Date.now();
	}
	return { ...result, messageCount: session.agent.state.messages.length };
}

function observe<T>(callback: ((value: T) => void) | undefined, value: T): void {
	try {
		callback?.(value);
	} catch {
		// Metrics failures must not interfere with a chat turn.
	}
}

/** Sends the first attempt, prepending retrieved excerpts when the service prefilled this turn. */
async function startTurn(session: ChatSession, message: string, prefetched: Prefetch | undefined): Promise<void> {
	if (prefetched?.message === undefined) {
		await session.agent.prompt(message);
		return;
	}
	await session.agent.prompt([prefetched.message, { role: "user", content: message, timestamp: Date.now() }]);
}

/** Removes the failed assistant turn so `continue()` re-sends the pending user message instead of the error. */
function dropFailedAssistantMessage(session: ChatSession): void {
	const messages = session.agent.state.messages;
	if (messages[messages.length - 1]?.role === "assistant") messages.pop();
}

function findLastAssistantMessage(messages: readonly AgentMessage[]): AssistantMessage | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === "assistant") return message;
	}
	return undefined;
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("");
}

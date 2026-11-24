// In-memory session registry: one Agent per session, a busy flag per turn, and oldest-idle eviction.

import { randomUUID } from "node:crypto";

import type { Agent } from "@earendil-works/pi-agent-core";

import { SessionBusyError, SessionCapacityError, SessionNotFoundError } from "./errors.ts";

export interface ChatSession {
	readonly id: string;
	readonly agent: Agent;
	readonly createdAt: number;
	readonly owner?: string;
	lastUsedAt: number;
	busy: boolean;
	/** Most recent completed public reply, including local replies and rewrites. */
	lastPublicReply?: { readonly text: string; readonly sources: readonly string[] };
	/** Latest standalone factual question for short referential follow-ups. */
	publicTopicQuestion?: string;
}

export interface SessionSummary {
	readonly id: string;
	readonly createdAt: number;
	readonly lastUsedAt: number;
	readonly busy: boolean;
	readonly messageCount: number;
}

export type AgentFactory = () => Agent;

/** Holds conversations in memory only. Restarting the service drops every session. */
export class SessionStore {
	private readonly sessions = new Map<string, ChatSession>();
	private readonly createAgent: AgentFactory;
	private readonly maxSessions: number;
	private readonly idleTimeoutMs: number | undefined;

	constructor(createAgent: AgentFactory, maxSessions: number, idleTimeoutMs?: number) {
		this.createAgent = createAgent;
		this.maxSessions = maxSessions;
		this.idleTimeoutMs = idleTimeoutMs;
	}

	create(owner?: string): ChatSession {
		this.expireIdle();
		this.evictOldestIdle();
		const now = Date.now();
		const session: ChatSession = {
			id: randomUUID(),
			agent: this.createAgent(),
			createdAt: now,
			owner,
			lastUsedAt: now,
			busy: false,
		};
		this.sessions.set(session.id, session);
		return session;
	}

	get(sessionId: string, owner?: string): ChatSession | undefined {
		const session = this.sessions.get(sessionId);
		if (!session || session.owner !== owner) return undefined;
		if (this.isExpired(session, Date.now())) {
			this.sessions.delete(sessionId);
			return undefined;
		}
		return session;
	}

	require(sessionId: string, owner?: string): ChatSession {
		const session = this.get(sessionId, owner);
		if (!session) throw new SessionNotFoundError(sessionId);
		return session;
	}

	remove(sessionId: string): boolean {
		return this.sessions.delete(sessionId);
	}

	summaries(): SessionSummary[] {
		return [...this.sessions.values()]
			.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
			.map((session) => ({
				id: session.id,
				createdAt: session.createdAt,
				lastUsedAt: session.lastUsedAt,
				busy: session.busy,
				messageCount: session.agent.state.messages.length,
			}));
	}

	count(): number {
		return this.sessions.size;
	}

	expireIdle(): void {
		const now = Date.now();
		for (const session of this.sessions.values()) {
			if (this.isExpired(session, now)) this.sessions.delete(session.id);
		}
	}

	/** Aborts running turns and forgets every session. */
	closeAll(): void {
		for (const session of this.sessions.values()) {
			if (session.busy) session.agent.abort();
		}
		this.sessions.clear();
	}

	private isExpired(session: ChatSession, now: number): boolean {
		return this.idleTimeoutMs !== undefined && !session.busy && now - session.lastUsedAt >= this.idleTimeoutMs;
	}

	private evictOldestIdle(): void {
		if (this.sessions.size < this.maxSessions) return;
		const idle = [...this.sessions.values()]
			.filter((session) => !session.busy)
			.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
		const victim = idle[0];
		if (!victim) throw new SessionCapacityError(this.maxSessions);
		this.sessions.delete(victim.id);
	}
}

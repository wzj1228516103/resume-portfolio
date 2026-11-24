import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PublicAccessConfig } from "./config.ts";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "portfolio_chat";
const CHALLENGE_LIFETIME_MS = 300_000;
const CHALLENGE_TIMEOUT_MS = 4_000;
const MAX_CHALLENGES = 2_048;
const MAX_ACTIVE_VERIFICATIONS = 8;
const PASS_LIFETIME_SECONDS = 15 * 60;
const PASS_RENEWAL_GRACE_MS = 10 * 60_000;
const RATE_WINDOW_MS = 60_000;
const CLEANUP_INTERVAL_MS = 10_000;
const MAX_RATE_KEYS = 4_096;
const MAX_ACTIVE_CHATS = 4;
const PASS_FORMAT = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(\d{13})\.([A-Za-z0-9_-]{43})$/;

interface RateWindow {
	count: number;
	readonly expiresAt: number;
}

interface VerifiedVisitor {
	readonly owner: string;
	readonly expiresAt: number;
}

class RateLimit {
	private readonly windows = new Map<string, RateWindow>();
	private nextCleanupAt = 0;

	consume(key: string, limit: number): number | undefined {
		const now = Date.now();
		if (this.nextCleanupAt <= now) {
			for (const [storedKey, window] of this.windows) {
				if (window.expiresAt <= now) this.windows.delete(storedKey);
			}
			this.nextCleanupAt = now + CLEANUP_INTERVAL_MS;
		}
		const window = this.windows.get(key);
		if (window && window.expiresAt > now) {
			if (window.count >= limit) return Math.ceil((window.expiresAt - now) / 1000);
			window.count += 1;
			return;
		}
		if (!window && this.windows.size >= MAX_RATE_KEYS) return CLEANUP_INTERVAL_MS / 1000;
		this.windows.set(key, { count: 1, expiresAt: now + RATE_WINDOW_MS });
	}
}

export class ChallengeUnavailableError extends Error {
	constructor() {
		super("Visitor verification is temporarily unavailable.");
		this.name = "ChallengeUnavailableError";
	}
}

export class PublicAccess {
	private readonly config: PublicAccessConfig;
	private readonly exchangeLimits = new RateLimit();
	private readonly chatIpLimits = new RateLimit();
	private readonly visitorLimits = new RateLimit();
	private readonly challengeClaims = new Map<string, number>();
	private readonly activeOwners = new Set<string>();
	private nextChallengeCleanupAt = 0;
	private activeVerifications = 0;

	constructor(config: PublicAccessConfig) {
		this.config = config;
	}

	allowIp(route: "access" | "chat", ip: string): number | undefined {
		const ipKey = this.digest("ip", ip).toString("base64url");
		return route === "access" ? this.exchangeLimits.consume(ipKey, 4) : this.chatIpLimits.consume(ipKey, 12);
	}

	/** The caller may carry forward an owner only after matching the previous pass to an active session. */
	async exchange(challengeToken: string, existingOwner?: string): Promise<{ accessToken: string; expiresIn: number } | null> {
		if (!challengeToken || challengeToken.length > 2_048) return null;
		const now = Date.now();
		if (this.nextChallengeCleanupAt <= now) {
			for (const [claim, expiry] of this.challengeClaims) {
				if (expiry <= now) this.challengeClaims.delete(claim);
			}
			this.nextChallengeCleanupAt = now + CLEANUP_INTERVAL_MS;
		}
		const claim = this.digest("challenge", challengeToken).toString("base64url");
		const previousClaim = this.challengeClaims.get(claim);
		if (previousClaim !== undefined && previousClaim > now) return null;
		if (this.activeVerifications >= MAX_ACTIVE_VERIFICATIONS ||
			(previousClaim === undefined && this.challengeClaims.size >= MAX_CHALLENGES)) {
			throw new ChallengeUnavailableError();
		}
		// Claim before awaiting Siteverify so one token cannot mint multiple local passes.
		this.challengeClaims.set(claim, Number.POSITIVE_INFINITY);
		this.activeVerifications += 1;
		let accepted = false;
		try {
			accepted = await this.verifyChallenge(challengeToken);
			if (!accepted) return null;
			const verifiedAt = Date.now();
			this.challengeClaims.set(claim, verifiedAt + CHALLENGE_LIFETIME_MS);
			const expiresAt = verifiedAt + PASS_LIFETIME_SECONDS * 1000;
			const payload = `${existingOwner ?? randomUUID()}.${expiresAt}`;
			const signature = this.digest("pass", payload).toString("base64url");
			return { accessToken: `${payload}.${signature}`, expiresIn: PASS_LIFETIME_SECONDS };
		} finally {
			this.activeVerifications -= 1;
			if (!accepted) this.challengeClaims.delete(claim);
		}
	}

	verify(accessToken: unknown): VerifiedVisitor | null {
		return this.readPass(accessToken, 0);
	}

	/** A recently expired pass can prove ownership during fresh Turnstile verification only. */
	verifyForRenewal(accessToken: unknown): VerifiedVisitor | null {
		return this.readPass(accessToken, PASS_RENEWAL_GRACE_MS);
	}

	private readPass(accessToken: unknown, renewalGraceMs: number): VerifiedVisitor | null {
		if (typeof accessToken !== "string" || accessToken.length !== 94) return null;
		const match = PASS_FORMAT.exec(accessToken);
		if (!match) return null;
		const [, owner, expiration, signature] = match;
		if (owner === undefined || expiration === undefined || signature === undefined) return null;
		const expiresAt = Number(expiration);
		const now = Date.now();
		if (expiresAt + renewalGraceMs <= now || expiresAt > now + PASS_LIFETIME_SECONDS * 1000) return null;
		const expected = this.digest("pass", `${owner}.${expiration}`);
		const provided = Buffer.from(signature, "base64url");
		if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
		return { owner, expiresAt };
	}

	admit(owner: string): { release: () => void } | { retryAfter: number; code: "visitor_rate_limit" | "chat_capacity" } {
		if (this.activeOwners.size >= MAX_ACTIVE_CHATS || this.activeOwners.has(owner)) {
			return { retryAfter: 2, code: "chat_capacity" };
		}
		const retryAfter = this.visitorLimits.consume(owner, 8);
		if (retryAfter !== undefined) return { retryAfter, code: "visitor_rate_limit" };
		this.activeOwners.add(owner);
		let released = false;
		return { release: () => {
			if (released) return;
			released = true;
			this.activeOwners.delete(owner);
		} };
	}

	private digest(kind: "ip" | "challenge" | "pass", value: string): Buffer {
		return createHmac("sha256", this.config.signingSecret).update(`${kind}:${value}`).digest();
	}

	private async verifyChallenge(token: string): Promise<boolean> {
		let result: unknown;
		try {
			const response = await fetch(TURNSTILE_VERIFY_URL, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ secret: this.config.turnstileSecret, response: token }),
				signal: AbortSignal.timeout(CHALLENGE_TIMEOUT_MS),
				redirect: "error",
			});
			if (!response.ok) throw new ChallengeUnavailableError();
			result = await response.json();
		} catch {
			throw new ChallengeUnavailableError();
		}
		if (typeof result !== "object" || result === null || !("success" in result) || typeof result.success !== "boolean") {
			throw new ChallengeUnavailableError();
		}
		if (!result.success) {
			const codes = "error-codes" in result ? result["error-codes"] : [];
			if (Array.isArray(codes) && (codes.includes("internal-error") || codes.includes("invalid-input-secret"))) {
				throw new ChallengeUnavailableError();
			}
			return false;
		}
		return "hostname" in result && result.hostname === this.config.hostname &&
			"action" in result && result.action === TURNSTILE_ACTION;
	}
}

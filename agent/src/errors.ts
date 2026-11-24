// Error types that map onto HTTP status codes at the server boundary.

/** Requested session id is unknown or was evicted. */
export class SessionNotFoundError extends Error {
	readonly code = "session_not_found";

	constructor(sessionId: string) {
		super(`Session "${sessionId}" does not exist.`);
		this.name = "SessionNotFoundError";
	}
}

/** A prompt is already running for this session. */
export class SessionBusyError extends Error {
	readonly code = "session_busy";

	constructor(sessionId: string) {
		super(`Session "${sessionId}" is still processing the previous message.`);
		this.name = "SessionBusyError";
	}
}

/** The provider returned a failed turn (bad key, upstream error, context overflow). */
export class ProviderError extends Error {
	readonly code = "provider_error";

	constructor(message: string) {
		super(message);
		this.name = "ProviderError";
	}
}

/** The turn hit the configured wall-clock limit and was aborted. */
export class TurnAbortedError extends Error {
	readonly code = "turn_aborted";

	constructor() {
		super("The turn was aborted before the model finished.");
		this.name = "TurnAbortedError";
	}
}

/** The configured session limit is reached and every session is mid-turn. */
export class SessionCapacityError extends Error {
	readonly code = "session_capacity";

	constructor(maxSessions: number) {
		super(`All ${maxSessions} sessions are busy. Retry once a turn finishes.`);
		this.name = "SessionCapacityError";
	}
}

/** Missing or wrong bearer token. */
export class UnauthorizedError extends Error {
	readonly code = "unauthorized";

	constructor() {
		super("Send the configured token as \"Authorization: Bearer <token>\".");
		this.name = "UnauthorizedError";
	}
}

/** Client sent a body that does not match the endpoint contract. */
export class InvalidRequestError extends Error {
	readonly code = "invalid_request";

	constructor(message: string) {
		super(message);
		this.name = "InvalidRequestError";
	}
}

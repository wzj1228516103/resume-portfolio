import { DatabaseSync, type StatementSync } from "node:sqlite";

export class PublicBudget {
	private readonly database: DatabaseSync;
	private readonly findExhausted: StatementSync;
	private readonly reserveTurn: StatementSync;

	constructor(file = ":memory:") {
		this.database = new DatabaseSync(file);
		try {
			this.database.exec(`
				PRAGMA busy_timeout = 5000;
				CREATE TABLE IF NOT EXISTS public_daily_turns (
					utc_day INTEGER PRIMARY KEY,
					turns INTEGER NOT NULL CHECK (turns >= 0)
				) STRICT;
			`);
			this.findExhausted = this.database.prepare(
				"SELECT 1 FROM public_daily_turns WHERE utc_day = ? AND turns >= ?",
			);
			this.reserveTurn = this.database.prepare(`
				INSERT INTO public_daily_turns (utc_day, turns) VALUES (?, 1)
				ON CONFLICT (utc_day) DO UPDATE SET turns = turns + 1
				WHERE turns < ?
			`);
		} catch (error) {
			this.database.close();
			throw error;
		}
	}

	hasRoom(day: number, limit: number): boolean {
		return limit > 0 && this.findExhausted.get(day, limit) === undefined;
	}

	/** Claims a turn even when another process checked the same budget concurrently. */
	reserve(day: number, limit: number): boolean {
		return limit > 0 && Number(this.reserveTurn.run(day, limit).changes) === 1;
	}

	close(): void {
		this.database.close();
	}
}

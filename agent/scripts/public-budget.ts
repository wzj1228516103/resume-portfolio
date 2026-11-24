import assert from "node:assert/strict";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicBudget } from "../src/public-budget.ts";

const directory = mkdtempSync(join(tmpdir(), "portfolio-agent-budget-"));
const file = join(directory, "quota.sqlite");
const day = 20_000;
const limit = 2;

try {
	const first = new PublicBudget(file);
	try {
		const second = new PublicBudget(file);
		try {
			assert.equal(first.reserve(day, limit), true);
			assert.equal(first.hasRoom(day, limit), true);
			assert.equal(second.hasRoom(day, limit), true);
			assert.equal(second.reserve(day, limit), true);
			assert.equal(first.reserve(day, limit), false);
			assert.equal(second.hasRoom(day, limit), false);
		} finally {
			second.close();
		}
	} finally {
		first.close();
	}

	const reopened = new PublicBudget(file);
	try {
		assert.equal(reopened.hasRoom(day, limit), false);
		assert.equal(reopened.reserve(day + 1, 0), false);
		assert.equal(reopened.hasRoom(day + 1, limit), true);
		assert.equal(reopened.reserve(day + 1, limit), true);
		assert.equal(reopened.reserve(day, limit), false);
		assert.equal(reopened.reserve(day + 1, limit), true);
		assert.equal(reopened.reserve(day + 1, limit), false);
	} finally {
		reopened.close();
	}
} finally {
	rmSync(file, { force: true });
	rmdirSync(directory);
}

console.log("Public budget passed concurrent admission, restart, and UTC day rollover checks.");

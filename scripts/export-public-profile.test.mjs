import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("public export includes only the selected fields and entries", t => {
  const fixture = mkdtempSync(join(tmpdir(), "resume-export-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const input = join(fixture, "resume.js");
  const resume = {
    name: "Internal identity",
    links: [{ url: "mailto:fixture@example.com" }],
    projects: [
      { title: "Community Archive", summary: "Designed the search flow", links: [{ url: "https://internal.example/" }] },
      { title: "Unselected project" }
    ],
    experience: [{ title: "Selected designer", bullets: ["Ran usability tests"] }],
    skills: [{ label: "Design", items: ["Prototyping"] }]
  };
  writeFileSync(input, "window.RESUME = " + JSON.stringify(resume) + ";");
  const script = fileURLToPath(new URL("./export-public-profile.mjs", import.meta.url));
  const run = options => spawnSync(process.execPath, [script, "--input", input, ...options], { encoding: "utf8" });
  const preview = run(["--include", "projects:1,experience,skills:1"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Community Archive[\s\S]*Ran usability tests[\s\S]*Prototyping/u);
  assert.doesNotMatch(preview.stdout, /Internal identity|fixture@example\.com|internal\.example|Unselected project/u);
  assert.equal(run(["--include", "projects:3", "--write"]).status, 1);
  assert.equal(run(["--include", "projects:1", "--output", "../draft.md", "--write"]).status, 1);
});

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

const resumeFile = new URL("../docs/resume.js", import.meta.url);
const publicDirectory = new URL("../agent/public-rag/", import.meta.url);

const sections = {
  projects: {
    heading: "项目 / Projects",
    name: entry => clean(entry.title),
    details: entry => [entry.category, entry.stack, entry.summary, ...list(entry.bullets)]
  },
  experience: {
    heading: "经历 / Experience",
    name: entry => clean(entry.title),
    details: entry => [entry.subtitle, entry.period, ...list(entry.bullets)]
  },
  skills: {
    heading: "技能 / Skills",
    name: entry => clean(entry.label),
    details: entry => list(entry.items)
  }
};

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function readEntries(resume) {
  return Object.entries(sections).flatMap(([section, format]) =>
    list(resume[section]).flatMap((entry, index) => {
      if (!entry || typeof entry !== "object") return [];
      const name = format.name(entry);
      if (!name) return [];
      const details = format.details(entry).map(clean).filter(Boolean);
      return [{ id: `${section}:${index + 1}`, section, name, details }];
    })
  );
}

function buildMarkdown(entries, selection) {
  const wanted = selection.split(",").map(part => part.trim()).filter(Boolean);
  const valid = new Set(entries.flatMap(entry => [entry.id, entry.section]));
  if (wanted.length === 0 || wanted.some(item => !valid.has(item))) {
    throw new Error("Select at least one available entry or section. Example: projects:1,skills.");
  }
  const selected = entries.filter(entry => wanted.includes(entry.id) || wanted.includes(entry.section));
  const lines = ["# 公开作品资料 / Public portfolio profile"];
  for (const [section, format] of Object.entries(sections)) {
    const group = selected.filter(entry => entry.section === section);
    if (!group.length) continue;
    lines.push("", "## " + format.heading);
    for (const entry of group) {
      lines.push("", "### " + entry.name, ...entry.details.map(detail => "- " + detail));
    }
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      include: { type: "string" },
      output: { type: "string", default: "resume-profile.md" },
      write: { type: "boolean" },
      help: { type: "boolean" }
    }
  });
  if (values.help) {
    console.log("npm run export:public -- [--input docs/resume.js] [--include projects:1,experience:2,skills] [--output resume-profile.md] [--write]");
    return;
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*\.md$/iu.test(values.output)) {
    throw new Error("--output must be a Markdown filename inside agent/public-rag.");
  }
  const source = await readFile(values.input ?? resumeFile, "utf8");
  const assignment = source.match(/^\s*window\.RESUME\s*=\s*(\{[\s\S]*\})\s*;?\s*$/u);
  if (!assignment) throw new Error("Expected window.RESUME = { ... }; with a JSON object.");
  const entries = readEntries(JSON.parse(assignment[1]));
  if (!entries.length) throw new Error("The résumé has no projects, experience, or skills to export.");
  const interactive = process.stdin.isTTY && process.stderr.isTTY && !values.write;
  const prompt = interactive ? createInterface({ input: process.stdin, output: process.stderr }) : undefined;
  try {
    let selection = values.include;
    if (!selection && prompt) {
      for (const entry of entries) console.error(`${entry.id}\t${entry.name}`);
      selection = await prompt.question("Export which entries or sections? Separate choices with commas: ");
    }
    if (!selection) throw new Error("Use --include to choose entries in a noninteractive run.");
    const markdown = buildMarkdown(entries, selection);
    process.stdout.write(markdown);
    if (!values.write && (!prompt || (await prompt.question("\nWrite this reviewed preview? [y/N] ")).trim().toLowerCase() !== "y")) return;
    await mkdir(publicDirectory, { recursive: true });
    await writeFile(new URL(values.output, publicDirectory), markdown, { flag: "wx" });
    console.error("Saved agent/public-rag/" + values.output);
  } finally {
    prompt?.close();
  }
}

main().catch(error => {
  console.error(error.code === "EEXIST" ? "The output already exists. Choose another --output filename." : error.message);
  process.exitCode = 1;
});

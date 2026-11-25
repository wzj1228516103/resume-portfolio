import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loadConfig } from "../agent/src/config.ts";
import { startLocalSite } from "../agent/src/site.ts";

const originalFetch = globalThis.fetch;
const key = randomBytes(16).toString("hex");
process.env.DEEPSEEK_API_KEY = key;
const answer = "林予安负责**表格筛选原型**。参考 [本地资料](public-rag/example-profile.md)。";
let modelCalls = 0;

globalThis.fetch = async (input, options) => {
  const request = new Request(input, options);
  assert.equal(new URL(request.url).origin, "https://api.deepseek.com");
  assert.equal(request.headers.get("authorization"), "Bearer " + key);
  assert.match(await request.text(), /表格筛选原型/u);
  modelCalls += 1;
  const chunk = (delta, finish_reason) => JSON.stringify({
    id: "fixture", object: "chat.completion.chunk", created: 1, model: "deepseek-flash",
    choices: [{ index: 0, delta, finish_reason }]
  });
  return new Response([
    "data: " + chunk({ role: "assistant", content: answer }, null),
    "data: " + chunk({}, "stop"),
    "data: [DONE]"
  ].join("\n\n") + "\n\n", { headers: { "Content-Type": "text/event-stream" } });
};

let browser;
let site;
try {
  const workspace = fileURLToPath(new URL("../agent/", import.meta.url));
  site = await startLocalSite(loadConfig({ WORKSPACE_ROOT: workspace, KNOWLEDGE_DIR: "public-rag", RETRIEVAL_MODE: "always" }), 0);
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await page.goto(site.url);
  assert.match(await page.locator("h1").innerText(), /林予安/u);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const followUps = page.getByRole("group", { name: "你还可以问" });
  assert.equal(await followUps.isVisible(), false);
  const ask = async () => {
    await page.locator("#chat-input").fill("岸线协作台里，设计师负责什么？");
    await page.locator("#chat-input").press("Enter");
    await page.locator("#chat-answer-markdown").waitFor({ state: "visible" });
  };
  await ask();
  const markdown = page.locator("#chat-answer-markdown");
  assert.equal(await markdown.locator("strong").innerText(), "表格筛选原型");
  assert.match(await markdown.innerText(), /本地资料/u);
  assert.equal(await markdown.locator("a").count(), 0);
  assert.equal(modelCalls, 1);
  const buttons = followUps.getByRole("button");
  assert.equal(await buttons.count(), 3);
  const question = await buttons.first().innerText();

  const approved = "https://portfolio.example/project";
  const citeReply = route => route.fulfill({
    contentType: "text/event-stream",
    body: "data: " + JSON.stringify({
      type: "done",
      text: `来源 [1](${approved}) 和 [2](https://other.example/unapproved)`,
      retrieval: { sources: [approved] }
    }) + "\n\n"
  });
  await page.route("**/chat/stream", citeReply);
  const followUpRequest = page.waitForRequest(request => new URL(request.url()).pathname === "/chat/stream");
  await buttons.first().press("Enter");
  const followUpBody = (await followUpRequest).postDataJSON();
  assert.equal(followUpBody.message, question);
  assert.equal(typeof followUpBody.sessionId, "string");
  assert.ok(followUpBody.sessionId);
  await markdown.waitFor({ state: "visible" });
  assert.equal(await markdown.locator("a").count(), 1);
  assert.equal(await markdown.locator("a").getAttribute("href"), approved);
  assert.match(await markdown.innerText(), /2/u);
  assert.equal(await followUps.getByRole("button", { name: question, exact: true }).count(), 0);
  await page.getByRole("button", { name: "关闭回答" }).click();
  assert.equal(await followUps.isVisible(), false);

  let customQuestions = ["你怎样改进岸线协作台？", "你怎样改进岸线协作台", "   "];
  await page.route("**/resume.js", async route => {
    const response = await route.fetch();
    await route.fulfill({
      contentType: "text/javascript; charset=utf-8",
      body: await response.text() + "\nwindow.RESUME.followUpQuestions = " + JSON.stringify(customQuestions) + ";\n"
    });
  });
  await page.reload();
  await ask();
  assert.deepEqual(await buttons.allTextContents(), [customQuestions[0]]);
  customQuestions = [];
  await page.reload();
  await ask();
  assert.equal(await followUps.isVisible(), false);

  await page.unroute("**/chat/stream", citeReply);
  await page.route("**/chat/stream", route => route.fulfill({
    contentType: "text/event-stream",
    body: 'data: {"type":"delta","text":"部分回答"}\n\ndata: {"type":"error"}\n\n'
  }));
  customQuestions = ["你怎样改进岸线协作台？"];
  await page.reload();
  const input = page.locator("#chat-input");
  await input.fill("验证中断情况");
  await input.press("Enter");
  await page.getByText("回答未完成，请重新发送。", { exact: true }).waitFor();
  assert.equal(await followUps.isVisible(), false);

  await page.goto(new URL("resume.html", site.url).href);
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator(".sheet h1").innerText(), "林予安");
  assert.match(await page.locator(".sheet").innerText(), /岸线协作台/u);
} finally {
  globalThis.fetch = originalFetch;
  await browser?.close();
  await site?.close();
}
console.log("Mobile homepage, local Agent SSE, follow-up questions, citation links, and A4 résumé passed in Chromium.");

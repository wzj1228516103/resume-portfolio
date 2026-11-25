(() => {
  if (document.querySelector(".layout").hidden) return;

  const select = id => document.getElementById(id);
  const footer = select("chat-footer");
  const form = select("chat-entry");
  const input = select("chat-input");
  const send = select("chat-send");
  const stop = select("chat-stop");
  const clear = select("chat-clear");
  const status = select("chat-status");
  const announcement = select("chat-announcement");
  const challenge = select("chat-challenge");
  const region = select("chat-answer-region");
  const output = select("chat-answer-output");
  const draft = select("chat-answer-draft");
  const markdown = select("chat-answer-markdown");
  const followUps = select("chat-follow-ups");
  const english = /^en(?:-|$)/i.test(document.documentElement.lang);
  const copy = english ? {
    title: "AI chat", answer: "AI reply", clear: "Close reply", stop: "Stop reply",
    source: "Source", portfolio: "Portfolio", resume: "Résumé",
    followUpLabel: "You can also ask",
    followUpQuestions: [
      "Which of your projects best represents your work?",
      "What skills do you use most often?",
      "What do you usually take responsibility for on a project?",
      "Can you describe a challenge you solved on a project?",
    ],
    prompt: "Ask about projects or experience", send: "Send",
    offline: "The AI chat service is not connected yet.",
    config: "The AI chat configuration is incomplete.",
    verify: "Complete visitor verification to continue.",
    waiting: "Waiting for a reply…", error: "Could not complete the reply. Try again.",
    stopped: "Reply stopped.", empty: "No reply was received.", complete: "Reply complete."
  } : {
    title: "AI 问答", answer: "AI 回答", clear: "关闭回答", stop: "停止回答",
    source: "来源", portfolio: "作品集", resume: "简历",
    followUpLabel: "你还可以问",
    followUpQuestions: [
      "哪个项目最能代表你的工作？",
      "你最常用哪些技能？",
      "你在项目里通常负责什么？",
      "可以分享一次解决项目难题的经历吗？",
    ],
    prompt: "询问项目或经历", send: "发送",
    offline: "AI 问答服务尚未接入。",
    config: "AI 问答配置未完成。",
    verify: "请完成访客验证。",
    waiting: "正在等待回答…", error: "回答未完成，请重新发送。",
    stopped: "已停止回答。", empty: "没有收到可显示的回答。", complete: "回答已完成。"
  };

  function resolveEndpoint(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value, document.baseURI);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (url.username || url.password || url.search || url.hash) return null;
      return url.protocol === "https:" || (local && url.protocol === "http:") ? url : null;
    } catch {
      return null;
    }
  }

  const config = window.PORTFOLIO_CHAT ?? {};
  const endpoint = resolveEndpoint(config.endpoint);
  const accessEndpoint = resolveEndpoint(config.accessEndpoint);
  const siteKey = typeof config.turnstileSiteKey === "string" ? config.turnstileSiteKey.trim() : "";
  const configuredVerification = Boolean(config.accessEndpoint || siteKey);
  const ready = endpoint && (!configuredVerification || (siteKey && accessEndpoint?.origin === endpoint.origin));

  footer.setAttribute("aria-label", copy.title);
  region.setAttribute("aria-label", copy.answer);
  clear.setAttribute("aria-label", copy.clear);
  stop.setAttribute("aria-label", copy.stop);
  send.setAttribute("aria-label", copy.send);
  select("chat-input-label").textContent = copy.prompt;
  input.placeholder = copy.prompt;
  status.textContent = ready ? "" : (config.endpoint || configuredVerification ? copy.config : copy.offline);
  input.disabled = !ready;
  footer.hidden = false;
  if (!ready) return;

  const normalizeQuestion = text => text.trim().replace(/\s*[?？.!。！]+$/u, "").toLowerCase();
  const customQuestions = window.RESUME?.followUpQuestions;
  const choices = Array.isArray(customQuestions) ? customQuestions : copy.followUpQuestions;
  const questions = new Map();
  for (const question of choices) {
    if (typeof question !== "string") continue;
    const text = question.trim();
    const key = normalizeQuestion(text);
    if (key && text.length <= input.maxLength && !questions.has(key)) questions.set(key, text);
  }

  let sessionId;
  let visitor;
  let active;

  function clearAnswer() {
    region.hidden = true;
    delete document.body.dataset.answerActive;
    draft.hidden = false;
    draft.textContent = "";
    markdown.hidden = true;
    markdown.replaceChildren();
    if (followUps) {
      followUps.hidden = true;
      followUps.replaceChildren();
    }
    clear.hidden = true;
  }

  function showFollowUps(message) {
    if (!followUps || !questions.size) return;
    const entries = [...questions.entries()];
    const asked = entries.findIndex(([key]) => key === normalizeQuestion(message));
    const suggestions = [...entries.slice(asked + 1), ...entries.slice(0, Math.max(0, asked))].slice(0, 3);
    if (!suggestions.length) return;

    const label = document.createElement("p");
    label.className = "chat-follow-ups-label";
    label.id = "chat-follow-ups-label";
    label.textContent = copy.followUpLabel;
    const buttons = suggestions.map(([, question]) => {
      const button = document.createElement("button");
      button.className = "chat-follow-up";
      button.type = "button";
      button.textContent = question;
      button.addEventListener("click", () => ask(question));
      return button;
    });
    followUps.replaceChildren(label, ...buttons);
    followUps.hidden = false;
  }

  function showAnswer(text, final, message) {
    if (!text.trim()) return;
    const follow = region.hidden || output.scrollHeight - output.scrollTop - output.clientHeight < 36;
    region.hidden = false;
    document.body.dataset.answerActive = "";
    draft.textContent = text;
    if (final && window.renderPortfolioAnswer) {
      try {
        markdown.replaceChildren(window.renderPortfolioAnswer(text, copy, final.retrieval?.sources));
        if (markdown.textContent.trim()) {
          markdown.hidden = false;
          draft.hidden = true;
        }
      } catch { /* Keep the plain-text reply. */ }
    }
    if (final) showFollowUps(message);
    if (follow) output.scrollTop = output.scrollHeight;
  }

  function post(url, body, signal, accept) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": accept },
      body: JSON.stringify(body),
      credentials: "omit",
      redirect: "error",
      signal
    });
  }

  async function visitorToken(signal) {
    if (!configuredVerification) return undefined;
    if (visitor && visitor.expiresAt > Date.now() + 5000) return visitor.token;
    status.textContent = copy.verify;
    const challengeToken = await window.getPortfolioChallengeToken(challenge, siteKey, english ? "en" : "zh-CN", signal);
    const response = await post(accessEndpoint, { challengeToken, accessToken: visitor?.token, sessionId }, signal, "application/json");
    if (!response.ok) throw new Error("Visitor verification rejected");
    const grant = await response.json();
    if (!grant.accessToken || typeof grant.accessToken !== "string" || !Number.isFinite(grant.expiresIn) || grant.expiresIn <= 0) {
      throw new Error("Invalid visitor pass");
    }
    if (!grant.continued) sessionId = undefined;
    visitor = { token: grant.accessToken, expiresAt: Date.now() + grant.expiresIn * 1000 };
    return visitor.token;
  }

  async function readEvents(response, onDelta) {
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (!response.ok || !response.body || mediaType !== "text/event-stream") throw new Error("Invalid chat response");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        if (done && buffer.trim()) frames.push(buffer);
        for (const frame of frames) {
          const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:"))
            .map(line => line.slice(5).replace(/^ /, "")).join("\n");
          if (!data) continue;
          const event = JSON.parse(data);
          if (event.type === "error") throw new Error("Chat failed");
          if (event.type === "delta" && typeof event.text === "string") onDelta(event.text);
          if (event.type === "done") return event;
        }
        if (done) throw new Error("Chat ended without a final reply");
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  input.addEventListener("input", () => { send.disabled = !input.value.trim(); });
  stop.addEventListener("click", () => active?.abort());
  clear.addEventListener("click", () => {
    clearAnswer();
    status.textContent = "";
    input.focus();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !clear.hidden && !document.querySelector("dialog[open]")) clear.click();
  });

  async function ask(message) {
    if (active) return;
    clearAnswer();
    announcement.textContent = "";
    input.disabled = send.disabled = send.hidden = true;
    stop.hidden = false;
    const controller = new AbortController();
    active = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
    let text = "";

    try {
      const accessToken = await visitorToken(signal);
      status.textContent = copy.waiting;
      const response = await post(endpoint, { message, sessionId, accessToken }, signal, "text/event-stream");
      if (response.status === 401 && configuredVerification) visitor = undefined;
      if (response.status === 404 || response.status === 401) sessionId = undefined;
      const final = await readEvents(response, delta => {
        text += delta;
        status.textContent = "";
        showAnswer(text);
      });
      signal.throwIfAborted();
      if (typeof final.sessionId === "string") sessionId = final.sessionId;
      if (typeof final.text === "string" && final.text.trim()) text = final.text;
      showAnswer(text, final, message);
      status.textContent = text.trim() ? "" : copy.empty;
      if (text.trim()) announcement.textContent = copy.complete;
    } catch {
      status.textContent = controller.signal.aborted ? copy.stopped : copy.error;
      if (!controller.signal.aborted && !input.value) input.value = message;
    } finally {
      const restoreFocus = [document.body, stop, input].includes(document.activeElement);
      active = undefined;
      input.disabled = send.hidden = false;
      stop.hidden = true;
      clear.hidden = region.hidden;
      send.disabled = !input.value.trim();
      if (restoreFocus) input.focus({ preventScroll: true });
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    const message = input.value.trim();
    if (active || !message) return;
    input.value = "";
    ask(message);
  });
})();

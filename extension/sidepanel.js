const DEFAULT_BRIDGE_URL = "http://127.0.0.1:18765";
const DEFAULT_INSTALL_COMMAND = "curl -fsSL https://raw.githubusercontent.com/gavinljg/Hermes-Copilot/main/install.sh | bash";
const SESSION_STORE_KEY = "edgeHermesSessions";
const MAX_SESSIONS = 20;
const MAX_MESSAGES_PER_SESSION = 40;

const els = {
  messages: document.querySelector("#messages"),
  pageMeta: document.querySelector("#pageMeta"),
  question: document.querySelector("#question"),
  askForm: document.querySelector("#askForm"),
  summarize: document.querySelector("#summarize"),
  send: document.querySelector("#send"),
  newSession: document.querySelector("#newSession"),
  bridgeOnboarding: document.querySelector("#bridgeOnboarding"),
  installCommand: document.querySelector("#installCommand"),
  copyInstallCommand: document.querySelector("#copyInstallCommand"),
  checkBridge: document.querySelector("#checkBridge"),
  sessionSelect: document.querySelector("#sessionSelect"),
  restoreSession: document.querySelector("#restoreSession"),
  deleteSession: document.querySelector("#deleteSession"),
  modelSelect: document.querySelector("#modelSelect"),
  bridgeUrl: document.querySelector("#bridgeUrl"),
  bridgeToken: document.querySelector("#bridgeToken")
};

let pageContext = null;
let busy = false;
let conversationHistory = [];
let currentSessionId = createSessionId();
let savedSessions = [];

init();

async function init() {
  const saved = await chrome.storage.sync.get({
    bridgeUrl: DEFAULT_BRIDGE_URL,
    bridgeToken: "",
    modelSelect: "deepseek|deepseek-v4-flash"
  });
  els.bridgeUrl.value = saved.bridgeUrl;
  els.bridgeToken.value = saved.bridgeToken;
  els.modelSelect.value = saved.modelSelect;
  els.installCommand.textContent = DEFAULT_INSTALL_COMMAND;

  els.bridgeUrl.addEventListener("change", saveSettings);
  els.bridgeToken.addEventListener("change", saveSettings);
  els.modelSelect.addEventListener("change", saveSettings);
  els.newSession.addEventListener("click", newSession);
  els.copyInstallCommand.addEventListener("click", copyInstallCommand);
  els.checkBridge.addEventListener("click", checkBridge);
  els.restoreSession.addEventListener("click", restoreSelectedSession);
  els.deleteSession.addEventListener("click", deleteSelectedSession);
  els.summarize.addEventListener("click", () => ask("请总结当前页面，并列出我最可能需要关注的点。"));
  els.askForm.addEventListener("submit", (event) => {
    event.preventDefault();
    ask(els.question.value.trim());
  });

  await refreshPageContext();
  await loadSessions();
  renderSessionOptions();
  await checkBridge();
}

async function saveSettings() {
  await chrome.storage.sync.set({
    bridgeUrl: normalizeBridgeUrl(els.bridgeUrl.value),
    bridgeToken: els.bridgeToken.value,
    modelSelect: els.modelSelect.value
  });
}

function normalizeBridgeUrl(value) {
  return (value || DEFAULT_BRIDGE_URL).replace(/\/+$/, "");
}

async function checkBridge() {
  const ok = await bridgeHealthCheck();
  els.bridgeOnboarding.hidden = ok;
  return ok;
}

async function bridgeHealthCheck() {
  try {
    const bridgeUrl = normalizeBridgeUrl(els.bridgeUrl.value);
    const headers = {};
    if (els.bridgeToken.value) headers["x-hermes-bridge-token"] = els.bridgeToken.value;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${bridgeUrl}/health`, { headers, signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json().catch(() => ({}));
    return Boolean(res.ok && data.ok);
  } catch (_error) {
    return false;
  }
}

async function copyInstallCommand() {
  await navigator.clipboard.writeText(DEFAULT_INSTALL_COMMAND);
  const oldText = els.copyInstallCommand.textContent;
  els.copyInstallCommand.textContent = "已复制";
  setTimeout(() => {
    els.copyInstallCommand.textContent = oldText;
  }, 1400);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refreshPageContext() {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("没有找到当前标签页");

    if (!/^https?:|^file:/.test(tab.url || "")) {
      pageContext = {
        title: tab.title || "",
        url: tab.url || "",
        visibleText: "",
        selectedText: "",
        headings: [],
        forms: [],
        resources: []
      };
      els.pageMeta.textContent = tab.title || tab.url || "浏览器内部页面";
      addMessage("system", "当前页面可能是浏览器内部页，扩展无法读取正文，只能使用标题和 URL。");
      return;
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_PAGE_CONTEXT" });
    } catch (_error) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      response = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_PAGE_CONTEXT" });
    }

    if (!response?.ok) throw new Error(response?.error || "读取页面失败");
    pageContext = response.page;
    els.pageMeta.textContent = `${pageContext.title || "Untitled"} · ${new URL(pageContext.url).hostname}`;
  } catch (error) {
    addMessage("system", `页面上下文读取失败：${error.message || error}`);
  }
}

async function ask(question) {
  if (busy) return;
  const finalQuestion = question || "请总结当前页面。";
  els.question.value = "";
  setBusy(true);
  addMessage("user", finalQuestion);
  const assistantMessage = addMessage("assistant", "");

  try {
    if (!pageContext) await refreshPageContext();
    await checkBridge();
    const bridgeUrl = normalizeBridgeUrl(els.bridgeUrl.value);
    const headers = { "content-type": "application/json" };
    if (els.bridgeToken.value) headers["x-hermes-bridge-token"] = els.bridgeToken.value;
    const { provider, model } = getSelectedModel();

    const res = await fetch(`${bridgeUrl}/chat-stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        question: finalQuestion,
        page: pageContext,
        provider,
        model,
        history: conversationHistory.slice(-8)
      })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Bridge HTTP ${res.status}`);
    }
    const answer = await readAnswerStream(res, assistantMessage);
    conversationHistory.push({ role: "user", content: finalQuestion });
    conversationHistory.push({ role: "assistant", content: answer });
    await persistCurrentSession();
  } catch (error) {
    assistantMessage.remove();
    await checkBridge();
    addMessage("system", `请求失败：${error.message || error}`);
  } finally {
    setBusy(false);
  }
}

function getSelectedModel() {
  const [provider, model] = String(els.modelSelect.value || "|").split("|");
  return {
    provider: provider || "",
    model: model || ""
  };
}

async function newSession() {
  if (busy) return;
  await persistCurrentSession();
  currentSessionId = createSessionId();
  conversationHistory = [];
  els.messages.innerHTML = "";
  await refreshPageContext();
  renderSessionOptions();
}

function createSessionId() {
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function loadSessions() {
  const stored = await chrome.storage.local.get({ [SESSION_STORE_KEY]: [] });
  savedSessions = Array.isArray(stored[SESSION_STORE_KEY]) ? stored[SESSION_STORE_KEY] : [];
}

async function saveSessions() {
  savedSessions = savedSessions
    .filter((session) => Array.isArray(session.messages) && session.messages.length)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_SESSIONS);
  await chrome.storage.local.set({ [SESSION_STORE_KEY]: savedSessions });
  renderSessionOptions();
}

async function persistCurrentSession() {
  if (!conversationHistory.length) return;
  const now = Date.now();
  const existingIndex = savedSessions.findIndex((session) => session.id === currentSessionId);
  const session = {
    id: currentSessionId,
    title: buildSessionTitle(),
    pageTitle: pageContext?.title || "",
    pageUrl: pageContext?.url || "",
    page: pageContext ? {
      title: pageContext.title || "",
      url: pageContext.url || "",
      selectedText: pageContext.selectedText || "",
      visibleText: String(pageContext.visibleText || "").slice(0, 60000),
      headings: Array.isArray(pageContext.headings) ? pageContext.headings.slice(0, 80) : [],
      forms: Array.isArray(pageContext.forms) ? pageContext.forms.slice(0, 30) : [],
      resources: Array.isArray(pageContext.resources) ? pageContext.resources.slice(0, 80) : []
    } : null,
    updatedAt: now,
    messages: conversationHistory.slice(-MAX_MESSAGES_PER_SESSION)
  };
  if (existingIndex >= 0) {
    savedSessions[existingIndex] = session;
  } else {
    savedSessions.unshift(session);
  }
  await saveSessions();
}

function buildSessionTitle() {
  const firstUser = conversationHistory.find((message) => message.role === "user")?.content || "新会话";
  return firstUser.replace(/\s+/g, " ").trim().slice(0, 42);
}

function renderSessionOptions() {
  if (!els.sessionSelect) return;
  els.sessionSelect.innerHTML = "";
  if (!savedSessions.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无历史会话";
    els.sessionSelect.appendChild(option);
    els.restoreSession.disabled = true;
    els.deleteSession.disabled = true;
    return;
  }

  for (const session of savedSessions) {
    const option = document.createElement("option");
    option.value = session.id;
    option.textContent = `${formatTime(session.updatedAt)} · ${session.title || session.pageTitle || "未命名会话"}`;
    els.sessionSelect.appendChild(option);
  }
  els.restoreSession.disabled = busy;
  els.deleteSession.disabled = busy;
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

async function restoreSelectedSession() {
  if (busy || !els.sessionSelect.value) return;
  await persistCurrentSession();
  const session = savedSessions.find((item) => item.id === els.sessionSelect.value);
  if (!session) return;
  currentSessionId = session.id;
  conversationHistory = Array.isArray(session.messages) ? [...session.messages] : [];
  pageContext = session.page || {
    title: session.pageTitle || "",
    url: session.pageUrl || "",
    visibleText: "",
    selectedText: "",
    headings: [],
    forms: [],
    resources: []
  };
  els.messages.innerHTML = "";
  for (const message of conversationHistory) {
    addMessage(message.role === "assistant" ? "assistant" : "user", message.content || "");
  }
  els.messages.scrollTop = els.messages.scrollHeight;
  if (session.pageTitle || session.pageUrl) {
    els.pageMeta.textContent = `${session.pageTitle || "已恢复会话"}${session.pageUrl ? ` · ${safeHostname(session.pageUrl)}` : ""}`;
  }
}

async function deleteSelectedSession() {
  if (busy || !els.sessionSelect.value) return;
  const id = els.sessionSelect.value;
  savedSessions = savedSessions.filter((session) => session.id !== id);
  if (currentSessionId === id) {
    currentSessionId = createSessionId();
    conversationHistory = [];
    els.messages.innerHTML = "";
    await refreshPageContext();
  }
  await saveSessions();
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (_error) {
    return url;
  }
}

function addMessage(role, text) {
  const item = document.createElement("div");
  item.className = `message ${role}`;
  if (role === "assistant") {
    updateAssistantMessage(item, text);
  } else {
    item.textContent = text;
  }
  els.messages.appendChild(item);
  els.messages.scrollTop = els.messages.scrollHeight;
  return item;
}

function updateAssistantMessage(item, text) {
  item.dataset.raw = text || "";
  item.innerHTML = text ? renderAssistantMarkdown(text) : '<div class="answerBubble"><p class="streamingHint">正在等待 Hermes...</p></div>';
  els.messages.scrollTop = els.messages.scrollHeight;
}

async function readAnswerStream(res, item) {
  if (!res.body) {
    throw new Error("当前浏览器不支持流式响应");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "delta") {
        answer += event.text || "";
        updateAssistantMessage(item, answer);
      } else if (event.type === "error") {
        throw new Error(event.error || "Bridge stream error");
      } else if (event.type === "done") {
        if (!answer.trim()) updateAssistantMessage(item, "(空响应)");
        return answer;
      }
    }
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer);
    if (event.type === "delta") {
      answer += event.text || "";
      updateAssistantMessage(item, answer);
    }
  }
  if (!answer.trim()) updateAssistantMessage(item, "(空响应)");
  return answer;
}

function setBusy(value) {
  busy = value;
  els.send.disabled = value;
  els.summarize.disabled = value;
  els.newSession.disabled = value;
  renderSessionOptions();
  els.modelSelect.disabled = value;
  els.checkBridge.disabled = value;
  els.send.textContent = value ? "处理中" : "发送";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(markdown) {
  return escapeHtml(markdown)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseTable(lines, start) {
  if (start + 1 >= lines.length || !lines[start].includes("|") || !isTableSeparator(lines[start + 1])) {
    return null;
  }
  const rows = [];
  let index = start;
  while (index < lines.length && lines[index].includes("|")) {
    if (!isTableSeparator(lines[index])) {
      rows.push(lines[index]);
    }
    index += 1;
  }
  const htmlRows = rows.map((row, rowIndex) => {
    const cells = row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|");
    const tag = rowIndex === 0 ? "th" : "td";
    return `<tr>${cells.map((cell) => `<${tag}>${renderInline(cell.trim())}</${tag}>`).join("")}</tr>`;
  });
  return {
    html: `<div class="tableWrap"><table>${htmlRows.join("")}</table></div>`,
    next: index
  };
}

function renderMarkdown(markdown) {
  const normalized = normalizeVisibleThinking(String(markdown || "").replace(/\r\n/g, "\n"));
  const lines = normalized.split("\n");
  const out = [];
  let paragraph = [];
  let list = null;
  let code = null;
  let thinking = null;

  function flushParagraph() {
    if (!paragraph.length) return;
    out.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!list) return;
    out.push(`<${list.type}>${list.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${list.type}>`);
    list = null;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (thinking) {
      if (/<\/think>/i.test(line)) {
        const beforeClose = line.replace(/<\/think>.*/i, "");
        if (beforeClose.trim()) thinking.lines.push(beforeClose);
        out.push(renderThinkingBlock(thinking.lines.join("\n")));
        thinking = null;
        const afterClose = line.replace(/^.*<\/think>/i, "").trim();
        if (afterClose) paragraph.push(afterClose);
      } else {
        thinking.lines.push(line);
      }
      continue;
    }

    if (code) {
      if (/^```/.test(line)) {
        out.push(`<pre><code>${escapeHtml(code.lines.join("\n"))}</code></pre>`);
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }

    if (/<think>/i.test(line)) {
      flushParagraph();
      flushList();
      thinking = { lines: [] };
      const afterOpen = line.replace(/^.*<think>/i, "");
      if (/<\/think>/i.test(afterOpen)) {
        thinking.lines.push(afterOpen.replace(/<\/think>.*/i, ""));
        out.push(renderThinkingBlock(thinking.lines.join("\n")));
        thinking = null;
      } else if (afterOpen.trim()) {
        thinking.lines.push(afterOpen);
      }
      continue;
    }

    if (/^```/.test(line)) {
      flushParagraph();
      flushList();
      code = { lines: [] };
      continue;
    }

    const table = parseTable(lines, i);
    if (table) {
      flushParagraph();
      flushList();
      out.push(table.html);
      i = table.next - 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 1, 5);
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const type = ordered ? "ol" : "ul";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((unordered || ordered)[1]);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    paragraph.push(line.trim());
  }

  if (code) out.push(`<pre><code>${escapeHtml(code.lines.join("\n"))}</code></pre>`);
  if (thinking) out.push(renderThinkingBlock(thinking.lines.join("\n")));
  flushParagraph();
  flushList();
  return out.join("");
}

function renderAssistantMarkdown(markdown) {
  const normalized = normalizeVisibleThinking(String(markdown || "").replace(/\r\n/g, "\n"));
  const extracted = extractThinkBlocks(normalized);
  const parts = [];
  if (extracted.thinking.length) {
    parts.push(`<div class="thinkingBubble"><div class="bubbleLabel">分析思路</div>${renderMarkdown(extracted.thinking.join("\n\n"))}</div>`);
  }
  const answerHtml = renderMarkdown(extracted.answer.trim() || normalized);
  parts.push(`<div class="answerBubble">${answerHtml}</div>`);
  return parts.join("");
}

function extractThinkBlocks(markdown) {
  const thinking = [];
  const answer = String(markdown || "").replace(/<think>([\s\S]*?)<\/think>/gi, (_match, content) => {
    if (String(content || "").trim()) thinking.push(String(content).trim());
    return "\n";
  });
  return { thinking, answer };
}

function normalizeVisibleThinking(markdown) {
  if (/<think>/i.test(markdown)) return markdown;
  const match = /(^|\n)\s*(分析思路|思考过程|思路摘要)\s*[:：]\s*/.exec(markdown);
  if (!match) return markdown;

  const start = (match.index || 0) + match[1].length;
  const labelEnd = start + match[0].slice(match[1].length).length;
  const before = markdown.slice(0, start);
  const rest = markdown.slice(labelEnd);
  const answerMatch = /\n\s*(正式答案|答案|结论)\s*[:：]\s*/.exec(rest);

  if (!answerMatch) {
    return `${before}<think>${rest.trim()}</think>`;
  }

  const thinking = rest.slice(0, answerMatch.index).trim();
  const answerStart = answerMatch.index + answerMatch[0].length;
  const answer = rest.slice(answerStart).trimStart();
  return `${before}<think>${thinking}</think>\n\n${answer}`;
}

function renderThinkingBlock(text) {
  const content = String(text || "").trim();
  if (!content) return "";
  return `<div class="inlineThinking">${renderMarkdown(content)}</div>`;
}

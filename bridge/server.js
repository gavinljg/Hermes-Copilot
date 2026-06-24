#!/usr/bin/env node

const http = require("node:http");
const { spawn } = require("node:child_process");

const HOST = process.env.HERMES_BRIDGE_HOST || "127.0.0.1";
const PORT = Number(process.env.HERMES_BRIDGE_PORT || 18765);
const HERMES_BIN = process.env.HERMES_BIN || "hermes";
const TOKEN = process.env.HERMES_BRIDGE_TOKEN || "";
const TIMEOUT_MS = Number(process.env.HERMES_BRIDGE_TIMEOUT_MS || 180000);
const MAX_BODY_BYTES = Number(process.env.HERMES_BRIDGE_MAX_BODY_BYTES || 900000);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-hermes-bridge-token",
    "cache-control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function checkToken(req) {
  if (!TOKEN) return true;
  return req.headers["x-hermes-bridge-token"] === TOKEN;
}

function truncate(text, max) {
  const value = String(text || "");
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n[truncated ${value.length - max} chars]`;
}

function buildPrompt(payload) {
  const language = payload.language === "zh" ? "zh" : "en";
  const question = truncate(payload.question || (language === "zh" ? "请总结当前页面。" : "Summarize the current page."), 6000);
  const page = payload.page || {};
  const resources = Array.isArray(page.resources) ? page.resources.slice(0, 80) : [];
  const forms = Array.isArray(page.forms) ? page.forms.slice(0, 30) : [];
  const history = Array.isArray(payload.history) ? payload.history.slice(-8) : [];
  const context = {
    title: truncate(page.title, 1000),
    url: truncate(page.url, 2000),
    selectedText: truncate(page.selectedText, 8000),
    visibleText: truncate(page.visibleText, 60000),
    headings: Array.isArray(page.headings) ? page.headings.slice(0, 80) : [],
    forms,
    resources
  };

  return [
    language === "zh"
      ? "你是一个运行在用户本机浏览器侧边栏里的网页助手。"
      : "You are a browser side-panel assistant running on the user's own machine.",
    language === "zh"
      ? "请基于用户提供的当前页面上下文回答问题。优先使用页面上下文；如果上下文不足，请明确说明缺什么。"
      : "Answer using the current page context provided by the user. Prefer page context; if it is insufficient, clearly say what is missing.",
    language === "zh"
      ? "如果用户问接口/网络调试，只能使用 resources 里可见的 Resource Timing URL/类型/耗时等信息；不要假装看到了 response body、request body 或完整 headers。"
      : "For API or network debugging questions, only use visible Resource Timing data in resources such as URL, type, and duration. Do not pretend to see response bodies, request bodies, or full headers.",
    language === "zh"
      ? "回复格式要求：每次回答开头必须先输出一个简短的“分析思路：”段落。这里不是隐藏推理，只写 2-4 条面向用户的简洁判断依据。然后空一行，再输出“正式答案：”和正式内容。"
      : "Response format: start every answer with a short “Analysis:” section. This is not hidden chain-of-thought; write only 2-4 concise user-facing reasons or evidence points. Then add a blank line and output “Final answer:” followed by the answer.",
    language === "zh"
      ? "回答默认使用中文，除非用户明确要求其他语言。保持直接、可操作。"
      : "Default to English unless the user explicitly asks for another language. Keep the answer direct and actionable.",
    "",
    history.length ? `${language === "zh" ? "当前会话最近消息" : "Recent messages in this chat"}:\n${JSON.stringify(history.map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: truncate(item.content, 6000)
    })), null, 2)}` : `${language === "zh" ? "当前会话最近消息" : "Recent messages in this chat"}: []`,
    "",
    `${language === "zh" ? "用户问题" : "User question"}:\n${question}`,
    "",
    `${language === "zh" ? "页面上下文 JSON" : "Page context JSON"}:\n${JSON.stringify(context, null, 2)}`
  ].join("\n");
}

function buildHermesArgs(prompt, payload = {}) {
  const args = ["-z", prompt];
  if (payload.model) args.push("-m", String(payload.model));
  if (payload.provider) args.push("--provider", String(payload.provider));
  return args;
}

function runHermes(prompt, payload) {
  return new Promise((resolve, reject) => {
    const args = buildHermesArgs(prompt, payload);
    const child = spawn(HERMES_BIN, args, {
      cwd: process.env.HERMES_BRIDGE_CWD || process.env.HOME || "/tmp",
      env: {
        ...process.env,
        HERMES_ACCEPT_HOOKS: process.env.HERMES_ACCEPT_HOOKS || "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
      reject(Object.assign(new Error(`Hermes timed out after ${TIMEOUT_MS} ms`), { status: 504 }));
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(Object.assign(new Error(stderr.trim() || `Hermes exited with code ${code}`), { status: 502 }));
    });
  });
}

function sendStreamEvent(res, event) {
  res.write(`${JSON.stringify(event)}\n`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTextAsDeltas(res, text) {
  const value = String(text || "");
  const chunkSize = Number(process.env.HERMES_BRIDGE_UI_CHUNK_SIZE || 36);
  const delayMs = Number(process.env.HERMES_BRIDGE_UI_CHUNK_DELAY_MS || 18);
  for (let i = 0; i < value.length; i += chunkSize) {
    sendStreamEvent(res, { type: "delta", text: value.slice(i, i + chunkSize) });
    if (delayMs > 0) await delay(delayMs);
  }
}

function runHermesStream(prompt, payload, res) {
  return new Promise((resolve) => {
    const args = buildHermesArgs(prompt, payload);
    const child = spawn(HERMES_BIN, args, {
      cwd: process.env.HERMES_BRIDGE_CWD || process.env.HOME || "/tmp",
      env: {
        ...process.env,
        HERMES_ACCEPT_HOOKS: process.env.HERMES_ACCEPT_HOOKS || "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    let sawStdout = false;
    let outputChain = Promise.resolve();
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
      sendStreamEvent(res, { type: "error", error: `Hermes timed out after ${TIMEOUT_MS} ms` });
      resolve();
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (text) {
        sawStdout = true;
        outputChain = outputChain.then(() => sendTextAsDeltas(res, text));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      sendStreamEvent(res, { type: "error", error: error.message || String(error) });
      resolve();
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      await outputChain;
      if (code !== 0) {
        sendStreamEvent(res, { type: "error", error: stderr.trim() || `Hermes exited with code ${code}` });
      } else if (!sawStdout) {
        sendStreamEvent(res, { type: "delta", text: "" });
      }
      sendStreamEvent(res, { type: "done" });
      resolve();
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname === "/health" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        hermesBin: HERMES_BIN,
        tokenRequired: Boolean(TOKEN)
      });
      return;
    }

    if (url.pathname !== "/chat" && url.pathname !== "/chat-stream") {
      sendJson(res, 404, { ok: false, error: "Not found" });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    if (!checkToken(req)) {
      sendJson(res, 401, { ok: false, error: "Invalid bridge token" });
      return;
    }

    const raw = await readBody(req);
    const payload = raw ? JSON.parse(raw) : {};
    const prompt = buildPrompt(payload);
    if (url.pathname === "/chat-stream") {
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,x-hermes-bridge-token",
        "cache-control": "no-store",
        "x-accel-buffering": "no"
      });
      await runHermesStream(prompt, payload, res);
      res.end();
      return;
    }
    const answer = await runHermes(prompt, payload);
    sendJson(res, 200, { ok: true, answer });
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || String(error)
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Hermes Copilot bridge listening on http://${HOST}:${PORT}`);
});

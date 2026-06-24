function isVisible(element) {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function textOf(selector, limit = 80) {
  return Array.from(document.querySelectorAll(selector))
    .filter(isVisible)
    .map((el) => el.innerText || el.textContent || "")
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function collectForms() {
  return Array.from(document.querySelectorAll("form"))
    .slice(0, 30)
    .map((form, index) => {
      const fields = Array.from(form.querySelectorAll("input, textarea, select, button"))
        .slice(0, 80)
        .map((field) => ({
          tag: field.tagName.toLowerCase(),
          type: field.getAttribute("type") || "",
          name: field.getAttribute("name") || "",
          id: field.id || "",
          label: findLabel(field),
          placeholder: field.getAttribute("placeholder") || "",
          text: field.tagName.toLowerCase() === "button" ? compact(field.innerText || field.value || "") : ""
        }));
      return {
        index,
        id: form.id || "",
        name: form.getAttribute("name") || "",
        action: form.getAttribute("action") || "",
        method: form.getAttribute("method") || "get",
        fields
      };
    });
}

function findLabel(field) {
  if (field.id) {
    const label = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
    if (label) return compact(label.innerText || label.textContent || "");
  }
  const wrapping = field.closest("label");
  if (wrapping) return compact(wrapping.innerText || wrapping.textContent || "");
  return "";
}

function collectResources() {
  const entries = performance.getEntriesByType("resource");
  return entries
    .slice(-120)
    .map((entry) => ({
      name: entry.name,
      type: entry.initiatorType || "",
      durationMs: Math.round(entry.duration),
      transferSize: entry.transferSize || 0,
      decodedBodySize: entry.decodedBodySize || 0
    }));
}

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function collectPageContext() {
  const visibleText = compact(document.body ? document.body.innerText : "");
  const selectedText = String(window.getSelection?.() || "").trim();
  return {
    title: document.title || "",
    url: location.href,
    selectedText,
    visibleText: visibleText.slice(0, 90000),
    headings: textOf("h1,h2,h3", 120),
    forms: collectForms(),
    resources: collectResources(),
    capturedAt: new Date().toISOString()
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "COLLECT_PAGE_CONTEXT") return false;
  try {
    sendResponse({ ok: true, page: collectPageContext() });
  } catch (error) {
    sendResponse({ ok: false, error: error.message || String(error) });
  }
  return true;
});

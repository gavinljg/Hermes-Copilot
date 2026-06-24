let currentLanguage = "en";

const labels = {
  en: { copied: "Install command copied.", buttonCopied: "Copied", buttonIdle: "Copy" },
  zh: { copied: "已复制安装命令。", buttonCopied: "已复制", buttonIdle: "复制" }
};

document.querySelectorAll(".languageChoice").forEach((button) => {
  button.addEventListener("click", () => setLanguage(button.dataset.language));
});

document.querySelectorAll(".copyInstall").forEach((button) => {
  button.addEventListener("click", async () => {
    const section = button.closest("section");
    const command = section.querySelector(".installCommand").textContent;
    const status = section.querySelector(".copyStatus");
    await navigator.clipboard.writeText(command);
    status.textContent = labels[currentLanguage].copied;
    button.textContent = labels[currentLanguage].buttonCopied;
    setTimeout(() => {
      status.textContent = "";
      button.textContent = labels[currentLanguage].buttonIdle;
    }, 1600);
  });
});

function setLanguage(language) {
  if (!labels[language]) return;
  currentLanguage = language;
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.querySelectorAll(".languageChoice").forEach((button) => {
    const active = button.dataset.language === language;
    button.classList.toggle("isActive", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-language-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.languagePanel !== language;
  });
}

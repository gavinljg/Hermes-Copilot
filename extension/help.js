const command = document.querySelector("#installCommand").textContent;
const button = document.querySelector("#copyInstall");
const status = document.querySelector("#copyStatus");

button.addEventListener("click", async () => {
  await navigator.clipboard.writeText(command);
  status.textContent = "已复制安装命令。";
  button.textContent = "已复制";
  setTimeout(() => {
    status.textContent = "";
    button.textContent = "复制";
  }, 1600);
});

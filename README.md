# Hermes Copilot

Hermes Copilot is a browser side-panel extension that reads the current page context and sends it to a local Hermes Bridge. The bridge calls the user's own Hermes setup, so model/provider configuration stays local.

## What It Does

- Reads the current tab title, URL, selected text, visible page text, headings, forms, and recent resource timing entries.
- Sends that context to a local bridge at `127.0.0.1:18765`.
- The bridge invokes `hermes -z` with the selected provider/model.
- Supports Markdown rendering, visible analysis-summary bubbles, streaming-style incremental display, local session history, and model selection.

## Install

Install the local bridge:

```bash
curl -fsSL https://raw.githubusercontent.com/gavinljg/Hermes-Copilot/main/install.sh | bash
```

Then load the extension:

1. Open `edge://extensions/`
2. Enable Developer mode
3. Click Load unpacked
4. Select `~/.local/share/hermes-copilot/extension`

The extension also shows this installer prompt when the local bridge is not detected.

## Requirements

- macOS
- Microsoft Edge
- Node.js
- Git
- A working `hermes` command with model/provider configured

## Local Development

```bash
git clone https://github.com/gavinljg/Hermes-Copilot.git
cd Hermes-Copilot
./install-launch-agent.sh
```

Health check:

```bash
curl http://127.0.0.1:18765/health
```

Manual bridge run:

```bash
npm start
```

## Directory Layout

- `extension/`: Edge MV3 extension.
- `bridge/`: local Node bridge that calls Hermes.
- `docs/`: installation guide page.
- `install.sh`: public installer script.
- `install-launch-agent.sh`: installs the bridge LaunchAgent from a checked-out copy.

## Privacy

Hermes Copilot does not provide a hosted cloud service. Page context is sent to the local bridge on `127.0.0.1`, and the local bridge calls the user's Hermes configuration. The model provider used by Hermes may receive page context depending on the user's Hermes setup.

## Limitations

- The extension cannot read full DevTools Network request/response bodies.
- Browser internal pages such as `edge://...` usually cannot be read.
- This version uses a local bridge. A store-ready public release may need native messaging or a packaged companion installer.

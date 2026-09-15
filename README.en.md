<p align="center"><img src="assets/icon.png" width="72" alt="Codex Sidecar"></p>

<h1 align="center">Codex Sidecar</h1>

<p align="center">Usage limits, reset news, and model checks in the Codex sidebar.</p>
<p align="center"><a href="README.md">简体中文</a> · <strong>English</strong></p>

**Keep remaining usage, reset news, and model checks in one collapsible card above your account menu.** Codex Sidecar is a community add-on for macOS. Open its launcher to start Codex with the card loaded, without keeping a terminal open or supplying another API key.

## Screenshots

![Codex sidebar placement: the card sits at the bottom of the left sidebar, directly above the account menu](assets/screenshots/sidebar-context.jpg)

The card sits **at the bottom of the Codex sidebar, directly above the account menu**. This design preview uses demo accounts, projects, usage, responses, and reset announcements. The app interface is currently in Chinese.

<details>
<summary>View card details</summary>

| At a glance | Model settings |
| :---: | :---: |
| <img src="assets/screenshots/overview.jpg" width="267" alt="Weekly and five-hour usage remaining, a Tibo reset announcement, and a model check result"> | <img src="assets/screenshots/settings.jpg" width="267" alt="Expanded card with model and reasoning effort selectors"> |

</details>

- **Track usage**: Remaining weekly and five-hour allowances, reset countdowns, and exact reset times in Beijing time.
- **Follow resets**: Tibo's extra reset announcements, confirmations, and sources from AIHOT. Viewing a notice does not trigger a reset.
- **Check models**: Select a model and reasoning effort, then run a fixed knowledge question or the experimental “Restore IQ” prompt. Each request uses a separate task that is archived on completion, with recovery controls for failures.

## Quick start

Requires **macOS, a signed-in Codex desktop app, Node.js 22+, Git, and Xcode Command Line Tools**. Run `xcode-select --install` if the command line tools are missing. No `npm install` is needed.

```sh
git clone https://github.com/Wan-Kai/codex-sidecar.git
cd codex-sidecar
npm run build:launcher
```

The build creates a local App and a desktop alias named **CodeX 注入版**. For the first launch, fully quit Codex with **⌘Q**, then double-click that alias. Use this launcher daily, or add the App to your Dock; the original Codex icon does not load Sidecar automatically.

Keep the repository in place. Rebuild after moving it or changing your Node installation path. The generated App cannot be distributed on its own. [Custom paths and troubleshooting →](docs/guide.en.md)

## Before using it

- **The check is a knowledge experiment**: A clear Gemini major version ≥ 3 passes; ≤ 2 fails; ambiguous answers remain unclassified. This is not an intelligence measurement, and the “Restore IQ” prompt has no verified recovery effect. Model requests consume your usual allowance. [Check rules →](docs/guide.en.md#model-checks)
- **Compatibility depends on Codex internals**: Sidecar loads through local CDP without modifying the Codex installation. Host build `26.908.40834` has been validated; other builds may need adaptation. This project is not affiliated with OpenAI.
- **Data follows two separate paths**: Usage comes from your current Codex session. AIHOT receives anonymous requests without account data. Keep debugging port `9222` accessible only on your machine. [Data handling →](docs/guide.en.md#data-handling)

## Update or disable

Update, then reopen the launcher:

```sh
git pull --ff-only
npm run build:launcher
```

To disable Sidecar, finish any pending task cleanup in the card, run `npm stop`, then quit Codex and reopen it with its original icon. [Uninstall, preview, and development checks →](docs/guide.en.md)

[User guide](docs/guide.en.md) · [Architecture (Chinese)](docs/architecture.md) · [Report an issue](https://github.com/Wan-Kai/codex-sidecar/issues) · [MIT License](LICENSE)

# User guide

[Back to overview](../README.en.md) · [简体中文](guide.zh-CN.md)

## Installation paths

The launcher checks `/Applications/Codex.app`, `/Applications/ChatGPT.app`, and the same names under `~/Applications`, in that order. It requires bundle ID `com.openai.codex`, so an actual ChatGPT installation is not selected based on its name alone.

For another location, set the path when building:

```sh
CODEX_APP_PATH="/absolute/path/to/Codex.app" npm run build:launcher
```

The generated launcher stores this optional path, the repository path, and the Node executable path. Rebuild after moving any of them. Distribute the source so each user can build locally; there is currently no signed, notarized installer.

Host validation covers macOS build `26.908.40834` with bundle ID `com.openai.codex`. Path discovery has automated tests, but other host builds and Windows/Linux injection remain unverified. Changes to Codex's internal message bridge, page URL, or sidebar structure can prevent mounting.

## Model checks

The UI calls this experiment “智商检测” (IQ check). It sends this exact Chinese question, with no answer example or formatting instruction:

> 不要调用任何外部工具，按你的已有知识，Gemini 的最新版本是什么？

Meaning: “Without calling any external tools, what is the latest Gemini version according to your existing knowledge?” The translation is explanatory; the app sends the Chinese original.

| Response | Result |
| --- | --- |
| Clearly confirms Gemini 3, including `3.`, `3.0`, or `3.1` | Normal |
| Clearly confirms version 2 or earlier | Abnormal |
| Clearly confirms version 4 or later | Normal, following the major-version ≥ 3 rule |
| No clear version or conflicting claims | Unclassified; inspect the original response |
| Any tool execution during the check | Invalid check |
| Network, allowance, or model error | Request failed |

This is a project-defined knowledge probe, not an intelligence measure, model identity test, or verification of Gemini's actual latest release. The parser handles natural language and Markdown conservatively; complex denials, guesses, or historical references may still require manual review.

The “恢复智商” (Restore IQ) button sends the fixed [`RECOVER_PROMPT`](../core.cjs), asking the selected model to directly produce 323 integers from 1 through 355 without tools. Validation checks count and bounds only. It establishes neither randomness nor restored ability. Completion leaves the card ready for a manual retest; it does not trigger another model request.

Available models come from the host's model list. For GPT-6, the visible reasoning labels are 轻度 / 中 / 高 / 极高 / 最高, corresponding to low / medium / high / xhigh / max, subject to the returned model's supported options. Requests use your normal Codex allowance.

## Updates and troubleshooting

From the repository directory:

```sh
git pull --ff-only
npm run build:launcher
```

Reopen the launcher. At the same repository path, the current loader is reused if its version matches; a newer version replaces it. Active card requests finish cleanup before the card is replaced.

| Situation | Action |
| --- | --- |
| Codex is already running without the debugging endpoint | Fully quit with ⌘Q and reopen through the Sidecar launcher. It never force-quits your tasks. |
| Port `9222` is occupied | Resolve the local port conflict before launching. |
| A desktop entry with the same name exists | Move the old entry aside. Builds only replace aliases or legacy symlinks that point to this checkout's App. Use `npm run build:check` to build without changing the desktop. |
| A request times out | Use “检查并收尾” to inspect and finish the original task. It does not resend the prompt. |
| Archiving fails | Use “重试归档” to retry archiving the saved result. |
| Creation times out before a task ID is returned | Inspect the Codex task list before clearing the card's pending record. |
| Usage or reset news cannot be read | Expand the relevant area and retry. Reaching a scheduled time does not prove a reset occurred. |

After an account switch, an old task may still be cleaned up, but its response is not presented as the current account's result when ownership cannot be confirmed.

## Disable and uninstall

Finish any pending task cleanup in the card, then run:

```sh
npm stop
```

Fully quit Codex and reopen it using the original icon. Stopping the loader does not cancel submitted model tasks or immediately remove an already mounted card. After stopping the loader and completing cleanup, `npm run remove` can remove the card from the current page.

To uninstall, disable Sidecar first, then delete the desktop alias and repository directory. Logs and process records remain under `~/Library/Application Support/Codex IQ Card` and can be deleted separately. Pending task records use the Codex page's local storage; clean those up through the card first. Archived tasks remain accessible in Codex.

## Data handling

- CDP binds to loopback. The loader accepts local WebSockets on the configured port and filters known Codex pages. CDP can control the page; do not forward or expose `9222` publicly. Other local processes may still access it.
- Sidecar does not read credential files, modify the Codex package, ASAR, signature, or CSP, or register a login item.
- Usage data comes through the host bridge and stays in page memory. Switching accounts clears it. Pending task IDs, options, and received responses are temporarily stored in page local storage to support cleanup.
- The loader requests the [AIHOT public reset feed](https://aihot.news/api/v1/codex-resets) every five minutes without account data, allowance details, or tokens. AIHOT receives an ordinary web request and its source IP. Public reset notices do not guarantee when an individual account receives a reset.
- Announcements, confirmations, and stale data are distinct states. No confidence percentage is shown when the source provides none. The card does not redeem reset credits or trigger account resets.
- There is no additional login service or telemetry. Local logs rotate on the next launch after exceeding 512 KB.

## Preview and development

The preview uses the production card with a mock bridge. It makes no model requests and reads no real account data. With Python 3 installed, run from the repository root:

```sh
python3 -m http.server 8742 --bind 127.0.0.1
```

Open <http://127.0.0.1:8742/preview.html> to try responses, tool calls, usage errors, archive failures, and reset states. Screenshots in the READMEs were captured in Chrome from this preview; all displayed account, usage, response, and reset data is simulated.

On macOS, build before running the native tests:

```sh
npm run build:check
npm test
npm run test:launcher
npm run status
```

These commands cover local builds, parsers, usage windows, reset states, task locking, account switches, failure recovery, loader processes, and native aliases. Tests do not start Codex or create a desktop alias. Native tests are skipped on other platforms; that does not imply desktop injection support.

See [architecture and icon generation (Chinese)](architecture.md) for implementation details. Report compatibility issues with macOS, Node, and Codex versions plus sanitized errors. Do not upload credentials or private conversations.

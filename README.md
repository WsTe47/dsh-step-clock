# dsh-step-clock

[中文](README.zh.md) | English

A live per-step elapsed-time bar for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web GUI. It answers one question the built-in turn timer does not: **how long has the step that is running right now been running?**

```
● 正在执行 bash，已运行 1 分 12 秒    第 12 步   [bash]        1:12
```

and, once that step finishes, keeps the result on screen:

```
● 上一步（第 12 步）已完成，用时 3 分 45 秒                    3:45
```

The bar sits in the composer dock — the strip just above the input box, where the todo and goal bars live — with a second seat below the composer so a tall goal bar cannot push it out of view.

## Why

The harness already shows a turn-level clock at the bottom of the conversation, but it only appears after 15 seconds and it measures the whole turn. When you are watching a long `bash` call you cannot tell whether it started two seconds ago or has been stuck for four minutes, and the turn clock cannot tell you either.

This plugin measures **the current step**, from the instant its activity actually started:

- **Tool steps** are anchored to the tool call's own start time. An in-flight call exists in the live snapshot only while it is in flight, so `0:47` means the call itself has been running 47 seconds — not an estimate derived from the turn.
- **Thinking steps** fall back to the step boundary, the closest honest anchor for model time.
- The clock ticks from `0:00` with **no delay threshold**.

## What it says

The bar states the situation in plain language rather than showing a bare number:

| State | Wording |
| --- | --- |
| Running a tool | `正在执行 <tool>，已运行 47 秒` |
| Several tools at once | `正在执行 bash，另有 2 个工具并行，本步已运行 5 秒` |
| Model streaming | `模型正在思考，本步已耗时 23 秒` |
| Submitted, no output yet | `已提交，正在等待模型响应，已等待 3 秒` |
| Finished step | `上一步（第 12 步）已完成，用时 3 分 45 秒` |
| Nothing running | `空闲，等待下一步` |

Alongside it: the step number, a chip of the running tool names (up to 4, then `+N`, hover for all), and a compact `m:ss` clock at the right edge.

Durations read naturally — `47 秒`, `1 分 12 秒`, `2 分钟`, `1 小时 3 分` — so `0:03` is never ambiguous. The wording is Chinese, matching the language of the session this was built for.

### Why the finished step stays

A step is frequently over in well under a second, so a bar that exists only *during* a step is easy to miss. Holding the last step's duration until the next step replaces it means a slow step — a `bash` call that ran for four minutes, say — can be identified after the fact. The record is kept only when the step's own `start` and `end` timestamps are both present; when they are not, the bar reports itself idle rather than inventing a duration.

## Install

```sh
dsh plugin --profile web add @WsTe47/dsh-step-clock
```

Then restart `dsh web`. The bar appears above the composer during the next running step.

## How it works

A dsh bundle, mounted as one inserted row:

- `package.json` declares `dsh.bundle.patch`, which is what makes the package installable, and `dsh.client` (`platform: web`), which is what serves the browser half.
- `cordis.patch.yml` inserts the `step-clock` row.
- `lib/index.js` is the (intentionally empty) host half. A bundle's row resolves the package root, so the package must be importable; this plugin has no host behaviour.
- `lib/client.js` is the browser half, in the `window.__ModuleLoader__.load({ id, factory })` registration shape a client bundle must have. React is taken from the module loader via `require('react')` rather than bundled.
- It registers two additive entries — `conversation.input.dock` above the composer and `conversation.composer.dock` below it — both `replaceRisk: none`, so every shipped todo / goal / queue / stats entry is untouched. It owns its stylesheet through `ctx.styles.insert`, disposed with its fiber.
- The shipped bundle is generated from `src/client/` by `npm run build`, so the readable source and the artifact cannot drift; `npm test` rebuilds and drives the bundle through its real loader contract.

It reads only facts the engine already publishes — the Chat timeline snapshot and the live running-call list — and polls nothing itself.

## Requirements

- dsh `>=0.1.5-rc.1`
- React 18 (a peer dependency, provided by the harness shell)

## Contributing

`contrib/awesome-dsh-plugin-entry.yml` is the single registry entry this package
submits to the curated list, kept here so the entry and the code stay in one
place. It is not part of the npm package.

## License

MIT

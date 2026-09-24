# omp-rewrite

[![CI](https://github.com/zPeppOz/omp-rewrite/actions/workflows/ci.yml/badge.svg)](https://github.com/zPeppOz/omp-rewrite/actions/workflows/ci.yml)

An [omp](https://github.com/can1357/oh-my-pi) extension that adds a `/rewrite` command: it turns a rough draft prompt into a thorough, unambiguous one, asking you about its direction first.

It works like `/btw`: it runs as an ephemeral side turn that sees the current conversation, so the rewrite can reference files, errors and decisions already discussed in the session, but nothing is added to the session history.

## Requirements

- omp 18.3.0 or newer, the first release that gives extensions `ctx.runEphemeralTurn`. On older versions `/rewrite` reports the required version and stops.
- An interactive session: the TUI, or an RPC client that answers extension dialogs. In print mode (`omp -p`) there is no composer to receive the result, so `/rewrite` fails immediately without calling the model.

## Installation

### From the marketplace

This repository is also an omp plugin marketplace:

```text
/marketplace add zPeppOz/omp-rewrite
/marketplace install omp-rewrite@omp-rewrite
```

Or from the shell:

```sh
omp plugin marketplace add zPeppOz/omp-rewrite
omp plugin install omp-rewrite@omp-rewrite
```

Restart omp afterwards: extension modules load when a session starts. `/rewrite` then shows up in the slash-command autocomplete.

To update, run `/marketplace update omp-rewrite`, then `/marketplace upgrade omp-rewrite@omp-rewrite` and restart. To remove it, run `/marketplace uninstall omp-rewrite@omp-rewrite`.

### From git

```sh
omp plugin install github:zPeppOz/omp-rewrite
```

### From a local clone

```sh
git clone https://github.com/zPeppOz/omp-rewrite.git
omp plugin link ./omp-rewrite
```

Install it only one way at a time: each copy registers the same `/rewrite` command.

## Usage

```text
/rewrite <draft>
```

Write the draft inline (Shift+Enter for a new line), or run `/rewrite` with no arguments to open an editor for a longer draft. Closing that editor with Esc cancels; submitting it empty shows the usage.

## How it works

1. **Direction questions**: the model reads the draft together with the session context and asks up to 4 questions about goal, scope, constraints, deliverable and acceptance criteria, each with suggested options, a recommended choice, and a free-form answer. Anything the conversation already answers is not asked; if the direction is already clear, this step is skipped. If the model's reply can't be read, you get a warning and the rewrite goes ahead without questions.
2. **Rewrite**: the model rewrites the draft using your answers. The last lines of the output stream above the composer as a preview.
3. **Result in the composer**: the rewritten prompt is placed in the composer, so you can review or edit it before pressing Enter. Text you typed in the meantime is kept and the rewrite is appended after it.
4. **Cancel**: press Esc while the model is working (TUI only), or cancel the questions dialog. On cancel or error, your original draft is put back in the composer.

Every message starts with `/rewrite:`, for example `/rewrite: cancelled; draft restored to the composer`.

## Known limitations

- It uses the current session's model and thinking level and makes two model calls per rewrite (questions, then rewrite), so with a slow or expensive model it is slow or expensive.
- In multiple-choice questions, a question left with no option selected is treated as unanswered and ignored.
- Hosts without omp's ask dialog (RPC and ACP clients) show one select per question: the recommended option is marked in its description, "Other…" opens a free-text input, and multiple-choice questions accept a single option. Esc cancellation is not available there.
- Only one `/rewrite` runs at a time; starting another one while it runs shows `/rewrite: already running`.

## Development

```sh
bun test
```

`index.ts` wires the command into omp (dialogs, side turns, widget, composer). `rewrite.ts` has no host dependencies: it holds the two prompts, the parsing of the model's questions and the preview layout, and `rewrite.test.ts` covers it. The extension has no runtime dependencies.

To release, bump `version` in both `package.json` and `.omp-plugin/marketplace.json` (`marketplace.test.ts` checks they match) and add a [CHANGELOG](CHANGELOG.md) entry. `/marketplace upgrade` compares the catalog version, so a missed bump means users don't get the update.

## License

[MIT](LICENSE)

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

## Custom instructions

Add your own instructions to the prompt that rewrites the draft, globally and per project:

```text
/rewrite-settings
```

Pick a scope, edit the text in the editor (saving it empty clears that scope), then pick the mode. Esc at any step cancels without changing anything. The field is a command because omp's `/settings` panel is built from a fixed list and can't show extension fields.

The values are ordinary omp settings, so you can also edit them by hand:

| Scope | File | Written by `/rewrite-settings` |
| --- | --- | --- |
| Global | `~/.omp/agent/config.yml` | Through omp's own settings store, like `/settings` |
| Project | `<cwd>/.omp/config.yml` | Directly by the extension |

```yaml
rewrite:
  instructions: |-
    Always write the prompt in English.
    Keep it under 200 words.
  instructionsMode: append # or "replace"; default "append"
```

| Key | Type | Default |
| --- | --- | --- |
| `rewrite.instructions` | text | empty |
| `rewrite.instructionsMode` | `append` or `replace` | `append` |

**Order.** When both scopes have text, both apply: global first, then project, and the prompt tells the model the project instructions win on conflict. If one is empty or missing, only the other applies. With neither, the prompt is exactly the one you had before.

**Mode.** One effective value: the project's, else the global one, else `append`.

- `append`: your instructions are added to the default rewrite rules. If one conflicts with a default rule, yours wins; the output is still only the rewritten prompt.
- `replace`: your instructions replace the default rewrite rules. What always stays: the draft, your answers to the questions, and a short frame saying what the draft is, that it must not be executed or answered, and that only the rewritten prompt is output (it goes into the composer verbatim). Everything else in the prompt is up to your text. With no instructions at all, `replace` has nothing to replace with and the default prompt is used.

The model receives your text inside a `<custom_instructions>` block, with a `<global>` and a `<project>` section, before the draft. An invalid value (text that isn't a string, a mode other than `append`/`replace`) is ignored with a warning, like omp does for its own settings.

## How it works

1. **Direction questions**: the model reads the draft together with the session context and asks up to 4 questions about goal, scope, constraints, deliverable and acceptance criteria, each with suggested options, a recommended choice, and a free-form answer. Anything the conversation already answers is not asked; if the direction is already clear, this step is skipped. If the model's reply can't be read, you get a warning and the rewrite goes ahead without questions.
2. **Rewrite**: the model rewrites the draft using your answers and your [custom instructions](#custom-instructions), if any. The last lines of the output stream above the composer as a preview.
3. **Result in the composer**: the rewritten prompt is placed in the composer, so you can review or edit it before pressing Enter. Text you typed in the meantime is kept and the rewrite is appended after it.
4. **Cancel**: press Esc while the model is working (TUI only), or cancel the questions dialog. On cancel or error, your original draft is put back in the composer.

Every message starts with the command name (`/rewrite:` or `/rewrite-settings:`), for example `/rewrite: cancelled; draft restored to the composer`.

## Known limitations

- It uses the current session's model and thinking level and makes two model calls per rewrite (questions, then rewrite), so with a slow or expensive model it is slow or expensive.
- In multiple-choice questions, a question left with no option selected is treated as unanswered and ignored.
- Hosts without omp's ask dialog (RPC and ACP clients) show one select per question: the recommended option is marked in its description, "Other…" opens a free-text input, and multiple-choice questions accept a single option. Esc cancellation is not available there.
- Only one `/rewrite` runs at a time; starting another one while it runs shows `/rewrite: already running`.
- `/rewrite-settings` writes `<cwd>/.omp/config.yml` itself, because omp never writes project keys. Other keys in that file are kept, but the file is re-serialized, so YAML comments in it are lost. A file that isn't a YAML mapping, or doesn't parse, is left untouched and the command reports an error.
- `/rewrite-settings` needs omp 18.3.1 or newer (the settings registry it writes global values through); `/rewrite` itself only needs 18.3.0.
- Custom instructions apply to the rewrite step only, not to the direction questions.

## Development

```sh
bun test
```

`index.ts` wires the commands into omp (dialogs, side turns, widget, composer). `rewrite.ts` and `instructions.ts` have no host dependencies: `rewrite.ts` holds the two prompts, the parsing of the model's questions and the preview layout; `instructions.ts` reads and combines the global and project settings layers. `storage.ts` writes them (global through omp's settings registry, project as YAML). `rewrite.test.ts`, `instructions.test.ts` and `storage.test.ts` cover them. The extension has no runtime dependencies.

To release, bump `version` in both `package.json` and `.omp-plugin/marketplace.json` (`marketplace.test.ts` checks they match) and add a [CHANGELOG](CHANGELOG.md) entry. `/marketplace upgrade` compares the catalog version, so a missed bump means users don't get the update.

## License

[MIT](LICENSE)

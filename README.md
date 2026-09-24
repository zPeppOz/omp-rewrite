# omp-rewrite

An [omp](https://github.com/can1357/oh-my-pi) extension that adds a `/rewrite` command: it turns a rough draft prompt into a thorough, unambiguous one, asking you about its direction first.

It works like `/btw`: it runs as an ephemeral side turn that sees the current conversation, so the rewrite can reference files, errors and decisions already discussed in the session, but nothing is added to the session history.

## Requirements

- An omp version that supports `ctx.runEphemeralTurn` for extensions. Tested on omp 18.3.0.

## Installation

```sh
git clone https://github.com/zPeppOz/omp-rewrite.git
omp plugin link ./omp-rewrite
```

Restart omp. `/rewrite` then shows up in the slash-command autocomplete.

## Usage

```text
/rewrite <draft>
```

Write the draft inline (Shift+Enter for a new line), or run `/rewrite` with no arguments to open an editor for a longer draft.

## How it works

1. **Direction questions**: the model reads the draft together with the session context and asks up to 4 questions about goal, scope, constraints, deliverable and acceptance criteria, each with suggested options, a recommended choice, and a free-form answer. Anything the conversation already answers is not asked; if the direction is already clear, this step is skipped.
2. **Rewrite**: the model rewrites the draft using your answers, streaming a preview above the composer.
3. **Result in the composer**: the rewritten prompt is placed in the composer, so you can review or edit it before pressing Enter. Text you typed in the meantime is kept and the rewrite is appended after it.
4. **Cancel**: press Esc while the model is working, or cancel the questions dialog. On cancel or error, your original draft is put back in the composer.

## Known limitations

- It uses the current session's model and thinking level and makes two model calls per rewrite (questions, then rewrite), so with a slow or expensive model it is slow or expensive.
- In multiple-choice questions, a question left with no option selected is treated as unanswered and ignored.

## License

[MIT](LICENSE)

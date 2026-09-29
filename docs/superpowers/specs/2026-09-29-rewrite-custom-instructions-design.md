# /rewrite: custom instructions

Approved 2026-09-29. Lets the user add instructions to the rewrite prompt, globally and per project.

## Facts verified on omp 18.4.2

- This repo has no settings system of its own; it reuses the host's layers: global `~/.omp/agent/config.yml`, project `<cwd>/.omp/config.yml`.
- Read: `pi.pi.settings.getGlobalSettings()` / `getProjectSettings()` return the raw layers, including namespaced keys.
- Write, global: a handle from `register()` in `@oh-my-pi/pi-coding-agent/config/registry`; `set`/`unset` + `flush()` persist to `config.yml` through omp's own store.
- Write, project: the host never writes project keys, so the extension writes `<cwd>/.omp/config.yml` and calls `reloadFromDisk()` (without it `getProjectSettings()` stays stale).
- The `/settings` panel cannot show extension fields (`config/all-settings.ts` lists a fixed set of domains), so the field lives in a `/rewrite-settings` command.

## Keys (namespace `rewrite`)

| Key | Type | Default |
| --- | --- | --- |
| `rewrite.instructions` | string | empty |
| `rewrite.instructionsMode` | `append` \| `replace` | `append` |

## Rules

- Text: global first, then project. Blank or missing text is ignored; if only one exists, only that one applies.
- Mode: one effective value, project, then global, then `append` (omp's scalar layering).
- `append`: default rewrite rules, then the custom block, then `<draft>` and `<decisions>`.
- `replace`: I/O frame and custom block replace the default rules; `<draft>` and `<decisions>` stay. With no text, the default prompt is used unchanged.
- The questions prompt (first side turn) is never changed.
- Invalid values in a layer (non-string text, unknown mode) are ignored with a warning, like omp does for its own keys.

## `/rewrite-settings`

1. Pick scope (global / project).
2. Edit the text in an editor prefilled with the current value. Saving blank clears the scope: its `rewrite` keys are removed and the flow ends.
3. Pick the mode (project also offers "inherit").

## Out of scope

Applying the instructions to the questions turn, per-scope templates, a `/settings` panel entry (not possible from an extension).

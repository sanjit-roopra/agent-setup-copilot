---
name: shunt-bulk-reader
description: Delegate bulk file reading to a cheaper Copilot model. Use for whole files above 350 lines or 24 KiB, questions across three or more files, saved large diffs, or a SHUNT_COPILOT_READ_REDIRECT denial.
---

Keep reasoning in the main conversation. Send source paths and a specific question to the helper; do not read or paste the source into your prompt first.

Resolve `../../scripts/bulk-read.mjs` relative to THIS SKILL.md's directory to obtain the absolute script path. Skill paths are provided by the host; do not assume the plugin is inside the project or that PLUGIN_ROOT is set in your terminal. Use the project's absolute root as `--root`.

```sh
node "/absolute/plugin/path/scripts/bulk-read.mjs" --root "/absolute/project" --question "How does retry handling work? Identify relevant functions and line ranges." --paths "src/service.ts" "src/retry.ts"
```

The helper reads files itself, sends a JSON source bundle over stdin to a separate Copilot CLI worker, verifies the returned model, and prints only a bounded summary. Normal shell permissions still apply. Do not use shell substitutions to insert source content. Do not chunk through an entire blocked file with repeated range reads.

Each invocation is independent; follow-ups must include the paths again and incur another worker request. Check exact values and small line ranges before editing. Summaries can omit or misinterpret details. Keep difficult reasoning, architecture, security judgments, and surgical edits with the main model.

If the worker fails, report the operational error. Do not silently switch model, paste the whole corpus into the main conversation, or disable hooks. For files larger than the configured input limit, split the task or use a targeted query. A large diff can be saved to a project-local file with `git diff > .shunt-diff.txt`, summarized by path, then removed.

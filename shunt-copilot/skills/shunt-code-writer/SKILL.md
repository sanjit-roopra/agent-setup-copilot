---
name: shunt-code-writer
description: Delegate predictable boilerplate generation before composing it yourself. Use for tests, repetitive configuration, type stubs, or documentation where most of the output follows a reference file; the cheap worker writes directly to a new target.
---

Use this before generating a large predictable file in the main conversation. Decide the specification and select a reference by path. Do not read the full reference or compose the full implementation first.

Resolve `../../scripts/code-write.mjs` relative to THIS SKILL.md's directory to obtain the absolute script path. Use the project's absolute root as `--root`.

```sh
node "/absolute/plugin/path/scripts/code-write.mjs" --root "/absolute/project" --spec "Generate tests for the specified retry cases, following the reference's test conventions: ..." --reference "tests/example.test.ts" --target "tests/new.test.ts"
```

The helper sends the reference and specification to a separate Copilot CLI worker and writes the result locally. Only path, line/byte counts, model, and hash return to your conversation. A target is required and must not already exist; its parent directory must exist. To revise an existing file, generate a new candidate, inspect focused differences, and merge the intended changes using normal editing tools.

Run the appropriate tests or compiler, review targeted sections, and make surgical corrections. Do not treat generated code as verified. Do not dump the whole generated file back into your context. Each call is independent: pass the previous candidate as the reference when refining it.

This is skill-guided delegation, not a Write hook. Writing a file through a native tool after generating its content already spends the main model's output tokens. Difficult algorithms, architectural decisions, security-sensitive reasoning and final review remain with the main model.

#!/usr/bin/env python3
"""Sync recommended built-in subagent models into Copilot CLI user settings."""

import argparse
import json
import os
from pathlib import Path
import re
import stat
import tempfile
from urllib.request import urlopen

SOURCE_URL = (
    "https://raw.githubusercontent.com/sanjit-roopra/"
    "agent-setup-copilot/main/copilot-cli/subagents.json"
)
AGENTS = {
    "explore", "task", "general-purpose", "rubber-duck",
    "code-review", "research", "security-review",
}
EFFORT_LEVELS = {"low", "medium", "high", "xhigh"}


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def parse_jsonc(text):
    """Parse JSON with comments and trailing commas, keeping character offsets."""
    masked = list(text)
    index = 0
    quoted = False
    escaped = False
    while index < len(masked):
        char = text[index]
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif text.startswith("//", index) or text.startswith("/*", index):
            block = text.startswith("/*", index)
            end = text.find("*/", index + 2) + 2 if block else text.find("\n", index)
            if block and end == 1:
                raise ValueError("Unterminated JSONC block comment")
            if end < 0:
                end = len(text)
            for position in range(index, end):
                if text[position] != "\n":
                    masked[position] = " "
            index = end
            continue
        index += 1

    plain = "".join(masked)
    quoted = False
    escaped = False
    for index, char in enumerate(plain):
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char == ",":
            following = index + 1
            while following < len(plain) and plain[following].isspace():
                following += 1
            if following < len(plain) and plain[following] in "}]":
                masked[index] = " "

    plain = "".join(masked)
    return json.loads(plain, object_pairs_hook=unique_keys), plain


def members(plain, offset):
    """Return the value spans of direct members of a JSON object."""
    decoder = json.JSONDecoder()
    if plain[offset] != "{":
        raise ValueError("Expected a JSON object")
    position = offset + 1
    result = {}
    while True:
        position = skip_space(plain, position)
        if plain[position] == "}":
            return result
        key, position = decoder.raw_decode(plain, position)
        position = skip_space(plain, position)
        if plain[position] != ":":
            raise ValueError("Expected a JSON property")
        start = skip_space(plain, position + 1)
        _, end = decoder.raw_decode(plain, start)
        result[key] = (start, end)
        position = skip_space(plain, end)
        if plain[position] == "}":
            return result
        if plain[position] != ",":
            raise ValueError("Expected a comma")
        position += 1


def skip_space(text, position):
    while position < len(text) and text[position].isspace():
        position += 1
    return position


def indent_at(text, position):
    line = text[text.rfind("\n", 0, position) + 1:position]
    return re.match(r"[ \t]*", line).group()


def formatted(value, indent):
    return json.dumps(value, indent=2).replace("\n", "\n" + indent)


def insert_entries(text, offset, existing, entries):
    indent = indent_at(text, offset) + "  "
    if text[offset + 1:offset + 2] == "\n":
        position = offset + 2
        return (
            text[:position] + indent + entries + ("," if existing else "")
            + "\n" + text[position:]
        )
    if not existing and text[offset + 1:offset + 2] == "}":
        return text[:offset + 1] + "\n" + indent + entries + "\n" + text[offset + 1:]
    return text[:offset + 1] + entries + (", " if existing else "") + text[offset + 1:]


def insert_member(text, offset, existing, key, value):
    indent = indent_at(text, offset) + "  "
    entry = f'{json.dumps(key)}: {formatted(value, indent)}'
    return insert_entries(text, offset, existing, entry)


def validate_recommendations(data):
    if not isinstance(data, dict) or set(data) != {"subagents"}:
        raise ValueError("Recommendations must contain only a subagents object")
    section = data["subagents"]
    if not isinstance(section, dict) or set(section) != {"agents"}:
        raise ValueError("Recommendations must contain only subagents.agents")
    agents = section["agents"]
    if not isinstance(agents, dict) or set(agents) != AGENTS:
        raise ValueError("Recommendations must list all seven built-in agents")
    for name, config in agents.items():
        if not isinstance(config, dict) or set(config) != {"model", "effortLevel"}:
            raise ValueError(f"Invalid model configuration for {name}")
        if not isinstance(config["model"], str) or not config["model"].strip():
            raise ValueError(f"Invalid model for {name}")
        if (not isinstance(config["effortLevel"], str)
                or config["effortLevel"] not in EFFORT_LEVELS):
            raise ValueError(f"Invalid effort level for {name}")
    return agents


def merge_settings(text, agents):
    current, plain = parse_jsonc(text)
    if not isinstance(current, dict):
        raise ValueError("Settings must be a JSON object")
    current_section = current.get("subagents", {})
    if not isinstance(current_section, dict):
        raise ValueError("Existing subagents setting must be an object")
    current_agents = current_section.get("agents", {})
    if not isinstance(current_agents, dict):
        raise ValueError("Existing subagents.agents must be an object")
    merged = current_agents.copy()
    for name, config in agents.items():
        previous = current_agents.get(name, {})
        if not isinstance(previous, dict):
            raise ValueError(f"Existing configuration for {name} must be an object")
        merged[name] = {**previous, **config}
    if merged == current_agents:
        return text

    root_offset = skip_space(plain, 0)
    root = members(plain, root_offset)
    if "subagents" not in root:
        return insert_member(text, root_offset, root, "subagents", {"agents": merged})
    section_offset = root["subagents"][0]
    section = members(plain, section_offset)
    if "agents" not in section:
        return insert_member(text, section_offset, section, "agents", merged)
    agents_offset = section["agents"][0]
    existing = members(plain, agents_offset)
    changes = [
        (existing[name][0], existing[name][1], merged[name])
        for name in agents
        if name in existing and current_agents[name] != merged[name]
    ]
    for start, end, config in sorted(changes, reverse=True):
        text = text[:start] + formatted(config, indent_at(text, start)) + text[end:]
    missing = {name: merged[name] for name in agents if name not in existing}
    if missing:
        indent = indent_at(text, agents_offset) + "  "
        separator = ",\n" + indent if text[agents_offset + 1:agents_offset + 2] == "\n" else ", "
        entries = separator.join(
            f'{json.dumps(name)}: {formatted(config, indent)}'
            for name, config in missing.items()
        )
        text = insert_entries(text, agents_offset, existing, entries)
    return text


def sync(settings, url):
    if not url.startswith("https://"):
        raise ValueError("Recommendation URL must use HTTPS")
    with urlopen(url, timeout=15) as response:
        if not response.geturl().startswith("https://"):
            raise ValueError("Recommendation URL redirected away from HTTPS")
        payload = response.read(65537)
    if len(payload) > 65536:
        raise ValueError("Recommendations exceed 64 KiB")
    agents = validate_recommendations(json.loads(payload, object_pairs_hook=unique_keys))

    target = settings.resolve()
    if target.exists():
        before = target.read_bytes()
        mode = stat.S_IMODE(target.stat().st_mode)
        original = before.decode("utf-8")
    else:
        before = None
        mode = 0o600
        original = "{}\n"
    updated = merge_settings(original, agents).encode("utf-8")
    if before == updated:
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as stream:
            temporary = Path(stream.name)
            os.fchmod(stream.fileno(), mode)
            stream.write(updated)
            stream.flush()
            os.fsync(stream.fileno())
        if target.exists() and target.read_bytes() != before:
            raise RuntimeError("Settings changed during update; refusing to overwrite")
        if before is None and target.exists():
            raise RuntimeError("Settings appeared during update; refusing to overwrite")
        os.replace(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=SOURCE_URL, help="HTTPS recommendations URL")
    parser.add_argument(
        "--settings",
        type=Path,
        default=Path(os.environ.get("COPILOT_HOME", Path.home() / ".copilot"))
        / "settings.json",
        help="Copilot CLI settings file",
    )
    args = parser.parse_args()
    try:
        changed = sync(args.settings, args.url)
    except (OSError, UnicodeError, ValueError, RuntimeError) as error:
        parser.exit(1, f"Subagent update failed: {error}\n")
    print("Updated Copilot CLI subagents." if changed else "Copilot CLI subagents already current.")


if __name__ == "__main__":
    main()

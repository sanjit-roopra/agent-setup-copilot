import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "update-subagents.py"
spec = importlib.util.spec_from_file_location("update_subagents", SCRIPT)
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)
RECOMMENDATIONS = SCRIPT.with_name("subagents.json")


class Response:
    def __init__(self, payload, url=updater.SOURCE_URL):
        self.payload = payload
        self.url = url

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def geturl(self):
        return self.url

    def read(self, limit):
        return self.payload[:limit]


class SubagentUpdateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = RECOMMENDATIONS.read_bytes()
        cls.agents = updater.validate_recommendations(json.loads(cls.payload))

    def test_recommendations_cover_seven_built_in_agents(self):
        self.assertEqual(set(self.agents), updater.AGENTS)
        self.assertEqual(self.agents["explore"]["model"], "gpt-6-luna")
        self.assertEqual(self.agents["security-review"]["model"], "claude-opus-5.5")

    def test_merge_preserves_unrelated_settings_comments_and_custom_agent(self):
        original = """{
  // Keep this personal setting.
  "theme": "dim",
  "url": "https://example.com/a,//b",
  "subagents": {
    "maxDepth": 2,
    /* Keep this setting too. */
    "agents": {
      "explore": {"model": "old", "contextTier": "long_context"},
      // Keep this custom agent comment.
      "my-agent": {"model": "custom"},
    },
  },
}
"""
        result = updater.merge_settings(original, self.agents)
        values, _ = updater.parse_jsonc(result)
        self.assertIn("// Keep this personal setting.", result)
        self.assertIn("/* Keep this setting too. */", result)
        self.assertIn("// Keep this custom agent comment.", result)
        self.assertEqual(values["theme"], "dim")
        self.assertEqual(values["url"], "https://example.com/a,//b")
        self.assertEqual(values["subagents"]["maxDepth"], 2)
        self.assertEqual(values["subagents"]["agents"]["my-agent"], {"model": "custom"})
        self.assertEqual(values["subagents"]["agents"]["explore"], {
            **self.agents["explore"], "contextTier": "long_context"})
        self.assertEqual(updater.merge_settings(result, self.agents), result)

    def test_merge_adds_missing_nested_objects_without_losing_comments(self):
        for original in ('{}\n', '{"theme": "dim"}', '{\n  // hi\n  "subagents": {"maxDepth": 2,},\n}'):
            with self.subTest(original=original):
                result = updater.merge_settings(original, self.agents)
                values, _ = updater.parse_jsonc(result)
                self.assertEqual(values["subagents"]["agents"], self.agents)
                if original == "{}\n":
                    self.assertTrue(result.startswith('{\n  "subagents":'))
                if "// hi" in original:
                    self.assertIn("// hi", result)
                self.assertEqual(updater.merge_settings(result, self.agents), result)

    def test_existing_built_in_comments_are_replaced_but_custom_comments_survive(self):
        original = """{
  "subagents": {
    "agents": {
      // User-selected model for explore.
      "explore": {"model": "old"},
      // Custom agent is not maintained by this list.
      "my-agent": {"model": "custom"},
    }
  }
}"""
        result = updater.merge_settings(original, self.agents)
        values, _ = updater.parse_jsonc(result)
        self.assertIn("// Custom agent is not maintained by this list.", result)
        self.assertEqual(values["subagents"]["agents"]["my-agent"], {"model": "custom"})

    def test_invalid_existing_settings_are_rejected(self):
        for original in ('{"subagents": []}', '{"subagents": {"agents": []}}',
                         '{"subagents": {"agents": {"explore": "old"}}}',
                         '{"theme": "one", "theme": "two"}', '{"broken": /* open'):
            with self.subTest(original=original), self.assertRaises(ValueError):
                updater.merge_settings(original, self.agents)

    def test_invalid_recommendations_are_rejected(self):
        for data in (
            {"subagents": {"agents": {}}},
            {"subagents": {"agents": {**self.agents, "extra": {}}}},
            {"subagents": {"agents": {**self.agents, "explore": {"model": ""}}}},
            {"subagents": {"agents": {**self.agents, "explore": {
                "model": "gpt-6-luna", "effortLevel": "invalid"}}}},
            {"subagents": {"agents": {**self.agents, "explore": {
                "model": "gpt-6-luna", "effortLevel": []}}}},
            {**json.loads(self.payload), "model": "overwritten"},
        ):
            with self.subTest(data=data), self.assertRaises(ValueError):
                updater.validate_recommendations(data)

    def test_sync_creates_settings_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            settings = Path(directory) / ".copilot" / "settings.json"
            with patch.object(updater, "urlopen", return_value=Response(self.payload)):
                self.assertTrue(updater.sync(settings, updater.SOURCE_URL))
                content = settings.read_bytes()
                self.assertFalse(updater.sync(settings, updater.SOURCE_URL))
            self.assertEqual(settings.read_bytes(), content)
            self.assertEqual(stat.S_IMODE(settings.stat().st_mode), 0o600)
            self.assertEqual(json.loads(content)["subagents"]["agents"], self.agents)

    def test_sync_preserves_symlink_and_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "dotfiles" / "settings.json"
            target.parent.mkdir()
            target.write_text('{"theme":"dim"}')
            target.chmod(0o640)
            link = Path(directory) / "settings.json"
            link.symlink_to(target)
            with patch.object(updater, "urlopen", return_value=Response(self.payload)):
                self.assertTrue(updater.sync(link, updater.SOURCE_URL))
            self.assertTrue(link.is_symlink())
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o640)
            self.assertEqual(json.loads(target.read_text())["theme"], "dim")

    def test_failed_fetch_or_invalid_input_does_not_change_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            settings = Path(directory) / "settings.json"
            settings.write_text('{"theme":"dim"}')
            for response in (
                Response(b"{}"),
                Response(self.payload, "http://example.com/redirect"),
                Response(b" " * 65537),
                Response(b'{"subagents": {}, "subagents": {}}'),
            ):
                with self.subTest(response=response.payload[:25]):
                    with patch.object(updater, "urlopen", return_value=response):
                        with self.assertRaises(ValueError):
                            updater.sync(settings, updater.SOURCE_URL)
                    self.assertEqual(settings.read_text(), '{"theme":"dim"}')
            with self.assertRaises(ValueError):
                updater.sync(settings, "http://example.com/models.json")


if __name__ == "__main__":
    unittest.main()

import sys
from pathlib import Path
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from hello import greet, normalize_name  # noqa: E402


class HelloTests(unittest.TestCase):
    def test_normalize_name_title_cases_words(self) -> None:
        self.assertEqual(normalize_name("  codex lead  "), "Codex Lead")

    def test_greet_uses_normalized_name(self) -> None:
        self.assertEqual(greet("  codex lead  "), "Hello, Codex Lead!")


if __name__ == "__main__":
    unittest.main()

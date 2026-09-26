"""Run from the repository root: python3 -m unittest discover -s scripts -p "test_*.py"."""

import contextlib
import io
import unittest

from release_version_guard import blocking_tags, compare, main, parse


def below(a, b):
    return compare(parse(a), parse(b)) < 0


class PrecedenceTests(unittest.TestCase):
    def test_nightly_of_a_version_sorts_below_its_rc_and_release(self):
        self.assertTrue(below("v0.8.0-nightly.14", "v0.8.0-rc.1"))
        self.assertTrue(below("v0.8.0-rc.1", "v0.8.0"))
        self.assertTrue(below("v0.8.0", "v0.8.1-nightly.1"))

    def test_numeric_identifiers_compare_numerically(self):
        self.assertTrue(below("v0.8.0-nightly.2", "v0.8.0-nightly.10"))
        self.assertTrue(below("v0.8.0-rc.1", "v0.8.0-rc.2"))
        self.assertTrue(below("v0.8.0-rc.2", "v0.8.0-rc.10"))

    def test_numeric_identifier_sorts_below_alphanumeric(self):
        self.assertTrue(below("v1.0.0-1", "v1.0.0-alpha"))

    def test_longer_prerelease_sorts_above_its_prefix(self):
        self.assertTrue(below("v1.0.0-alpha", "v1.0.0-alpha.1"))

    def test_core_compares_numerically(self):
        self.assertTrue(below("v0.9.0", "v0.10.0"))

    def test_build_metadata_is_ignored(self):
        self.assertEqual(compare(parse("v1.0.0+abc"), parse("v1.0.0")), 0)

    def test_rejects_tags_that_are_not_v_prefixed_semver(self):
        for tag in ("0.8.0", "v0.8", "v01.2.3", "v1.2.3-", "latest", "v1.2.3-01"):
            self.assertIsNone(parse(tag), tag)


class GuardTests(unittest.TestCase):
    EXISTING = ["v0.7.0", "v0.8.0-nightly.14", "v0.8.0-rc.1", "not-a-version", "v0.6.5"]

    def test_accepts_a_nightly_of_the_next_version(self):
        self.assertEqual(blocking_tags("v0.8.1-nightly.1", self.EXISTING), [])

    def test_refuses_a_nightly_that_sorts_below_an_rc(self):
        self.assertEqual(blocking_tags("v0.8.0-nightly.15", self.EXISTING), ["v0.8.0-rc.1"])

    def test_beta_does_not_have_to_lead_nightly(self):
        existing = self.EXISTING + ["v0.8.1-nightly.1"]
        self.assertEqual(blocking_tags("v0.8.0-rc.2", existing), [])

    def test_stable_only_has_to_lead_stable(self):
        existing = self.EXISTING + ["v0.8.1-nightly.1", "v0.8.0-rc.2"]
        self.assertEqual(blocking_tags("v0.8.0", existing), [])

    def test_refuses_a_beta_below_an_existing_stable(self):
        self.assertEqual(blocking_tags("v0.7.0-rc.3", self.EXISTING), ["v0.8.0-rc.1", "v0.7.0"])

    def test_refuses_a_stable_below_an_existing_stable(self):
        self.assertEqual(blocking_tags("v0.6.9", self.EXISTING), ["v0.7.0"])

    def test_the_tag_being_released_is_not_its_own_blocker(self):
        self.assertEqual(blocking_tags("v0.8.0-rc.1", self.EXISTING), [])

    def test_blockers_are_listed_newest_first(self):
        existing = ["v0.8.0-nightly.3", "v0.8.0-rc.1", "v0.8.0-nightly.10"]
        self.assertEqual(
            blocking_tags("v0.8.0-nightly.2", existing),
            ["v0.8.0-rc.1", "v0.8.0-nightly.10", "v0.8.0-nightly.3"],
        )


class CommandLineTests(unittest.TestCase):
    LS_REMOTE = io.StringIO(
        "1111\trefs/tags/v0.8.0-rc.1\n"
        "2222\trefs/tags/v0.8.0-nightly.14\n"
    )

    def run_main(self, tag):
        self.LS_REMOTE.seek(0)
        with contextlib.redirect_stdout(io.StringIO()):
            return main(["release_version_guard.py", tag], self.LS_REMOTE)

    def test_exits_zero_when_the_tag_leads(self):
        self.assertEqual(self.run_main("v0.8.1-nightly.1"), 0)

    def test_exits_nonzero_when_the_tag_would_be_a_downgrade(self):
        self.assertEqual(self.run_main("v0.8.0-nightly.15"), 1)

    def test_exits_nonzero_for_a_tag_that_is_not_semver(self):
        self.assertEqual(self.run_main("v0.8"), 1)


if __name__ == "__main__":
    unittest.main()

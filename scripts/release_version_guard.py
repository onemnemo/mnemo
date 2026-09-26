#!/usr/bin/env python3
"""Refuses a release tag that does not sort above the releases its channels already carry.

The app never installs a downgrade, so a tag below the newest build on its channel reaches nobody.
Usage: git ls-remote --tags --refs origin | release_version_guard.py <tag>
"""

import functools
import re
import sys

SEMVER = re.compile(
    r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)

# Mirrors the case statement in the release workflow and UpdateChannels.ForVersion.
NIGHTLY_LABELS = ("nightly", "alpha", "dev")

# The channels whose existing tags a new tag on each channel has to sort above. Beta does not
# have to lead nightly, because a beta tag is never published to the nightly feed.
MUST_LEAD = {
    "nightly": ("stable", "beta", "nightly"),
    "beta": ("stable", "beta"),
    "stable": ("stable",),
}


def parse(tag):
    """Return (core, prerelease identifiers) for a v-prefixed semver tag, or None."""
    match = SEMVER.match(tag)
    if not match:
        return None
    core = tuple(int(part) for part in match.group(1, 2, 3))
    pre = tuple(match.group(4).split(".")) if match.group(4) else ()
    return core, pre


def _compare_identifier(a, b):
    a_num, b_num = a.isdigit(), b.isdigit()
    if a_num and b_num:
        return (int(a) > int(b)) - (int(a) < int(b))
    if a_num != b_num:
        return -1 if a_num else 1
    return (a > b) - (a < b)


def compare(a, b):
    """Semver 2.0 precedence of two parsed versions: negative, zero or positive."""
    (a_core, a_pre), (b_core, b_pre) = a, b
    if a_core != b_core:
        return -1 if a_core < b_core else 1
    if not a_pre or not b_pre:
        return (not a_pre) - (not b_pre)
    for x, y in zip(a_pre, b_pre):
        result = _compare_identifier(x, y)
        if result:
            return result
    return (len(a_pre) > len(b_pre)) - (len(a_pre) < len(b_pre))


def channel_of(version):
    _, pre = version
    if not pre:
        return "stable"
    return "nightly" if pre[0].lower().startswith(NIGHTLY_LABELS) else "beta"


def blocking_tags(tag, existing):
    """Existing tags on the channels the tag must lead that it does not sort strictly above."""
    version = parse(tag)
    if version is None:
        raise ValueError(f"{tag} is not a v-prefixed semver tag")
    lead = MUST_LEAD[channel_of(version)]
    blockers = []
    for other in existing:
        if other == tag:
            continue
        other_version = parse(other)
        if other_version is None or channel_of(other_version) not in lead:
            continue
        if compare(version, other_version) <= 0:
            blockers.append(other)
    by_version = functools.cmp_to_key(lambda x, y: compare(parse(x), parse(y)))
    return sorted(blockers, key=by_version, reverse=True)


def tags_from_ls_remote(lines):
    tags = []
    for line in lines:
        fields = line.split()
        if fields and fields[-1].startswith("refs/tags/"):
            tags.append(fields[-1][len("refs/tags/"):])
    return tags


def main(argv, stdin):
    if len(argv) != 2:
        print("usage: release_version_guard.py <tag> < ls-remote output", file=sys.stderr)
        return 2
    tag = argv[1]
    try:
        blockers = blocking_tags(tag, tags_from_ls_remote(stdin))
    except ValueError as error:
        print(f"::error::{error}")
        return 1
    if blockers:
        channel = channel_of(parse(tag))
        print(
            f"::error::{tag} is a {channel} tag but does not sort above {', '.join(blockers)}, "
            f"so installs on that channel would treat it as a downgrade and never update. "
            f"Tag a higher version: once a version has an rc or a release, nightlies belong "
            f"to the next version (v0.8.1-nightly.1 after v0.8.0-rc.1)."
        )
        return 1
    print(f"{tag} sorts above every release it has to lead")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv, sys.stdin))

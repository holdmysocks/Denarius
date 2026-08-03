#!/usr/bin/env python3
"""Bump the Denarius version everywhere it is declared.

The version lives in several files that must not drift apart. This rewrites
all of them from one command and verifies nothing was missed.

    scripts/bump-version.py 1.2.0             rewrite every declaration
    scripts/bump-version.py --check           verify they all agree
    scripts/bump-version.py 1.2.0 --commit    also `git commit`
    scripts/bump-version.py 1.2.0 --commit --tag   ... and `git tag vX.Y.Z`

frontend/package.json and package-lock.json are handled by `npm version`
rather than hand-edited, so npm owns its own lockfile format. Everything else
is a targeted regex — deliberately narrow, so an unrelated "1.0.0" (a
dependency pin, a dated audit doc) is never touched.

Nothing is pushed. Push yourself once you're happy:
    git push origin dev && git push origin vX.Y.Z
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")

# (path, description, regex). Each regex needs a `ver` group plus whatever
# context makes it unique. `expect` is the number of matches required — a
# mismatch means the file drifted and is a hard error, not a silent no-op.
SITES: list[tuple[str, str, re.Pattern[str], int]] = [
    (
        "backend/app/main.py",
        "FastAPI/OpenAPI version",
        re.compile(r'(?m)^(?P<pre>    version=")(?P<ver>[^"]+)(?P<post>",)$'),
        1,
    ),
    (
        "frontend/src/pages/settings/SettingsPage.tsx",
        "APP_VERSION shown in Settings",
        re.compile(r'(?P<pre>const APP_VERSION = ")(?P<ver>[^"]+)(?P<post>";)'),
        1,
    ),
    (
        "README.md",
        "status badge line",
        re.compile(r"(?P<pre>> \*\*Status:\*\* v)(?P<ver>\S+)(?P<post> —)"),
        1,
    ),
    (
        "docker-compose.yml",
        "header comment",
        re.compile(r"(?P<pre># Denarius v)(?P<ver>\S+)(?P<post>)"),
        1,
    ),
    (
        "docker-compose.yml",
        "built image tags",
        re.compile(r"(?P<pre>\$\{DENARIUS_VERSION:-)(?P<ver>[^}]+)(?P<post>\})"),
        3,
    ),
    (
        ".env.example",
        "DENARIUS_VERSION example",
        re.compile(r"(?P<pre># DENARIUS_VERSION=)(?P<ver>\S+)(?P<post>)"),
        1,
    ),
]


def fail(msg: str) -> "typing.NoReturn":  # noqa: F821
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def package_json_version() -> str:
    """frontend/package.json is the canonical source."""
    data = json.loads((REPO / "frontend/package.json").read_text())
    return data["version"]


def lockfile_versions() -> list[str]:
    data = json.loads((REPO / "frontend/package-lock.json").read_text())
    # Only the two root entries. Dependency versions are none of our business.
    return [data["version"], data["packages"][""]["version"]]


def scan() -> tuple[dict[str, list[str]], list[str]]:
    """Return {label: [versions found]} and a list of structural problems."""
    found: dict[str, list[str]] = {
        "frontend/package.json": [package_json_version()],
        "frontend/package-lock.json": lockfile_versions(),
    }
    problems: list[str] = []
    for rel, desc, pattern, expect in SITES:
        path = REPO / rel
        if not path.exists():
            problems.append(f"{rel}: missing")
            continue
        matches = pattern.findall(path.read_text())
        label = f"{rel} ({desc})"
        if len(matches) != expect:
            problems.append(
                f"{label}: expected {expect} match(es), found {len(matches)} "
                "— the file changed shape; update SITES in this script"
            )
        found[label] = [m[1] for m in matches]
    return found, problems


def check(quiet: bool = False) -> str:
    found, problems = scan()
    versions = {v for vs in found.values() for v in vs}
    if not quiet:
        width = max(len(k) for k in found)
        for label, vs in found.items():
            print(f"  {label:<{width}}  {', '.join(vs)}")
    for p in problems:
        print(f"  ! {p}", file=sys.stderr)
    if problems:
        fail("version declarations are structurally broken (see above)")
    if len(versions) != 1:
        fail(f"version declarations disagree: {sorted(versions)}")
    return versions.pop()


def run(cmd: list[str], cwd: Path | None = None) -> None:
    result = subprocess.run(cmd, cwd=cwd or REPO, capture_output=True, text=True)
    if result.returncode != 0:
        fail(f"`{' '.join(cmd)}` failed:\n{result.stderr.strip()}")


def bump(new: str, do_commit: bool, do_tag: bool) -> None:
    if not SEMVER.match(new):
        fail(f"'{new}' is not a semver version (expected X.Y.Z)")

    old = check(quiet=True)
    if old == new:
        fail(f"already at {new}")

    dirty = subprocess.run(
        ["git", "status", "--porcelain"], cwd=REPO, capture_output=True, text=True
    ).stdout.strip()
    if dirty and (do_commit or do_tag):
        fail("working tree is dirty; commit or stash before --commit/--tag")

    print(f"bumping {old} -> {new}")

    # npm owns package.json + package-lock.json.
    run(
        ["npm", "version", new, "--no-git-tag-version", "--allow-same-version"],
        cwd=REPO / "frontend",
    )
    print("  frontend/package.json, frontend/package-lock.json  (npm version)")

    for rel, desc, pattern, expect in SITES:
        path = REPO / rel
        text = path.read_text()
        updated, count = pattern.subn(
            lambda m: f"{m.group('pre')}{new}{m.group('post')}", text
        )
        if count != expect:
            fail(f"{rel} ({desc}): expected {expect} replacement(s), made {count}")
        path.write_text(updated)
        print(f"  {rel}  ({desc}, x{count})")

    print("\nverifying:")
    confirmed = check()
    if confirmed != new:
        fail(f"post-bump verification says {confirmed}, expected {new}")
    print(f"\nall declarations agree on {new}")

    if do_commit:
        run(["git", "commit", "-aqm", f"chore: bump version to {new}"])
        print(f"committed: chore: bump version to {new}")
    if do_tag:
        run(["git", "tag", "-a", f"v{new}", "-m", f"Denarius v{new}"])
        print(f"tagged: v{new}")
    if do_commit or do_tag:
        refs = "dev" + (f" && git push origin v{new}" if do_tag else "")
        print(f"\nnot pushed. when ready:  git push origin {refs}")


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Bump the Denarius version everywhere it is declared."
    )
    ap.add_argument("version", nargs="?", help="new version, e.g. 1.2.0")
    ap.add_argument(
        "--check",
        action="store_true",
        help="verify all declarations agree, change nothing",
    )
    ap.add_argument("--commit", action="store_true", help="git commit the bump")
    ap.add_argument("--tag", action="store_true", help="git tag vX.Y.Z")
    args = ap.parse_args()

    if args.check:
        if args.version:
            fail("--check takes no version argument")
        print("version declarations:")
        print(f"\nall agree on {check()}")
        return

    if not args.version:
        ap.error("a version is required (or use --check)")

    bump(args.version, args.commit, args.tag)


if __name__ == "__main__":
    main()

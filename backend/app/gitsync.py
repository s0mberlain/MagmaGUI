"""Optional one-way sync of the YAML config history to a git repository (PLAN 4a).

The database stays the source of truth. Every config commit becomes a git commit with the same
author, date and message, on `usecases/<L1>/<L2>/<L3>.yaml` (an L2 config is `<L2>/<L2>.yaml`).
Config tags become git tags named `<code>/<tag>`. Each exported commit carries a
`Magma-Commit: <sha>` trailer, so a sync never exports a commit twice, even after a failed push.
"""

import base64
import logging
import os
import re
import subprocess
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.models import ConfigCommit, ConfigTag, GitSyncState, L2UseCase, L3UseCase

log = logging.getLogger(__name__)

TRAILER = "Magma-Commit"
OUR_TAG = re.compile(r"^[A-Z0-9]{2}-[A-Z0-9]{3}(-[0-9A-Z]+)?/")


class GitError(RuntimeError):
    pass


def redact(url: str) -> str:
    """Hide a password or token that someone put into the URL itself."""
    return re.sub(r"//[^/@]*@", "//***@", url)


@dataclass
class Result:
    exported: int = 0
    tags: int = 0
    head: str | None = None
    messages: list[str] = field(default_factory=list)


class Repo:
    def __init__(self, settings: Settings):
        self.s = settings
        self.dir = Path(settings.git_workdir)

    def _env(self) -> dict[str, str]:
        env = {
            **os.environ,
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_COMMITTER_NAME": "MaGMa UCF",
            "GIT_COMMITTER_EMAIL": f"magma@{self.s.git_author_email_domain}",
        }
        if self.s.git_ssh_key_file:
            known = self.dir.parent / "git_known_hosts"
            env["GIT_SSH_COMMAND"] = (
                f"ssh -i {self.s.git_ssh_key_file} -o IdentitiesOnly=yes "
                f"-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile={known}"
            )
        return env

    def _auth(self) -> list[str]:
        if not self.s.git_token:
            return []
        cred = base64.b64encode(f"{self.s.git_username}:{self.s.git_token}".encode()).decode()
        # passed per call, never written to .git/config
        return ["-c", f"http.extraHeader=Authorization: Basic {cred}"]

    def git(self, *args: str, env: dict | None = None, remote: bool = False, check=True) -> str:
        cmd = ["git", *(self._auth() if remote else []), *args]
        p = subprocess.run(
            cmd,
            cwd=self.dir,
            env={**self._env(), **(env or {})},
            capture_output=True,
            text=True,
            timeout=120,
        )
        if check and p.returncode != 0:
            msg = (p.stderr or p.stdout).strip().replace(self.s.git_token or "\0", "***")
            raise GitError(f"git {args[0]}: {redact(msg)}")
        return p.stdout.strip()

    def ok(self, *args: str, remote: bool = False) -> bool:
        return (
            subprocess.run(
                ["git", *(self._auth() if remote else []), *args],
                cwd=self.dir,
                env=self._env(),
                capture_output=True,
                timeout=120,
            ).returncode
            == 0
        )

    def prepare(self) -> None:
        """Create the working copy on first use and bring it up to date with the remote."""
        self.dir.mkdir(parents=True, exist_ok=True)
        b = self.s.git_branch
        if not (self.dir / ".git").is_dir():
            self.git("init", "-q", "-b", b)
            self.git("remote", "add", "origin", self.s.git_remote_url)
        else:
            self.git("remote", "set-url", "origin", self.s.git_remote_url)
        self.git("config", "user.name", "MaGMa UCF")
        self.git("config", "user.email", f"magma@{self.s.git_author_email_domain}")
        self.git("fetch", "-q", "origin", remote=True)
        if self.ok("rev-parse", "-q", "--verify", f"refs/remotes/origin/{b}"):
            if not self.ok("rev-parse", "-q", "--verify", "HEAD"):
                self.git("checkout", "-q", "-B", b, f"origin/{b}")
            elif not self.ok("rebase", "-q", f"origin/{b}"):
                self.git("rebase", "--abort", check=False)
                raise GitError(
                    f"Local commits do not apply on top of origin/{b}. Someone changed the same "
                    "files in the repository; resolve it there or reset the working copy."
                )

    def exported(self) -> dict[str, str]:
        """Magma commit sha -> git commit sha for everything reachable from HEAD."""
        if not self.ok("rev-parse", "-q", "--verify", "HEAD"):
            return {}
        out = self.git("log", f"--format=%H %(trailers:key={TRAILER},valueonly,separator=)")
        pairs = (line.split() for line in out.splitlines())
        return {p[1]: p[0] for p in pairs if len(p) == 2}

    def push(self, tags: list[str]) -> None:
        b = self.s.git_branch
        for attempt in range(3):
            if self.ok("push", "-q", "origin", f"HEAD:refs/heads/{b}", remote=True):
                break
            self.git("fetch", "-q", "origin", remote=True)
            if not self.ok("rebase", "-q", f"origin/{b}"):
                self.git("rebase", "--abort", check=False)
                raise GitError(f"Push rejected and rebase onto origin/{b} failed")
            if attempt == 2:
                self.git("push", "-q", "origin", f"HEAD:refs/heads/{b}", remote=True)
        if tags:
            self.git(
                "push", "-q", "--force", "origin", *[f"refs/tags/{t}" for t in tags], remote=True
            )


def path_for(db: Session, c: ConfigCommit) -> tuple[str, str]:
    if c.l3_id:
        l3 = db.get(L3UseCase, c.l3_id)
        l2 = l3.parent
        code = l3.code
        rel = f"usecases/{l2.parent.code}/{l2.code}/{l3.code}.yaml"
    else:
        l2 = db.get(L2UseCase, c.l2_id)
        code = l2.code
        rel = f"usecases/{l2.parent.code}/{l2.code}/{l2.code}.yaml"
    return code, rel


README = """# MaGMa use case configurations

This repository is written by the MaGMa UCF web application. Every configuration commit made in
the app appears here as a git commit with the same author, date and message. Tags are named
`<use case>/<tag>`, for example `AO-CRE-01/verified-2026-11-13`.

Layout: `usecases/<L1>/<L2>/<L2>.yaml` for an L2 use case and `usecases/<L1>/<L2>/<L3>.yaml`
for an L3 rule. Changes made directly in this repository are not read back into the app.
"""


def sync(db: Session, settings: Settings) -> Result:
    repo = Repo(settings)
    repo.prepare()
    res = Result()
    done = repo.exported()
    todo = [
        c
        for c in db.scalars(select(ConfigCommit).order_by(ConfigCommit.created_at, ConfigCommit.id))
        if c.sha not in done
    ]
    readme = repo.dir / "README.md"
    if not readme.exists():
        readme.write_text(README)
        repo.git("add", "README.md")
        repo.git("commit", "-q", "-m", "Add README")
    for c in todo:
        code, rel = path_for(db, c)
        f = repo.dir / rel
        if c.content.strip():
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(c.content if c.content.endswith("\n") else c.content + "\n")
            repo.git("add", "--", rel)
        elif f.exists():
            repo.git("rm", "-q", "--", rel)
        when = c.created_at if c.created_at.tzinfo else c.created_at.replace(tzinfo=UTC)
        msg = f"{code}: {c.message}\n\nRevision r{c.rev} in MaGMa UCF.\n\n{TRAILER}: {c.sha}"
        repo.git(
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            msg,
            env={
                "GIT_AUTHOR_NAME": c.author,
                "GIT_AUTHOR_EMAIL": f"{c.author}@{settings.git_author_email_domain}",
                "GIT_AUTHOR_DATE": when.isoformat(),
            },
        )
        res.exported += 1

    done = repo.exported()
    wanted: dict[str, str] = {}
    for t in db.scalars(select(ConfigTag)):
        c = t.commit
        code, _ = path_for(db, c)
        name = f"{code}/{t.name}"
        if c.sha in done and repo.ok("check-ref-format", f"refs/tags/{name}"):
            wanted[name] = done[c.sha]
    local = set(repo.git("tag", "--list").splitlines())
    changed = []
    for name, sha in wanted.items():
        if name not in local or repo.git("rev-list", "-n1", name) != sha:
            repo.git("tag", "-f", name, sha)
            changed.append(name)
    stale = [t for t in local if OUR_TAG.match(t) and t not in wanted]
    repo.push(changed)
    if stale:
        repo.git("push", "-q", "origin", *[f":refs/tags/{t}" for t in stale], remote=True)
        repo.git("tag", "-d", *stale)
    res.tags = len(changed)

    # record the git ids (they can change when a rebase was needed before the push)
    done = repo.exported()
    for c in db.scalars(select(ConfigCommit)):
        if done.get(c.sha) != c.git_sha:
            c.git_sha = done.get(c.sha)
    res.head = repo.git("rev-parse", "HEAD")
    return res


def state(db: Session) -> GitSyncState:
    st = db.get(GitSyncState, 1)
    if st is None:
        st = GitSyncState(id=1)
        db.add(st)
    return st


_lock = threading.Lock()
_pending = threading.Event()
_running = threading.Event()


def run(factory: sessionmaker, settings: Settings) -> Result | None:
    """One sync with its outcome stored in git_sync_state. Raises nothing."""
    with _lock:
        _running.set()
        try:
            with factory() as db:
                st = state(db)
                st.last_attempt_at = datetime.now(UTC)
                try:
                    res = sync(db, settings)
                except (GitError, OSError, subprocess.TimeoutExpired) as e:
                    db.rollback()
                    st = state(db)
                    st.last_attempt_at = datetime.now(UTC)
                    st.last_error = str(e)[:2000]
                    db.commit()
                    log.warning("Git sync failed: %s", e)
                    return None
                st.last_success_at = st.last_attempt_at
                st.last_error = None
                st.head_sha = res.head
                db.commit()
                if res.exported or res.tags:
                    log.info("Git sync: %d commits, %d tags", res.exported, res.tags)
                return res
        finally:
            _running.clear()


def request(factory: sessionmaker, settings: Settings) -> None:
    """Sync in the background; several requests while a sync runs lead to one more run."""
    if not settings.git_enabled:
        return
    _pending.set()
    if _running.is_set():
        return

    def worker() -> None:
        while _pending.is_set():
            _pending.clear()
            run(factory, settings)

    threading.Thread(target=worker, name="gitsync", daemon=True).start()


def running() -> bool:
    return _running.is_set()

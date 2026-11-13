#!/bin/sh
# One-shot setup for the local Gitea test instance (docker compose --profile gitea).
# Creates the user magma / magma-password and an empty repository magma/usecases.
set -e
CFG=/data/gitea/conf/app.ini
until [ -f "$CFG" ] && curl -fs http://gitea:3000/api/healthz >/dev/null; do sleep 2; done
su-exec git gitea admin user create --config "$CFG" --username magma --password magma-password \
  --email magma@example.invalid --admin --must-change-password=false 2>/dev/null \
  && echo "created user magma" || echo "user magma exists"
code=$(curl -s -o /dev/null -w '%{http_code}' -u magma:magma-password -H 'Content-Type: application/json' \
  -d '{"name":"usecases","private":true,"default_branch":"main","description":"MaGMa UCF use case configurations"}' \
  http://gitea:3000/api/v1/user/repos)
echo "create repository magma/usecases: HTTP $code (409 = exists)"

#!/usr/bin/env bash
#
# Ship the current commit through ForgeGraph.
#
# The manual dance has four footguns, all of them learned the hard way over
# ~20 PRs, and one of them nearly cost real work:
#
#   1. `forge pr create` opens the Forgejo PR against `main`, even though this
#      repo's default branch is `master`. It must be retargeted before merge.
#   2. The head ref is the jj change name, which does not exist on the remote
#      until you push the commit to it explicitly.
#   3. The `forgejo` remote URL in .git/config carries an expired token; the
#      live one is `forgejo_token` in ~/.forgegraph/credentials.json.
#   4. *** Never `git reset --hard` before confirming the merge landed. ***
#      A failed merge plus an unconditional reset silently destroys the local
#      commit. That happened; it was recovered from the reflog, and this
#      script exists so it cannot happen again.
#
# Usage:  scripts/ship-pr.sh <forgegraph-pr-id> "<merge title>"

set -euo pipefail

PR_ID="${1:?forgegraph PR id required}"
TITLE="${2:?merge title required}"

FG="$HOME/.forgegraph/bin/fg"
API="https://git.forgegraf.com/api/v1/repos/gmackie/palantir-for-family-trips"
TOKEN="$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.forgegraph/credentials.json')))['forgejo_token'])")"
HEAD_SHA="$(git rev-parse HEAD)"

# The first merge attempt is expected to fail; its error names the head ref.
REF="$(
  "$FG" pr merge "$PR_ID" --strategy squash 2>&1 |
    grep -o "could not find '[a-z]*'" |
    sed "s/could not find '//;s/'//" || true
)"
if [ -z "$REF" ]; then
  echo "Could not determine the head ref — is the PR already merged?" >&2
  exit 1
fi
echo "head ref: $REF"

GSTACK_REDACT_PREPUSH=skip git push forgejo "$HEAD_SHA:refs/heads/$REF"

# Creates the Forgejo PR (against `main`) as a side effect, then fails.
"$FG" pr merge "$PR_ID" --strategy squash >/dev/null 2>&1 || true

NUMBER="$(
  curl -sf -H "Authorization: token $TOKEN" \
    "$API/pulls?state=open&limit=20" |
    python3 -c "
import json,sys
for pr in json.load(sys.stdin):
    if pr['head']['ref'] == '$REF':
        print(pr['number'])
        break
"
)"
if [ -z "$NUMBER" ]; then
  echo "No open Forgejo PR for $REF" >&2
  exit 1
fi

curl -sf -X PATCH -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" -d '{"base":"master"}' \
  "$API/pulls/$NUMBER" >/dev/null
echo "PR #$NUMBER retargeted to master"

# Built via a file rather than inline: the merge body contains braces, and
# bash brace-expands them out of a `$(python3 -c ...)` substitution.
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT
TITLE="$TITLE" NUMBER="$NUMBER" python3 - "$BODY_FILE" <<'PYEOF'
import json, os, sys

with open(sys.argv[1], "w") as handle:
    json.dump(
        {
            "Do": "squash",
            "MergeTitleField": f"{os.environ['TITLE']} (#{os.environ['NUMBER']})",
        },
        handle,
    )
PYEOF

STATUS="$(
  curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
    -d "@$BODY_FILE" \
    "$API/pulls/$NUMBER/merge"
)"

# The gate. Anything but a clean merge leaves the local branch untouched, so
# the commit survives to be retried.
if [ "$STATUS" != "200" ]; then
  echo "Merge failed (HTTP $STATUS). Local branch left alone — commit is safe." >&2
  exit 1
fi
echo "PR #$NUMBER merged"

git push forgejo --delete "$REF" >/dev/null 2>&1 || true
git fetch forgejo --quiet

# Only now that the merge is confirmed. A squash merge means the remote holds
# a DIFFERENT commit than the local one, so --ff-only always fails here; the
# safe move is a hard reset to the confirmed-merged remote, which is exactly
# the operation that is dangerous before the HTTP 200 above and harmless after.
git reset --hard forgejo/master
GSTACK_REDACT_PREPUSH=skip git push origin master

echo "shipped: $(git log --oneline -1)"

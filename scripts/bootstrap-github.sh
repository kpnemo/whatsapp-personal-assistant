#!/usr/bin/env bash
# One-time GitHub repo bootstrap. Requires: gh CLI authenticated as the repo owner/admin.
#
# Usage:
#   scripts/bootstrap-github.sh <owner>/<repo> [maintainer-email]
#
# Or via env:
#   WPA_MAINTAINER_EMAIL=you@example.com scripts/bootstrap-github.sh <owner>/<repo>
#
# What it does:
#   - Sets visibility / description / homepage / topics.
#   - Locks merge method to squash only, enables auto-merge + delete-on-merge.
#   - Enables wiki, issues, discussions, projects.
#   - Enables secret scanning, push protection, dependabot security updates,
#     private vulnerability reporting.
#   - Protects `main`: signed commits, linear history, required status checks,
#     1 review + CODEOWNERS review, admins enforced, no force push / delete.
#   - Seeds Discussion categories ("Announcements").
#   - Replaces <CONTACT-EMAIL> placeholder in CODE_OF_CONDUCT.md with the
#     provided maintainer email (skipped if no email given and placeholder
#     is still present — a WARNING is printed in that case).

set -euo pipefail

REPO="${1:?usage: bootstrap-github.sh <owner>/<repo> [maintainer-email]}"
MAINTAINER_EMAIL="${2:-${WPA_MAINTAINER_EMAIL:-}}"

# --- Preflight --------------------------------------------------------------

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI not found. Install from https://cli.github.com/" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COC_PATH="${REPO_ROOT}/CODE_OF_CONDUCT.md"

# --- CODE_OF_CONDUCT.md contact email ---------------------------------------

if [ -f "$COC_PATH" ] && grep -q '<CONTACT-EMAIL>' "$COC_PATH"; then
  if [ -n "$MAINTAINER_EMAIL" ]; then
    # Cross-platform sed in-place (BSD vs GNU).
    if sed --version >/dev/null 2>&1; then
      sed -i "s|<CONTACT-EMAIL>|${MAINTAINER_EMAIL}|g" "$COC_PATH"
    else
      sed -i '' "s|<CONTACT-EMAIL>|${MAINTAINER_EMAIL}|g" "$COC_PATH"
    fi
    echo "Replaced <CONTACT-EMAIL> in CODE_OF_CONDUCT.md with ${MAINTAINER_EMAIL}"
    echo "Remember to commit this change: git add CODE_OF_CONDUCT.md && git commit -m \"docs: set CoC contact email\""
  else
    echo "WARNING: CODE_OF_CONDUCT.md still contains <CONTACT-EMAIL>. Pass an email as the second arg or set WPA_MAINTAINER_EMAIL before shipping publicly." >&2
  fi
fi

# --- Repo settings ----------------------------------------------------------

OWNER="${REPO%%/*}"
NAME="${REPO##*/}"

gh repo edit "$REPO" \
  --visibility public \
  --description "Open-source self-hosted personal AI assistant for WhatsApp" \
  --homepage "https://${OWNER}.github.io/${NAME}" \
  --add-topic whatsapp \
  --add-topic baileys \
  --add-topic claude \
  --add-topic anthropic \
  --add-topic self-hosted \
  --add-topic typescript \
  --add-topic docker

# Merge method + branch hygiene
gh repo edit "$REPO" --enable-squash-merge --enable-auto-merge --delete-branch-on-merge
gh api -X PATCH "repos/${REPO}" \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false >/dev/null

# Enable features
gh api -X PATCH "repos/${REPO}" \
  -F has_wiki=true \
  -F has_issues=true \
  -F has_discussions=true \
  -F has_projects=true >/dev/null

# --- Security features ------------------------------------------------------

gh api -X PATCH "repos/${REPO}" \
  -f "security_and_analysis[secret_scanning][status]=enabled" \
  -f "security_and_analysis[secret_scanning_push_protection][status]=enabled" \
  -f "security_and_analysis[dependabot_security_updates][status]=enabled" >/dev/null

# Private vulnerability reporting
gh api -X PUT "repos/${REPO}/private-vulnerability-reporting" >/dev/null

# --- Branch protection on main ---------------------------------------------

gh api -X PUT "repos/${REPO}/branches/main/protection" \
  -F "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=ci / lint" \
  -f "required_status_checks[contexts][]=ci / typecheck" \
  -f "required_status_checks[contexts][]=ci / test" \
  -f "required_status_checks[contexts][]=ci / build" \
  -f "required_status_checks[contexts][]=codeql / analyze (javascript-typescript)" \
  -f "required_status_checks[contexts][]=secret-scan / gitleaks" \
  -F "enforce_admins=true" \
  -F "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "required_pull_request_reviews[dismiss_stale_reviews]=true" \
  -F "required_pull_request_reviews[require_code_owner_reviews]=true" \
  -F "required_linear_history=true" \
  -F "required_signatures=true" \
  -F "allow_force_pushes=false" \
  -F "allow_deletions=false" >/dev/null

# --- Seed Discussions categories -------------------------------------------

REPO_NODE_ID="$(gh api "repos/${REPO}" --jq .node_id)"

gh api graphql -f query='
mutation($repo: ID!) {
  createDiscussionCategory(input: {
    repositoryId: $repo,
    name: "Announcements",
    emoji: ":mega:",
    description: "Maintainer-only announcements",
    isAnswerable: false
  }) { category { id } }
}' -F repo="$REPO_NODE_ID" || true

# (Projects v2 creation left to UI — `gh projects create` is flaky. A one-liner
#  for experienced users is documented in docs/CONTRIBUTING.md.)

echo "Bootstrap complete for ${REPO}."

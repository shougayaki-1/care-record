# Independent security scheduler

This is the independent scheduler for Issue #160. The user confirmed the Workers Free plan;
check current usage before changes that may incur additional costs. The worker needs a repository-limited
fine-grained GitHub token with Actions read/write and the approved production Discord webhook,
stored as Cloudflare secrets. Actions write can operate other Actions workflows in this
repository; it is not limited to this workflow. Set an expiration and rotate the token.
Never commit, print, or put either secret in a URL or command argument.

Each invocation reads recent main-branch runs and requires a successful production collection
step within 20 minutes, requests a main-branch workflow dispatch, and sends a fixed Japanese
warning to Discord if the check or dispatch fails. The check runs before the dispatch, so a
newly requested run cannot prove its own success; a later invocation must verify it. Warnings
repeat on every invocation while the problem persists. A successful dispatch response does not
prove that a job started or completed. This checks production only: staging is currently
inactive. Existing GitHub scheduling can cause duplicate runs; the existing environment-level
concurrency remains in force. GitHub API rate limits or an unavailable Discord webhook can
prevent verification or notification; inspect Cloudflare invocation failures as well.

Before enabling, test the worker with synthetic responses, verify secret scope and destination,
confirm the plan and usage, then observe multiple real scheduled runs and the production
collection step. Test failure delivery without exposing real credentials or personal data.
This scheduler does not detect a simultaneous Cloudflare and Discord outage, nor does it fix
missing Firewall data or prove application log ingestion health.

# Security and secrets

## What is public
- The repository is public: source, docs, art sources and the whole history, including each commit's author name and email. Public is not open: the licence is all rights reserved (`LICENSE`). Versions published before 2026-10-03 carried the MIT licence, and anyone who took a copy of those keeps the rights MIT gave them.
- The game is a static site. Every player's browser downloads all of `dist/` (minified code, models, textures), so the shipped game is readable no matter whether the repository is public or private.
- The game has no server, no accounts and no keys. Nothing in it is secret, and it must stay that way: anything put in the game code ships to every player.

## Where a secret goes
| Secret used by | Put it in | Read it with |
| --- | --- | --- |
| A tool or script on your machine | `.env` (git ignores it; copy `.env.example`) | `process.env.NAME`, run as `node --env-file-if-exists=.env tools/x.mjs` |
| The GitHub Pages build | GitHub: Settings > Secrets and variables > Actions | `${{ secrets.NAME }}` in the workflow (as `pages.yml` already does with `GITHUB_TOKEN`) |
| The game in the browser | Nowhere | A feature that needs a key (online saves, a leaderboard, an AI call) needs a small server or serverless function that holds the key; the game calls that function, never the provider |

Vite passes variables named `VITE_*` to the game code and writes their values into the build, so they are public. Never give a secret a `VITE_` name.

## The guard
`tools/check-secrets.mjs` looks for key files by name (`.env`, `*.pem`, `id_rsa`, `credentials.json`, ...) and for secret-looking text (GitHub, Anthropic, OpenAI, AWS, Google, Slack, Stripe and npm token formats, private key blocks, passwords inside URLs, quoted values assigned to names like `apiKey` or `password`). It runs:

| When | Command | Checks |
| --- | --- | --- |
| Every commit | `.githooks/pre-commit` | the staged files, as staged |
| Every `npm run test:unit`, so every Pages deploy | `tests/secrets.test.mjs` | every tracked file; also that `.env` is ignored |
| After every `npm run build`, so every Pages deploy | `postbuild` | the built game in `dist/`, including any value from a local `.env` that leaked into it |
| On demand | `npm run secrets` | every tracked file |

`npm install` points git at `.githooks/` (the `prepare` script). On a clone where that did not run: `git config core.hooksPath .githooks`. `git commit --no-verify` skips the hook, but the tests and the deploy build still check. A false alarm on one line: add the comment `secrets-ok` to that line.

## If a secret leaks
1. Revoke or rotate it with the provider first. Once it is in a public commit, assume it has been copied: bots scan new public commits within minutes, and deleting the commit afterwards does not undo that.
2. Move it to `.env` and remove it from the code in a new commit. With the key revoked there is no need to rewrite history (CLAUDE.md: history is never rewritten on shared branches).

## Audit, 2026-10-03
All 502 tracked files and all 102 commits on every branch: no keys, tokens, passwords or key files. The tools read only test settings from the environment. Commit author emails are public: a personal address shows on the PR #1 merge (made on github.com) and the Mac's network name on earlier commits. History is not rewritten, so these stay. Since 2026-10-03 this repo commits as `pederotto <210900141+pederotto@users.noreply.github.com>` (repo git config; set it again on a new clone). Merges done on github.com use the account's email unless GitHub: Settings > Emails > "Keep my email addresses private" is on.

# Nanoditor

A mobile-first web app for working on your own machine from your phone: browse and edit files, write notes in an Obsidian vault, and do day-to-day git work across many repos.

It runs in one Docker container (a Go binary with the React app embedded) and is reachable only over [Tailscale](https://tailscale.com). Access is limited to your Tailscale identity. There are no passwords and no database server: app state lives in a SQLite file in `data/`.

## Requirements

- A Linux host with Docker (with Compose) and Tailscale running.
- A phone (or any other device) on the same tailnet.
- `make`. For development you also need Go 1.26+ and Node 22+.

## Setup

```sh
git clone <this repo> nanoditor && cd nanoditor
cp .env.example .env
$EDITOR .env      # set ALLOWED_LOGINS, HOST_HOME, ALLOWED_ROOTS, PUID/PGID, TZ
make up
```

The variables in `.env`:

| Variable | Meaning |
|---|---|
| `ALLOWED_LOGINS` | Tailscale logins allowed in (comma-separated), e.g. `you@example.com` |
| `HOST_HOME` | Your home folder on the host, e.g. `/home/you`. It is mounted at the same path in the container |
| `ALLOWED_ROOTS` | Folders the app may read and write (comma-separated). Must be inside `HOST_HOME` or `/mnt` |
| `PUID`, `PGID` | Your host user and group IDs (`id -u`, `id -g`), so new files are owned by you |
| `PORT` | Port to listen on (default `7777`) |
| `TZ` | Timezone for daily notes and capture timestamps, e.g. `Europe/Berlin` |
| `DEV_TRUST_LOCAL` | Development only: also trust requests from `127.0.0.1` |

## Use it

Open `http://<tailscale-ip>:7777` (or `http://<machine-name>:7777` with MagicDNS) on your phone with Tailscale connected. `make up` prints the address. On iPhone, Safari → Share → **Add to Home Screen** gives you a full-screen app icon.

Everything follows the **workspace**, the folder you open in Files (**Open folder…**, like VS Code):

- **Git** lists only the repos inside the workspace: the folder itself if it is a repo, otherwise every repo below it (up to its *scan depth*). Switching workspace switches the list.
- **Notes** opens the workspace's own **vault**. Set it in Settings → This workspace: detected Obsidian vaults (folders with `.obsidian`) are offered, or pick any folder. Open notes appear as tabs, Obsidian-style.
- **Settings → This workspace** (vault, daily-notes folder, inbox file, git scan depth, dotfiles) is saved **per workspace, independently**. Only the theme is app-wide.

## What it does

| Tab | Features |
|---|---|
| Files | Workspaces; folder browser with git status badges; rendered Markdown; syntax-highlighted code (wrap / line numbers); images, PDF, media; editor with a keyboard toolbar; name and content search (ripgrep); new / rename / delete (to trash); copy path or contents |
| Notes | Per-workspace vault; tabs for open notes (switching saves first); quick capture to `Inbox.md` or today's daily note; recent notes; vault browser; Markdown editor with a formatting toolbar; preview with `[[wikilinks]]`; 2-second autosave; one-tap copy |
| Git | Repos inside the open workspace, dirty ones first; changes grouped as staged / unstaged / untracked / conflicts; stage, unstage, discard per file or **per hunk**; commit, amend, commit & push; fetch / pull (ff-only or rebase) / push; branches (switch, create, track remote); stashes; history with commit diffs |

Safety rails:

- Saves detect when another editor (or Obsidian) changed a file after you opened it (409 conflict sheet).
- Unsaved edits persist as drafts on the device.
- Deletes and discarded untracked files move to `data/trash/`.
- Read-only git commands never take `index.lock`, so they don't fight VS Code.

## Security model

- The container uses host networking and listens on `0.0.0.0:7777`. A Docker port mapping would rewrite Tailscale peers' source IPs to the bridge gateway, which breaks the identity check. **Every request** except `/api/healthz` is checked with tailscaled's WhoIs API. The caller must be a tailnet device logged in as an address in `ALLOWED_LOGINS`. LAN and other addresses get 403.
- Mutating requests also need an `X-ND: 1` header (CSRF guard).
- All paths are confined to `ALLOWED_ROOTS` (symlinks are resolved first), and writes inside `.git/` are refused.
- Traffic is plain HTTP inside the WireGuard tunnel. Because it's HTTP, iOS treats the page as a non-secure context, so the app uses a clipboard fallback and has no offline service worker. To get HTTPS, run `tailscale serve --bg --https=8443 http://127.0.0.1:7777`; no code changes needed.
- The app can read and write anything in `ALLOWED_ROOTS` and runs git with your credentials, so keep `ALLOWED_LOGINS` to yourself.

## Operate

```sh
make up       # build and (re)start
make logs     # follow logs (every API call is logged with the caller's IP)
make down     # stop
make test     # go vet + go test, tsc + vitest
make dev      # API on :7778 + Vite on :7779 (also reachable from the phone)
```

The container runs as `PUID:PGID` and mounts `HOST_HOME` at the same path, so `~/.gitconfig`, `~/.git-credentials` (the `store` helper) and `~/.ssh` behave exactly as on the host. It also mounts `/mnt` (for other disks) and `/var/run/tailscale` read-only for WhoIs.

## Layout

```
backend/   Go: cmd/nanoditor (main), internal/{auth,pathsafe,fsapi,notes,gitx,store,httpapi}
frontend/  React + Vite + Tailwind + CodeMirror 6
data/      SQLite db + trash (gitignored)
```

## Known limits

- **Git hooks run inside the container.** It has git, ssh and ripgrep, but no Node/Python. A pre-commit hook that needs `npx`/`python` fails there. Commit from the host for those repos, or add the runtime to the Dockerfile.
- No GPG commit signing.
- No line-level staging (hunk-level only), no merge-conflict editor (resolve by editing the file, then stage it).

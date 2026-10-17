# Nanoditor

A mobile-first web app for working on your own machine from your phone: browse, read and edit files (code and Markdown notes alike), and do day-to-day git work across many repos.

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
| `TZ` | Timezone for commit times and log timestamps, e.g. `Europe/Berlin` |
| `TERMINAL` | `on` adds the Terminal page (off by default; see [Terminal](#terminal)) |
| `TERMINAL_USER` | Account the terminal logs in as, if it isn't the name of your home folder |
| `TERMINAL_SSH` | Where the host's SSH server listens (default `127.0.0.1:22`) |
| `DEV_TRUST_LOCAL` | Development only: also trust requests from `127.0.0.1` |

## Use it

Open `http://<tailscale-ip>:7777` (or `http://<machine-name>:7777` with MagicDNS) on your phone with Tailscale connected. `make up` prints the address. On iPhone, Safari → Share → **Add to Home Screen** gives you a full-screen app icon.

Everything follows the **workspace**, the folder you open in Files (**Open folder…**, like VS Code):

- **Git** lists only the repos inside the workspace: the folder itself if it is a repo, otherwise every repo below it (up to its *scan depth*). Switching workspace switches the list.
- **Files** opens every file, notes and code alike, in one editor with a tab bar, so you can jump between a note, a config file and an image in one tap. Tabs are kept per workspace on the device.
- **`[[wikilinks]]`** in Markdown work like in Obsidian: a link is looked up in the Obsidian vault that holds the note (the nearest folder with `.obsidian`), otherwise anywhere in the workspace. No setup needed.
- **Settings → This workspace** (git scan depth, dotfiles) is saved **per workspace, independently**. Theme and autosave are app-wide.

## What it does

| Tab | Features |
|---|---|
| Files | Workspaces; folder browser with git status badges; tabs for open files (switching saves first); rendered Markdown with `[[wikilinks]]`; syntax-highlighted code (wrap / line numbers); images, PDF, media; read or edit in place with a keyboard toolbar (arrow keys with Shift to select, select next match like ⌘D); Save button within thumb reach (and ⌘S), optional autosave (Settings → App); unsaved edits stay with their tab until saved or discarded; name and content search (ripgrep); new / rename / delete (to trash); copy path or contents |
| Terminal | Optional (`TERMINAL=on`). Your own login shell on the machine (fish, zsh, bash: whatever your account uses), several at once; shells keep running while you're away and their output replays when you return; a key row with Esc, Tab, sticky Ctrl and arrows |
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
- The terminal, when on, is full shell access as you. The terminal WebSocket can't carry the `X-ND` header, so it checks that the `Origin` is the app itself. The app never changes SSH access: you add its key yourself, restricted to connections from the machine and to a shell (no forwarding).

## Terminal

The Terminal page runs your own login shell on the machine, with your usual environment. The app runs in a container, so it reaches the machine over SSH to `localhost` as you; the SSH server starts whatever shell your account uses.

1. Make sure an SSH server runs on the machine (`sudo apt install openssh-server` on Debian/Ubuntu).
2. Set `TERMINAL=on` in `.env` and run `make up`.
3. Open the Terminal tab. It shows a one-line command that adds the app's key to `~/.ssh/authorized_keys`; run it on the machine, then tap **check**.

The key is limited with `from="127.0.0.1,::1"` and `no-port-forwarding,no-agent-forwarding,no-X11-forwarding`. To revoke access, delete the line ending in `nanoditor-terminal`. The app's private key is `data/terminal_ed25519`, and it pins the machine's SSH host key on first use (`data/terminal_host_key`).

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
backend/   Go: cmd/nanoditor (main), internal/{auth,pathsafe,fsapi,notes,gitx,term,store,httpapi}
frontend/  React + Vite + Tailwind + CodeMirror 6
data/      SQLite db + trash (gitignored)
```

## Known limits

- **Git hooks run inside the container.** It has git, ssh and ripgrep, but no Node/Python. A pre-commit hook that needs `npx`/`python` fails there. Commit from the host for those repos, or add the runtime to the Dockerfile.
- No GPG commit signing.
- Terminal shells live in the app's memory: restarting the container (`make up`) ends them.
- No line-level staging (hunk-level only), no merge-conflict editor (resolve by editing the file, then stage it).

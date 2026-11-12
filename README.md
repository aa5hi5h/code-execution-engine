# CodeBox

Collaborative coding rooms with a real terminal. Supports Python, JavaScript, C++, Java and Go.

- **Editor:** Monaco (VS Code's editor), synced live with Yjs. Two people typing at once merge instead of overwriting each other. Remote cursors and names are shown.
- **Run button:** compiles and runs the code inside your private Docker sandbox (Ctrl/Cmd + Enter). 20 second limit, 256 KB output limit.
- **Terminal:** up to 3 per user, same sandbox, same `/workspace` files the Run button writes to.
- **Cleanup:** a sandbox with no typing/running for 30 minutes is removed. Your files stay in a Docker volume.

## Start

    docker compose up --build

Open http://localhost:3000, sign up, create a room, share the code.

## Re-running / upgrading from the old CodeBox (disk space)

Docker reuses what it already has:

- Base images (postgres, node, docker-cli) are **not** downloaded again.
- Unchanged layers come from cache. Only changed layers are rebuilt:
  the app's npm install (new packages) and the sandbox image (adds g++, Java, Go: roughly 0.7 to 1 GB new).
- The database volume `pgdata` is kept, so users and rooms survive. New columns are added automatically.
- Old sandbox containers are replaced automatically the next time someone opens a terminal or clicks Run.

Keep the folder named `codebox` (or run `docker compose -p codebox up --build`) so Docker finds the same
project and volume. A different folder name creates a separate project with an empty database.

Old images are left behind as `<none>`. Reclaim that space any time with:

    docker image prune -f

## Presenting to other people

The `NEXTAUTH_URL` in `.env` must equal the address people type in their browser.

1. **Only your laptop:** nothing to change.
2. **Same Wi-Fi:** find your IP, set `NEXTAUTH_URL=http://<your-ip>:3000` in `.env`,
   run `docker compose up -d`, share that address. Allow port 3000 in your firewall.
3. **Over the internet, no server needed:** run `docker compose up -d`, then in another terminal
   `cloudflared tunnel --url http://localhost:3000` (free, no account). Put the printed
   `https://...trycloudflare.com` address into `NEXTAUTH_URL` in `.env` and run `docker compose up -d` again.
4. **A VPS:** same as above with your domain behind HTTPS (Caddy or nginx; WebSockets must be allowed).

Tip: open the app and run a sample in each language once before the demo, so everything is warm.

## Security (read before hosting publicly)

The app mounts `/var/run/docker.sock`, which means it controls the host's Docker. That is fine for a
demo with trusted people. For a public service, run sandboxes with gVisor or Sysbox, or on a separate
runner machine. Sandboxes already have memory, CPU and process limits and `no-new-privileges`.
Set `SANDBOX_NETWORK=none` in `.env` to block internet access from inside sandboxes.
Do not reuse the default Postgres password outside a demo.

## Settings (.env)

| Name | Default | Meaning |
| --- | --- | --- |
| NEXTAUTH_SECRET | generated | signs login cookies |
| NEXTAUTH_URL | http://localhost:3000 | public address |
| SANDBOX_MEMORY / SANDBOX_CPUS | 512m / 1 | per-user sandbox limits |
| SANDBOX_IDLE_MINUTES | 30 | idle time before a sandbox is removed |
| SANDBOX_NETWORK | bridge | `none` disables internet in sandboxes |
| RUN_TIMEOUT_SECONDS | 20 | limit for one Run |

# AI Stack - Local LLM Exposed via Cloudflare Tunnel

This Docker Compose stack exposes a local LLM (running on the host at `localhost:1234`) to the internet via Cloudflare Tunnels, with Traefik as the reverse proxy and OpenWebUI as a web interface.

## Architecture

```
Internet
    │
    ▼
Cloudflare (SSL termination)
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Docker Compose Stack (in VM on Apple Silicon)          │
│                                                         │
│   cloudflared ──► traefik ──┬──► openwebui             │
│                             │                           │
│                             └──► lmstudio-proxy ──────┐ │
└─────────────────────────────────────────────────────────┘
                                                          │
                                                          ▼
                                            Host: LM Studio (localhost:1234)
```

## Services

| Service | Description | Local URL | External URL |
|---------|-------------|-----------|--------------|
| **Traefik** | Reverse proxy with basic auth | http://traefik.localhost:8080 | - |
| **OpenWebUI** | Web interface for LLMs | http://openwebui.localhost | https://openwebui.chrislee.dev |
| **LM Studio API** | Direct API access to LLM | http://lmstudio.localhost | https://lmstudio.chrislee.dev |

## Prerequisites

- Docker Desktop for Mac (Apple Silicon)
- LM Studio running on host at `localhost:1234`
- Cloudflare account with a domain configured

## Setup Instructions

### 1. Generate Basic Auth Password

Generate a hashed password for basic authentication:

```bash
# Using htpasswd (install via: brew install httpd-tools)
htpasswd -nB admin

# Or using Docker:
docker run --rm httpd:alpine htpasswd -nB admin
```

You'll be prompted for a password. Copy the entire output (e.g., `admin:$2y$05$...`).

### 2. Create Cloudflare Tunnel

1. Go to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)
2. Navigate to **Networks** → **Tunnels**
3. Click **Create a tunnel**
4. Choose **Cloudflared** as the connector
5. Name your tunnel (e.g., `aistack`)
6. Copy the tunnel token (long string starting with `eyJ...`)

### 3. Configure Cloudflare Tunnel Routes

In the Cloudflare dashboard, add public hostnames for your tunnel:

| Public Hostname | Service | Additional Settings |
|-----------------|---------|---------------------|
| `openwebui.chrislee.dev` | `http://traefik:80` | - |
| `lmstudio.chrislee.dev` | `http://traefik:80` | - |

### 4. Configure DNS (if not using Cloudflare DNS)

If your domain's DNS is managed by Cloudflare and the tunnel is created there, DNS records are usually created automatically. Otherwise, add CNAME records pointing to your tunnel:

```
openwebui.chrislee.dev  CNAME  <tunnel-id>.cfargotunnel.com
lmstudio.chrislee.dev   CNAME  <tunnel-id>.cfargotunnel.com
```

### 5. Fill in Configuration

Edit the `.env` file and fill in the required values:

```bash
# Required - copy your hashed password here
TRAEFIK_BASIC_AUTH_USERS=admin:$2y$05$YOUR_HASHED_PASSWORD_HERE

# Required - your Cloudflare tunnel token
CLOUDFLARE_TUNNEL_TOKEN=eyJ...your-token-here
```

Also update `traefik/dynamic/middlewares.yml` with the same basic auth credentials:

```yaml
users:
  - "admin:$2y$05$YOUR_HASHED_PASSWORD_HERE"
```

## Configuration Files to Edit

| File | What to Edit |
|------|--------------|
| `.env` | `TRAEFIK_BASIC_AUTH_USERS` - Basic auth credentials |
| `.env` | `CLOUDFLARE_TUNNEL_TOKEN` - Your tunnel token |
| `traefik/dynamic/middlewares.yml` | `users` - Same basic auth credentials |

## Starting the Stack

Once all configuration is complete:

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Check status
docker compose ps
```

## Accessing Services

### Local Access (No Authentication Required)

Add these entries to your `/etc/hosts` for local testing:

```
127.0.0.1  traefik.localhost
127.0.0.1  openwebui.localhost
127.0.0.1  lmstudio.localhost
```

Then access:
- Traefik Dashboard: http://traefik.localhost:8080
- OpenWebUI: http://openwebui.localhost
- LM Studio API: http://lmstudio.localhost

### External Access (Basic Authentication Required)

- OpenWebUI: https://openwebui.chrislee.dev
- LM Studio API: https://lmstudio.chrislee.dev

You'll be prompted for the username and password you configured.

## Testing the LM Studio API

```bash
# Local (no auth)
curl http://lmstudio.localhost/v1/models

# External (with auth)
curl -u admin:yourpassword https://lmstudio.chrislee.dev/v1/models
```

## Folder Structure

```
aistack/
├── docker-compose.yml      # Main compose file
├── .env                    # Environment variables (secrets)
├── README.md               # This file
├── traefik/
│   ├── traefik.yml         # Traefik static configuration
│   └── dynamic/
│       └── middlewares.yml # Traefik dynamic config (auth)
├── cloudflared/
│   └── config.yml          # Reference config (not used with token)
├── openwebui/
│   └── data/               # OpenWebUI persistent data (created on first run)
└── lmstudio-proxy/
    └── nginx.conf          # Nginx config for proxying to host LLM
```

## Data Persistence

OpenWebUI data is persisted in `./openwebui/data/` which contains:

| File/Directory | Contents |
|----------------|----------|
| `webui.db` | SQLite database with users, chats, settings, model configs |
| `uploads/` | Files uploaded in conversations |
| `cache/` | Model and response cache |

**Your data survives:**
- `docker compose down` and `docker compose up`
- `docker compose down -v` (volumes flag doesn't affect bind mounts)
- Container recreation/updates

**Your data is lost if you:**
- Delete the `./openwebui/data/` directory
- Run `docker compose down` from a different directory

### Backing Up

```bash
# Create a backup
cp -r ./openwebui/data ./openwebui/data-backup-$(date +%Y%m%d)

# Or just the database
cp ./openwebui/data/webui.db ./openwebui/webui.db.backup
```

### Restoring

```bash
# Stop the stack
docker compose down

# Restore from backup
rm -rf ./openwebui/data
cp -r ./openwebui/data-backup-YYYYMMDD ./openwebui/data

# Start again
docker compose up -d
```

## Troubleshooting

### Can't reach LM Studio from containers

The stack uses `host.docker.internal` to reach the host machine. Ensure:
1. LM Studio is running and listening on `localhost:1234`
2. LM Studio's server is configured to accept connections (check CORS settings)

### Cloudflare tunnel not connecting

1. Verify your tunnel token is correct in `.env`
2. Check cloudflared logs: `docker compose logs cloudflared`
3. Ensure the tunnel is active in Cloudflare dashboard

### Basic auth not working

1. Ensure the password hash in `middlewares.yml` matches `.env`
2. The hash must be bcrypt format (starts with `$2y$`)
3. Restart Traefik after changes: `docker compose restart traefik`

## Disabling Basic Auth

Once you have API tokens set up for your services (e.g., OpenWebUI's built-in auth), you can disable the basic auth layer:

1. Edit `.env` and change:
   ```bash
   # Comment out the auth middleware
   # EXTERNAL_MIDDLEWARES=auth@file

   # Enable the no-auth passthrough
   EXTERNAL_MIDDLEWARES=noauth@file
   ```

2. Restart the stack:
   ```bash
   docker compose up -d
   ```

External access will now bypass basic auth, relying solely on each service's own authentication.

## Security Notes

- Basic auth protects external access; local network access has no auth
- The `.env` file contains secrets - don't commit it to version control
- Consider adding `.env` to `.gitignore`
- OpenWebUI has its own authentication system (enabled by default)
- When disabling basic auth, ensure your services have their own authentication enabled

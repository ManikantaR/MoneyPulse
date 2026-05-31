# Ollama on the Mac, MoneyPulse on the NAS

> **Why**: The NAS has limited resources; the M1 Mac is far better for LLM/vision inference. So Ollama runs on the Mac and the NAS API calls it over the LAN. AI stays on user-owned hardware (no third-party cloud).
>
> **The connection that must work**: the NAS API runs **inside a Docker container** → it must reach the Mac at `http://<MAC_IP>:11434`. Proving "the NAS host can ping the Mac" is **not** enough — test from *inside the container*.

```
┌─────────────── NAS (10.140.2.x) ───────────────┐         ┌──── Mac (M1, LAN) ────┐
│  docker: moneypulse-api  ──OLLAMA_URL──────────────────▶  ollama serve           │
│            (bridge network, NATs to LAN via host)│  :11434  OLLAMA_HOST=0.0.0.0   │
└─────────────────────────────────────────────────┘         └───────────────────────┘
```

---

## Run Ollama NATIVELY on macOS (not in a container)

**Decision: native macOS Ollama, not Podman/Docker.** Two reasons:
- **GPU**: containers on macOS run in a Linux VM with **no access to Apple's Metal GPU** (Ollama's container GPU support is CUDA/ROCm only). Containerized = **CPU-only**, much slower. Native macOS Ollama uses the M1 GPU via Metal.
- **Networking**: Podman/Docker on macOS forwards published ports through a VM (gvproxy), which typically binds the Mac host's **`127.0.0.1` only** — so the NAS can't reach it on the LAN even with `-p 11434:11434`. Native Ollama binds the LAN directly via `OLLAMA_HOST=0.0.0.0`.

### Migrating from a Podman/Docker Ollama container
```bash
podman ps                      # find the ollama container
podman stop <ollama_container> # free port 11434 (and disable autostart if set)
brew install ollama            # or download from https://ollama.com/download
# models in the container do NOT carry over — re-pull natively:
ollama pull mistral:7b
```
Then follow "On the Mac" below. Verify the LAN binding with `lsof -nP -iTCP:11434 -sTCP:LISTEN` → must show `*:11434`/`0.0.0.0`, not `127.0.0.1:11434`.

---

## The connection requirements (all four must hold)

1. **Ollama listens on the LAN, not loopback.** Default binds `127.0.0.1` only → unreachable from the NAS. Must be `OLLAMA_HOST=0.0.0.0:11434`.
2. **The Mac's IP is stable.** Use a router **DHCP reservation** (or static IP). A lease change silently breaks `OLLAMA_URL`.
3. **No firewall/VLAN blocks 11434** between the NAS and the Mac. macOS Application Firewall must allow incoming connections for Ollama; if the Mac and NAS are on different VLANs, the inter-VLAN rule must allow `NAS → MAC_IP:11434/tcp`.
4. **The Mac is awake (network-reachable).** A sleeping laptop drops the connection — handled gracefully by the retry logic (Prompt 7), but for reliability keep it awake (see below).

---

## Setup

### On the Mac
```bash
# 1. LAN IP (note it; should be routable from the NAS):
ipconfig getifaddr en0      # try en1 for Wi-Fi if empty

# 2. Pull the model the NAS expects (compose default OLLAMA_MODEL=mistral:7b):
ollama pull mistral:7b

# 3. Bind Ollama to the LAN, persistently across app restarts:
launchctl setenv OLLAMA_HOST "0.0.0.0:11434"
#    then QUIT and reopen the Ollama menu-bar app so it picks up the env.
#    (Quick one-off instead: OLLAMA_HOST=0.0.0.0:11434 ollama serve)
```
- **Reserve the IP** in your router's DHCP settings.
- If the macOS firewall is on: System Settings → Network → Firewall → Options → allow incoming for Ollama.

### Keep the Mac reachable (don't let it nap)
System Settings → Battery / Energy:
- **Prevent automatic sleeping when the display is off** (on power adapter).
- Enable **Wake for network access** / **Power Nap** if available.
- Or run `caffeinate -s` while it's acting as the AI host.

The retry logic (Prompt 7) tolerates the Mac sleeping — categorization just catches up when it wakes. Keep-awake only matters if you want AI to run *immediately* at all hours.

### On the NAS
1. Repo-root `~/repo/MyMoney/.env` (shipped to the NAS by `deploy-to-nas.sh`, persists across redeploys):
   ```
   OLLAMA_URL=http://<MAC_IP>:11434
   ```
2. Ensure the NAS compose (`/volume1/docker/docker-compose.moneypulse.yml`) maps `OLLAMA_URL` into both the `api` and `pdf-parser` services (`OLLAMA_URL: ${OLLAMA_URL:-...}`). The repo `docker-compose.yml` already does — verify the NAS one and add if missing.
3. Recreate:
   ```bash
   ssh nas "cd /volume1/docker && docker compose -f docker-compose.moneypulse.yml \
     --env-file /volume1/docker/moneypulse/repo/.env up -d --force-recreate api pdf-parser"
   ```

---

## Verify the connection — LAYERED (this is the important part)

Run these in order. The **container-level** test is the one that matters; the others isolate where a failure is.

```bash
# Layer 1 — Mac is serving on the LAN (run on the Mac):
curl -s http://localhost:11434/api/tags | head -c 200          # Ollama up locally?

# Layer 2 — NAS HOST can reach the Mac (run from your Mac via ssh):
ssh nas "curl -s http://<MAC_IP>:11434/api/tags | head -c 200"  # LAN/VLAN/firewall OK?

# Layer 3 — the CONTAINER can reach the Mac (THE decisive test):
ssh nas "docker exec moneypulse-api curl -s http://<MAC_IP>:11434/api/tags | head -c 200"

# Layer 4 — the app sees it:
ssh nas "docker exec moneypulse-api printenv OLLAMA_URL"        # = http://<MAC_IP>:11434
#   then GET /api/health → should report ollama: connected
```

Interpreting failures:
- **Layer 1 fails** → Ollama isn't running, or `OLLAMA_HOST` not set to `0.0.0.0` (only bound to loopback).
- **Layer 1 ok, Layer 2 fails** → firewall on the Mac, wrong IP, or a VLAN rule blocking `NAS → MAC:11434`.
- **Layer 2 ok, Layer 3 fails** → container networking. Bridge containers normally reach LAN IPs fine; if not, check the NAS Docker network mode. (Do NOT use `mac.local` — `*.local` mDNS does not resolve inside a bridge container; use the IP.)
- **Layer 3 ok, Layer 4 wrong** → `OLLAMA_URL` not mapped in the NAS compose, or container not recreated after the `.env` change.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/api/health` shows `ollama: unavailable` | Mac asleep, IP changed, or `OLLAMA_HOST` loopback-only | Wake Mac; confirm DHCP reservation; set `OLLAMA_HOST=0.0.0.0:11434` |
| Works from NAS host, not from container | container networking / used `.local` | Use the Mac **IP** in `OLLAMA_URL`, not mDNS |
| Worked, then stopped after days | Mac DHCP lease changed | Reserve the IP in the router |
| Categorization never runs while Mac asleep | the retry/reconcile (Prompt 7) not yet deployed | deploy Prompt 7 |

---

## Security & privacy
- Transaction descriptions now travel over the **LAN** to the Mac. Both are user-owned devices — still no third-party cloud, consistent with the project's "AI stays on user hardware" principle. It is plaintext HTTP on a trusted home LAN.
- Ollama has **no authentication**. Bind it to the LAN and rely on network trust + firewall. **Never** expose `11434` to the WAN / port-forward it.
- Keep `OLLAMA_URL` in env only — never hardcode the Mac IP in code.

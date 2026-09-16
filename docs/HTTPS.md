# HTTPS and existing HTTP installations

These changes are implemented in the security-hardening branch. Use a release or
image explicitly containing them; older v0.1.5 images do not acquire new behavior
merely by setting these variables.

Margin's server speaks HTTP behind your TLS terminator. It now rejects non-local
HTTP access with status 426 unless you explicitly enable the private-network
exception below. This includes login, notes, audio, and the web page. Health checks
remain available. Sample mode is unauthenticated and must stay on loopback.

## Before upgrading

1. Set a unique `MARGIN_PASSWORD` of at least 16 characters. Prefer a password-manager
   generated password or a long passphrase. Empty, short, repeated-character, and
   example placeholder values prevent startup. Length alone is not proof of strength.
2. Configure HTTPS and the exact trusted proxy address, or consciously choose the
   temporary HTTP exception. Update the Compose file as well as `.env`: Compose
   must pass `TRUSTED_PROXIES` and `ALLOW_INSECURE_HTTP` into the container. If using
   a custom migration file, copy those environment entries from the current profile.
3. Keep the existing project name, `.env`, and data/model volumes. Do not use
   `docker compose down -v`. Restart Margin after changing its environment.

## HTTPS reverse proxy

Use a hostname and certificate trusted by every client. A private VPN with an
HTTPS endpoint also works. Keep direct port 8787 access restricted to the proxy
and local administration. For a proxy on another host, firewall 8787 to that host;
encrypt or otherwise protect that proxy-to-Margin network segment too.

Example Caddy configuration for a proxy running on the Docker host:

```caddyfile
margin.example.com {
    reverse_proxy 127.0.0.1:8787 {
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-For {remote_host}
    }
    # Add only after HTTPS works reliably for this hostname.
    header Strict-Transport-Security "max-age=31536000"
}
```

Replace the hostname with yours. Certificate issuance requires correct DNS and
an appropriate ACME challenge setup; see [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).
The example assumes Caddy directly receives client connections, not a CDN or
another proxy. For a containerized Caddy on Margin's Docker network, use
`margin:8787` as the upstream and keep that network private.

Configure Margin:

```dotenv
BIND_ADDRESS=127.0.0.1
COOKIE_SECURE=true
TRUSTED_PROXIES=REPLACE_WITH_EXACT_PROXY_PEER_IP
ALLOW_INSECURE_HTTP=false
ALLOWED_ORIGINS=https://margin.example.com
```

Use `COOKIE_SECURE=true` for HTTPS setups to retain Secure cookies on older images as well.

`TRUSTED_PROXIES` means the **socket peer address Margin sees**, not the public
browser IP or the hostname. For native Node plus a same-host proxy this is normally
`127.0.0.1` or `::1`. For Docker it may be the bridge gateway (host proxy) or the
proxy container's IP (shared Docker network). Inspect your Docker networking and
reserve a stable proxy address. Do not trust every address or guess a CIDR.

Only exact IPs are supported. The proxy must overwrite `X-Forwarded-Proto` and
`X-Forwarded-For`, stripping incoming client values. This version supports a single
trusted proxy, not automatic parsing of multi-proxy forwarding chains. Caddy's
[reverse-proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
explains header handling. Other proxies need equivalent configuration.

Margin accepts `X-Forwarded-Proto: https` only from a trusted peer. `COOKIE_SECURE=auto`
sets Secure cookies for that traffic; legacy `false` cannot disable Secure on
verified HTTPS. `true` forces Secure even on HTTP (which can prevent HTTP login).
`ALLOWED_ORIGINS` permits an external browser origin when needed; it does not prove
TLS or make an untrusted proxy trustworthy.

Use HTTPS for `ABS_URL` whenever that connection crosses an untrusted network.
The Audiobookshelf token travels on that connection, separately from the user's
Margin password/session. Do not disable certificate verification.

## Explicit private-network HTTP exception

If you intentionally use HTTP inside an isolated network or encrypted VPN tunnel:

```dotenv
ALLOW_INSECURE_HTTP=true
COOKIE_SECURE=auto
# Bind only the intended private/VPN interface, not every interface.
BIND_ADDRESS=YOUR_PRIVATE_INTERFACE_IP
```

This acknowledges the risk; it does **not** encrypt HTTP. It applies to all requests
reaching this server, so restrict the listener and firewall. Do not use it on public
Wi-Fi or expose the listener to the Internet. Release Android builds still require
HTTPS; a server-side exception does not relax Android's transport policy.

Direct native Node development over loopback needs no exception. Docker port
forwarding can change the socket peer even when the published port is loopback;
use the explicit exception only for a host-only test installation if necessary.

## Verify and troubleshoot

- Open the HTTPS address, sign in, and confirm audio, notes, and browser reload work.
- Check that the login cookie has Secure, HttpOnly, and SameSite=Strict attributes.
- Direct network HTTP should return 426 unless the exception is enabled. A proxy
  returning 426 usually means its socket IP or forwarding headers are misconfigured.
- Repeated failed logins return 429 with `Retry-After`. Each source has a 10/minute
  budget with increasing failure backoff; a shared 100/minute budget bounds
  distributed attempts. Correctly configure proxy client-IP forwarding so clients
  do not all share one source. Limits cannot prevent every denial of service.
- Restarting revokes sessions. Active sessions are capped at 1,024; sign out of
  unused clients or restart if a session-flood exhausts the cap.

If you previously used plain HTTP over an untrusted network, change your Margin
password and restart to revoke its sessions. Rotate the Audiobookshelf API token
if its own connection was exposed or compromise is suspected. This hardening is
not evidence that an installation was compromised.

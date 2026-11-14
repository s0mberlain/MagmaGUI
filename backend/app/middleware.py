"""ASGI middleware: security headers on every response, the client address for the audit log
and a cap on the request body size."""

import logging

from app import audit

log = logging.getLogger("magma.proxy")

# The SPA loads only its own scripts and styles; React sets inline style attributes, the QR code
# and charts are inline SVG, downloads use data: URLs.
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; "
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
)
# Swagger UI (signed-in users only) is served by the app itself (swagger-ui-bundle package); its
# start-up code is an inline script.
DOCS_CSP = (
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"
)


class BodyTooLarge(Exception):
    pass


class SecurityHeaders:
    def __init__(self, app, hsts: bool = False, max_body: int = 0):
        self.app = app
        self.hsts = hsts
        self.max_body = max_body  # bytes, 0 = no limit
        self._proxy_warned = False

    def _check_proxy(self, scope, client) -> None:
        """A reverse proxy whose address is not in FORWARDED_ALLOW_IPS: every user then has the
        proxy's address, in the audit log and for the failed sign-in limit (20 wrong passwords
        from anyone would block sign-in for all)."""
        if self._proxy_warned or not client:
            return
        fwd = dict(scope.get("headers") or []).get(b"x-forwarded-for")
        if fwd and client[0] not in [p.strip() for p in fwd.decode("latin-1").split(",")]:
            self._proxy_warned = True
            log.warning(
                "Requests arrive through a reverse proxy at %s that is not trusted, so every "
                "user appears with that address (audit log, sign-in limit). Set "
                "FORWARDED_ALLOW_IPS to the proxy's address.",
                client[0],
            )

    async def _too_large(self, send) -> None:
        body = b'{"detail":"The request is too large"}'
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"connection", b"close"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        client = scope.get("client")
        self._check_proxy(scope, client)
        too_large = False
        if self.max_body:
            length = dict(scope.get("headers") or []).get(b"content-length")
            if length and length.isdigit() and int(length) > self.max_body:
                return await self._too_large(send)
            # without (or with a wrong) Content-Length: count what actually arrives
            seen = 0
            inner_receive = receive

            async def receive():
                nonlocal seen, too_large
                message = await inner_receive()
                if message["type"] == "http.request":
                    seen += len(message.get("body", b""))
                    if seen > self.max_body:
                        too_large = True
                        raise BodyTooLarge
                return message

        token = audit.client_ip.set(client[0] if client else None)
        csp = DOCS_CSP if scope.get("path") == "/api/docs" else CSP

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {k.lower() for k, _ in headers}
                extra = [
                    (b"content-security-policy", csp.encode()),
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"same-origin"),
                    (b"cross-origin-opener-policy", b"same-origin"),
                    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
                ]
                if self.hsts:
                    extra.append((b"strict-transport-security", b"max-age=31536000"))
                headers += [(k, v) for k, v in extra if k not in present]
                message["headers"] = headers
            await send(message)

        started = False
        inner_send = send_with_headers

        async def tracking_send(message):
            nonlocal started
            if too_large:
                # the framework turns the aborted read into its own error answer: send ours
                if not started:
                    started = True
                    await self._too_large(send)
                return
            started = True
            await inner_send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except BodyTooLarge:
            if not started:
                await self._too_large(send)
        finally:
            audit.client_ip.reset(token)

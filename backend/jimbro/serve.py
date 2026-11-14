"""Run the JimBro app on HTTPS (browser PWA: camera needs a secure origin) and plain LAN
HTTP (Expo Go: React Native rejects the Pi's self-signed certificate) in ONE process,
so live rep events from either side reach subscribers on the other.

    python -m jimbro.serve        # settings from JIMBRO_PORT, JIMBRO_HTTP_PORT, JIMBRO_TLS_*
"""

from __future__ import annotations

import asyncio
import os

import uvicorn


def listener_configs(
    app: object, https_port: int, http_port: int, certfile: str, keyfile: str
) -> list[uvicorn.Config]:
    def config(port: int, cert: str | None = None, key: str | None = None) -> uvicorn.Config:
        return uvicorn.Config(
            app,  # type: ignore[arg-type]
            host="0.0.0.0",
            port=port,
            ssl_certfile=cert,
            ssl_keyfile=key,
            ws_ping_interval=20.0,
            server_header=False,
        )

    configs = []
    if https_port and certfile and keyfile:
        configs.append(config(https_port, certfile, keyfile))
    if http_port:
        configs.append(config(http_port))
    if not configs:
        raise ValueError("no listener configured: set a TLS cert/key or JIMBRO_HTTP_PORT")
    return configs


async def serve(configs: list[uvicorn.Config]) -> None:  # pragma: no cover - runs servers
    servers = [uvicorn.Server(c) for c in configs]
    await asyncio.gather(*(s.serve() for s in servers))


def main() -> None:  # pragma: no cover - process entry point
    from .api import app

    env = os.environ
    configs = listener_configs(
        app,
        https_port=int(env.get("JIMBRO_PORT", "443")),
        http_port=int(env.get("JIMBRO_HTTP_PORT", "0")),
        certfile=env.get("JIMBRO_TLS_CERT", ""),
        keyfile=env.get("JIMBRO_TLS_KEY", ""),
    )
    asyncio.run(serve(configs))


if __name__ == "__main__":  # pragma: no cover
    main()

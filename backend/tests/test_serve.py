"""One process serves HTTPS (PWA camera) and LAN HTTP (Expo Go) so both share one event bus."""

import pytest

from jimbro.serve import listener_configs


def test_https_and_http_listeners_share_one_app() -> None:
    app = object()
    configs = listener_configs(
        app, https_port=443, http_port=8080, certfile="/c.crt", keyfile="/c.key"
    )
    assert [(c.port, c.ssl_certfile) for c in configs] == [(443, "/c.crt"), (8080, None)]
    assert all(c.app is app and c.host == "0.0.0.0" for c in configs)


def test_http_listener_is_optional() -> None:
    configs = listener_configs(object(), https_port=443, http_port=0, certfile="/c", keyfile="/k")
    assert [c.port for c in configs] == [443]


def test_without_certificate_https_is_skipped() -> None:
    configs = listener_configs(object(), https_port=443, http_port=8080, certfile="", keyfile="")
    assert [(c.port, c.ssl_certfile) for c in configs] == [(8080, None)]


def test_needs_at_least_one_listener() -> None:
    with pytest.raises(ValueError):
        listener_configs(object(), https_port=443, http_port=0, certfile="", keyfile="")

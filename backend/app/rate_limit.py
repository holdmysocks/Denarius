from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request


def client_ip(request: Request) -> str:
    """Identify the real client behind the bundled nginx proxy.

    The backend port is never published; every request arrives through nginx,
    so ``request.client.host`` is always nginx's container address and all
    clients would share one rate-limit bucket. nginx overwrites ``X-Real-IP``
    with ``$remote_addr`` on every proxied request (see nginx/nginx.conf), so
    a client cannot spoof it through the proxy. Requests that reach uvicorn
    directly (local development) fall back to the socket peer address.
    """
    real_ip = request.headers.get("x-real-ip", "").strip()
    return real_ip or get_remote_address(request)


# Process-local in-memory limiter. For multi-worker deployments swap the
# storage_uri to a redis:// URL.
limiter = Limiter(key_func=client_ip)

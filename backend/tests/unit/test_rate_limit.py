import unittest

from starlette.requests import Request

from app.rate_limit import client_ip


def _request(headers: dict[str, str], peer: str = "172.18.0.5") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/login",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
            "client": (peer, 51234),
        }
    )


class ClientIpTests(unittest.TestCase):
    def test_uses_the_address_nginx_saw(self):
        self.assertEqual(client_ip(_request({"X-Real-IP": "192.168.1.20"})), "192.168.1.20")

    def test_distinct_clients_behind_nginx_get_distinct_buckets(self):
        a = client_ip(_request({"X-Real-IP": "192.168.1.20"}))
        b = client_ip(_request({"X-Real-IP": "192.168.1.21"}))
        self.assertNotEqual(a, b)

    def test_falls_back_to_socket_peer_without_proxy(self):
        self.assertEqual(client_ip(_request({}, peer="127.0.0.1")), "127.0.0.1")

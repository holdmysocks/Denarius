import unittest

from pydantic import ValidationError

from app.routers.notifications import SubscriptionIn, _is_push_service


class PushEndpointAllowlistTests(unittest.TestCase):
    def test_real_push_services_are_accepted(self):
        for url in (
            "https://web.push.apple.com/QGx1Y2t5",
            "https://fcm.googleapis.com/fcm/send/abc:def",
            "https://updates.push.services.mozilla.com/wpush/v2/abc",
            "https://wns2-par02p.notify.windows.com/w/?token=abc",
        ):
            with self.subTest(url=url):
                self.assertTrue(_is_push_service(url))

    def test_other_hosts_and_plain_http_are_rejected(self):
        for url in (
            "http://fcm.googleapis.com/fcm/send/abc",
            "https://evil.example.com/push",
            "https://fcm.googleapis.com.evil.example.com/x",
            "https://notpush.apple.com/x",
            "https://localhost/x",
            "https://169.254.169.254/latest/meta-data",
            "not a url",
        ):
            with self.subTest(url=url):
                self.assertFalse(_is_push_service(url))

    def test_subscription_schema_rejects_unknown_endpoint(self):
        with self.assertRaises(ValidationError):
            SubscriptionIn(endpoint="https://example.com/x", keys={"p256dh": "a", "auth": "b"})


class VapidSubjectTests(unittest.TestCase):
    def test_subjects_denarius_produces_pass_the_vapid_check(self):
        from py_vapid import _check_sub

        for subject in ("mailto:owner@example.com", "mailto:admin@localhost", "https://denarius.example.com"):
            with self.subTest(subject=subject):
                self.assertTrue(_check_sub(subject))

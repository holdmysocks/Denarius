# Installing Denarius and turning on notifications

Denarius is an installable web app (a PWA). You add it to your home screen or
dock from the browser, with no App Store, and it opens in its own window with
its own icon. Once installed, it can show push notifications for bills coming
due and categories that go over budget, even when the app is closed.

## 1. Serve Denarius over HTTPS

Browsers allow push notifications only on a secure address: `https://…`, or
`http://localhost` on the machine running Docker. A plain
`http://umbrel.local:9723` or `http://100.x.y.z:9723` still works as a website,
but the notification switch stays off with an "HTTPS needed" message.

The simplest setup is **Tailscale Serve**, which gives Denarius a private HTTPS
address on your tailnet with a real certificate:

1. In the Tailscale admin console, under **DNS**, enable **MagicDNS** and
   **HTTPS Certificates**.
2. On the machine running Denarius, run:

   ```bash
   tailscale serve --bg 9723
   ```

   Denarius is now at `https://<machine-name>.<tailnet>.ts.net` on every device
   signed in to your tailnet. On umbrelOS, Tailscale runs as the Tailscale app:
   open **Settings → Advanced settings → Terminal**, choose the **Tailscale**
   app, and run the command there. The setting is saved, so it survives
   restarts. Any other reverse proxy that terminates TLS (Caddy, Traefik,
   Nginx Proxy Manager) works too.

Nothing else changes: you don't need to add the new address to
`ALLOWED_ORIGINS` or redeploy. To turn the HTTPS address off again, run
`tailscale serve --https=443 off`.

## 2. Install the app

| Device | How |
|---|---|
| iPhone / iPad | Open the HTTPS address in **Safari**, tap **Share → Add to Home Screen**, then open Denarius from the new icon. (iOS 16.4 or later.) |
| Android | In Chrome, tap **Install app** when prompted, or **⋮ → Add to Home screen**. |
| Mac | Safari: **File → Add to Dock**. Chrome or Edge: the install icon in the address bar. |
| Windows / Linux | Chrome or Edge: the install icon in the address bar, or **Settings → App & alerts → Install**. |

## 3. Turn on notifications

In the installed app, go to **Settings → App & alerts** and tap **Turn on**.
Allow notifications when asked, then tap **Send test** to check it works.

- **iPhone and iPad only deliver notifications to the installed app.** In a
  Safari tab the switch explains this instead of turning on.
- Turn notifications on separately on each device. Settings shows how many of
  your devices are set up.
- Signing out detaches the device from your account; signing back in
  re-attaches it, so a shared iPad gets whoever is signed in.

### What you'll get

| Alert | When |
|---|---|
| Bills and subscriptions | The day before, on the due date, and once if it's a day overdue. Income items are skipped. |
| Over budget | Once a month per category, when its spending passes the budget. |

Each alert is sent once. Denarius checks every hour from 8am to 9pm in the
app's timezone (Settings → Preferences). You can switch either kind off in
**Settings → App & alerts**.

## How it works

- `frontend/public/sw.js` is the service worker. It shows notifications and
  opens the right page when you tap one. It caches nothing, so a redeploy is
  never hidden behind a stale copy.
- The backend signs each push with a VAPID key pair, generated on first use and
  stored in the database (`app_settings`). Back up the database and
  subscriptions keep working after a restore. If the key is lost, every device
  has to turn notifications on again.
- Pushes go through the browser vendor's push service (Apple, Google, Mozilla
  or Microsoft). The message is end-to-end encrypted to your device, so those
  services can't read it. Subscriptions are only accepted for those services.
- Each push carries a contact address for the push service operator, as the Web
  Push standard requires. By default it is the first admin's email; set
  `VAPID_SUBJECT` (`mailto:you@example.com` or `https://your.host`) to use
  something else.

## Troubleshooting

- **"HTTPS needed"**: you're on a plain `http://` address; see step 1.
- **"Notifications are blocked"**: the device's permission is set to deny.
  iPhone: Settings → Notifications → Denarius. Chrome: the site settings icon
  in the address bar.
- **Test says "No device received it"**: turn notifications off and on again on
  that device. Devices that were uninstalled or reset are removed on their own.

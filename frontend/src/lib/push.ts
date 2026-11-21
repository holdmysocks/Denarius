import api from "@/api/client";

/**
 * Web Push from the installed home-screen app or the browser.
 *
 * The service worker (public/sw.js) shows the notifications; this module
 * registers it and keeps the browser's push subscription in step with the
 * server, so alerts go to whoever is signed in on this device.
 */

export type PushAvailability =
  /** Ready to turn on. */
  | "available"
  /** Served over plain http (not localhost): browsers only allow push over https. */
  | "insecure"
  /** iPhone/iPad in a Safari tab: push only works after Add to Home Screen. */
  | "ios-needs-install"
  /** The browser has no Web Push at all. */
  | "unsupported";

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports itself as a Mac; tell them apart by touch support.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushAvailability(): PushAvailability {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  const hasPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIos() && !isStandalone()) return "ios-needs-install";
  return hasPush ? "available" : "unsupported";
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed", err);
    });
  });
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const left = new Uint8Array(a);
  return left.length === b.length && left.every((byte, i) => byte === b[i]);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function saveSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  await api.post("/notifications/subscriptions", { endpoint: json.endpoint, keys: json.keys });
}

/** True when this browser has a push subscription and permission is granted. */
export async function isPushEnabledHere(): Promise<boolean> {
  if (pushAvailability() !== "available" || Notification.permission !== "granted") return false;
  return (await currentSubscription()) !== null;
}

/** Ask for permission, subscribe this device and register it with the server. */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for Denarius. Allow them in your browser or device settings, then try again."
        : "Notification permission was not granted.",
    );
  }

  const { data } = await api.get<{ public_key: string }>("/notifications/vapid-public-key");
  const serverKey = base64UrlToBytes(data.public_key);

  const registration =
    (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  // A subscription made for a different server key (another Denarius
  // install on this origin, say) can't receive our pushes; replace it.
  if (subscription && !sameKey(subscription.options.applicationServerKey, serverKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: serverKey,
  });
  await saveSubscription(subscription);
}

/** Stop push on this device, both in the browser and on the server. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await api.post("/notifications/unsubscribe", { endpoint });
}

/**
 * After sign-in, re-register this device's existing subscription so alerts go
 * to the account now signed in here. Silent: nothing happens unless the user
 * turned notifications on earlier.
 */
export async function syncPushSubscription(): Promise<void> {
  try {
    if (pushAvailability() !== "available" || Notification.permission !== "granted") return;
    const subscription = await currentSubscription();
    if (subscription) await saveSubscription(subscription);
  } catch (err) {
    console.warn("Could not sync push subscription", err);
  }
}

/**
 * On sign-out, detach this device from the account so the next person to use
 * it doesn't get the previous user's alerts. Takes the access token up front
 * because the auth store is cleared before this request goes out. The browser
 * subscription itself is kept, so signing back in re-attaches it.
 */
export function detachPushOnSignOut(accessToken: string | null): void {
  if (!accessToken || pushAvailability() !== "available") return;
  void (async () => {
    try {
      const subscription = await currentSubscription();
      if (!subscription) return;
      await fetch(`${api.defaults.baseURL ?? ""}/notifications/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        keepalive: true,
      });
    } catch {
      // Best effort: the server drops dead subscriptions on its own.
    }
  })();
}

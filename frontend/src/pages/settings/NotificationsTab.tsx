import { useEffect, useState, useSyncExternalStore } from "react";
import { isAxiosError } from "axios";
import { Bell, BellOff, Download, Info, Send, Share, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  usePushSettings,
  useRefreshPushSettings,
  useSendTestPush,
  useUpdatePushSettings,
} from "@/api/pushNotifications";
import { canPromptInstall, onInstallPromptChange, promptInstall } from "@/lib/install";
import { disablePush, enablePush, isIos, isPushEnabledHere, isStandalone, pushAvailability } from "@/lib/push";

function errorText(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function InstallCard() {
  const canPrompt = useSyncExternalStore(onInstallPromptChange, canPromptInstall, () => false);
  const installed = isStandalone();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Download className="h-4 w-4" />
          Install on your home screen
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {installed ? (
          <p className="text-muted-foreground">You're using the installed Denarius app.</p>
        ) : isIos() ? (
          <ol className="space-y-2 text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="font-medium text-foreground">1.</span>
              <span>
                Open Denarius in <span className="font-medium text-foreground">Safari</span> and tap{" "}
                <Share className="inline h-4 w-4 -mt-0.5" aria-label="Share" /> Share.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-medium text-foreground">2.</span>
              <span>
                Choose <SquarePlus className="inline h-4 w-4 -mt-0.5" aria-hidden />{" "}
                <span className="font-medium text-foreground">Add to Home Screen</span>, then open Denarius from its
                new icon.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-medium text-foreground">3.</span>
              <span>Come back to this page in the app to turn on notifications.</span>
            </li>
          </ol>
        ) : canPrompt ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-muted-foreground">Add Denarius to this device as an app with its own icon and window.</p>
            <Button size="sm" onClick={() => void promptInstall()}>
              Install
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">
            Use your browser's menu to install: <span className="font-medium text-foreground">Install app</span> or{" "}
            <span className="font-medium text-foreground">Add to Home screen</span> in Chrome and Edge,{" "}
            <span className="font-medium text-foreground">Add to Dock</span> in Safari on a Mac.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PushCard() {
  const availability = pushAvailability();
  const { data: settings, isError, refetch } = usePushSettings();
  const updateSettings = useUpdatePushSettings();
  const refreshSettings = useRefreshPushSettings();
  const sendTest = useSendTestPush();

  const [enabledHere, setEnabledHere] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void isPushEnabledHere().then((on) => {
      if (!cancelled) setEnabledHere(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleHere() {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      if (enabledHere) {
        await disablePush();
        setEnabledHere(false);
      } else {
        await enablePush();
        setEnabledHere(true);
      }
      await refreshSettings();
    } catch (err) {
      setError(errorText(err, "Couldn't change notifications on this device."));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTestResult(null);
    setError(null);
    try {
      const { delivered } = await sendTest.mutateAsync();
      setTestResult(
        delivered > 0
          ? `Sent to ${delivered} device${delivered === 1 ? "" : "s"}.`
          : "No device received it. Turn notifications off and on again here.",
      );
      await refreshSettings();
    } catch (err) {
      setError(errorText(err, "Couldn't send a test notification."));
    }
  }

  function setPref(field: "push_bills" | "push_budgets", value: boolean) {
    if (!settings) return;
    setError(null);
    updateSettings.mutate(
      { push_bills: settings.push_bills, push_budgets: settings.push_budgets, [field]: value },
      { onError: (err) => setError(errorText(err, "Couldn't save your notification choices.")) },
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="h-4 w-4" />
          Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {availability === "insecure" && (
          <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              Browsers only allow notifications on a secure (https://) address. Open Denarius through HTTPS, for example
              with Tailscale Serve, to turn them on. The README explains how.
            </p>
          </div>
        )}
        {availability === "ios-needs-install" && (
          <p className="text-muted-foreground">
            On iPhone and iPad, notifications work only in the installed app. Add Denarius to your home screen first
            (above), then open it from there.
          </p>
        )}
        {availability === "unsupported" && (
          <p className="text-muted-foreground">This browser doesn't support web notifications.</p>
        )}

        {availability === "available" && (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">This device</p>
              <p className="text-xs text-muted-foreground">
                {enabledHere === null
                  ? "Checking…"
                  : enabledHere
                    ? "Notifications are on here."
                    : "Get bill reminders and budget alerts on this device."}
              </p>
            </div>
            <Button
              size="sm"
              variant={enabledHere ? "outline" : "default"}
              disabled={busy || enabledHere === null}
              onClick={() => void toggleHere()}
            >
              {enabledHere ? <BellOff className="h-4 w-4 mr-1.5" /> : <Bell className="h-4 w-4 mr-1.5" />}
              {enabledHere ? "Turn off" : "Turn on"}
            </Button>
          </div>
        )}

        {isError ? (
          <div className="flex items-center gap-3">
            <p className="text-destructive">Couldn't load your notification settings.</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : settings ? (
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">Bills and subscriptions</p>
                <p className="text-xs text-muted-foreground">The day before, the day it's due, and if it goes overdue.</p>
              </div>
              <Switch
                checked={settings.push_bills}
                onCheckedChange={(v) => setPref("push_bills", v)}
                disabled={updateSettings.isPending}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">Over budget</p>
                <p className="text-xs text-muted-foreground">Once a month when a category goes over its budget.</p>
              </div>
              <Switch
                checked={settings.push_budgets}
                onCheckedChange={(v) => setPref("push_budgets", v)}
                disabled={updateSettings.isPending}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-4">
              <p className="text-xs text-muted-foreground">
                {settings.device_count === 0
                  ? "No devices are set up for your account yet."
                  : `${settings.device_count} device${settings.device_count === 1 ? "" : "s"} set up for your account. Alerts are checked hourly from 8am to 9pm.`}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={settings.device_count === 0 || sendTest.isPending}
                onClick={() => void test()}
              >
                <Send className="h-4 w-4 mr-1.5" />
                Send test
              </Button>
            </div>
          </div>
        ) : null}

        {testResult && <p className="text-xs text-muted-foreground">{testResult}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

export default function NotificationsTab() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <InstallCard />
      <PushCard />
    </div>
  );
}

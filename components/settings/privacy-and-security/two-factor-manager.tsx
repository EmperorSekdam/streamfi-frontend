"use client";

import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

const ENROLL_ENDPOINT = "/api/auth/two-factor/enroll";

type StatusState = "loading" | "ready" | "error";

interface Enrollment {
  secret: string;
  otpauthUrl: string;
}

async function requestJson(
  init: RequestInit,
  fallbackError: string
): Promise<Record<string, unknown>> {
  const response = await fetch(ENROLL_ENDPOINT, { cache: "no-store", ...init });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : fallbackError
    );
  }
  return data;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function normalizeTotpInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

export default function TwoFactorManager() {
  const [status, setStatus] = useState<StatusState>("loading");
  const [enabled, setEnabled] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const data = await requestJson(
        { method: "GET" },
        "Unable to load two-factor status"
      );
      setEnabled(data.enabled === true);
      setStatus("ready");
    } catch (cause) {
      setError(errorMessage(cause, "Unable to load two-factor status"));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause, fallback));
    } finally {
      setBusy(false);
    }
  }

  const beginEnrollment = () =>
    run(async () => {
      const data = await requestJson(
        { method: "POST" },
        "Unable to start enrollment"
      );
      if (
        typeof data.secret !== "string" ||
        typeof data.otpauthUrl !== "string"
      ) {
        throw new Error("Unable to start enrollment");
      }
      setCode("");
      setEnrollment({ secret: data.secret, otpauthUrl: data.otpauthUrl });
    }, "Unable to start enrollment");

  const confirmEnrollment = () =>
    run(async () => {
      const data = await requestJson(
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        },
        "Unable to confirm code"
      );
      setEnabled(true);
      setEnrollment(null);
      setCode("");
      setRecoveryCodes(
        Array.isArray(data.recoveryCodes)
          ? data.recoveryCodes.filter((c): c is string => typeof c === "string")
          : []
      );
    }, "Unable to confirm code");

  const cancelEnrollment = () => {
    setEnrollment(null);
    setCode("");
    setError("");
  };

  const disable = () =>
    run(async () => {
      await requestJson(
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: code.trim() }),
        },
        "Unable to disable two-factor authentication"
      );
      setEnabled(false);
      setCode("");
      setRecoveryCodes([]);
    }, "Unable to disable two-factor authentication");

  const statusLabel =
    status === "loading"
      ? "Checking…"
      : status === "error"
        ? "Status unavailable"
        : enabled
          ? "Enabled"
          : "Not enabled";

  return (
    <section
      aria-labelledby="two-factor-heading"
      className="mb-6 rounded-lg border border-border bg-card p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2
            id="two-factor-heading"
            className="text-highlight text-xl font-medium"
          >
            Two-factor authentication
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a second step with a time-based code from an authenticator app
            (such as Google Authenticator, 1Password, or Authy). Once enabled,
            StreamFi asks for a code before wallet key exports, wallet
            regeneration, and sensitive admin actions.
          </p>
        </div>
        <span
          className={
            status === "ready" && enabled
              ? "text-sm font-medium text-emerald-600"
              : "text-sm text-muted-foreground"
          }
        >
          {statusLabel}
        </span>
      </div>

      {status === "error" && (
        <button
          type="button"
          onClick={() => void loadStatus()}
          className="mt-4 rounded border border-border px-4 py-2 text-sm"
        >
          Retry
        </button>
      )}

      {status === "ready" && !enabled && !enrollment && (
        <button
          type="button"
          onClick={() => void beginEnrollment()}
          disabled={busy}
          className="mt-4 rounded bg-highlight px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? "Starting…" : "Set up authenticator"}
        </button>
      )}

      {enrollment && (
        <div className="mt-4 space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Scan this QR code with your authenticator app.</li>
            <li>Enter the six-digit code the app shows to finish setup.</li>
          </ol>
          <div className="inline-block rounded bg-white p-3">
            <QRCodeSVG
              value={enrollment.otpauthUrl}
              size={176}
              aria-label="Authenticator setup QR code"
              role="img"
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">
              Can&apos;t scan? Enter this setup key manually:
            </p>
            <code className="mt-1 block break-all rounded border border-border bg-background p-3 text-sm">
              {enrollment.secret}
            </code>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={event =>
                setCode(normalizeTotpInput(event.target.value))
              }
              aria-label="Authenticator code"
              placeholder="123456"
              className="w-full max-w-xs rounded border border-border bg-background px-3 py-2"
            />
            <button
              type="button"
              onClick={() => void confirmEnrollment()}
              disabled={busy || code.length !== 6}
              className="rounded bg-highlight px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Confirm and enable"}
            </button>
            <button
              type="button"
              onClick={cancelEnrollment}
              disabled={busy}
              className="rounded border border-border px-4 py-2 text-sm disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {status === "ready" && enabled && recoveryCodes.length === 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            To turn off two-factor authentication, enter a current authenticator
            code or an unused recovery code.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              autoComplete="one-time-code"
              value={code}
              onChange={event => setCode(event.target.value)}
              aria-label="Authenticator or recovery code to disable two-factor authentication"
              className="w-full max-w-xs rounded border border-border bg-background px-3 py-2"
            />
            <button
              type="button"
              onClick={() => void disable()}
              disabled={busy || code.trim().length < 6}
              className="rounded border border-border px-4 py-2 text-sm disabled:opacity-50"
            >
              {busy ? "Disabling…" : "Disable"}
            </button>
          </div>
        </div>
      )}

      {recoveryCodes.length > 0 && (
        <div className="mt-4 rounded border border-amber-500/50 bg-amber-50 p-4 text-amber-950">
          <h3 className="font-semibold">Save these recovery codes now</h3>
          <p className="mt-1 text-xs">
            Each code works once if you lose access to your authenticator. They
            will not be shown again.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
            {recoveryCodes.map(recoveryCode => (
              <li key={recoveryCode}>{recoveryCode}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setRecoveryCodes([])}
            className="mt-3 text-sm underline"
          >
            I saved these codes
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}

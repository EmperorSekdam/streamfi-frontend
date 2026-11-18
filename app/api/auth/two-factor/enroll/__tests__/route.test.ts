jest.mock("@/lib/auth/verify-session", () => ({ verifySession: jest.fn() }));
jest.mock("@/lib/rate-limit", () => {
  const limiter = jest.fn().mockResolvedValue(false);
  return { createRateLimiter: () => limiter, __limiter: limiter };
});
jest.mock("@vercel/postgres", () => ({ sql: jest.fn() }));
jest.mock("@/lib/security/encrypted-secrets", () => ({
  encryptSecret: jest.fn((value: string) => `enc(${value})`),
  decryptSecret: jest.fn((value: string) =>
    value.replace(/^enc\((.*)\)$/, "$1")
  ),
}));
jest.mock("@/lib/security/step-up", () => ({
  verifyTotp: jest.fn(),
  consumeRecoveryCode: jest.fn(),
  totpVerifier: { verify: jest.fn() },
}));
jest.mock("bcryptjs", () => ({
  hash: jest.fn(async (value: string) => `hash(${value})`),
}));
jest.mock("otplib", () => ({
  authenticator: {
    generateSecret: jest.fn(() => "JBSWY3DPEHPK3PXP"),
    keyuri: jest.fn(
      (label: string, issuer: string, secret: string) =>
        `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}`
    ),
  },
}));

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { verifySession } from "@/lib/auth/verify-session";
import {
  consumeRecoveryCode,
  totpVerifier,
  verifyTotp,
} from "@/lib/security/step-up";
import { DELETE, GET, POST, PUT } from "../route";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const limiter = require("@/lib/rate-limit").__limiter as jest.Mock;
const sqlMock = sql as unknown as jest.Mock;
const sessionMock = verifySession as jest.Mock;
const verifyCodeMock = totpVerifier.verify as jest.Mock;
const verifyTotpMock = verifyTotp as jest.Mock;
const recoveryMock = consumeRecoveryCode as jest.Mock;

const URL = "https://streamfi.media/api/auth/two-factor/enroll";

function request(method: string, body?: unknown) {
  return new NextRequest(URL, {
    method,
    headers: { "content-type": "application/json" },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}

function sqlText(call: unknown[]): string {
  return (call[0] as TemplateStringsArray).join("?");
}

function queries(): string[] {
  return sqlMock.mock.calls.map(sqlText);
}

beforeEach(() => {
  jest.clearAllMocks();
  limiter.mockResolvedValue(false);
  sessionMock.mockResolvedValue({ ok: true, userId: "user-1" });
  sqlMock.mockResolvedValue({ rows: [] });
});

describe("authentication and rate limiting", () => {
  it.each([
    ["GET", () => GET(request("GET"))],
    ["POST", () => POST(request("POST"))],
    ["PUT", () => PUT(request("PUT", { code: "123456" }))],
    ["DELETE", () => DELETE(request("DELETE", { code: "123456" }))],
  ])("%s rejects requests without a session", async (_method, call) => {
    sessionMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const response = await call();
    expect(response.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", () => GET(request("GET"))],
    ["POST", () => POST(request("POST"))],
    ["PUT", () => PUT(request("PUT", { code: "123456" }))],
    ["DELETE", () => DELETE(request("DELETE", { code: "123456" }))],
  ])("%s returns 429 when rate limited", async (_method, call) => {
    limiter.mockResolvedValue(true);
    const response = await call();
    expect(response.status).toBe(429);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("reports the persisted enrollment state", async () => {
    sqlMock.mockResolvedValueOnce({ rows: [{ totp_enabled: true }] });
    const response = await GET(request("GET"));
    expect(await response.json()).toEqual({ enabled: true });
  });

  it("treats a missing user row as not enabled", async () => {
    const response = await GET(request("GET"));
    expect(await response.json()).toEqual({ enabled: false });
  });
});

describe("POST (start enrollment)", () => {
  it("refuses to re-enroll while 2FA is already enabled", async () => {
    sqlMock.mockResolvedValueOnce({ rows: [{ totp_enabled: true }] });
    const response = await POST(request("POST"));
    expect(response.status).toBe(409);
    expect(
      queries().some(q => q.includes("INSERT INTO totp_enrollments"))
    ).toBe(false);
  });

  it("stores an encrypted pending secret and returns an otpauth URL labelled with the email", async () => {
    sqlMock
      .mockResolvedValueOnce({ rows: [{ totp_enabled: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ email: "creator@example.com" }] })
      .mockResolvedValueOnce({ rows: [] });
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      secret: "JBSWY3DPEHPK3PXP",
      otpauthUrl:
        "otpauth://totp/StreamFi:creator@example.com?secret=JBSWY3DPEHPK3PXP&issuer=StreamFi",
    });
    const insert = sqlMock.mock.calls.find(call =>
      sqlText(call).includes("INSERT INTO totp_enrollments")
    );
    expect(insert).toBeDefined();
    expect(insert).toContain("enc(JBSWY3DPEHPK3PXP)");
    expect(insert).not.toContain("JBSWY3DPEHPK3PXP");
    expect(queries().some(q => q.includes("UPDATE users SET totp"))).toBe(
      false
    );
  });

  it("falls back to the user id when the account has no email", async () => {
    sqlMock.mockResolvedValueOnce({ rows: [{ totp_enabled: false }] });
    const response = await POST(request("POST"));
    const data = await response.json();
    expect(data.otpauthUrl).toContain("StreamFi:user-1");
  });
});

describe("PUT (confirm enrollment)", () => {
  it("rejects malformed JSON", async () => {
    const response = await PUT(request("PUT", "{not json"));
    expect(response.status).toBe(400);
  });

  it("rejects a non-string code", async () => {
    const response = await PUT(request("PUT", { code: 123456 }));
    expect(response.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("returns 410 when no unexpired enrollment exists", async () => {
    const response = await PUT(request("PUT", { code: "123456" }));
    expect(response.status).toBe(410);
  });

  it("rejects an invalid code without enabling 2FA", async () => {
    sqlMock.mockResolvedValueOnce({
      rows: [{ secret_enc: "enc(JBSWY3DPEHPK3PXP)" }],
    });
    verifyCodeMock.mockReturnValue(false);
    const response = await PUT(request("PUT", { code: "000000" }));
    expect(response.status).toBe(400);
    expect(queries().some(q => q.includes("totp_enabled = true"))).toBe(false);
  });

  it("enables 2FA, stores hashed recovery codes and returns them once", async () => {
    sqlMock.mockResolvedValueOnce({
      rows: [{ secret_enc: "enc(JBSWY3DPEHPK3PXP)" }],
    });
    verifyCodeMock.mockReturnValue(true);
    const response = await PUT(request("PUT", { code: "123 456" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.enabled).toBe(true);
    expect(data.recoveryCodes).toHaveLength(10);
    expect(new Set(data.recoveryCodes).size).toBe(10);
    for (const code of data.recoveryCodes) {
      expect(code).toMatch(/^[0-9A-F]{12}$/);
    }
    expect(verifyCodeMock).toHaveBeenCalledWith({
      token: "123456",
      secret: "JBSWY3DPEHPK3PXP",
    });
    const recoveryInserts = sqlMock.mock.calls.filter(call =>
      sqlText(call).includes("INSERT INTO step_up_recovery_codes")
    );
    expect(recoveryInserts).toHaveLength(10);
    for (const call of recoveryInserts) {
      expect(String(call[2])).toMatch(/^hash\(/);
    }
    expect(queries().some(q => q.includes("totp_enabled = true"))).toBe(true);
    expect(
      queries().some(q =>
        q.includes("DELETE FROM totp_enrollments WHERE user_id")
      )
    ).toBe(true);
  });
});

describe("DELETE (disable)", () => {
  it("rejects malformed JSON", async () => {
    const response = await DELETE(request("DELETE", "{not json"));
    expect(response.status).toBe(400);
  });

  it("rejects a code that is neither a valid TOTP nor an unused recovery code", async () => {
    verifyTotpMock.mockResolvedValue(false);
    recoveryMock.mockResolvedValue(false);
    const response = await DELETE(request("DELETE", { code: "000000" }));
    expect(response.status).toBe(401);
    expect(queries().some(q => q.includes("totp_enabled = false"))).toBe(false);
  });

  it("disables 2FA with a valid authenticator code", async () => {
    verifyTotpMock.mockResolvedValue(true);
    const response = await DELETE(request("DELETE", { code: "123456" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
    expect(recoveryMock).not.toHaveBeenCalled();
    expect(queries().some(q => q.includes("totp_enabled = false"))).toBe(true);
    expect(
      queries().some(q => q.includes("DELETE FROM step_up_recovery_codes"))
    ).toBe(true);
  });

  it("disables 2FA with an unused recovery code", async () => {
    verifyTotpMock.mockResolvedValue(false);
    recoveryMock.mockResolvedValue(true);
    const response = await DELETE(request("DELETE", { code: "ABCDEF123456" }));
    expect(response.status).toBe(200);
    expect(recoveryMock).toHaveBeenCalledWith("user-1", "ABCDEF123456");
  });
});

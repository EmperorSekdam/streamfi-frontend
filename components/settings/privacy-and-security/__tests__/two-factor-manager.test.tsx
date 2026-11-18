import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import TwoFactorManager, { normalizeTotpInput } from "../two-factor-manager";

type MockResponse = { ok: boolean; body: unknown };

const OTPAUTH =
  "otpauth://totp/StreamFi:creator@example.com?secret=JBSWY3DPEHPK3PXP&issuer=StreamFi";

function mockFetch(...responses: MockResponse[]) {
  const fetchMock = jest.fn();
  for (const { ok, body } of responses) {
    fetchMock.mockResolvedValueOnce({ ok, json: async () => body });
  }
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function lastCall(fetchMock: jest.Mock) {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url, init: init as RequestInit };
}

describe("normalizeTotpInput", () => {
  it("keeps at most six digits and strips everything else", () => {
    expect(normalizeTotpInput("12 34-56789")).toBe("123456");
    expect(normalizeTotpInput("abc")).toBe("");
  });
});

describe("TwoFactorManager", () => {
  it("describes two-factor authentication rather than email verification", async () => {
    mockFetch({ ok: true, body: { enabled: false } });
    render(<TwoFactorManager />);
    expect(
      screen.getByRole("heading", { name: "Two-factor authentication" })
    ).toBeInTheDocument();
    expect(screen.getByText(/authenticator app/i)).toBeInTheDocument();
    expect(screen.queryByText(/email/i)).not.toBeInTheDocument();
    await screen.findByText("Not enabled");
  });

  it("does not claim 2FA is off when the status request fails, and can retry", async () => {
    const fetchMock = mockFetch(
      { ok: false, body: { error: "Too many two-factor requests" } },
      { ok: true, body: { enabled: true } }
    );
    render(<TwoFactorManager />);
    expect(await screen.findByText("Status unavailable")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Too many two-factor requests"
    );
    expect(
      screen.queryByRole("button", { name: "Set up authenticator" })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Enabled")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("runs the full enrollment flow: QR code, code confirmation, recovery codes", async () => {
    const fetchMock = mockFetch(
      { ok: true, body: { enabled: false } },
      { ok: true, body: { secret: "JBSWY3DPEHPK3PXP", otpauthUrl: OTPAUTH } },
      {
        ok: true,
        body: {
          enabled: true,
          recoveryCodes: ["AAAAAAAAAAAA", "BBBBBBBBBBBB"],
        },
      }
    );
    render(<TwoFactorManager />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Set up authenticator" })
    );
    expect(
      await screen.findByRole("img", { name: "Authenticator setup QR code" })
    ).toBeInTheDocument();
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(lastCall(fetchMock)).toEqual({
      url: "/api/auth/two-factor/enroll",
      init: expect.objectContaining({ method: "POST" }),
    });

    const confirm = screen.getByRole("button", { name: "Confirm and enable" });
    const input = screen.getByLabelText("Authenticator code");
    fireEvent.change(input, { target: { value: "12345" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: "123 456" } });
    expect(input).toHaveValue("123456");
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    expect(
      await screen.findByText("Save these recovery codes now")
    ).toBeInTheDocument();
    expect(screen.getByText("AAAAAAAAAAAA")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    const { init } = lastCall(fetchMock);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ code: "123456" });
    expect(
      screen.queryByRole("img", { name: "Authenticator setup QR code" })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "I saved these codes" })
    );
    expect(screen.queryByText("AAAAAAAAAAAA")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disable" })).toBeInTheDocument();
  });

  it("keeps 2FA disabled and shows the server error when the code is wrong", async () => {
    mockFetch(
      { ok: true, body: { enabled: false } },
      { ok: true, body: { secret: "JBSWY3DPEHPK3PXP", otpauthUrl: OTPAUTH } },
      { ok: false, body: { error: "Invalid code" } }
    );
    render(<TwoFactorManager />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Set up authenticator" })
    );
    fireEvent.change(await screen.findByLabelText("Authenticator code"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and enable" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid code");
    expect(screen.getByText("Not enabled")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Authenticator setup QR code" })
    ).toBeInTheDocument();
  });

  it("surfaces an expired enrollment so the user can start again", async () => {
    mockFetch(
      { ok: true, body: { enabled: false } },
      { ok: true, body: { secret: "JBSWY3DPEHPK3PXP", otpauthUrl: OTPAUTH } },
      { ok: false, body: { error: "Enrollment expired; start again" } }
    );
    render(<TwoFactorManager />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Set up authenticator" })
    );
    fireEvent.change(await screen.findByLabelText("Authenticator code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and enable" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enrollment expired; start again"
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: "Set up authenticator" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an error when enrollment cannot start, including non-JSON responses", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ enabled: false }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new SyntaxError("bad json");
        },
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<TwoFactorManager />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Set up authenticator" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to start enrollment"
    );
    expect(
      screen.queryByRole("img", { name: "Authenticator setup QR code" })
    ).not.toBeInTheDocument();
  });

  it("rejects an enrollment response that is missing the otpauth URL", async () => {
    mockFetch(
      { ok: true, body: { enabled: false } },
      { ok: true, body: { secret: "JBSWY3DPEHPK3PXP" } }
    );
    render(<TwoFactorManager />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Set up authenticator" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to start enrollment"
    );
  });

  it("disables 2FA with an authenticator or recovery code", async () => {
    const fetchMock = mockFetch(
      { ok: true, body: { enabled: true } },
      { ok: false, body: { error: "Invalid code" } },
      { ok: true, body: { enabled: false } }
    );
    render(<TwoFactorManager />);
    const input = await screen.findByLabelText(/recovery code to disable/i);
    const disable = screen.getByRole("button", { name: "Disable" });
    expect(disable).toBeDisabled();

    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(disable);
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid code");
    expect(screen.getByText("Enabled")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: " ABCDEF123456 " } });
    fireEvent.click(disable);
    await waitFor(() =>
      expect(screen.getByText("Not enabled")).toBeInTheDocument()
    );
    const { init } = lastCall(fetchMock);
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual({ code: "ABCDEF123456" });
    expect(
      screen.getByRole("button", { name: "Set up authenticator" })
    ).toBeInTheDocument();
  });
});

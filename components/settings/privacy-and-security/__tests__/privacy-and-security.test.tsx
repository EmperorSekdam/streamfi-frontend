import { render, screen } from "@testing-library/react";

const walletState: { privyWallet: unknown; publicKey: string | null } = {
  privyWallet: null,
  publicKey: null,
};

jest.mock("@/contexts/stellar-wallet-context", () => ({
  useStellarWallet: () => walletState,
}));

import PrivacySecurityPage from "../PrivacyAndSecurity";

beforeEach(() => {
  walletState.privyWallet = null;
  walletState.publicKey = null;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ enabled: false }),
  }) as unknown as typeof fetch;
});

describe("PrivacySecurityPage", () => {
  it("has no placeholder password, toggle, or save controls", async () => {
    render(<PrivacySecurityPage />);
    await screen.findByText("Not enabled");
    expect(
      screen.queryByRole("button", { name: /change password/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save changes/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Privacy Controls/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Set up authenticator" })
    ).toBeInTheDocument();
  });

  it("does not reuse the email verification copy for two-factor authentication", async () => {
    render(<PrivacySecurityPage />);
    await screen.findByText("Not enabled");
    const emailCopy = screen.getByText(/Confirm your email address/);
    const twoFactorSection = screen
      .getByRole("heading", { name: "Two-factor authentication" })
      .closest("section") as HTMLElement;
    expect(twoFactorSection).not.toContainElement(emailCopy);
    expect(twoFactorSection.textContent).not.toContain(
      emailCopy.textContent ?? ""
    );
  });

  it("shows Google sign-in guidance for Privy users", async () => {
    walletState.privyWallet = { email: "creator@example.com" };
    render(<PrivacySecurityPage />);
    await screen.findByText("Not enabled");
    expect(
      screen.getByRole("link", { name: "Google Account security settings" })
    ).toBeInTheDocument();
  });

  it("shows wallet sign-in guidance for wallet users", async () => {
    walletState.publicKey = "GABC";
    render(<PrivacySecurityPage />);
    await screen.findByText("Not enabled");
    expect(
      screen.getByText(/no\s+StreamFi password to change/i)
    ).toBeInTheDocument();
  });
});

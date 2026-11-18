import { render, screen } from "@testing-library/react";
import SignInMethod, { GOOGLE_SECURITY_URL } from "../sign-in-method";

describe("SignInMethod", () => {
  it("sends Google users to their Google Account security page instead of a fake password flow", () => {
    render(<SignInMethod method="google" />);
    const link = screen.getByRole("link", {
      name: "Google Account security settings",
    });
    expect(link).toHaveAttribute("href", GOOGLE_SECURITY_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      screen.queryByRole("button", { name: /change password/i })
    ).not.toBeInTheDocument();
  });

  it("tells wallet users their wallet key is their credential", () => {
    render(<SignInMethod method="wallet" />);
    expect(
      screen.getByText(/no\s+StreamFi password to change/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("explains that StreamFi has no passwords when the sign-in method is unknown", () => {
    render(<SignInMethod method={null} />);
    expect(
      screen.getByText(/StreamFi does not use passwords/i)
    ).toBeInTheDocument();
  });
});

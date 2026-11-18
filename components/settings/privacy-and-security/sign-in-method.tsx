"use client";

export type SignInMethodKind = "google" | "wallet" | null;

export const GOOGLE_SECURITY_URL = "https://myaccount.google.com/security";

export default function SignInMethod({ method }: { method: SignInMethodKind }) {
  return (
    <section
      aria-labelledby="sign-in-method-heading"
      className="bg-card border border-border mb-6 rounded-lg p-6"
    >
      <h2
        id="sign-in-method-heading"
        className="text-highlight text-xl font-medium mb-2"
      >
        Sign-in method
      </h2>
      {method === "google" && (
        <p className="text-muted-foreground text-sm">
          You sign in to StreamFi with your Google account, so StreamFi does not
          store a password for you. To change your password or review your
          Google sign-in security, visit your{" "}
          <a
            href={GOOGLE_SECURITY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-highlight hover:underline"
          >
            Google Account security settings
          </a>
          .
        </p>
      )}
      {method === "wallet" && (
        <p className="text-muted-foreground text-sm">
          You sign in to StreamFi with your Stellar wallet, so there is no
          StreamFi password to change. Your wallet&apos;s secret key or recovery
          phrase is your credential: keep it offline and never share it.
        </p>
      )}
      {method === null && (
        <p className="text-muted-foreground text-sm">
          StreamFi does not use passwords. You sign in with Google or a Stellar
          wallet; connect one to see how your sign-in is secured.
        </p>
      )}
    </section>
  );
}

import { SignInButton } from "@/components/sign-in-button";

export const dynamic = "force-dynamic";

type SignInPageProps = {
  searchParams: Promise<{
    error?: string;
    callbackUrl?: string;
  }>;
};

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "That Google account is not authorized to use this dashboard. Ask the owner to add it to DASHBOARD_ALLOWED_EMAILS.",
  Configuration:
    "The dashboard auth is not configured correctly. Check NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and DASHBOARD_ALLOWED_EMAILS.",
  Verification: "Sign-in link has expired. Try again.",
  Default: "Sign-in failed. Please try again."
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { error, callbackUrl } = await searchParams;
  const message = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default) : null;

  return (
    <main className="shell">
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          MeetMate
        </div>
      </div>

      <section className="panel" style={{ maxWidth: 480, margin: "4rem auto", padding: "2rem" }}>
        <h1 style={{ marginBottom: "0.5rem" }}>Sign in</h1>
        <p className="subtle" style={{ marginBottom: "1.5rem" }}>
          Sign in with a Google account that has been approved for this MeetMate instance.
        </p>

        {message ? (
          <div
            role="alert"
            style={{
              background: "rgba(220, 38, 38, 0.1)",
              border: "1px solid rgba(220, 38, 38, 0.4)",
              borderRadius: "0.5rem",
              padding: "0.75rem 1rem",
              marginBottom: "1rem",
              color: "rgb(220, 38, 38)"
            }}
          >
            {message}
          </div>
        ) : null}

        <SignInButton callbackUrl={callbackUrl ?? "/"} />
      </section>
    </main>
  );
}

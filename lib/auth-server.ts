import { getServerSession } from "next-auth";

import { authOptions } from "./auth";
import { getAllowedEmails } from "./env";

export type DashboardSession = {
  email: string;
};

/**
 * Server-side guard for API routes. Returns the session if the caller is
 * authenticated AND on the allow list. Returns null otherwise — callers
 * should respond with 401 in that case.
 *
 * The allow list is re-checked here (in addition to the NextAuth signIn
 * callback) so that removing an email from DASHBOARD_ALLOWED_EMAILS takes
 * effect on the next request rather than the next sign-in.
 */
export async function getDashboardSession(): Promise<DashboardSession | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase().trim();

  if (!email) {
    return null;
  }

  const allowed = getAllowedEmails();
  if (allowed.size === 0 || !allowed.has(email)) {
    return null;
  }

  return { email };
}

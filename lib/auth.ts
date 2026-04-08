import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { getAllowedEmails } from "./env";

/**
 * NextAuth v4 configuration for the dashboard.
 *
 * - Google OAuth only.
 * - Sign-in is restricted to emails listed in DASHBOARD_ALLOWED_EMAILS.
 * - JWT sessions (no DB adapter) so we don't need an extra Prisma model.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          prompt: "select_account"
        }
      }
    })
  ],
  session: {
    strategy: "jwt"
  },
  pages: {
    signIn: "/signin",
    error: "/signin"
  },
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase().trim();
      if (!email) {
        return false;
      }
      const allowed = getAllowedEmails();
      if (allowed.size === 0) {
        // Fail closed: if no allow list is configured, refuse sign-in instead
        // of letting any Google account in.
        return false;
      }
      return allowed.has(email);
    },
    async jwt({ token, user }) {
      if (user?.email) {
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.email === "string") {
        session.user.email = token.email;
      }
      return session;
    }
  }
};

/** Pure helper exported for unit tests. */
export function isEmailAllowed(
  email: string | null | undefined,
  allowList: ReadonlySet<string>
): boolean {
  if (!email) return false;
  if (allowList.size === 0) return false;
  return allowList.has(email.toLowerCase().trim());
}

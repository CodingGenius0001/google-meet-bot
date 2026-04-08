export { default } from "next-auth/middleware";

/**
 * Protect every route except the auth handlers, the public sign-in page,
 * the health check, and Next.js internals. The worker calls the database
 * directly, not the dashboard, so locking down API routes does not affect it.
 */
export const config = {
  matcher: [
    "/((?!api/auth|api/health|signin|_next/static|_next/image|favicon.ico).*)"
  ]
};

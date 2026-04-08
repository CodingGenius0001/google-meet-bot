"use client";

import { signOut } from "next-auth/react";

type SignOutButtonProps = {
  email?: string | null;
};

export function SignOutButton({ email }: SignOutButtonProps) {
  return (
    <div className="signout">
      {email ? <span className="subtle">{email}</span> : null}
      <button
        type="button"
        className="ghost-button"
        onClick={() => {
          void signOut({ callbackUrl: "/signin" });
        }}
      >
        Sign out
      </button>
    </div>
  );
}

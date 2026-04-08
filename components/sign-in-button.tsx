"use client";

import { signIn } from "next-auth/react";

type SignInButtonProps = {
  callbackUrl?: string;
};

export function SignInButton({ callbackUrl = "/" }: SignInButtonProps) {
  return (
    <button
      type="button"
      className="primary-button"
      onClick={() => {
        void signIn("google", { callbackUrl });
      }}
    >
      Continue with Google
    </button>
  );
}

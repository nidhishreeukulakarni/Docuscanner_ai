"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import ThemeToggle from "@/components/ThemeToggle";

/**
 * Navbar
 * ------------------------------------------------------------
 * Simple top nav. Kept quiet and out of the way — the product
 * itself is the star, not the chrome around it.
 * ------------------------------------------------------------
 */
export default function Navbar() {
  const router = useRouter();
  const { user, logout } = useAuth();

  return (
    <header className="w-full border-b border-[var(--border-subtle)] bg-[var(--bg)]">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-display text-lg text-[var(--text)] hover:scale-[1.03] transition-transform inline-block">
          DocuSense<span className="text-[var(--accent)]">.</span>
        </Link>

        {user && (
          <nav className="hidden md:flex items-center gap-8 font-body text-sm text-[var(--text-muted)]">
            <Link
              href="/workspace"
              className="hover:text-[var(--text)] hover:scale-[1.05] inline-block transition-all"
            >
              Workspace
            </Link>
          </nav>
        )}

        <div className="flex items-center gap-3">
          <ThemeToggle />

          {user ? (
            <>
              <span className="hidden sm:inline font-mono text-xs text-[var(--text-muted)] truncate max-w-40">
                {user.email}
              </span>
              <button
                onClick={() => {
                  logout();
                  router.push("/");
                }}
                className="font-body text-sm font-medium rounded-md border border-[var(--border-subtle)]
                           text-[var(--text)] px-4 py-2 hover:border-[var(--accent)] hover:text-[var(--accent)]
                           hover:scale-[1.03] active:scale-[0.97] transition-all"
              >
                Log out
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="font-body text-sm font-medium rounded-md bg-[var(--accent)] text-[var(--bg)]
                         px-4 py-2 hover:bg-[var(--accent-strong)] hover:scale-[1.03] active:scale-[0.97]
                         transition-all"
            >
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
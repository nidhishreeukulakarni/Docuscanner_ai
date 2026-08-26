"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

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
    <header className="w-full border-b border-white/10 bg-ink-950">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-display text-lg text-paper-50">
          DocuSense<span className="text-highlight-400">.</span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 font-body text-sm text-slate-400">
          <Link href="/workspace" className="hover:text-paper-50 transition-colors">
            Workspace
          </Link>
          <a href="#how-it-works" className="hover:text-paper-50 transition-colors">
            How it works
          </a>
          <a href="#" className="hover:text-paper-50 transition-colors">
            Pricing
          </a>
        </nav>

        {user ? (
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline font-mono text-xs text-slate-400 truncate max-w-[10rem]">
              {user.email}
            </span>
            <button
              onClick={() => {
                logout();
                router.push("/");
              }}
              className="font-body text-sm font-medium rounded-md border border-white/10 text-paper-50
                         px-4 py-2 hover:bg-white/5 transition-colors"
            >
              Log out
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="font-body text-sm font-medium rounded-md bg-highlight-400 text-ink-950
                       px-4 py-2 hover:bg-highlight-500 transition-colors"
          >
            Log in
          </Link>
        )}
      </div>
    </header>
  );
}
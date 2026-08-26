import { redirect } from "next/navigation";

// Placeholder for the real marketing/landing page — for now, "/" just
// sends people straight into the app. /workspace already redirects to
// /login on its own if there's no session, so this covers both cases.
export default function RootPage() {
  redirect("/workspace");
}
import { redirect } from "next/navigation";

// The app has no public landing page in Phase 1; send visitors to login.
export default function HomePage() {
  redirect("/login");
}

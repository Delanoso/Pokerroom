import { redirect } from "next/navigation";

/** Public sign-up is disabled — operators create accounts from Admin → Players. */
export default function RegisterPage() {
  redirect("/login");
}

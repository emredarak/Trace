import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkPasscode } from "@/lib/demo-auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  async function login(formData: FormData) {
    "use server";
    const code = String(formData.get("passcode") ?? "");
    if (checkPasscode(code)) {
      (await cookies()).set("trace_demo", "1", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
      redirect("/");
    }
    redirect("/login?error=1");
  }

  return (
    <main>
      <h1>Demo girişi</h1>
      {params.error && <p>Hatalı parola.</p>}
      <form action={login}>
        <label htmlFor="passcode">Demo parolası</label>
        <input id="passcode" name="passcode" type="password" required />
        <button type="submit">Giriş</button>
      </form>
    </main>
  );
}

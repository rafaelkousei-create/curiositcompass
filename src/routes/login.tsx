import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { oauthReturnPath } from "@/lib/oauth-return-path";
import "@lovable.dev/cloud-auth-js/styles.css";

export const Route = createFileRoute("/login")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({ next: oauthReturnPath(s["next"]) }),
  head: () => ({ meta: [
    { title: "Sign in — Curiosity Compass" },
    { name: "description", content: "Sign in to securely connect your assistant to Curiosity Compass." },
    { property: "og:title", content: "Sign in — Curiosity Compass" },
    { property: "og:description", content: "Connect your assistant securely with your Curiosity Compass account." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Login,
});

function Login() {
  const { next } = Route.useSearch();
  const [mode, setMode] = useState<"login" | "signup" | "reset" | "password">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const recovery = window.location.hash.includes("type=recovery");
    if (recovery) setMode("password");
    const pending = sessionStorage.getItem("compass-oauth-return");
    const finishSocial = async () => {
      const { data } = await supabase.auth.getSession();
      if (pending && data.session && !recovery) {
        sessionStorage.removeItem("compass-oauth-return");
        window.location.assign(oauthReturnPath(pending));
      }
    };
    void finishSocial();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("password");
      if (event === "SIGNED_IN" && pending && !recovery) {
        sessionStorage.removeItem("compass-oauth-return");
        window.location.assign(oauthReturnPath(pending));
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const returnUrl = new URL(next, window.location.origin).href;
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: returnUrl } });
        if (error) throw error;
        if (data.session) window.location.assign(next);
        else setMessage("Check your email to confirm your account and return to your connection.");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login?next=${encodeURIComponent(next)}` });
        if (error) throw error;
        setMessage("Check your email for a password reset link.");
      } else if (mode === "password") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        window.location.assign(next);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.assign(next);
      }
    } catch (err) { setMessage(err instanceof Error ? err.message : "Sign-in failed. Please try again."); }
    finally { setBusy(false); }
  }

  async function social(provider: "google" | "lovable") {
    setBusy(true); setMessage("");
    sessionStorage.setItem("compass-oauth-return", next);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: `${window.location.origin}/login?next=${encodeURIComponent(next)}` });
      if (result.error) throw result.error;
      if (!result.redirected) {
        sessionStorage.removeItem("compass-oauth-return");
        window.location.assign(next);
      }
    } catch (err) {
      sessionStorage.removeItem("compass-oauth-return");
      setMessage(err instanceof Error ? err.message : "Sign-in failed."); setBusy(false);
    }
  }

  return <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
    <div className="w-full max-w-sm space-y-5">
      <p className="font-display text-sm text-primary">Curiosity Compass</p>
      <h1 className="text-2xl font-semibold">{mode === "signup" ? "Create your account" : mode === "reset" ? "Reset your password" : mode === "password" ? "Choose a new password" : "Sign in to connect"}</h1>
      <form className="space-y-4" onSubmit={submit}>
        {mode !== "password" && <label className="block text-sm">Email<input className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>}
        {mode !== "reset" && <label className="block text-sm">Password<input className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /></label>}
        <Button className="w-full" disabled={busy} type="submit">{busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : mode === "password" ? "Save password" : "Sign in"}</Button>
      </form>
      {(mode === "login" || mode === "signup") && <div className="space-y-3 border-t border-border pt-5">
        <Button variant="outline" className="w-full" disabled={busy} onClick={() => void social("google")}>Continue with Google</Button>
        <Button className="lovable-auth-button w-full" disabled={busy} onClick={() => void social("lovable")}>Continue with Lovable</Button>
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button variant="link" disabled={busy} onClick={() => { setMessage(""); setMode(mode === "signup" ? "login" : "signup"); }}>{mode === "signup" ? "Already have an account?" : "Create an account"}</Button>
        <Button variant="link" disabled={busy} onClick={() => { setMessage(""); setMode(mode === "reset" ? "login" : "reset"); }}>{mode === "reset" ? "Back to sign in" : "Forgot password?"}</Button>
      </div>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div>
  </main>;
}
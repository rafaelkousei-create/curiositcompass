import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Details = { client?: { name?: string; redirect_uri?: string }; redirect_uri?: string; scope?: string; scopes?: string[]; redirect_url?: string; redirect_to?: string };
export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({ authorization_id: typeof s["authorization_id"] === "string" ? s["authorization_id"] : "" }),
  head: () => ({ meta: [
    { title: "Connect your assistant — Curiosity Compass" },
    { name: "description", content: "Review and approve secure assistant access to Curiosity Compass." },
    { property: "og:title", content: "Connect your assistant — Curiosity Compass" },
    { property: "og:description", content: "Choose whether to grant your assistant access to landmark discovery." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("This connection request is missing its authorization ID. Start the connection again from your assistant.");
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) throw redirect({ to: "/login", search: { next: location.pathname + location.searchStr + location.hash } });
  },
  loader: async ({ location }) => {
    const id = new URLSearchParams(location.searchStr).get("authorization_id");
    if (!id) throw new Error("Invalid connection request.");
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
    if (error) throw error;
    const details = data as Details;
    const target = details?.redirect_url ?? details?.redirect_to;
    if (target && !details?.client) throw redirect({ href: target });
    if (!details?.client) throw new Error("This connection request has expired or is invalid. Start again from your assistant.");
    const session = await supabase.auth.getSession();
    return { details, email: session.data.session?.user.email };
  },
  errorComponent: ({ error }) => <main className="flex min-h-dvh items-center justify-center bg-background px-5"><div className="max-w-sm space-y-4"><h1 className="text-xl font-semibold">Could not connect your assistant</h1><p role="alert" className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Could not load this connection request."}</p><Button asChild variant="outline"><a href="/">Return to the guide</a></Button></div></main>,
  component: Consent,
});

function Consent() {
  const { details, email } = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const client = details.client?.name ?? "Your assistant";
  const scopes = details.scopes ?? details.scope?.split(" ").filter(Boolean) ?? [];
  async function decide(approve: boolean) {
    setBusy(true); setError("");
    try {
      const result = approve ? await supabase.auth.oauth.approveAuthorization(authorization_id) : await supabase.auth.oauth.denyAuthorization(authorization_id);
      if (result.error) throw result.error;
      const data = result.data as { redirect_url?: string; redirect_to?: string } | null;
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) throw new Error("No return address was supplied. Start the connection again from your assistant.");
      window.location.assign(target);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save your choice. Please try again."); setBusy(false); }
  }
  return <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10"><div className="w-full max-w-md space-y-5">
    <p className="font-display text-sm text-primary">Curiosity Compass</p>
    <h1 className="text-2xl font-semibold">Connect {client} to Curiosity Compass</h1>
    <p className="text-sm text-muted-foreground">Signed in as {email}</p>
    <p>This lets {client} use this app as you.</p>
    <p className="break-all text-sm text-muted-foreground">{details.client?.redirect_uri ?? details.redirect_uri}</p>
    {scopes.length > 0 && <ul className="space-y-2 text-sm">{scopes.map(scope => <li key={scope}>{scope === "email" ? "Share your email address" : scope === "profile" ? "Share your basic profile" : scope === "openid" ? "Confirm your identity" : `Additional permission requested: ${scope}`}</li>)}</ul>}
    <ul className="space-y-2 border-y border-border py-4 text-sm"><li>Discover landmarks near a supplied location.</li><li>Identify a place from a description.</li><li>Generate stories using this app’s AI credits.</li></ul>
    <p className="text-sm text-muted-foreground">This does not bypass the app’s permissions. Your open map, microphone, audio, and session-only history are not shared.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => void decide(true)}>Approve connection</Button><Button variant="outline" disabled={busy} onClick={() => void decide(false)}>Cancel connection</Button></div>
    <Button variant="link" disabled={busy} onClick={async () => { const { error } = await supabase.auth.signOut(); if (error) { setError(error.message); return; } window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); }}>Switch account</Button>
  </div></main>;
}
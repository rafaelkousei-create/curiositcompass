import { auth, defineMcp } from "@lovable.dev/mcp-js";
import discoverLandmark from "./tools/discover-landmark";
import identifyPlace from "./tools/identify-place";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";
export default defineMcp({
  name: "curiosity-compass", title: "Curiosity Compass", version: "0.1.0",
  instructions: "Explore landmarks using coordinates supplied by the caller, or identify a described place. Generated stories use app AI credits and may need fact checking. These tools cannot read an open browser's GPS, current story or session-only history and do not control its audio. Ask the user for a location rather than assuming it.",
  auth: auth.oauth.issuer({ issuer: `https://${projectRef}.supabase.co/auth/v1`, acceptedAudiences: "authenticated", requireOAuthClientClaim: true }),
  tools: [discoverLandmark, identifyPlace],
});
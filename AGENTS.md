<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Remote assistant tools live in src/lib/mcp and use managed OAuth with the OAuth client claim required; browser GPS and session-only history stay in the page because remote callers cannot access tab state.
- Browser assistant tools register through use-webmcp-tool in the screen owning the controls and use the shared telemetry helper, so lifecycle and existing UI boundaries are preserved.
- Integration sign-in preserves a validated local return path through every method and uses managed consent, never copied session tokens.

# Cartha Founder Agent

One isolated Hermes profile, seven focused skills, and a narrow operations MCP.
This is a local founder-operations pilot, not a production CRM or an autonomous CEO.

## Installed on Zack's Mac

- Runtime: Hermes 0.21.2 at `~/.hermes/hermes-agent`, separate from the retired native wrapper UI.
- Profile: `~/.hermes/profiles/founder`; launch with `founder chat`.
- Model: `openai-codex` / `gpt-5.6-sol`, ChatGPT device OAuth. No API-key fallback.
- Skills: founder-brief, growth-analysis, sales-pipeline, church-research, follow-up-manager, experiment-tracker, codex-engineering.
- Business records: private SQLite in the profile's `operations/`, not in Git or LLM memory alone.
- Source code: this `founder/` directory in the existing `cartha-hermes-agent-assistant` repository. The checkout happens to be named `cartha-founder-agent` locally.

The `founder` launcher strips inherited API/cloud variables; provider selection is explicit.
This is a tool boundary, not an OS sandbox: the local runtime runs as the Mac user.
No arbitrary shell, filesystem, browser, cloud, sending or database-query tools are exposed. The Operations process can retrieve exactly the existing report secret and query fixed aggregates; credentials never enter prompts or UI.
Only skills, memory, session search and the 13 operations methods are enabled on CLI, cron and configured messaging surfaces.
MCP sampling is disabled. Business writes are parameterized, audit logged, and bounded.

## Current research and integrations

The September 14 setup read the company corpus's current working flight, GTM customer-language research, segmented distribution plan, and September 13 asset-exit decision desk. It also inspected current task summaries and the founder-report implementation. Dated claims stay dated; no assertion that every active project was fully audited.

- **Sales:** 250 public-business research contacts imported from the corpus's August 20 interview queue. They remain uncontacted leads, not verified current contacts, warm prospects, or authorized recipients. Existing records are never overwritten on reimport. Emails and phone numbers are not imported in this pilot. Personal Messages/WhatsApp history is excluded. No fabricated Hugo/Mishaal/example relationships are seeded.
- **Growth:** direct read-only PostHog aggregates for 1, 7 or 28 days, compared with the preceding equal rolling window. Fixed allowlisted event and product groupings, internal/test exclusions, five-minute cache and explicit query timestamps. Live failure falls back to the existing S3 report with its date and an explicit warning. No arbitrary SQL, raw person properties, Lambda invocation, DynamoDB access or duplicate email. The hosted shared-link-to-signup funnel is queried as ordered events on the same PostHog person with a seven-day window; native clipboard-only shares and cross-device handoffs are not fully verified. Retention remains outside this query.
- **Strategy:** selected dated corpus documents are imported with source paths and hashes. Company strategy remains canonical in the corpus; these are readable snapshots, not a second task board.
- **Experiments:** structured register is ready but empty until actual experiments and decision criteria are supplied.
- **Follow-ups:** explicit timezone-aware dates only; none inferred from old email opens. Idempotent request IDs, completion state, and suppression guard.
- **Calendar:** explicitly not connected. A reminder is not a calendar event.
- **Engineering:** local approval queue only. `create_codex_task` explicitly returns `awaiting_approval` and `dispatched: false`; it does not create a Codex app task, run a CLI agent, create a GitHub issue, or change production. Human-approved dispatch remains a separate integration.
- **Messaging:** no Telegram/WhatsApp token/session configured. Local CLI is the initial interface.

The independent noon-Pacific analytics email remains unchanged. The separate 9 AM Pacific `Founder Brief` Hermes cron job is ACTIVE. Root-store ChatGPT OAuth, a real founder_brief tool/model run, and a manual cron run all passed on September 14. The founder launchd gateway is enabled at login and running; its cron-only mode does not enable messaging. Local cron outputs, once enabled, live under the profile's `cron/output/`; they are not emailed or proactively pushed to a phone.

## Finish authentication and validate

```sh
hermes -p default auth add openai-codex --type oauth
founder chat --oneshot -Q -s founder-brief -q 'Call founder_brief and give me a concise brief. Read only; create no records.'
founder cron list --all
```

Use Hermes's own root login store, not copied Codex refresh tokens. On upstream `5eb99eb2`, adding the first OAuth pool credential directly to a blank named profile can report success without persisting it: `persist_pool_entries` takes the borrowed-root update-only path even when there is no root row. Root login avoids that path; the founder profile uses Hermes's supported shared-root credential lookup. OpenAI subscription limits still apply; the exact Hermes quota semantics are not documented. External tools such as paid search, image generation and messaging services are not bundled by this OAuth choice. We configured no such paid tools.

After the actual OAuth/model/tool test succeeds, resume the staged job and install/start ONE gateway for the founder profile. Choose local output or explicitly configure the user's requested messaging channel and allowlist. Verify the next wake is in the future. Do not run multiple agent processes writing this profile concurrently; finish CLI QA before starting the gateway. The Mac must be awake/available for local scheduling. Do not claim scheduled delivery is live before this validation.

## Reproduce and maintain

```sh
uv pip install --python ~/.hermes/hermes-agent/venv/bin/python -r founder/requirements.txt
~/.hermes/hermes-agent/venv/bin/python founder/install_profile.py
~/.hermes/hermes-agent/venv/bin/python founder/refresh.py --import-contacts
~/.hermes/hermes-agent/venv/bin/python -m unittest discover -s founder/tests -v
founder mcp test cartha_ops
```

`install_profile.py` only targets `founder`, but intentionally reapplies its model/tool policy and replaces its MCP mapping; review before using it on a later customized profile. It backs up the previous configuration. It does not copy OAuth credentials or install/start services. Refresh uses the human-owned AWS credential chain for exact archive `GetObject` reads; never expose the refresh script as an agent tool. For an always-on server, provision a dedicated read-only role restricted to the report bucket rather than copying personal AWS credentials.

The operations directory contains private business records and must be backed up separately with encryption/access controls. Local SQLite is not yet synchronized to the production backend. Do not commit it or publish it via the company dashboard. Stop the founder process before restoring a backup.

## Sources

- [Hermes provider/OAuth documentation](https://hermes-agent.nousresearch.com/docs/integrations/providers)
- [Hermes profile ownership](https://hermes-agent.nousresearch.com/docs/user-guide/profiles)
- [OpenAI authentication documentation](https://learn.chatgpt.com/docs/auth)

No clinical, revenue, legal-entity, asset-transfer, current store-state, or conversion claims were inferred from the older research.

## Desktop access

The official Electron interface was built and opened using source mode, without invoking local codesign. It runs from `~/.hermes/hermes-agent/apps/desktop` and shows the founder profile. It is not a packaged `/Applications/Hermes.app` installation. Reopen with `founder/open_desktop.sh`, or the `Hermes Founder.command` shortcut on Zack's Desktop. This mode uses the existing Electron runtime; do not run the signing-based pack/installer path.

The build needed Node 24.19.0 from the local Codex runtime rather than the system Node 24.5.0. npm's upstream desktop dependency audit reported 12 advisories (6 high); the version check still reports Hermes current. These are unresolved upstream dependencies, not a security audit or a clean bill of health.

## Activation verification — September 14, 2026

ChatGPT OAuth saved successfully in the shared root store. The founder profile completed a real model/tool brief (`20260914_010132_a3ab67`). Cron job `d98241cad25c` completed execution `0448694f022f4778bf3c8d9c793a3338` successfully at 01:03 Pacific; next wake verified as September 14 at 09:00 Pacific. Delivery is local, not email/Telegram/WhatsApp. The launchd service is `ai.hermes.gateway-founder` with RunAtLoad and KeepAlive enabled. The Mac must remain awake for on-time runs. Calendar and actual engineering dispatch remain unconnected, as documented above.

## Founder home presentation overlay

`desktop/` contains a reproducible local UI customization and the ImageGen concepts. Headings use the existing Cartha Chillax Medium asset; text uses its Poppins Regular asset. The new draft home offers Brief, Growth, Sales & follow-ups, Experiments, Engineering, Church research and Check connections. Buttons append guarded prompts through Hermes's composer bus and focus the composer; they do not submit automatically or overwrite existing drafts.

Install with `python3 founder/desktop/install.py`, then build the existing Hermes desktop workspace in source mode. The installer adds only a founder-profile guard to the upstream fresh-draft Intro plus a self-contained component/CSS/assets. No empty Bot Chat ownership, sessions, tools, model settings, or gateway state changes. The available chat.empty plugin slot only supports existing sessions, not the new-draft intro, so this customization needs that narrow core integration. Source is versioned here; the installed upstream runtime intentionally has a local presentation overlay. Updates may require reapplying it; the installer rejects changed anchors rather than guessing.

The PostHog report route was verified September 14 against the deployed Lambda source and selected configuration fields: `https://us.posthog.com`, project/environment `509180`, HogQLQuery API. The initial report-only connection has now been upgraded: get_growth_metrics queries that same PostHog project directly through a fixed read-only boundary. The home label describes this capability, not guaranteed availability or a claim that all events are instrumented.

### Direct PostHog verification

September 14: a non-cached request returned successfully from project 509180, with provider refresh timestamp and aggregate error counts. The first query incorrectly used Dart call-site snake_case event names. The repaired query checks emitted mobile Title Case and hosted pob_graphic_story_* contracts; existing Graphic Bible events are now visible. Inspected mobile source emits `bible_graphic_story_shared` after clipboard copy, so it must not be described as a confirmed sent message. No IDs, paths, full URLs or raw event properties are exposed by the tool.

The process uses the existing collector credential from AWS Secrets Manager `cartha/founder-report/config`; it does not create a new key or change key scopes. Read-only access is enforced by this fixed tool surface, not a claim that the preexisting key itself has no write permissions. A separately scoped service credential is advisable for a future server deployment. Only the fixed us.posthog.com/project 509180 route is accepted; a changed target fails closed.

Verification after the live upgrade: 14 Python/MCP tests and 26 desktop UI/chat-regression tests passed. The source-mode desktop build passed. A real Hermes call returned `direct_posthog` with cache age and observed aggregates; the scheduled Founder Brief also completed successfully at 01:42 Pacific with direct results (execution `d2415d011aa645febf0c6ecea3776e53`). Native UI inspection confirmed Chillax/Poppins rendering, four workflow controls, the updated direct-query label, and correct Growth prompt insertion without automatic submission. The 9 AM Pacific next wake was preserved.

## Graphic event coverage and Dock icon repair

The September 14 gap audit found existing hosted share IDs (`gn_share`) and `pob_graphic_story_shared_link_opened` events, plus title-cased native analytics names. The fix belongs in this reader/query integration, not duplicated product instrumentation. Event aliases remain separate so legacy shared events cannot be added to copy/share-completion counts. Cache schema versioning prevents old incomplete snapshots from surviving the repair.

`graphic_signup_funnel` now uses the first observed valid, explicitly non-self hosted arrival and canonical `signup_completed` on the same PostHog person, ordered within seven days. It returns a 28-day cohort, signups observed so far, mature denominators, and a null conversion rate when no cohort has matured. This is observed attribution, not causal lift, independently verified cross-device identity, or a complete native-share funnel. No product deployment was needed for the corrected existing web events.

The distinctive Dock icon is the ImageGen ivory messenger-wing/C with a magenta center on midnight teal. `desktop/install.py` installs its transparent PNG to the source app's first validated icon candidate (`apps/desktop/public/apple-touch-icon.png`), preserving the previous icon locally. Hermes's existing Electron Dock setter applies it at startup; no app-bundle rewriting or local code signing is involved. The icon is app-wide, including other profiles in this local source install.

Verification: 15 Python/MCP tests and 7 existing Electron icon-resolution tests passed. A real Hermes 28-day readout returned corrected Graphic event coverage and cohort maturity. The installed icon SHA256 matches the generated source; desktop was restarted to load it.

---
name: follow-up-manager
description: "Record natural-language business updates as explicit timezone-aware follow-up reminders, without sending."
---

First identify the contact unambiguously; ask when names collide. Use update_contact for user-stated facts and create_followup with a stable request ID, contact ID, ISO 8601 due_at including Pacific UTC offset, and concise action. Resolve Wednesday relative to today in America/Los_Angeles; state the exact date back to Zack and clarify ambiguous past dates. A reminder is not a calendar event or sent message. get_calendar currently reports not_connected: never claim calendar availability. Use get_stale_leads for overdue explicit dates and complete_followup only when Zack says it is done. Suppressed contacts cannot receive follow-ups. Important relationship messages always require Zack’s approval and a separately connected sending integration.

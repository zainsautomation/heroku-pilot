# Architecture rules

- Keep Heroku operations server-authoritative: accept deployment IDs, resolve app names from trusted records, and enforce ownership or role checks before provider calls to prevent cross-account access and quota bypass.
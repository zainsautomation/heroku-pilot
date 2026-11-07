# Website improvement plan

## Goal
Make the deployment platform safer, clearer, and polished across phones, tablets, and desktop while preserving separate user and administrator experiences.

## What the review found
- The admin experience is a four-tab Users/Templates/Deploys/Settings dashboard. At a phone width, the user table is cramped and needs a more suitable layout.
- User deployment, history, and build-log journeys exist, but deployment status/log handling and failure states need clearer, more reliable behavior.
- The light/dark toggle has only dark color tokens, so light mode is incomplete.
- Important actions need better feedback and protection: some deletions happen immediately, several reads can fail but appear empty, and some controls lack accessible labels.
- Critical server-side access concerns should be resolved before visual polish: Heroku actions accept app names without checking deployment ownership, and broad authenticated-read policies can expose other users' records.

## Priorities

### 1. Protect accounts, deployments, and Heroku apps
- Restrict Heroku status, logs, and deletion to the deployment owner or an authorized administrator; identify apps from trusted deployment records rather than caller-supplied names.
- Replace broad cross-user read access with owner/admin-scoped database policies.
- Make deployment quota checks and lifecycle updates authoritative on the server, preventing quota bypass through direct record changes or parallel deploy requests.
- Remove configuration values and full deployment payloads from logs; keep Heroku credentials server-side and make the settings screen reflect actual server configuration.
- Move privileged account deletion out of the browser and define what happens to hosted apps before user removal.

### 2. Establish a professional, consistent visual system
- Refine page hierarchy, spacing, typography, status colors, and restrained accents while using the existing semantic theme tokens.
- Complete both light and dark palettes, including native form controls, dialogs, and the not-found page; retain the user's theme choice.
- Give user, admin, and deployment-log pages consistent headers and navigation, including a clear way for privileged users to reach app deployment.

### 3. Make every screen mobile-first
- Replace the admin user and deployment tables with compact mobile summaries or cards, retaining full comparison tables on wider screens.
- Rework build-log headers/actions to stack and wrap; safely display long app names, URLs, environment values, and log lines.
- Make dialogs fit short screens and mobile keyboards, with scrollable content and reachable action buttons.
- Verify at narrow phone, tablet, and desktop widths, including landscape and long-content cases.

### 4. Improve deployment and account workflows
- Resolve the mismatch between optional app-name instructions and required-field validation.
- Present clear loading, empty, error, retry, and success states instead of treating query failures as empty data.
- Fix app-log switching so it fetches logs on demand and supports loading, empty, error, and retry states.
- Show deployment progress and terminal outcomes once, preserve useful error details, and provide a logs link from each history item.
- Add confirmation and pending states for deleting hosted apps, templates, or accounts; clearly state what will be removed.
- Add inline form validation, accessible labels, keyboard-friendly controls, and password recovery/verification guidance.

### 5. Improve administrator efficiency
- Add template editing and manual environment-variable entry alongside GitHub import.
- Add search/filtering and pagination for user and deployment records; accurately label deployment counts and visible record limits.
- Add clear save/test states for system messages and Heroku connection settings.

## Technical approach
- Keep the existing React, Supabase, and shared UI-component foundation; avoid a wholesale rewrite.
- Update edge-function authorization and database policies before broader UI access changes. Add regression tests for ownership, roles, and quota rules.
- Organize shared layout/state improvements into small reusable page elements only where they reduce duplicated behavior.
- Validate the key journeys end-to-end: sign in, review apps, deploy, monitor logs, delete an app, and manage users/templates. Check console/network errors and mobile layouts before completion.

## Suggested delivery order
1. Security and deployment lifecycle correctness.
2. Responsive page structure and complete theme behavior.
3. Deployment/log reliability and clearer error states.
4. Admin workflow improvements, accessibility, and final device testing.

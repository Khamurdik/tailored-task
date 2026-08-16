# web/public-view

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/web/src/features/public-view/TODO.md`](../../../../apps/web/src/features/public-view/TODO.md)

Everything a visitor can do, and — more importantly — everything they can see.
This is the only route in the product an untrusted person reaches, so almost
every row here is `security`.

## Declared tests

### Opening a link

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-PUBLICVIEW-008 | A valid link renders the shared node without any sign-in step | unit | P0 |
| WEB-PUBLICVIEW-009 | The visitor can browse into subfolders of the shared root | unit | P0 |
| WEB-PUBLICVIEW-010 | The visitor can open a PDF from within the share | unit | P0 |
| WEB-PUBLICVIEW-011 | The visitor can download a file from within the share | unit | P1 |
| WEB-PUBLICVIEW-012 | A link to a single file renders the file, not a folder listing | unit | P1 |
| WEB-PUBLICVIEW-013 | Reloading inside the share keeps the visitor inside it | unit | P0 |
| WEB-PUBLICVIEW-014 | The browser back button works within the share | unit | P1 |

### What a visitor must not see or do

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-PUBLICVIEW-003 | Breadcrumbs stop at the share root and never name an ancestor above it | security | P0 |
| WEB-PUBLICVIEW-015 | No control creates, renames, moves, deletes, or uploads | security | P0 |
| WEB-PUBLICVIEW-016 | No share dialog is reachable | security | P0 |
| WEB-PUBLICVIEW-017 | Editing the URL to an ancestor id renders not-found | security | P0 |
| WEB-PUBLICVIEW-018 | Editing the URL to a sibling id renders not-found | security | P0 |
| WEB-PUBLICVIEW-019 | Deep-linking to an owner route while holding only a share token renders not-found | security | P0 |
| WEB-PUBLICVIEW-007 | The header shows no account menu | unit | P2 |
| WEB-PUBLICVIEW-020 | No owner name, email, or room title above the share root is rendered anywhere | security | P0 |

### Cache isolation

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-PUBLICVIEW-001 | No query key in this route is shared with an owner-scoped key | security | P0 |
| WEB-PUBLICVIEW-002 | Owner data cached before visiting a share link is never rendered inside it | security | P0 |
| WEB-PUBLICVIEW-021 | Signing out inside a share view does not clear the visitor's access | unit | P1 |
| WEB-PUBLICVIEW-005 | A signed-in visitor still gets the read-only view | security | P0 |
| WEB-PUBLICVIEW-022 | A signed-in owner opening their own link still sees the read-only view | security | P0 |

### Link lifecycle

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-PUBLICVIEW-006 | Invalid, revoked, expired, and deleted each render a distinct screen | unit | P1 |
| WEB-PUBLICVIEW-023 | A malformed token renders the invalid screen, never a crash | unit | P0 |
| WEB-PUBLICVIEW-024 | Revocation during an open session surfaces on the next action | security | P0 |
| WEB-PUBLICVIEW-025 | An expired link renders the expired screen with no retry loop | unit | P1 |
| WEB-PUBLICVIEW-026 | A deleted node renders the gone screen | unit | P1 |
| WEB-PUBLICVIEW-004 | The route never redirects to login | security | P0 |
| WEB-PUBLICVIEW-027 | No error screen invites the visitor to create an account | security | P1 |

# web/sharing

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/web/src/features/sharing/TODO.md`](../../../../apps/web/src/features/sharing/TODO.md)

Sharing is where a user gives away access, so every interaction that could give
away *more* than intended is declared separately.

## Declared tests

### Creating a public link

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-SHARING-001 | Opening the dialog creates no grant; the link is generated on demand | security | P0 |
| WEB-SHARING-007 | Closing the dialog without generating leaves no grant behind | security | P0 |
| WEB-SHARING-008 | Generating the link shows it exactly once with a clear warning | security | P0 |
| WEB-SHARING-009 | Reopening the dialog does not show the plaintext token again | security | P0 |
| WEB-SHARING-010 | Copying puts the full URL on the clipboard, not just the token | unit | P1 |
| WEB-SHARING-011 | Generating twice creates two distinct grants and says so | unit | P1 |
| WEB-SHARING-012 | An expiry can be set at creation and is shown in the list | unit | P2 |
| WEB-SHARING-013 | The token is never written to the URL bar or browser history | security | P0 |

### Inviting a person by email

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-SHARING-014 | Inviting an existing user adds them to the grant list immediately | unit | P0 |
| WEB-SHARING-015 | Inviting an address with no account shows a pending state, not an error | unit | P0 |
| WEB-SHARING-016 | The pending state explains the grant applies once that account exists | unit | P1 |
| WEB-SHARING-017 | A malformed email is rejected before the request | unit | P1 |
| WEB-SHARING-018 | Inviting the same address twice is refused with an explanation | unit | P1 |
| WEB-SHARING-019 | Inviting yourself is refused with an explanation | unit | P2 |
| WEB-SHARING-020 | Email case and whitespace are normalised before sending | unit | P1 |

### Seeing and removing access

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-SHARING-003 | Inherited grants show where they come from and offer no revoke button | unit | P0 |
| WEB-SHARING-004 | Direct grants offer revoke | unit | P0 |
| WEB-SHARING-021 | The list separates direct from inherited under clear headings | unit | P0 |
| WEB-SHARING-022 | An inherited grant links to the ancestor where it can be revoked | unit | P1 |
| WEB-SHARING-023 | Revoking asks for confirmation and names what is being cut off | unit | P1 |
| WEB-SHARING-024 | A revoked grant disappears from the list without a manual refresh | unit | P0 |
| WEB-SHARING-025 | A failed revoke restores the row and explains why | unit | P0 |
| WEB-SHARING-026 | An expired grant is shown as expired rather than silently omitted | unit | P1 |
| WEB-SHARING-027 | A node with no grants says so plainly instead of showing an empty table | unit | P2 |

### Visibility of exposure

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-SHARING-006 | A share indicator appears on shared rows in the explorer | unit | P2 |
| WEB-SHARING-028 | The indicator also appears on rows exposed only through inheritance | security | P0 |
| WEB-SHARING-029 | Hovering the indicator explains which ancestor grants the access | unit | P1 |
| WEB-SHARING-030 | The dialog is unavailable to a non-owner rather than failing on submit | security | P0 |

### Existing declarations

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-SHARING-002 | The plaintext token is shown once and the UI says so | security | P0 |
| WEB-SHARING-005 | Copy confirms it copied | unit | P2 |

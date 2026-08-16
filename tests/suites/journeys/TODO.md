# journeys — user stories, end to end

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../TODO.md).

Grouped by **who is acting**, because the interesting question is rarely "does
this work" and almost always "does this work *for this person, and not for that
one*". Each group is one persona and covers what they can do, what they can see,
and what they must be refused.

Journeys are expensive and flaky, so a behaviour provable in `web/*` or `api/*`
belongs there. What survives here is anything that only exists when the real
browser, the real API, and the real bucket are all in play.

## Personas

| Persona | Who | Credentials |
| --- | --- | --- |
| Owner | A seeded user who created the room | Bearer token |
| Admin | A seeded user with `is_admin` | Bearer token |
| Invited viewer | A seeded user granted access by email | Bearer token |
| Public visitor | Anyone holding a share link | `X-Share-Token` only |
| Stranger | A seeded user with no grant on this room | Bearer token |
| Anonymous | No credentials at all | none |

## Declared tests

### Owner — the core loop

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| JOURNEY-001 | As an owner I upload a file, share the folder, and a visitor in a fresh context with no storage sees read-only content, cannot mutate it, and the link 404s the moment I revoke | journey | P0 |
| JOURNEY-003 | As an owner I drop 20 files into a folder, navigate two levels away, and every upload still completes and reports its result | journey | P0 |
| JOURNEY-004 | As an owner I build a 5-level tree, move a subtree, and every breadcrumb and listing stays correct | journey | P1 |
| JOURNEY-007 | As an owner I delete a folder and the confirmation shows the true subtree counts before I confirm | journey | P2 |
| JOURNEY-008 | As an owner I create a folder, upload into it, rename it, move it, and delete it in one session without a stale screen | journey | P0 |
| JOURNEY-009 | As an owner I upload two files with the same name and both land under distinct names | journey | P0 |
| JOURNEY-010 | As an owner I reload the page mid-session and land back where I was, still signed in | journey | P0 |
| JOURNEY-011 | As an owner I work in two tabs and a change in one appears in the other on refocus | journey | P1 |
| JOURNEY-012 | As an owner I cancel an upload halfway and the partial file never appears in the listing | journey | P1 |

### Owner — sign-in and identity

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| JOURNEY-002 | As an owner I log in with a password, log out, and log back in with Google to the same account | journey | P0 |
| JOURNEY-013 | As an owner I open a deep link while signed out, sign in, and land on that exact link | journey | P0 |
| JOURNEY-014 | As an owner my session survives past the access-token lifetime without me noticing | journey | P0 |
| JOURNEY-015 | As an owner I sign out in one tab and the other tab stops showing my data | journey | P0 |
| JOURNEY-016 | As a person with no account I cannot create one from anywhere in the UI | journey | P0 |

### Invited viewer

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| JOURNEY-017 | As an invited viewer I sign in and see the shared folder in my rooms | journey | P0 |
| JOURNEY-018 | As an invited viewer I can read and download but every mutating control is absent | journey | P0 |
| JOURNEY-019 | As an invited viewer I cannot reach the owner's other rooms by editing the URL | journey | P0 |
| JOURNEY-020 | As a person invited before I had an account, I am seeded and the grant is waiting when I first sign in | journey | P0 |
| JOURNEY-021 | As an invited viewer my access disappears the moment the owner revokes it | journey | P0 |

### Public visitor

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| JOURNEY-005 | As a share visitor I open a PDF and it renders, from the same link | journey | P1 |
| JOURNEY-022 | As a visitor I browse the whole shared subtree but cannot see anything above its root | journey | P0 |
| JOURNEY-023 | As a visitor I am never shown a sign-in screen | journey | P0 |
| JOURNEY-024 | As a visitor I keep working while the owner adds a file, and I see it on refresh | journey | P2 |
| JOURNEY-025 | As a visitor holding a link to folder B, editing the URL to sibling folder C shows not-found | journey | P0 |
| JOURNEY-026 | As a visitor my link stops working the moment the owner deletes the folder | journey | P0 |
| JOURNEY-027 | As a visitor with an expired link I get a clear expired screen and no retry loop | journey | P1 |
| JOURNEY-028 | As a signed-in user opening someone's share link, I get the read-only view and not my own UI | journey | P0 |

### Stranger and anonymous

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| JOURNEY-029 | As a signed-in stranger, every id from another user's room returns not-found | journey | P0 |
| JOURNEY-030 | As an anonymous visitor, every owner route sends me to sign-in and leaks nothing first | journey | P0 |
| JOURNEY-031 | As a stranger I cannot tell whether a room id exists from any response | journey | P0 |
| JOURNEY-032 | As anyone, a guessed share token returns the invalid screen | journey | P0 |

### Admin

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| JOURNEY-006 | As an admin I trigger a job by hand and watch it reach a terminal status | journey | P1 |
| JOURNEY-033 | As an admin I see every job with its schedule, last outcome, and next run | journey | P1 |
| JOURNEY-034 | As an admin I open a past run and read what it changed | journey | P1 |
| JOURNEY-035 | As a non-admin owner, the jobs area does not exist for me | journey | P0 |

### Resilience — the network is not perfect

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| JOURNEY-036 | With the API stopped, the app renders an offline state rather than a blank page | journey | P1 |
| JOURNEY-037 | With the API returning 500, every screen offers a retry rather than a spinner | journey | P1 |
| JOURNEY-038 | Losing connectivity mid-upload marks the file failed and it retries cleanly on return | journey | P1 |
| JOURNEY-039 | A slow API shows loading states everywhere, and none of them is a bare spinner | journey | P2 |

## Notes
- **JOURNEY-001 demonstrates the whole product.** It is the one test to keep
  working if everything else is cut. `storageState` must be explicitly empty for
  the visitor context — with bearer tokens in `localStorage`, a leaked storage
  state would silently authenticate the "anonymous" visitor and the test would
  pass while proving nothing.
- JOURNEY-002 exists because account linking is the part of auth most likely to
  be quietly broken by a refactor, and it cannot be observed below this tier.
- JOURNEY-025, -029, and -031 look like three versions of one test. They are the
  same *property* reached by three different routes, and the whole point is that
  a fix applied at one route often misses the others.
- The Resilience group needs the API stubbed at the network layer rather than
  actually killed, or these become the flakiest tests in the repo.

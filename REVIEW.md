# Reviewing this

A live deployment, six accounts, and a dataset built so the permission model can
be checked by clicking rather than by reading code.

| | |
| --- | --- |
| Web | https://tailored-task.vercel.app |
| API | https://8vuzutujwq.us-east-2.awsapprunner.com |
| Public share link | https://tailored-task.vercel.app/s/VBHV2KVG5Y9F5WZ9 |

**Every account below uses the same password: `review-2026-meridian`.**
These are demo identities on `example.com`, which is reserved by RFC 2606 and
receives no mail. The system never sends email at all — see "no notification"
below.

---

## The accounts

| Sign in as | Who they are | What they demonstrate |
| --- | --- | --- |
| `ana.ruiz@example.com` | Owner of **Project Meridian** | Sees her whole room. Cannot see Bo's room at all |
| `bo.lindqvist@example.com` | Owner of **Project Northwind** | A second, unrelated room. Proves owners are isolated from each other |
| `cara.mensah@example.com` | Invited to **Financials** only | Sees one folder of somebody else's room, and nothing above or beside it |
| `dmytro.kovalenko@example.com` | Invited to **Legal** only | A *different* slice of the same room — two grants that do not overlap |
| `erik.sandberg@example.com` | Signed in, granted nothing | Authentication is not authorization: a valid session sees nothing |
| `khamurdik@gmail.com` | Administrator | The only account that can reach `/jobs` |

Plus **no account at all** — open the share link in a private window.

---

## The tree

```
Project Meridian            (owned by Ana)
├── Financials              → shared with Cara
│   ├── q4-report.pdf
│   └── cap-table.pdf
├── Legal                   → shared with Dmytro
│   └── master-agreement.pdf
├── HR                      → shared with nobody
│   └── headcount.pdf
└── Teaser                  → public link, no account needed
    └── teaser.pdf

Project Northwind           (owned by Bo)
└── Diligence
    └── northwind-summary.pdf
```

---

## What actually happens

Every cell below is a real HTTP status from `GET /nodes/:id`, issued as that
identity against the live API. **200 = visible, 404 = not.**

| node | Ana | Bo | Cara | Dmytro | Erik | link | anon |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Meridian (room) | 200 | 404 | 404 | 404 | 404 | 404 | 404 |
| ├ Financials | 200 | 404 | **200** | 404 | 404 | 404 | 404 |
| │ └ q4-report.pdf | 200 | 404 | **200** | 404 | 404 | 404 | 404 |
| ├ Legal | 200 | 404 | 404 | **200** | 404 | 404 | 404 |
| │ └ master-agreement.pdf | 200 | 404 | 404 | **200** | 404 | 404 | 404 |
| ├ HR | 200 | 404 | 404 | 404 | 404 | 404 | 404 |
| │ └ headcount.pdf | 200 | 404 | 404 | 404 | 404 | 404 | 404 |
| └ Teaser | 200 | 404 | 404 | 404 | 404 | **200** | 404 |
| &nbsp;&nbsp;└ teaser.pdf | 200 | 404 | 404 | 404 | 404 | **200** | 404 |
| Northwind (Bo's room) | 404 | **200** | 404 | 404 | 404 | 404 | 404 |
| └ northwind-summary.pdf | 404 | **200** | 404 | 404 | 404 | 404 | 404 |

Four things worth noticing in that table:

- **Cara can read `Financials` but not the room above it.** A grant scopes to a
  subtree, and the ancestors it hangs from stay invisible. Her breadcrumb trail
  starts at `Financials`, not at `Project Meridian` — the room's name is itself
  information, and a visitor never receives it.
- **Cara and Dmytro cannot see each other's folder**, though both are inside the
  same room and both were invited by the same owner.
- **Ana and Bo are mutually invisible.** Ownership is read from the node, never
  from a grant, so there is no path by which one owner acquires another's tree.
- **Every denial is `404`, never `403`.** A stranger, an expired grant, a revoked
  link and an id that never existed all produce a byte-identical response, so
  none of them confirms that a thing exists.

---

## A five-minute walkthrough

1. **Open the share link in a private window.** No sign-in prompt appears — a
   recipient of a document link is never asked to make an account. You see
   `Teaser` and can open the PDF. Try editing: there is nothing to click.
2. **Change the id in the URL** to any other node. The same unavailable screen,
   with no hint that the id was real.
3. **Sign in as Cara.** She lands on a room list containing exactly one entry.
   Open it: `Financials` and nothing else.
4. **Sign in as Erik.** A valid session, an empty room list. Authentication
   proves who you are and grants nothing.
5. **Sign in as Ana.** The whole room. Upload a PDF — it goes from the browser
   straight to S3 with a presigned URL, and the API never touches the bytes.
   Share a folder, then revoke it and watch the recipient's view die.
6. **Sign in as the admin** to reach `/jobs`: six scheduled cleanup jobs, each
   with its next run time, each triggerable by hand. Non-admins get `404` there,
   not `403` — the surface does not admit it exists.

---

## Two deliberate behaviours that look like bugs

**Inviting somebody by email sends them nothing.** There is no mail in this
system. A grant addressed to an address that has never signed in sits pending and
binds the first time that person logs in; you send them the link yourself. That
is the mechanism rather than a fallback, and the reasoning is in `HANDOFF.md`
§3.13.

**There is no sign-up.** Accounts are provisioned by an operator through the seed
step, and Google sign-in *links* to an existing account rather than creating one.
`POST /auth/register` returns 404 from the router, because it does not exist.

---

## If you would rather read than click

- [`README.md`](README.md) — module index and the layer graph
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the only whole-system document
- [`HANDOFF.md`](HANDOFF.md) §3 — every design decision and why
- [`DEPLOYMENT-CLOUD.md`](DEPLOYMENT-CLOUD.md) — how this deployment was built
- [`tests/TODO.md`](tests/TODO.md) — 570 declared tests, and why the suite is red
  by design until the last one lands

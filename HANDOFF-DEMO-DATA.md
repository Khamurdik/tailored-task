# Demo data — a self-contained handoff

Written to be **pasted into a separate chat that has no access to this
repository**. Everything needed to build a visualisation is inline: the
accounts, the tree, the grants, and the measured access matrix.

Nothing here is hypothetical. Every status code in the matrix is a real
`GET /nodes/:id` issued against the live API on 2026-08-18, once per identity.

---

## 1. What the product is

A **virtual data room** — the due-diligence kind. An owner uploads documents into
a folder tree and grants outsiders scoped, revocable, read-only access to part of
it. Think of a company opening its financial records to a specific investor's
lawyer, but only the folder that lawyer is meant to see.

Three rules drive everything in the matrix below:

1. **A grant scopes to a subtree.** Being given a folder does not reveal the
   folder above it, or its siblings.
2. **Ownership is read from the node, never from a grant.** So two owners are
   mutually invisible; there is no path by which one acquires the other's tree.
3. **Every denial is `404`, never `403`.** A stranger, a revoked link, an expired
   grant and an id that never existed all return a byte-identical response — so
   no response ever confirms that something exists.

---

## 2. Accounts

Live at **https://tailored-task.vercel.app**. Every account uses the password
**`review-2026-meridian`**. The `example.com` addresses are RFC 2606 reserved and
receive no mail; this system sends no email at all.

| Email | Name | Role in the demo | Demonstrates |
| --- | --- | --- | --- |
| `ana.ruiz@example.com` | Ana Ruiz | Owner of Project Meridian | Full sight of her own room |
| `bo.lindqvist@example.com` | Bo Lindqvist | Owner of Project Northwind | A second room; owners are isolated from each other |
| `cara.mensah@example.com` | Cara Mensah | Invited to `Financials` | One folder of somebody else's room, nothing above or beside it |
| `dmytro.kovalenko@example.com` | Dmytro Kovalenko | Invited to `Legal` | A different slice of the *same* room; two grants that never overlap |
| `erik.sandberg@example.com` | Erik Sandberg | Signed in, granted nothing | Authentication is not authorization |
| `khamurdik@gmail.com` | Administrator | Operator | The only account that can reach `/jobs` |

Two further identities that are not accounts:

| Identity | How it is presented | Demonstrates |
| --- | --- | --- |
| **link** | A share token in an `X-Share-Token` header, or the URL `/s/VBHV2KVG5Y9F5WZ9` | A stranger with a link, holding no account at all |
| **anon** | No credential of any kind | The default: nothing is visible |

Note for anyone drawing a "what each person sees when they sign in" view: **Cara
and Dmytro land on an empty room list.** `GET /nodes` returns only rooms the
caller *owns*, and they own none — there is no "shared with me" listing in this
build, so an invited user reaches their folder by direct link only. Their access
is real; it is just not discoverable from the UI.

---

## 3. The tree

```
Project Meridian            owner: Ana
├── Financials              granted to Cara (viewer)
│   ├── q4-report.pdf
│   └── cap-table.pdf
├── Legal                   granted to Dmytro (viewer)
│   └── master-agreement.pdf
├── HR                      granted to nobody
│   └── headcount.pdf
└── Teaser                  public link, no account needed
    └── teaser.pdf

Project Northwind           owner: Bo
└── Diligence
    └── northwind-summary.pdf
```

Grants, in full — there are only three:

| # | On | Kind | To | Role |
| --- | --- | --- | --- | --- |
| 1 | `Financials` | user | `cara.mensah@example.com` | viewer |
| 2 | `Legal` | user | `dmytro.kovalenko@example.com` | viewer |
| 3 | `Teaser` | public link (16-char code `VBHV2KVG5Y9F5WZ9`) | anyone holding it | viewer |

---

## 4. The measured access matrix

`200` = visible, `404` = not visible. Measured, not designed.

| node | depth | Ana | Bo | Cara | Dmytro | Erik | link | anon |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Project Meridian | 0 | 200 | 404 | 404 | 404 | 404 | 404 | 404 |
| Financials | 1 | 200 | 404 | 200 | 404 | 404 | 404 | 404 |
| q4-report.pdf | 2 | 200 | 404 | 200 | 404 | 404 | 404 | 404 |
| Legal | 1 | 200 | 404 | 404 | 200 | 404 | 404 | 404 |
| master-agreement.pdf | 2 | 200 | 404 | 404 | 200 | 404 | 404 | 404 |
| HR | 1 | 200 | 404 | 404 | 404 | 404 | 404 | 404 |
| headcount.pdf | 2 | 200 | 404 | 404 | 404 | 404 | 404 | 404 |
| Teaser | 1 | 200 | 404 | 404 | 404 | 404 | 200 | 404 |
| teaser.pdf | 2 | 200 | 404 | 404 | 404 | 404 | 200 | 404 |
| Project Northwind | 0 | 404 | 200 | 404 | 404 | 404 | 404 | 404 |
| northwind-summary.pdf | 2 | 404 | 200 | 404 | 404 | 404 | 404 | 404 |

### The same data as JSON

```json
{
  "actors": ["Ana", "Bo", "Cara", "Dmytro", "Erik", "link", "anon"],
  "nodes": [
    { "name": "Project Meridian", "type": "room", "depth": 0, "parent": null,
      "visibleTo": ["Ana"] },
    { "name": "Financials", "type": "folder", "depth": 1, "parent": "Project Meridian",
      "visibleTo": ["Ana", "Cara"] },
    { "name": "q4-report.pdf", "type": "file", "depth": 2, "parent": "Financials",
      "visibleTo": ["Ana", "Cara"] },
    { "name": "cap-table.pdf", "type": "file", "depth": 2, "parent": "Financials",
      "visibleTo": ["Ana", "Cara"] },
    { "name": "Legal", "type": "folder", "depth": 1, "parent": "Project Meridian",
      "visibleTo": ["Ana", "Dmytro"] },
    { "name": "master-agreement.pdf", "type": "file", "depth": 2, "parent": "Legal",
      "visibleTo": ["Ana", "Dmytro"] },
    { "name": "HR", "type": "folder", "depth": 1, "parent": "Project Meridian",
      "visibleTo": ["Ana"] },
    { "name": "headcount.pdf", "type": "file", "depth": 2, "parent": "HR",
      "visibleTo": ["Ana"] },
    { "name": "Teaser", "type": "folder", "depth": 1, "parent": "Project Meridian",
      "visibleTo": ["Ana", "link"] },
    { "name": "teaser.pdf", "type": "file", "depth": 2, "parent": "Teaser",
      "visibleTo": ["Ana", "link"] },
    { "name": "Project Northwind", "type": "room", "depth": 0, "parent": null,
      "visibleTo": ["Bo"] },
    { "name": "Diligence", "type": "folder", "depth": 1, "parent": "Project Northwind",
      "visibleTo": ["Bo"] },
    { "name": "northwind-summary.pdf", "type": "file", "depth": 2, "parent": "Diligence",
      "visibleTo": ["Bo"] }
  ]
}
```

`cap-table.pdf` and `Diligence` are not in the markdown table above only because
they were not sampled individually; they inherit their parent's grant and are
included in the JSON for completeness.

---

## 5. What the matrix is actually showing

Four findings worth making visible, in rough order of how surprising they are to
someone who has not thought about permission scoping:

1. **Cara reads `Financials` but gets `404` on `Project Meridian` above it.**
   Access flows *down* a subtree, never up.

   One caveat, found while verifying this data: her **breadcrumb** still names
   the room (`Project Meridian / Financials`), even though the room itself
   returns 404 to her. The anonymous link visitor *is* correctly truncated to
   `["Teaser"]`. If you visualise breadcrumbs, do not draw them as truncated for
   user grants — that is the bug, not the behaviour.
2. **Cara and Dmytro cannot see each other's folder**, despite being in the same
   room, invited by the same owner, with the same role.
3. **Ana and Bo are mutually invisible**, including each other's room ids.
4. **Erik is fully signed in and sees nothing.** A valid session is not a
   permission. This is the row that usually surprises people.

And the anonymous pair at the right-hand edge: `link` sees exactly one folder and
its file; `anon` — the same person without the link — sees nothing.

---

## 6. Notes for whoever visualises this

- The natural shapes are a **matrix heat-grid** (nodes × actors, one colour for
  visible and one for not) and a **tree diagram repeated per actor**, greying out
  what that actor cannot see. The second is more intuitive and shows rule 1 —
  access flowing down but never up — far better than the grid does.
- Actor order matters. `Ana → Bo → Cara → Dmytro → Erik → link → anon` runs from
  most access to least, so the visible cells form a rough diagonal and the
  right-hand columns are almost empty. That emptiness is the point.
- Two colours are enough. There is no partial visibility in this model: a node is
  either fully readable or returns `404`. Resist a third state.
- If you show the `404`s, it is worth labelling them as *indistinguishable* —
  the system deliberately gives the same answer for "you may not" and "it does
  not exist", and that identity is a security property rather than an
  implementation detail.

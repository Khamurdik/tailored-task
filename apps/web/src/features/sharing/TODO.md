# web/features/sharing

## Purpose
Create and manage grants on a node.

## Owns
Nothing.

## Public surface
`<ShareDialog nodeId />`

## Depends on
`shared`.

## Responsibilities
- [x] Two modes in one dialog: public link, and invite by email
- [x] Generate the link on demand, not on dialog open — do not create a grant
      the user did not ask for. A dialog that mints on open leaves a live grant
      behind every time somebody opens it to look
- [x] Copy button with confirmation; the plaintext token is shown **once**. The
      body unmounts on close, so reopening genuinely cannot show it again —
      which is the only thing the server can support, since it stores a hash.
      The clipboard gets the **full URL**, not the bare token
- [x] Grant list with revoke, separating direct grants from inherited ones and
      naming the ancestor that grants access
- [ ] Optional: expiry picker. **Not built** — the API accepts `expiresAt` and
      the list renders an expiry when one is set, so this is a control rather
      than a capability
- [ ] A share indicator on rows in the explorer. **Not built** — it needs grant
      data per row, which today would be one `/shares` request per row; doing it
      properly means the listing carrying an `isShared` flag

## Implementation notes

- [x] **The invite form is `noValidate`.** `type="email"` keeps the right mobile
      keyboard, but native constraint validation blocks submit before `onSubmit`
      runs — so the field silently did nothing and this dialog's own explanation
      never rendered. The browser's bubble is also inconsistent between engines
      and is not tied to the field by `aria-describedby`.
- [x] Inviting an address that already has access is refused **client-side**.
      Sending it would be a 409 the user cannot act on.
- [x] Email is NFC-normalised and trimmed, and **case is left alone** — the
      column is `citext`, so folding here too would be a second rule that can
      disagree with the first.

## Invariants
- Inherited grants are revocable only at their source. Showing a revoke button
  that would fail is worse than showing where to go instead.

## Done when
An owner can see every path by which a node is exposed and shut each one down.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/web/sharing/TODO.md`](../../../../../tests/suites/web/sharing/TODO.md) and implemented there — never in this module's folder.

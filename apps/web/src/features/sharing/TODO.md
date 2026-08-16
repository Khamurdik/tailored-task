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
- [ ] Two modes in one dialog: public link, and invite by email
- [ ] Generate the link on demand, not on dialog open — do not create a grant
      the user did not ask for
- [ ] Copy button with confirmation; the plaintext token is shown **once**, so
      say so plainly in the UI
- [ ] Grant list with revoke, separating direct grants from inherited ones and
      naming the ancestor that grants access
- [ ] Optional: expiry picker
- [ ] A share indicator on rows in the explorer, so exposure is visible without
      opening a dialog

## Invariants
- Inherited grants are revocable only at their source. Showing a revoke button
  that would fail is worse than showing where to go instead.

## Done when
An owner can see every path by which a node is exposed and shut each one down.

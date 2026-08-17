import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';

/**
 * Google sign-in, and it is **optional infrastructure**.
 *
 * With `VITE_GOOGLE_CLIENT_ID` unset the button is not rendered at all — not
 * disabled, not a stub. A checkout without Google credentials has to run and
 * serve password login, and a disabled button that never explains itself is
 * worse than no button.
 */
export function GoogleSignInButton({
  disabled,
  onCredential,
}: {
  disabled: boolean;
  onCredential: (idToken: string) => void;
}) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (clientId === undefined || clientId.trim() === '') return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Wrapped at the point of use rather than at the app root, so the
          provider — and Google's script — only load on the one route that
          needs them. */}
      <GoogleOAuthProvider clientId={clientId}>
        <div aria-disabled={disabled} className={disabled ? 'pointer-events-none opacity-50' : ''}>
          <GoogleLogin
            /* "Sign in", never "Sign up". It cannot create an account —
               labelling it as signup guarantees a support question from someone
               who tried and was refused. */
            text="signin_with"
            onSuccess={(response) => {
              if (response.credential !== undefined) onCredential(response.credential);
            }}
            onError={() => {
              // Deliberately silent. This fires when the popup is closed or
              // dismissed, which is a user changing their mind — showing them
              // an error for deciding not to continue is noise.
            }}
          />
        </div>
      </GoogleOAuthProvider>
    </div>
  );
}

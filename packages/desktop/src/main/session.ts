import type { PublicUser } from '@jewellery/domain'

/**
 * Who the counter is running as.
 *
 * Its own file, and not part of `ipc.ts`, for one concrete reason: `ipc.ts`
 * imports `electron`, so anything importing the Session type from there drags
 * Electron in with it. The handler bodies in `retailHandlers.ts` are deliberately
 * free of Electron so their refusal paths can be tested with no window — which
 * is the same rule the application layer already lives under (DECISIONS §9).
 *
 * There is no sign-in screen. The session is established at startup instead of
 * being typed, and `user` is still checked on every write: `created_by` is NOT
 * NULL and a foreign key to `users`, so a handler that cannot name a user must
 * refuse rather than invent one.
 */
export interface Session {
  user: PublicUser | null
}

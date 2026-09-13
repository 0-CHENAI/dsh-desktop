import { registerAuthorization } from './authorization.js'

/** Desktop UI occupants and the authenticated provider sign-in bridge. */
export function apply(ctx) { registerAuthorization(ctx) }

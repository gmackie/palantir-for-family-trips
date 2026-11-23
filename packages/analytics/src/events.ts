/**
 * The product-event catalog: every event the app sends by name, with the
 * exact properties it carries. Dependency-free, so the browser, the Worker
 * and the Expo app share it (`@sortey/analytics/events`).
 *
 * Naming: snake_case `object_verb`, the same name on every surface for the
 * same action. Properties are small enums, counts and flags. A person is
 * referred to only by an opaque internal id, passed to `identifyUser` or as a
 * server event's `distinctId` — never by an email, a name or a phone number,
 * and the types below refuse such a property (see `PiiSafe`).
 */

/** What one event property may hold: an enum member, a count or a flag. */
export type EventValue = string | number | boolean | null;

/** A property bag as the providers receive it. */
export interface EventProps {
  readonly [key: string]: EventValue;
}

/** Property names that identify a person. A catalog entry may not use them. */
export type PiiKey =
  | "email"
  | "name"
  | "first_name"
  | "last_name"
  | "full_name"
  | "display_name"
  | "username"
  | "phone"
  | "phone_number"
  | "address"
  | "ip"
  | "ip_address";

/** Name shapes that identify a person however they are prefixed. */
type PiiPattern =
  | `${string}email${string}`
  | `${string}_name`
  | `${string}phone${string}`
  | `${string}address${string}`;

/**
 * `P` with every PII-named property turned into `never` and every value that
 * is not an `EventValue` turned into `never`, so a catalog entry declaring
 * one no longer satisfies `DefineCatalog`.
 */
export type PiiSafe<P> = {
  readonly [K in keyof P]: K extends PiiKey | PiiPattern
    ? never
    : P[K] extends EventValue
      ? P[K]
      : never;
};

/** Optional `never` for every PII key: intersected into every call's props. */
export type NoPii = { readonly [K in PiiKey]?: never };

/**
 * Declares a catalog: the identity on `C`, which fails to compile when an
 * entry has a PII-named property or a non-scalar value.
 */
export type DefineCatalog<
  C extends { readonly [E in keyof C]: PiiSafe<C[E]> },
> = C;

/** An event with no properties. */
export type NoProps = Readonly<Record<string, never>>;

/**
 * The props argument for one event: optional when the event has none,
 * required otherwise, always closed against PII keys.
 */
export type PropsArg<P> = [NoProps] extends [P]
  ? [props?: P & NoPii]
  : [props: P & NoPii];

/**
 * Events the browser (and the mobile app) send. The template's entries stay
 * so its tests keep passing; Sortey's journey events (SORTEY-33) follow, with
 * the props apps/nextjs/src/lib/analytics.ts and
 * apps/expo/src/utils/observe-analytics.ts send today.
 */
export type ClientEvents = DefineCatalog<{
  /** A workspace was created (today: the first-run bootstrap). */
  workspace_created: { readonly source: "bootstrap" | "settings" };
  /**
   * Someone was invited to a trip (or, in the template, a workspace's invite
   * allowlist): `method` is how the invite left the app.
   */
  invite_sent:
    | { readonly role: "owner" | "admin" | "member" }
    | { readonly method: "share_link" }
    | {
        readonly method: "email" | "link";
        readonly role: "owner" | "admin" | "member";
      };
  /** The user was sent to the payment provider's checkout. */
  checkout_started: { readonly plan: string };
  /** A trip was created (web after the server action, mobile on success). */
  trip_created: {
    readonly trip_mode: string | null;
    readonly group_mode: boolean;
  };
  /** An invite was accepted. */
  invite_accepted: { readonly method: "share_link" | "email_invite" };
  /** Mobile: a stop was logged (queued while offline). */
  stop_logged: {
    readonly kind: string;
    readonly queued: boolean;
    readonly photos: number;
  };
  /** Mobile: an expense was created (gas or regular, maybe queued). */
  expense_created:
    | {
        readonly expense_type: "gas";
        readonly queued: false;
        readonly split: boolean;
      }
    | { readonly expense_type: "regular"; readonly queued: true }
    | {
        readonly expense_type: "regular";
        readonly queued: false;
        readonly receipt: boolean;
        readonly line_items: number;
      };
}>;

/** Events the Worker sends, after the fact it records has committed. */
export type ServerEvents = DefineCatalog<{
  /** A user row was created (any sign-in method). */
  user_signed_up: NoProps;
  /** A subscription became active (on creation, or from another status). */
  subscription_activated: { readonly transition: "created" | "updated" };
}>;

export type ClientEventName = keyof ClientEvents & string;
export type ServerEventName = keyof ServerEvents & string;

/**
 * One server event, ready to send. `id` is deterministic (derived from the
 * fact it records, e.g. `signup:<userId>`), so a retried hook or a redelivered
 * webhook produces the same id and Dataflare deduplicates it.
 */
export type ServerEvent = {
  readonly [E in ServerEventName]: {
    readonly event: E;
    readonly id: string;
    /** The opaque internal id of the person (or account) this is about. */
    readonly distinctId: string;
    /** The signed-in user's id when the event is about one. */
    readonly userId?: string | undefined;
    readonly props: ServerEvents[E] & NoPii;
  };
}[ServerEventName];

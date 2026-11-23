/**
 * The provider-neutral analytics facade: `trackEvent`, `identifyUser`,
 * `resetUser` dispatch to every enabled provider (Dataflare today), each
 * behind an `AnalyticsSink`. With no sink every call is a no-op.
 *
 * Dependency-free (`@sortey/analytics/facade`): the web entry builds one over
 * dataflare-web, the Expo app one over its Dataflare client
 * (`dataflare-native.ts`).
 */
import type { EventProps, PropsArg } from "./events";

/** One analytics provider, as the facade drives it. */
export interface AnalyticsSink {
  readonly track: (event: string, props: EventProps) => void;
  /**
   * An opaque internal user id; never an email. `props` are person
   * properties, already scrubbed of PII-named keys.
   */
  readonly identify: (userId: string, props?: EventProps) => void;
  readonly reset: () => void;
}

export interface Analytics<C extends Catalog> {
  /** True when at least one provider is wired in. */
  readonly enabled: boolean;
  readonly trackEvent: <E extends keyof C & string>(
    event: E,
    ...props: PropsArg<C[E]>
  ) => void;
  /**
   * Untyped capture for events outside the catalog: the migration path for
   * apps whose call sites predate `ClientEvents`. Props are scrubbed the
   * same way. Prefer adding the event to the catalog and `trackEvent`.
   */
  readonly captureEvent: (event: string, props?: EventProps) => void;
  /**
   * Links later events to this user (sign-in, or a restored session).
   * Repeats are ignored; a different user resets first. `props` are person
   * properties (plan, role): small enums only, scrubbed like event props.
   */
  readonly identifyUser: (userId: string, props?: EventProps) => void;
  /** Forgets the user (sign-out). */
  readonly resetUser: () => void;
  /**
   * Follows the signed-in user: an id identifies, `null` resets a user that
   * was identified. For a session hook that reports the current user.
   */
  readonly syncUser: (userId: string | null) => void;
}

const PII_KEY =
  /email|phone|address|^name$|_name$|^username$|^ip$|^ip_address$/i;
const EMAIL_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * Runtime backstop for the catalog types: drops PII-named keys and
 * email-looking strings, so a widened value cannot slip one through.
 */
export const scrubProps = (props: EventProps | undefined): EventProps => {
  const out: { [key: string]: EventProps[string] } = {};
  if (!props) return out;
  for (const [key, value] of Object.entries(props)) {
    if (PII_KEY.test(key)) continue;
    // Only a string can look like an address; String() of a number, a
    // boolean or null never does.
    if (EMAIL_VALUE.test(String(value))) continue;
    out[key] = value;
  }
  return out;
};

/** A provider failing must never break the screen that tracked the event. */
const each = (
  sinks: ReadonlyArray<AnalyticsSink>,
  call: (sink: AnalyticsSink) => void,
): void => {
  for (const sink of sinks) {
    try {
      call(sink);
    } catch {
      // Analytics is best effort.
    }
  }
};

/** Any catalog: event name → its property bag. */
export interface Catalog {
  readonly [event: string]: EventProps;
}

export function createAnalytics<C extends Catalog>(
  sinks: ReadonlyArray<AnalyticsSink>,
): Analytics<C> {
  let currentUser: string | null = null;

  const resetUser = () => {
    currentUser = null;
    each(sinks, (sink) => sink.reset());
  };

  const identifyUser = (userId: string, props?: EventProps) => {
    if (!userId || EMAIL_VALUE.test(userId) || userId === currentUser) return;
    if (currentUser !== null) each(sinks, (sink) => sink.reset());
    currentUser = userId;
    const person = props === undefined ? undefined : scrubProps(props);
    each(sinks, (sink) => sink.identify(userId, person));
  };

  const capture = (event: string, props: EventProps | undefined) => {
    if (!event) return;
    const scrubbed = scrubProps(props);
    each(sinks, (sink) => sink.track(event, scrubbed));
  };

  return {
    enabled: sinks.length > 0,
    trackEvent: (event, ...props) => capture(event, props[0]),
    captureEvent: capture,
    identifyUser,
    resetUser,
    syncUser: (userId) => {
      if (userId === null) {
        if (currentUser !== null) resetUser();
        return;
      }
      identifyUser(userId);
    },
  };
}

/**
 * The value contracts shared by the browser (`dataflare-web`) and native
 * (`dataflare-native.ts`) surfaces, named once here so both take the same
 * types. They predate the Dataflare move (PostHog-era names are kept so
 * call sites did not change).
 */

/**
 * What an analytics property may hold: a JSON value. No `undefined` (a
 * property that has no value is an absent key), no `Date`, no class
 * instance, no function. Dataflare's native client sends flat values only,
 * so `trackEventNative` drops nested lists and objects; catalog events
 * (`../events`) are flat already.
 */
export type AnalyticsValue =
  | string
  | number
  | boolean
  | null
  | Array<AnalyticsValue>
  | { readonly [key: string]: AnalyticsValue };

/** The property bag on one event or person profile. */
export interface AnalyticsProperties {
  readonly [key: string]: AnalyticsValue;
}

/** What a feature flag evaluates to: the boolean flag, or the variant key. */
export type FeatureFlagValue = boolean | string;

/**
 * The JSON stored against a flag's value (Dataflare `payloads`), or
 * `undefined` when the flag has none or the flags have not loaded yet.
 */
export type FeatureFlagPayload =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<FeatureFlagPayload>
  | { readonly [key: string]: FeatureFlagPayload };

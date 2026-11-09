/** Copy shape shared by en.ts and es.ts (UI-DESIGN §12). A missing or extra key fails the typecheck. */
import type { ErrorCode, WarningCode } from '../../core/errors';

/** A plural pair, picked with Intl.PluralRules ('one' or anything else). */
export interface Plural {
  one: string;
  other: string;
}
export type Text = string | Plural;

/** Alert anatomy: bold title + body. `reasons` override the code row for a details.reason id. */
export interface ErrCopy {
  t: string;
  b: string;
  reasons?: Readonly<Record<string, { t: string; b: string }>>;
}

/** Turns the literal type of en.ts into a plain shape every language must fill. */
export type Shape<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Shape<U>[]
    : { readonly [K in keyof T]: Shape<T[K]> };

export type ErrorTable = Readonly<Record<ErrorCode, ErrCopy>>;
export type WarningTable = Readonly<Record<WarningCode, Text>>;

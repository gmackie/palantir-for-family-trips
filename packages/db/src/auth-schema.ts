import { pgTable } from "drizzle-orm/pg-core";

export const userRoleEnum = ["user", "admin"] as const;
export type UserRole = (typeof userRoleEnum)[number];

export const user = pgTable("user", (t) => ({
  id: t.text().primaryKey(),
  name: t.text().notNull(),
  email: t.text().notNull().unique(),
  emailVerified: t.boolean().notNull(),
  image: t.text(),
  role: t.text().$type<UserRole>().notNull().default("user"),
  createdAt: t.timestamp().notNull(),
  updatedAt: t.timestamp().notNull(),
}));

export const session = pgTable("session", (t) => ({
  id: t.text().primaryKey(),
  expiresAt: t.timestamp().notNull(),
  token: t.text().notNull().unique(),
  createdAt: t.timestamp().notNull(),
  updatedAt: t.timestamp().notNull(),
  ipAddress: t.text(),
  userAgent: t.text(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
}));

export const account = pgTable("account", (t) => ({
  id: t.text().primaryKey(),
  accountId: t.text().notNull(),
  providerId: t.text().notNull(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: t.text(),
  refreshToken: t.text(),
  idToken: t.text(),
  accessTokenExpiresAt: t.timestamp(),
  refreshTokenExpiresAt: t.timestamp(),
  scope: t.text(),
  password: t.text(),
  createdAt: t.timestamp().notNull(),
  updatedAt: t.timestamp().notNull(),
}));

export const verification = pgTable("verification", (t) => ({
  id: t.text().primaryKey(),
  identifier: t.text().notNull(),
  value: t.text().notNull(),
  expiresAt: t.timestamp().notNull(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
}));

// @better-auth/oauth-provider (1.6.17, matching better-auth): the remote MCP
// endpoint's authorization server
// (packages/auth/src/oauth-provider.ts). Field names and types follow the
// plugin's schema; `string[]` is a Postgres text[] (the drizzle adapter
// supports arrays on pg), `json` is jsonb. Tokens are stored as sha256 hex.

export const oauthClient = pgTable("oauth_client", (t) => ({
  id: t.text().primaryKey(),
  clientId: t.text().notNull().unique(),
  clientSecret: t.text(),
  disabled: t.boolean().default(false),
  skipConsent: t.boolean(),
  enableEndSession: t.boolean(),
  subjectType: t.text(),
  scopes: t.text().array(),
  userId: t.text().references(() => user.id, { onDelete: "cascade" }),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
  name: t.text(),
  uri: t.text(),
  icon: t.text(),
  contacts: t.text().array(),
  tos: t.text(),
  policy: t.text(),
  softwareId: t.text(),
  softwareVersion: t.text(),
  softwareStatement: t.text(),
  redirectUris: t.text().array().notNull(),
  postLogoutRedirectUris: t.text().array(),
  tokenEndpointAuthMethod: t.text(),
  grantTypes: t.text().array(),
  responseTypes: t.text().array(),
  public: t.boolean(),
  type: t.text(),
  requirePKCE: t.boolean(),
  referenceId: t.text(),
  metadata: t.jsonb(),
}));

export const oauthRefreshToken = pgTable("oauth_refresh_token", (t) => ({
  id: t.text().primaryKey(),
  token: t.text().notNull().unique(),
  clientId: t
    .text()
    .notNull()
    .references(() => oauthClient.clientId, { onDelete: "cascade" }),
  sessionId: t.text().references(() => session.id, { onDelete: "set null" }),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  referenceId: t.text(),
  expiresAt: t.timestamp().notNull(),
  createdAt: t.timestamp().notNull(),
  revoked: t.timestamp(),
  authTime: t.timestamp(),
  scopes: t.text().array().notNull(),
}));

export const oauthAccessToken = pgTable("oauth_access_token", (t) => ({
  id: t.text().primaryKey(),
  token: t.text().notNull().unique(),
  clientId: t
    .text()
    .notNull()
    .references(() => oauthClient.clientId, { onDelete: "cascade" }),
  sessionId: t.text().references(() => session.id, { onDelete: "set null" }),
  userId: t.text().references(() => user.id, { onDelete: "cascade" }),
  referenceId: t.text(),
  refreshId: t
    .text()
    .references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
  expiresAt: t.timestamp().notNull(),
  createdAt: t.timestamp().notNull(),
  scopes: t.text().array().notNull(),
}));

export const oauthConsent = pgTable("oauth_consent", (t) => ({
  id: t.text().primaryKey(),
  clientId: t
    .text()
    .notNull()
    .references(() => oauthClient.clientId, { onDelete: "cascade" }),
  userId: t.text().references(() => user.id, { onDelete: "cascade" }),
  referenceId: t.text(),
  scopes: t.text().array().notNull(),
  createdAt: t.timestamp().notNull(),
  updatedAt: t.timestamp().notNull(),
}));

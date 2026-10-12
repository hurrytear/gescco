---
{"title":"Self-hosted SSO: design, development and integration","category":"Networking & proxies","kind":"Design notes","date":"2026-10-12","summary":"Use OpenID Connect as the common entry point and plan the identity provider model, authentication flow, server development, application integration, security controls and rollout checks.","tags":["SSO","OpenID Connect","OAuth 2.0","Identity"]}
---
Self-hosted SSO fits organizations that need shared accounts, centralized login policy and cross-application session management. A practical target is an OpenID Connect-compatible identity provider (IdP), with business applications acting as relying parties (RPs). This note presents a development route without binding it to a language or framework; domains, clients and users are placeholders.

## 01 / Set the boundary and protocol first

Separate “sign in once” into identity authentication, application authorization, application sessions and logout. SSO establishes a trusted identity result; each application still applies its own role, tenant and resource rules.

- Prefer the OpenID Connect Authorization Code Flow for web applications; use PKCE for browser and mobile clients that cannot safely keep a secret.
- The `openid` scope requests authentication. Request `profile`, `email` and organization-specific scopes only when needed.
- Do not treat an ID Token as a general API access token or use an email address as an immutable primary key.
- Decide user keys, account merging, disabling, offboarding, organization changes and audit retention before designing tables.
- Expose only HTTPS endpoints and give the issuer, redirect registrations and signing keys stable lifecycles.

The authorization code flow gives the browser a short-lived code; the server exchanges it at the token endpoint. OIDC requires the redirect URI to match a registered value exactly. `state` correlates the browser request and mitigates CSRF, while `nonce` binds the authentication request to the ID Token. See [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html) and the [OAuth 2.0 Security BCP](https://datatracker.ietf.org/doc/html/rfc9700/) as protocol and security baselines.

## 02 / Model the identity domain

The minimum model usually includes users, credentials, organizations, groups, clients, scopes, authorization codes, refresh tokens, sessions and audit events. Keep login credentials separate from business profiles so passwords, MFA and external directories can change independently.

- Give users an immutable internal ID; login names, email addresses and display names are mutable attributes.
- Store client ID, authentication method, exact redirect URIs, allowed scopes, logout URIs and organization ownership for each client.
- Make authorization codes single-use and very short-lived. Bind them to the client, redirect URI, PKCE verifier hash, user and authentication context.
- Rotate refresh tokens and retain revocation records so reuse or leakage can invalidate a token family.
- Store device, creation time, recent activity, authentication strength and revocation time for sessions, supporting per-user and per-device logout.
- Audit successful and failed logins, MFA, consent, token revocation, client changes and administrator actions. Do not store passwords, full tokens or unnecessary personal data in the event body.

## 03 / Build the identity provider endpoints

Implement discovery and key publication before authentication and token flows. Typical public endpoints include `/.well-known/openid-configuration`, `/authorize`, `/token`, `/jwks.json`, `/userinfo`, `/introspect` and `/revoke`; exposure depends on client types and product boundaries.

- The discovery document declares the issuer, endpoint URLs, supported grants, scopes, claims and signing algorithms.
- `/authorize` validates the client, redirect URI, scopes, `state`, `nonce` and PKCE parameters, then creates a one-time authorization context.
- `/token` accepts only an unused, unexpired code and revalidates the client, redirect URI and PKCE. Do not validate only the code format.
- Validate ID Token signatures, issuer, audience, expiry, issue time, nonce and required authentication context.
- `/userinfo` returns the minimum profile for an access token. Resource servers validate access-token audience, scopes and lifetime.
- JWKS publishes current and transition-period old keys and rotates with `kid`; private keys remain in controlled key storage.

Build the protocol state machine and negative tests before adding UI. Return standard error codes and a correlation ID; keep internal stack traces, passwords and tokens out of responses and logs.

## 04 / Design the login and consent flow

When a user reaches an application, the RP creates unpredictable `state`, `nonce` and a PKCE verifier, storing the state in a protected short-lived session before redirecting to the IdP. After receiving the code, the RP exchanges it on the server, validates the ID Token and creates a local session keyed by `sub` and issuer.

- Use exact pre-registered `redirect_uri` values; do not allow arbitrary callbacks or open redirects.
- Bind the state to a cookie with `Secure`, `HttpOnly` and an appropriate `SameSite` policy. Destroy one-time state after success or failure.
- Show the organization, application and requested scopes on first consent. Policy may suppress repeated prompts for low-risk approved scopes.
- Separate business authorization from authentication. Groups or roles in an ID Token are inputs; the application computes final permissions through versioned policy.
- Bind organization, client and user relationships together in multi-tenant systems. Do not automatically grant a privileged organization based only on an email domain.

## 05 / Handle sessions, tokens and logout

The IdP session, RP session, access token and refresh token have different lifetimes. Do not collapse them into one “logged in” state. Short-lived access tokens suit API calls, while the browser session can use a server-side session or a protected short-lived cookie.

- Do not put access tokens, profile data or executable content in browser cookies. Use high-entropy session IDs and rotate them.
- If a rotated refresh token appears again, revoke its token family and raise an alert.
- Password, MFA, account-disable, administrator-forced logout and other high-risk events must revoke related sessions.
- On RP logout, clear the local session. For global logout, use OIDC logout capabilities or backend session revocation; a successful front-end redirect is not proof of revocation.
- Audit token issuance, refresh, revocation and replay anomalies without recording complete bearer tokens.

## 06 / Publish an application integration contract

Provide a clear integration contract for each application type instead of asking teams to assemble login flows independently. Include issuer, discovery URL, client registration fields, callback examples, scopes, claim mappings, logout, key-rotation notices and acceptance cases.

- Server-side web applications use Authorization Code + PKCE and exchange tokens in the backend.
- For single-page applications, evaluate a backend session or BFF. If tokens must reach the browser, still use PKCE, short-lived access tokens and strict API audiences.
- Mobile clients use the system browser and an application callback; avoid embedded WebViews for credential collection.
- Internal service calls use client credentials or controlled service identities instead of impersonating employees.
- A legacy application can first use an integration layer for protocol conversion and retain its existing business session while migrating toward standard OIDC.

Register and revoke each client independently. Never share one client secret among several systems; clients that cannot keep secrets should not receive static secrets. Production redirect URIs, scopes and organizations require change review.

## 07 / Establish security and operations controls

The identity provider is a high-value control plane. Protect keys, login endpoints, administrative endpoints and recovery paths first. Rate limits and CAPTCHA only slow attacks; they do not replace MFA, risk detection, key protection and audit.

- Use an approved slow password hash, one-time MFA recovery codes and stronger authentication for administrators and sensitive applications.
- Rate-limit login, authorization and token endpoints by user, client, IP and device dimensions without locking an entire organization unnecessarily.
- Separate administrative duties, require confirmation for sensitive changes and keep independent administrator audit records. Protect and rehearse recovery accounts offline.
- Use short-lived signing keys, explicit `kid` values and reversible key rotation, retaining an overlap window for old signatures.
- Monitor authorization failures, state/nonce mismatches, callback errors, refresh-token reuse, JWKS failures and clock skew.
- Back up the database, key metadata and audit indexes separately and rehearse recovery with independent permissions and encryption.

## 08 / Roll out and validate in stages

Deploy one test client and organization first, complete interoperability and failure tests, then expand to low-risk applications. Keep the old login path during migration with a defined retirement date so two account systems do not diverge indefinitely.

- Protocol checks: discovery, authorization code, PKCE, state, nonce, signatures, issuer, audience, expiry and exact redirect matching.
- Account checks: creation, disabling, email change, group change, deletion and merging; verify that immutable `sub` does not change with display attributes.
- Session checks: multiple devices, single-device logout, global logout, password change, MFA change and refresh-token replay.
- Availability checks: temporary IdP outage, JWKS cache, read-only database, queue backlog, clock skew and key rotation.
- Security checks: open redirects, code replay, callback tampering, CSRF, scope escalation, cross-tenant access, log leakage and administrator overreach.
- Operations checks: alerts, audit search, backup recovery, client revocation, key rollback and named ownership.

Use test evidence and a rollback procedure for the go-live decision. Successful authentication does not prove business authorization, and a 200 response from a token endpoint does not prove a resource server checked audience and scope.

## References

- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [OAuth 2.0 Security Best Current Practice (RFC 9700)](https://datatracker.ietf.org/doc/html/rfc9700/)
- [Proof Key for Code Exchange (RFC 7636)](https://datatracker.ietf.org/doc/html/rfc7636)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

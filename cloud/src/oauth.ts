import {
  AuthorizationError,
  CimdFetchError,
  authorizationErrorRedirect,
  type ConsentDescription,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import type { Env } from "./types.js";
import { SCOPE_READ } from "./types.js";
import { isAllowedUser, publicOrigin } from "./auth.js";
import { upsertUser } from "./db.js";

/**
 * Browser sign-in for MCP clients: this Worker is the OAuth 2.1 authorization
 * server for its own `/mcp` resource, and GitHub is only the identity step.
 *
 *   GET  /authorize               validate the client's request (PKCE S256
 *                                 required), show a consent page naming it
 *   POST /authorize               Allow: on to GitHub; Deny: back to the client
 *   GET  /oauth/github/callback   GitHub says who it is; check the allowlist,
 *                                 finish the grant, back to the client
 *
 * workers-oauth-provider owns everything else: metadata, client registration
 * (Client ID Metadata Documents and dynamic registration), the token endpoint,
 * refresh rotation and revocation, and the cookies that bind each step to the
 * browser that started it.
 *
 * An OAuth client is only ever granted `read`, and its tokens are bound to the
 * `/mcp` resource: an agent connected this way can read uploaded transcripts,
 * never upload or delete. Those stay with the CLI's own login.
 */

export const GITHUB_CALLBACK_PATH = "/oauth/github/callback";

/** The provider's user id may not contain ':' (it delimits its tokens). */
export function grantUserId(userId: string): string {
  return userId.replace(/:/g, "-");
}

export interface OAuthGrantProps {
  kind: "oauth";
  userId: string;
  username: string;
  epoch: number;
}

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string, status = 200, headers = new Headers()): Response {
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  headers.set("X-Frame-Options", "DENY");
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${escape(title)}</title>` +
      `<style>body{font:15px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#1b1b1b}` +
      `.warn{background:#fff4e5;border:1px solid #f0c27b;padding:.6rem .8rem;border-radius:6px}` +
      `button{font:inherit;padding:.45rem 1.1rem;margin-right:.5rem}</style>${body}`,
    { status, headers },
  );
}

function consentPage(details: ConsentDescription, handle: string): string {
  const name = escape(details.clientName);
  const who = details.clientDomain
    ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
    : "This app registered itself; its name is not verified.";
  return `<h1>Allow ${name} to read your xtctx cloud?</h1>
<p>${who} Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
${
  details.redirectIsLoopback
    ? `<p class="warn"><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting from it.</p>`
    : ""
}
<p>It will be able to:</p>
<ul><li><strong>read</strong>: list and read the transcripts uploaded to your xtctx cloud account, from every device and project.</li></ul>
<p>It will not be able to upload, change or delete anything. You sign in with GitHub next.</p>
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <button name="decision" value="approve">Allow</button>
  <button name="decision" value="deny">Deny</button>
</form>`;
}

function renderAuthError(err: unknown): Response {
  if (err instanceof AuthorizationError && err.redirectTo) return Response.redirect(err.redirectTo, 302);
  if (err instanceof AuthorizationError || err instanceof CimdFetchError) {
    const message = err instanceof AuthorizationError ? err.description : "This app could not be verified.";
    return page("Sign-in failed", `<h1>Sign-in failed</h1><p>${escape(message ?? "Invalid request.")}</p><p>Start again from the app.</p>`, 400);
  }
  throw err;
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function randomVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER as OAuthHelpers;
  if (!env.GITHUB_CLIENT_SECRET) {
    console.error(JSON.stringify({ event: "authorize_unconfigured", reason: "GITHUB_CLIENT_SECRET is not set" }));
    return page("Not available", "<h1>Browser sign-in is not configured on this server.</h1>", 503);
  }

  try {
    if (request.method === "GET") {
      const authRequest = await oauth.parseAuthRequest(request);
      // The library leaves PKCE optional for confidential clients; here it is
      // required of every client, and only S256.
      if (authRequest.codeChallengeMethod !== "S256" || !authRequest.codeChallenge) {
        return Response.redirect(
          authorizationErrorRedirect(authRequest, "invalid_request", "PKCE with code_challenge_method=S256 is required"),
          302,
        );
      }
      // Whatever was asked for, an OAuth client is offered read and nothing else.
      const offered = { ...authRequest, scope: [SCOPE_READ] };
      const details = await oauth.describeConsent(offered);
      const consent = await oauth.beginConsent(offered);
      return page(`Authorize ${details.clientName}`, consentPage(details, consent.handle), 200, consent.headers);
    }

    if (request.method === "POST") {
      const form = await request.formData();
      const handle = String(form.get("handle") ?? "");
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(request, handle, { scope: [SCOPE_READ] });
      const verifier = randomVerifier();
      const { state, headers } = await oauth.beginUpstream(approved.request, {
        data: { verifier },
        headers: approved.headers,
      });
      const github = new URL("https://github.com/login/oauth/authorize");
      github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      github.searchParams.set("redirect_uri", `${publicOrigin(env)}${GITHUB_CALLBACK_PATH}`);
      github.searchParams.set("scope", "read:user");
      github.searchParams.set("state", state);
      github.searchParams.set("code_challenge", await s256(verifier));
      github.searchParams.set("code_challenge_method", "S256");
      github.searchParams.set("allow_signup", "false");
      headers.set("Location", github.toString());
      return new Response(null, { status: 302, headers });
    }

    return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  } catch (err) {
    return renderAuthError(err);
  }
}

interface GitHubUser {
  id: number;
  login: string;
}

/** Exchange a web-flow code for the GitHub user it belongs to. Null on any failure. */
async function githubUserFromCode(env: Env, code: string, verifier: string): Promise<GitHubUser | null> {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      code_verifier: verifier,
      redirect_uri: `${publicOrigin(env)}${GITHUB_CALLBACK_PATH}`,
    }),
  });
  const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenRes.ok || !token.access_token) return null;
  return githubUser(token.access_token);
}

/** Who a GitHub access token belongs to. Null on any failure. */
export async function githubUser(accessToken: string): Promise<GitHubUser | null> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "xtctx-cloud", Accept: "application/vnd.github+json" },
  });
  const user = (await res.json().catch(() => ({}))) as Partial<GitHubUser>;
  if (!res.ok || typeof user.id !== "number" || typeof user.login !== "string" || !user.login) return null;
  return { id: user.id, login: user.login };
}

export async function handleGithubCallback(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER as OAuthHelpers;
  try {
    const { request: original, data, headers } = await oauth.finishUpstream<{ verifier: string }>(request);
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const fail = (description: string) => {
      headers.set("Location", authorizationErrorRedirect(original, "access_denied", description));
      return new Response(null, { status: 302, headers });
    };
    if (url.searchParams.get("error") || !code) return fail("GitHub sign-in was cancelled");

    const user = await githubUserFromCode(env, code, data.verifier);
    if (!user) return fail("GitHub sign-in failed");

    const userId = `github:${user.id}`;
    // Before anything is written for this account.
    if (!isAllowedUser(env, userId)) return fail("This GitHub account is not allowed on this server");

    const epoch = await upsertUser(env, userId, user.login);
    const props: OAuthGrantProps = { kind: "oauth", userId, username: user.login, epoch };
    const { redirectTo } = await oauth.completeAuthorization({
      request: original,
      userId: grantUserId(userId),
      metadata: { login: user.login },
      scope: original.scope.filter((s) => s === SCOPE_READ),
      props,
    });
    headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers });
  } catch (err) {
    return renderAuthError(err);
  }
}

/**
 * End every OAuth grant the user holds. Best effort: the token epoch, which
 * the caller has already moved, is what actually refuses those tokens.
 */
export async function revokeOAuthGrants(env: Env, userId: string): Promise<void> {
  const oauth = env.OAUTH_PROVIDER;
  if (!oauth) return;
  try {
    let cursor: string | undefined;
    do {
      const page = await oauth.listUserGrants(grantUserId(userId), { cursor });
      for (const grant of page.items) await oauth.revokeGrant(grant.id, grantUserId(userId));
      cursor = page.cursor;
    } while (cursor);
  } catch (err) {
    console.error(JSON.stringify({ event: "grant_revocation_failed", userId, error: String(err) }));
  }
}

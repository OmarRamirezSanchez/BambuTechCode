/** A member's RAD session: the access token RAD's APIs accept and the refresh token that renews it. */
export type RadSession = { token: string; refreshToken: string }

/**
 * RAD's own Google sign-in: RAD verifies the Firebase ID token and opens a session for the RAD member with that
 * corporate account. A Google account without a RAD member fails with RAD's 404.
 */
export async function radLogin(auth: string, idToken: string): Promise<RadSession> {
  const data = await post<{ tokens: { accessToken: string; refreshToken: string } }>(auth + "/auth/login", {
    body: { tokenId: idToken },
  })
  return { token: data.tokens.accessToken, refreshToken: data.tokens.refreshToken }
}

/** Renews an expired access token. RAD keeps the refresh token until it expires. */
export async function radRefresh(auth: string, session: RadSession): Promise<RadSession> {
  const data = await post<{ accessToken: string }>(auth + "/auth/refresh", {
    body: { tokenId: session.token },
    authorization: session.refreshToken,
  })
  return { token: data.accessToken, refreshToken: session.refreshToken }
}

/** RAD's API root. Governed runtimes are configured with its usage API, which lives under it. */
export function radAuthApi(usage: string) {
  return process.env.RAD_API_URL ?? usage.replace(/\/projects\/usage\/?$/, "")
}

async function post<T>(url: string, input: { body: unknown; authorization?: string }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(input.authorization ? { Authorization: "Bearer " + input.authorization } : {}),
    },
    body: JSON.stringify(input.body),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw Object.assign(Error("RAD sign-in failed"), { status: response.status })
  return ((await response.json()) as { data: T }).data
}

// Verifies a caller Supabase access token against the configured project using
// the official GoTrue user endpoint. Fails closed on network/upstream errors.

export async function resolveSupabaseUser({ baseUrl, secretKey, accessToken, fetchFn = fetch }) {
  const token = typeof accessToken === "string" ? accessToken.trim() : "";
  if (!baseUrl || !secretKey || !token) {
    return { ok: false, status: 401 };
  }

  try {
    const response = await fetchFn(`${baseUrl}/auth/v1/user`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: secretKey,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { ok: false, status: 401 };
    }

    const data = await response.json();
    const userId = typeof data?.id === "string" ? data.id.trim() : "";
    if (!userId) {
      return { ok: false, status: 401 };
    }

    return {
      ok: true,
      userId,
      email: typeof data?.email === "string" ? data.email : "",
    };
  } catch {
    return { ok: false, status: 401 };
  }
}

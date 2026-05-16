import { useAuth } from "@clerk/react";
import { useCallback } from "react";

/**
 * Returns an authenticated fetch wrapper that attaches the Clerk Bearer token
 * to every request. Use this instead of raw `fetch()` in pages that make
 * direct API calls, so the Clerk session token is always included.
 */
export function useAuthFetch() {
  const { getToken } = useAuth();
  return useCallback(
    async (url: string, init: RequestInit = {}): Promise<Response> => {
      const token = await getToken();
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return fetch(url, { ...init, headers });
    },
    [getToken],
  );
}

/**
 * Returns an authenticated JSON fetcher (resolves the response body as JSON).
 * Throws on non-OK responses. Suitable as a React Query `queryFn`.
 */
export function useAuthFetcher() {
  const { getToken } = useAuth();
  return useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (url: string, init: RequestInit = {}): Promise<any> => {
      const token = await getToken();
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const res = await fetch(url, { ...init, headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    [getToken],
  );
}

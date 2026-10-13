"use client";

import { useEffect } from "react";

import { DEFAULT_PROVIDER_API_KEY, DEFAULT_PROVIDER_BASE_URL } from "@/lib/constants/default-provider";

export const CLIENT_PROVIDER_STORAGE_KEY = "mxpage:provider-credentials:v1";

type StoredProviderCredentials = {
  apiKey?: string;
  baseUrl?: string;
};

function readCredentials(): StoredProviderCredentials {
  try {
    const raw = window.localStorage.getItem(CLIENT_PROVIDER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredProviderCredentials;
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "",
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() : "",
    };
  } catch {
    return {};
  }
}

// 首次使用时自动写入 KKOne 中转站默认凭证，用户无需手动填写
function seedDefaultCredentials() {
  const stored = readCredentials();
  if (stored.apiKey && stored.baseUrl) return;
  window.localStorage.setItem(
    CLIENT_PROVIDER_STORAGE_KEY,
    JSON.stringify({
      apiKey: stored.apiKey || DEFAULT_PROVIDER_API_KEY,
      baseUrl: stored.baseUrl || DEFAULT_PROVIDER_BASE_URL,
    }),
  );
}

function shouldAttachCredentials(input: RequestInfo | URL) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith("/api/")) return true;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

export function ProviderCredentialFetchBridge() {
  useEffect(() => {
    seedDefaultCredentials();
    const originalFetch = window.fetch.bind(window);

    window.fetch = (input, init = {}) => {
      if (!shouldAttachCredentials(input)) {
        return originalFetch(input, init);
      }

      const credentials = readCredentials();
      const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));

      headers.set("x-mxpage-api-key", credentials.apiKey || DEFAULT_PROVIDER_API_KEY);
      headers.set("x-mxpage-base-url", credentials.baseUrl || DEFAULT_PROVIDER_BASE_URL);

      return originalFetch(input, { ...init, headers });
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}

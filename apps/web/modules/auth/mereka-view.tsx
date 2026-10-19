"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import AuthContainer from "@components/ui/AuthContainer";
import { useEffect, useRef, useState } from "react";

type PageProps =
  | { state: "ready"; callbackUrl: string; issuerOrigin: string }
  | { state: "unavailable" | "invalid-callback" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

async function requestJson(url: string, signal: AbortSignal, limit: number, init: RequestInit = {}) {
  signal.throwIfAborted();
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal,
  });
  signal.throwIfAborted();
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const length = response.headers.get("content-length");
  if (response.status !== 200 || mediaType !== "application/json" || (length && Number(length) > limit)) {
    throw new Error("Sign-in response unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Sign-in response body unavailable");
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let text = "";
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        cancel();
        throw new Error("Sign-in response too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

async function beginSignIn(callbackUrl: string, issuerOrigin: string, signal: AbortSignal) {
  const csrf = await requestJson("/api/auth/csrf", signal, 4096);
  if (
    !isPlainObject(csrf) ||
    typeof csrf.csrfToken !== "string" ||
    !csrf.csrfToken.trim() ||
    csrf.csrfToken.length > 512
  ) {
    throw new Error("Sign-in CSRF unavailable");
  }
  const result = await requestJson("/api/auth/signin/authentik", signal, 16_384, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl, json: "true" }),
  });
  if (
    !isPlainObject(result) ||
    typeof result.url !== "string" ||
    result.url.length > 8192 ||
    /[\\\u0000-\u0020\u007f]/.test(result.url)
  ) {
    throw new Error("Sign-in authorization unavailable");
  }
  const url = new URL(result.url);
  if (url.href.length > 8192 || url.origin !== issuerOrigin || url.username || url.password || url.hash)
    throw new Error("Invalid sign-in origin");
  const expected = {
    response_type: "code",
    redirect_uri: new URL("/api/auth/callback/authentik", callbackUrl).href,
    code_challenge_method: "S256",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== value)
      throw new Error("Invalid sign-in parameters");
  }
  for (const key of ["client_id", "state", "nonce", "code_challenge"]) {
    const value = url.searchParams.get(key);
    if (url.searchParams.getAll(key).length !== 1 || !value?.trim() || value.length > 512)
      throw new Error("Incomplete sign-in parameters");
  }
  signal.throwIfAborted();
  return url.href;
}

function startAttempt(callbackUrl: string, issuerOrigin: string) {
  const controller = new AbortController();
  const interrupted = new Promise<never>((_, reject) => {
    controller.signal.onabort = () => reject(new Error("Sign-in did not start"));
  });
  const timer = setTimeout(() => controller.abort(), 30_000);
  const promise = Promise.race([beginSignIn(callbackUrl, issuerOrigin, controller.signal), interrupted])
    .catch((error: unknown) => {
      controller.abort();
      throw error;
    })
    .finally(() => {
      clearTimeout(timer);
      controller.signal.onabort = null;
    });
  return { callbackUrl, issuerOrigin, controller, promise, observers: 0, navigated: false };
}

export default function MerekaEntry(props: PageProps) {
  const { t } = useLocale();
  const [status, setStatus] = useState<"pending" | "error">("pending");
  const [attemptNumber, setAttemptNumber] = useState(0);
  const attemptRef = useRef<ReturnType<typeof startAttempt> | null>(null);
  const callbackUrl = props.state === "ready" ? props.callbackUrl : null;
  const issuerOrigin = props.state === "ready" ? props.issuerOrigin : null;
  useEffect(() => {
    if (!callbackUrl || !issuerOrigin) {
      attemptRef.current?.controller.abort();
      attemptRef.current = null;
      return;
    }
    if (window.location.origin !== new URL(callbackUrl).origin || window.top !== window.self) {
      setStatus("error");
      return;
    }
    let active = true;
    const previous = attemptRef.current;
    if (!previous || previous.callbackUrl !== callbackUrl || previous.issuerOrigin !== issuerOrigin) {
      previous?.controller.abort();
      attemptRef.current = startAttempt(callbackUrl, issuerOrigin);
      setStatus("pending");
    }
    const attempt = attemptRef.current;
    if (!attempt) return;
    attempt.observers++;
    attempt.promise.then(
      (url) => {
        if (
          !active ||
          attemptRef.current !== attempt ||
          attempt.controller.signal.aborted ||
          attempt.navigated
        )
          return;
        attempt.navigated = true;
        try {
          window.location.assign(url);
        } catch {
          setStatus("error");
        }
      },
      () => {
        if (active && attemptRef.current === attempt) setStatus("error");
      }
    );
    return () => {
      active = false;
      attempt.observers--;
      // StrictMode resubscribes before this microtask; a real unmount cancels.
      queueMicrotask(() => {
        if (attempt.observers === 0) attempt.controller.abort();
      });
    };
  }, [callbackUrl, issuerOrigin, attemptNumber]);
  const retry = () => {
    if (status !== "error" || props.state !== "ready") return;
    attemptRef.current?.controller.abort();
    attemptRef.current = null;
    setStatus("pending");
    setAttemptNumber((number) => number + 1);
  };
  const goToLogin = () => {
    attemptRef.current?.controller.abort();
    attemptRef.current = null;
    window.location.assign("/auth/login");
  };
  let message = "mereka_sign_in_pending";
  if (props.state === "unavailable") message = "mereka_sign_in_unavailable";
  else if (props.state === "invalid-callback") message = "mereka_sign_in_invalid_return";
  else if (status === "error") message = "mereka_sign_in_failed";
  const error = props.state !== "ready" || status === "error";
  return (
    <AuthContainer showLogo>
      <p role={error ? "alert" : "status"} aria-live="polite" className="mb-4 text-center">
        {t(message)}
      </p>
      {props.state === "ready" && status === "error" && (
        <Button onClick={retry} className="mb-3 w-full">
          {t("try_again")}
        </Button>
      )}
      <Button onClick={goToLogin} className="w-full">
        {t("go_back_login")}
      </Button>
    </AuthContainer>
  );
}

"use client";

import type { ParsedUrlQuery } from "node:querystring";
import { WEBSITE_URL } from "@calcom/lib/constants";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import AuthContainer from "@components/ui/AuthContainer";
import { CheckIcon } from "@coss/ui/icons";
import { useEffect, useRef, useState } from "react";

export type PageProps = {
  query: ParsedUrlQuery;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

async function endSession(signal: AbortSignal) {
  const callbackUrl = new URL("/auth/logout", window.location.origin).href;
  const request = async (url: string, init: RequestInit = {}) => {
    signal.throwIfAborted();
    const response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
    });
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (response.status !== 200 || mediaType !== "application/json") {
      throw new Error("Logout request failed");
    }
    const body: unknown = await response.json();
    signal.throwIfAborted();
    return body;
  };
  const csrf = await request("/api/auth/csrf");
  if (
    !isPlainObject(csrf) ||
    typeof csrf.csrfToken !== "string" ||
    !csrf.csrfToken.trim() ||
    csrf.csrfToken.length > 512
  ) {
    throw new Error("Logout CSRF token unavailable");
  }
  const result = await request("/api/auth/signout", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl, json: "true" }),
  });
  if (!isPlainObject(result) || result.url !== callbackUrl) throw new Error("Logout was not accepted");
  // NextAuth's public session helpers turn failed reads into null. Only a fresh,
  // successful empty response can confirm that this browser's session ended.
  const session = await request("/api/auth/session");
  if (!isPlainObject(session) || Object.keys(session).length !== 0)
    throw new Error("Session is still active");
}

function startLogout() {
  const controller = new AbortController();
  const interrupted = new Promise<never>((_, reject) => {
    controller.signal.onabort = () => reject(new Error("Logout did not complete"));
  });
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const promise = Promise.race([endSession(controller.signal), interrupted]).finally(() => {
    clearTimeout(timeout);
    controller.signal.onabort = null;
  });
  return { controller, promise, observers: 0 };
}

export function Logout(props: PageProps) {
  const [btnLoading, setBtnLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<"pending" | "success" | "error">("pending");
  const [attemptNumber, setAttemptNumber] = useState(0);
  const attemptRef = useRef<ReturnType<typeof startLogout> | null>(null);
  const surveyRedirected = useRef(false);
  useEffect(() => {
    let active = true;
    attemptRef.current ??= startLogout();
    const attempt = attemptRef.current;
    attempt.observers++;
    attempt.promise.then(
      () => {
        if (active) setStatus("success");
      },
      () => {
        if (active) setStatus("error");
      }
    );
    return () => {
      active = false;
      attempt.observers--;
      // StrictMode immediately subscribes again; a real unmount cancels work.
      queueMicrotask(() => {
        if (attempt.observers === 0) attempt.controller.abort();
      });
    };
  }, [attemptNumber]);
  useEffect(() => {
    if (status === "success" && props.query?.survey === "true" && !surveyRedirected.current) {
      surveyRedirected.current = true;
      window.location.assign(`${WEBSITE_URL}/cancellation`);
    }
  }, [status, props.query?.survey]);
  const { t } = useLocale();

  const message = () => {
    if (props.query?.passReset === "true") return "reset_your_password";
    if (props.query?.emailChange === "true") return "email_change";
    return "hope_to_see_you_soon";
  };

  const navigateToLogin = () => {
    if (status !== "success") return;
    setBtnLoading(true);
    window.location.assign("/auth/login");
  };
  const retry = () => {
    if (status !== "error") return;
    attemptRef.current = null;
    setStatus("pending");
    setAttemptNumber((number) => number + 1);
  };

  return (
    <AuthContainer showLogo>
      <div className="mb-4">
        {status === "success" && (
          <div className="bg-cal-success mx-auto flex h-12 w-12 items-center justify-center rounded-full">
            <CheckIcon className="h-6 w-6 text-green-600" />
          </div>
        )}
        <div className="mt-3 text-center sm:mt-5">
          <h3 className="text-emphasis text-lg font-medium leading-6" id="modal-title">
            {t(
              status === "success"
                ? "youve_been_logged_out"
                : status === "error"
                  ? "something_went_wrong"
                  : "sign_out"
            )}
          </h3>
          <div className="mt-2" role={status === "error" ? "alert" : undefined} aria-live="polite">
            <p className="text-subtle text-sm">
              {t(status === "success" ? message() : status === "error" ? "please_try_again" : "loading")}
            </p>
          </div>
        </div>
      </div>
      {status === "error" && (
        <Button onClick={retry} className="mb-3 flex w-full justify-center">
          {t("try_again")}
        </Button>
      )}
      <Button
        data-testid="logout-btn"
        onClick={navigateToLogin}
        className="flex w-full justify-center"
        disabled={status !== "success"}
        loading={btnLoading || status === "pending"}>
        {t("go_back_login")}
      </Button>
    </AuthContainer>
  );
}

export default Logout;

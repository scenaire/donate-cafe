// Request-scoped Supabase client that reads the caller's auth session from
// cookies. Uses the ANON key — this is about identifying who is asking, not
// about bypassing RLS, so it must never be confused with lib/supabase.ts.
//
// Used to answer one question: is this request from the signed-in admin?

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

export async function supabaseFromCookies() {
  const store = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. Safe to
          // ignore — the session is refreshed by the route handlers instead.
        }
      },
    },
  });
}

// A valid session is necessary but NOT sufficient. Supabase Auth will happily
// mint a session for any address that completes a magic link, so without this
// check anyone able to receive email could sign in and read every tip. The
// single pre-registered admin address is the actual authorisation boundary
// (SRS 1.2); the session only proves control of an inbox.
export async function requireAdmin(): Promise<
  { ok: true; email: string } | { ok: false; response: NextResponse }
> {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    console.error("ADMIN_EMAIL is unset — refusing all admin access");
    return {
      ok: false,
      response: NextResponse.json({ error: "Admin access not configured." }, { status: 503 }),
    };
  }

  const client = await supabaseFromCookies();
  const { data, error } = await client.auth.getUser();
  const email = data?.user?.email?.trim().toLowerCase();

  if (error || !email) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }
  if (email !== adminEmail) {
    console.warn(`Rejected admin access for ${email}`);
    return { ok: false, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
  }

  return { ok: true, email };
}

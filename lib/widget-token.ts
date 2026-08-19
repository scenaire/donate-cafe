import { supabase } from "@/lib/supabase";

// SERVER ONLY. The OBS widget token used to be a static ALERT_WIDGET_TOKEN env
// var — rotating it meant a redeploy. It now lives in cafe_settings.widget_token
// so the Alerts overlay Settings panel can regenerate it live. Every route that
// used to compare against process.env.ALERT_WIDGET_TOKEN now goes through here
// instead.

export async function getWidgetToken(): Promise<string | null> {
  const { data, error } = await supabase.from("cafe_settings").select("widget_token").eq("id", true).maybeSingle();
  if (error) {
    console.error("Failed to load widget token", error.message);
    return null;
  }
  return (data?.widget_token as string | undefined) ?? null;
}

export async function isValidWidgetToken(token: string | null): Promise<boolean> {
  if (!token) return false;
  const expected = await getWidgetToken();
  return Boolean(expected) && token === expected;
}

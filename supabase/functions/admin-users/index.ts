// Owner-only user management. Needs the service-role key, so it can never run in the browser.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DOMAIN = "salesmantracker.app"; // hidden email domain; must match config.js

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return json({ error: "Not logged in" }, 401);
  const { data: me } = await admin.from("st_profiles").select("role,active").eq("id", user.id).maybeSingle();
  if (!me || me.role !== "owner" || !me.active) return json({ error: "Owner only" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  if (body.action === "create") {
    const username = String(body.username ?? "").trim().toLowerCase();
    const name = String(body.display_name ?? "").trim();
    const password = String(body.password ?? "");
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: "Username: 3-30 letters/numbers (a-z, 0-9 . _ -)" }, 400);
    if (!name) return json({ error: "Name is required" }, 400);
    if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);
    const { data, error } = await admin.auth.admin.createUser({
      email: `${username}@${DOMAIN}`, password, email_confirm: true,
    });
    if (error) return json({ error: error.message.includes("already") ? "Username already taken" : error.message }, 400);
    const { error: pErr } = await admin.from("st_profiles").insert({
      id: data.user.id, username, display_name: name, role: "salesman",
    });
    if (pErr) { await admin.auth.admin.deleteUser(data.user.id); return json({ error: pErr.message }, 400); }
    return json({ ok: true });
  }

  // The remaining actions only ever touch salesmen, never other owners.
  const { data: target } = await admin.from("st_profiles").select("id,role").eq("id", body.id).maybeSingle();
  if (!target || target.role !== "salesman") return json({ error: "Salesman not found" }, 404);

  if (body.action === "reset_password") {
    const password = String(body.password ?? "");
    if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);
    const { error } = await admin.auth.admin.updateUserById(target.id, { password });
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }

  if (body.action === "set_active") {
    const active = !!body.active;
    const { error } = await admin.auth.admin.updateUserById(target.id, { ban_duration: active ? "none" : "876000h" });
    if (error) return json({ error: error.message }, 400);
    await admin.from("st_profiles").update({ active }).eq("id", target.id);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});

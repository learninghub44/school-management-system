import { supabase } from "./supabaseClient.js";

export async function requireRole(allowed = []) {

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        window.location.href = "../auth/login.html";
        return null;
    }

    const { data: profile } = await supabase
        .from("users")
        .select("*")
        .eq("id", user.id)
        .single();

    if (!profile) return null;

    if (allowed.length && !allowed.includes(profile.role)) {
        alert("Access denied");
        window.location.href = "../../dashboard.html";
        return null;
    }

    return profile;
}
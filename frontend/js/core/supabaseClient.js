import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

/*
==================================================
SUPABASE CONFIG
==================================================
Replace with your real Supabase project values
==================================================
*/

const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";

/*
==================================================
CREATE SINGLE GLOBAL CLIENT
==================================================
*/

export const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

/*
==================================================
HELPER: GET CURRENT USER
==================================================
*/

export async function getCurrentUser() {

    const {
        data: { user },
        error
    } = await supabase.auth.getUser();

    if (error) {
        console.error("Auth error:", error.message);
        return null;
    }

    return user;
}

/*
==================================================
HELPER: LOGOUT
==================================================
*/

export async function logout() {

    await supabase.auth.signOut();

    window.location.href =
    "/pages/auth/login.html";
}
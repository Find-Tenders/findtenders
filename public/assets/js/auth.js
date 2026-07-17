import { supabase } from './supabaseClient.js';

// ---- Customer auth: email OTP (no passwords) ----

// Step 1: email a 6-digit code to the given address. Creates the account
// automatically on first use (shouldCreateUser: true), so login and
// register are the same call.
export async function requestCustomerOtp(email, fullName) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      data: fullName ? { full_name: fullName } : undefined,
    },
  });
  if (error) throw error;
}

// Step 2: verify the 6-digit code the user received by email.
export async function verifyCustomerOtp(email, code) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: 'email',
  });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getCurrentUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

// Fetches (and if missing, waits briefly for) the profile row created by
// the on_auth_user_created trigger.
export async function getMyProfile() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

// Redirects to the login-required page if there's no active session.
// Call this at the top of any page that requires a signed-in user.
export async function requireSession(redirectTo = '/') {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = redirectTo;
    return null;
  }
  return session;
}

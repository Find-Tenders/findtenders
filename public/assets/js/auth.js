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

// Fetches the caller's own profile row. Must filter by id explicitly —
// admins can see every profile under RLS, so relying on RLS alone to
// narrow to "just mine" breaks .single() for admin accounts.
export async function getMyProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
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

// Signs out and redirects if the account has been suspended by an admin.
// Call after fetching the profile, before showing any app content.
export async function blockIfSuspended(profile, redirectTo = '/') {
  if (profile.account_status === 'suspended') {
    await signOut();
    window.location.href = redirectTo + (redirectTo.includes('?') ? '&' : '?') + 'suspended=1';
    return true;
  }
  return false;
}

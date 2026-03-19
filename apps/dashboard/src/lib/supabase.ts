// Supabase is not used in FlexSend — replaced by flexsend.ts
// This file exists to prevent import errors in template files
export const supabase = {
  auth: {
    signInWithPassword: async () => ({ data: null, error: new Error('Not supported') }),
    signUp: async () => ({ data: null, error: new Error('Not supported') }),
    signOut: async () => ({ error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    updateUser: async () => ({ error: null }),
    resetPasswordForEmail: async () => ({ error: null }),
    resend: async () => ({ error: null }),
    signInWithOAuth: async () => ({ error: null }),
  },
};

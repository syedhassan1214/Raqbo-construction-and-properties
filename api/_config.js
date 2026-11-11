// RAQBO server functions — settings. Values can be overridden in Vercel → Settings → Environment Variables.
// The anon key is the same public key the website already uses (safe to publish). NEVER put the service_role key here.
module.exports = {
  SB_URL: process.env.SUPABASE_URL || 'https://usamujceckeghagaller.supabase.co',
  SB_KEY: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzYW11amNlY2tlZ2hhZ2FsbGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4NjM4NTUsImV4cCI6MjEwOTQzOTg1NX0.AgWD3Ksk9LOgq60JN2qcdsHVdOUGGa6e3DuAXuwH3eI',
  WA_NUMBER: process.env.RAQBO_WHATSAPP || '923001223344'
};

// Online database (Supabase). The publishable key is meant to be public: all
// protection is in the database rules (supabase/schema.sql).
// Only the real website uses it: opened as a file or from localhost (or with
// ?lokaal) everything stays in this browser. ?online forces the database.
window.JO = window.JO || {};
JO.config = {
  supabaseUrl: 'https://pnzaxsyslhyzfxjyknqz.supabase.co',
  supabaseKey: 'sb_publishable_QOPoOKmYXG7tFGp_zZSKKg_5K7Chm05'
};

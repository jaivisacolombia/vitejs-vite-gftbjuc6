import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Falta configurar la conexión con Supabase.');
}

export const supabase = createClient(supabaseUrl.trim(), supabaseKey.trim());

supabase.auth.getSession().then(({ data, error }) => {
  if (error) {
    console.error('JAIVISA - Error al comprobar la sesión:', error.message);
    return;
  }

  console.log('JAIVISA - Sesión activa:', !!data.session);
  console.log('JAIVISA - Conexión configurada con Supabase');
});

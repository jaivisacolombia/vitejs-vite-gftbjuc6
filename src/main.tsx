
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import InstallPWA from './InstallPWA.tsx';
import './supabase';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <InstallPWA />
  </StrictMode>
);

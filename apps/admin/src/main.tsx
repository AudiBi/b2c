import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { AppRoutes } from './App';
import { I18nProvider } from './i18n';
import { AppProviders, createQueryClient } from './providers';
import './styles/admin.css';

const container = document.getElementById('root');
if (!container) throw new Error('Élément #root introuvable');

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <AppProviders client={createQueryClient()}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AppProviders>
    </I18nProvider>
  </StrictMode>,
);

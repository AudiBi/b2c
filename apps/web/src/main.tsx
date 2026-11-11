import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { AppRoutes } from './App';
import { DEFAULT_LANG, isLang, loadCatalog } from './i18n';
import { preloadRoute } from './page-preload';
import { AppProviders, createQueryClient } from './providers';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

const container = document.getElementById('root');
if (!container) throw new Error('Élément #root introuvable');

const app = (
  <StrictMode>
    <AppProviders client={createQueryClient()}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  </StrictMode>
);

// Seuls les textes de la langue de la page sont téléchargés (la langue inconnue retombe sur le français, comme le rendu serveur)
const segment = window.location.pathname.split('/')[1];
await Promise.all([loadCatalog(isLang(segment) ? segment : DEFAULT_LANG), preloadRoute(window.location.pathname)]);

// Pages pré-rendues : on « hydrate » le HTML existant ; sinon (espace client) on construit l'interface
if (container.hasChildNodes()) hydrateRoot(container, app);
else createRoot(container).render(app);

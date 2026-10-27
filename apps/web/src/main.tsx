import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { AppRoutes } from './App';
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

// Pages pré-rendues : on « hydrate » le HTML existant ; sinon (espace client) on construit l'interface
if (container.hasChildNodes()) hydrateRoot(container, app);
else createRoot(container).render(app);

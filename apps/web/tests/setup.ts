import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import '../src/i18n/all';
import { preloadAllPages } from '../src/page-preload';

afterEach(() => cleanup());

// jsdom n'implémente pas le défilement
window.scrollTo = () => undefined;

// Le premier écran de l'espace connecté charge ses modules à la demande : on laisse 5 s aux recherches asynchrones
configure({ asyncUtilTimeout: 5000 });

// Pages à chargement différé (formulaires) : disponibles dès le premier rendu des tests, comme après le préchargement du site
await preloadAllPages();

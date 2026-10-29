import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

afterEach(() => cleanup());

// jsdom n'implémente pas le défilement
window.scrollTo = () => undefined;

// L'interface du panel suit la langue mémorisée : les tests s'écrivent en français
beforeEach(() => window.localStorage.setItem('b2c.admin.lang', 'fr'));

// Le premier écran de l'espace connecté charge ses modules à la demande : on laisse 5 s aux recherches asynchrones
configure({ asyncUtilTimeout: 5000 });

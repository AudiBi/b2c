import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// jsdom n'implémente pas le défilement
window.scrollTo = () => undefined;

// Le premier écran de l'espace connecté charge ses modules à la demande : on laisse 5 s aux recherches asynchrones
configure({ asyncUtilTimeout: 5000 });

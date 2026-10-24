/** Mots de passe trop courants refusés (liste courte ; à remplacer par une vraie liste en production). */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  [
    'password', 'password1', 'password123', 'passw0rd', 'motdepasse', 'motdepasse1', 'modpas123',
    '123456', '1234567', '12345678', '123456789', '1234567890', '0123456789', '11111111', '00000000',
    'qwerty', 'qwerty123', 'qwertyuiop', 'azerty', 'azerty123', 'azertyuiop', 'abc123', 'abcd1234',
    'iloveyou', 'welcome', 'welcome1', 'admin', 'admin123', 'administrator', 'letmein', 'monkey',
    'dragon', 'football', 'baseball', 'master', 'sunshine', 'princess', 'login', 'changeme',
    'haiti', 'haiti123', 'ayiti', 'ayiti123', 'portauprince', 'transithaiti', 'transit123', 'colis123',
  ].map((p) => p.toLowerCase()),
);

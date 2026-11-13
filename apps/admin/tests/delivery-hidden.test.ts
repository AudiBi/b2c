import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogs } from '../src/i18n';

const fr = catalogs.fr;
const user = { id: 'u', companyId: 'c', kind: 'STAFF', email: 'a@x.test', firstName: 'A', lastName: 'B', locale: 'fr', emailVerified: true, roles: [], permissions: ['delivery:read', 'delivery:read_assigned', 'package:read'] };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('livraison à domicile', () => {
  it('masquée par défaut : ni « Tournées » ni « Mes tournées » dans le menu, même avec les droits', async () => {
    vi.stubEnv('VITE_FEATURE_DELIVERY', 'false');
    vi.resetModules();
    const { buildNav } = await import('../src/components/layout/nav');
    const labels = buildNav(user as never, fr).flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain(fr.staff.nav.packages);
    expect(labels).not.toContain(fr.staff.nav.routes);
    expect(labels).not.toContain(fr.staff.nav.myRoutes);
  });

  it('réactivable par VITE_FEATURE_DELIVERY=true', async () => {
    vi.stubEnv('VITE_FEATURE_DELIVERY', 'true');
    vi.resetModules();
    const { buildNav } = await import('../src/components/layout/nav');
    const labels = buildNav(user as never, fr).flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain(fr.staff.nav.routes);
    expect(labels).toContain(fr.staff.nav.myRoutes);
  });
});

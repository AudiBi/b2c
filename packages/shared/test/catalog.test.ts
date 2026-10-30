import {
  PERMISSIONS,
  PERMISSION_CODES,
  ROLE_BY_CODE,
  ROLE_CODES,
  ROLE_DEFINITIONS,
  isReadOnlyPermission,
  PermissionSet,
  registerSchema,
  createCompanySchema,
  roleAssignmentSchema,
} from '../src';

describe('catalogue des rôles et permissions', () => {
  it('définit les 12 rôles du cahier des charges et les 2 rôles de l’équipe d’un compte professionnel', () => {
    expect(ROLE_DEFINITIONS).toHaveLength(14);
    expect(new Set(ROLE_DEFINITIONS.map((r) => r.code)).size).toBe(14);
    expect(ROLE_DEFINITIONS.map((r) => r.code).sort()).toEqual([...ROLE_CODES].sort());
  });

  it('ne référence que des permissions existantes, sans doublon par rôle', () => {
    for (const role of ROLE_DEFINITIONS) {
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
      for (const code of role.permissions) expect(PERMISSIONS).toHaveProperty(code);
    }
  });

  it('respecte le format ressource:action pour chaque permission', () => {
    for (const code of PERMISSION_CODES) expect(code).toMatch(/^[a-z_]+:[a-z_]+$/);
  });

  it("l'auditeur n'a que des permissions de lecture", () => {
    const auditor = ROLE_BY_CODE.get('AUDITOR')!;
    expect(auditor.permissions.length).toBeGreaterThan(10);
    expect(auditor.permissions.every(isReadOnlyPermission)).toBe(true);
    expect(auditor.permissions).toContain('audit:read');
  });

  it('le super administrateur n\'a aucune permission métier', () => {
    const forbidden = ['package:read', 'invoice:read', 'payment:record_cash', 'customer:read'];
    const superAdmin = ROLE_BY_CODE.get('SUPER_ADMIN')!;
    for (const code of forbidden) expect(superAdmin.permissions).not.toContain(code);
  });

  it("seul l'administrateur d'entreprise et le super administrateur gèrent les rôles", () => {
    const holders = ROLE_DEFINITIONS.filter((r) => r.permissions.includes('role:assign')).map((r) => r.code);
    expect(holders.sort()).toEqual(['COMPANY_ADMIN', 'SUPER_ADMIN']);
  });

  it("le livreur et le service client ne peuvent pas encaisser d'espèces", () => {
    for (const code of ['DRIVER', 'CUSTOMER_SERVICE', 'AUDITOR', 'RECEPTION_AGENT'] as const) {
      expect(ROLE_BY_CODE.get(code)!.permissions).not.toContain('payment:record_cash');
    }
  });

  it("les clients n'ont que des permissions limitées à leurs propres données", () => {
    for (const code of ['CUSTOMER_INDIVIDUAL', 'CUSTOMER_BUSINESS'] as const) {
      for (const permission of ROLE_BY_CODE.get(code)!.permissions) {
        expect(permission.endsWith('_own') || permission === 'quote:create').toBe(true);
      }
    }
  });
});

describe('PermissionSet', () => {
  const warehouseA = '00000000-0000-7000-8000-00000000000a';
  const warehouseB = '00000000-0000-7000-8000-00000000000b';
  const set = new PermissionSet([
    { permission: 'package:receive', scopeType: 'WAREHOUSE', scopeId: warehouseA },
    { permission: 'invoice:read', scopeType: 'COMPANY', scopeId: null },
  ]);

  it('une attribution de portée entreprise vaut partout', () => {
    expect(set.can('invoice:read')).toBe(true);
    expect(set.can('invoice:read', { type: 'WAREHOUSE', id: warehouseB })).toBe(true);
  });

  it("une attribution d'entrepôt ne vaut que pour cet entrepôt", () => {
    expect(set.can('package:receive', { type: 'WAREHOUSE', id: warehouseA })).toBe(true);
    expect(set.can('package:receive', { type: 'WAREHOUSE', id: warehouseB })).toBe(false);
    expect(set.can('package:receive')).toBe(false);
    expect(set.can('package:receive', { type: 'AGENCY', id: warehouseA })).toBe(false);
  });

  it('has() accepte une permission détenue dans une portée quelconque', () => {
    expect(set.has('package:receive')).toBe(true);
    expect(set.has('payment:record_cash')).toBe(false);
  });

  it('coversCompanyWide exige la portée entreprise', () => {
    expect(set.coversCompanyWide(['invoice:read'])).toBe(true);
    expect(set.coversCompanyWide(['package:receive'])).toBe(false);
  });

  it('ignore une attribution scopée sans identifiant', () => {
    const broken = new PermissionSet([{ permission: 'package:receive', scopeType: 'WAREHOUSE', scopeId: null }]);
    expect(broken.has('package:receive')).toBe(false);
  });

  it('scopeIds retourne les objets autorisés', () => {
    expect(set.scopeIds('package:receive', 'WAREHOUSE')).toEqual([warehouseA]);
  });
});

describe('schémas de validation', () => {
  const valid = {
    companySlug: 'demo',
    accountType: 'INDIVIDUAL',
    email: '  Marie@Example.COM ',
    password: 'correct-horse-battery',
    firstName: 'Marie',
    lastName: 'Jean',
    acceptTerms: true,
  };

  it("normalise l'e-mail et applique la langue par défaut", () => {
    const parsed = registerSchema.parse(valid);
    expect(parsed.email).toBe('marie@example.com');
    expect(parsed.locale).toBe('fr');
  });

  it('refuse les champs inconnus (pas de mass assignment)', () => {
    expect(registerSchema.safeParse({ ...valid, roles: ['COMPANY_ADMIN'] }).success).toBe(false);
  });

  it('refuse un mot de passe court, courant ou contenant l\'e-mail', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: 'Password123' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: 'xxmariexx-1234' }).success).toBe(false);
  });

  it('exige les conditions acceptées et la raison sociale pour un compte professionnel', () => {
    expect(registerSchema.safeParse({ ...valid, acceptTerms: false }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, accountType: 'BUSINESS' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, accountType: 'BUSINESS', businessName: 'Ets Jean' }).success).toBe(true);
  });

  it('valide le format du téléphone', () => {
    expect(registerSchema.safeParse({ ...valid, phone: '+50937000000' }).success).toBe(true);
    expect(registerSchema.safeParse({ ...valid, phone: '37000000' }).success).toBe(false);
  });

  it("refuse de créer une entreprise avec l'identifiant réservé", () => {
    const input = {
      name: 'Test', slug: 'platform', trackingPrefix: 'TT', customerCodePrefix: 'TT',
      adminEmail: 'a@example.com', adminFirstName: 'A', adminLastName: 'B',
    };
    expect(createCompanySchema.safeParse(input).success).toBe(false);
    expect(createCompanySchema.safeParse({ ...input, slug: 'test-co' }).success).toBe(true);
  });

  it('une portée non COMPANY exige un identifiant', () => {
    expect(roleAssignmentSchema.safeParse({ roleCode: 'RECEPTION_AGENT', scopeType: 'WAREHOUSE' }).success).toBe(false);
    expect(
      roleAssignmentSchema.safeParse({
        roleCode: 'RECEPTION_AGENT',
        scopeType: 'WAREHOUSE',
        scopeId: '00000000-0000-7000-8000-00000000000a',
      }).success,
    ).toBe(true);
    expect(
      roleAssignmentSchema.safeParse({ roleCode: 'AUDITOR', scopeType: 'COMPANY', scopeId: '00000000-0000-7000-8000-00000000000a' }).success,
    ).toBe(false);
  });
});

// Moindre privilège pour l'équipe d'un compte professionnel : jamais d'argent, de code de remise, d'adresse, de profil ni d'équipe
describe("rôles de l'équipe d'un compte professionnel", () => {
  const forbidden = ['payment:read_own', 'payment:declare_own', 'team:manage_own', 'profile:read_own', 'profile:update_own', 'notification:read_own'];
  it.each(['TEAM_READER', 'TEAM_OPERATOR'])('%s : droits « _own » limités, aucun droit sensible', (code) => {
    const role = ROLE_DEFINITIONS.find((r) => r.code === code)!;
    expect(role.audience).toBe('CUSTOMER');
    expect(role.allowedScopes).toEqual(['COMPANY']);
    for (const p of role.permissions) expect(p.endsWith('_own')).toBe(true);
    for (const p of forbidden) expect(role.permissions).not.toContain(p);
  });
  it("le lecteur voit les factures, pas l'opérateur ; l'opérateur déclare des achats, pas le lecteur ; seul le client professionnel gère l'équipe", () => {
    const perms = (code: string) => ROLE_DEFINITIONS.find((r) => r.code === code)!.permissions;
    expect(perms('TEAM_READER')).toContain('invoice:read_own');
    expect(perms('TEAM_OPERATOR')).not.toContain('invoice:read_own');
    expect(perms('TEAM_OPERATOR')).toContain('prealert:create_own');
    expect(perms('TEAM_READER')).not.toContain('prealert:create_own');
    expect(perms('CUSTOMER_BUSINESS')).toContain('team:manage_own');
    expect(perms('CUSTOMER_INDIVIDUAL')).not.toContain('team:manage_own');
  });
});

import {
  assignClaimSchema,
  claimStatusSchema,
  createClaimSchema,
  createRouteSchema,
  dashboardQuerySchema,
  deliverySettingsSchema,
  failDeliverySchema,
  handoverCodeSchema,
  handoverSchema,
  listClaimsQuerySchema,
} from '../src';

const uuid = '3f2b8c1e-9d4a-4e6b-8a1f-2c7d5e9b0a11';

describe('remise : preuves', () => {
  it('le client lui-même : aucun bénéficiaire attendu ; un bénéficiaire en exige un', () => {
    expect(handoverSchema.safeParse({ recipientKind: 'CUSTOMER' }).success).toBe(true);
    expect(handoverSchema.safeParse({ recipientKind: 'CUSTOMER', beneficiaryId: uuid }).success).toBe(false);
    expect(handoverSchema.safeParse({ recipientKind: 'BENEFICIARY' }).success).toBe(false);
    expect(handoverSchema.safeParse({ recipientKind: 'BENEFICIARY', beneficiaryId: uuid }).success).toBe(true);
  });

  it('le code de remise a 6 chiffres exactement', () => {
    for (const ok of ['000000', '123456', ' 987654 ']) expect(handoverCodeSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['12345', '1234567', '12a456', '', '١٢٣٤٥٦']) expect(handoverCodeSchema.safeParse(bad).success).toBe(false);
  });

  it('jamais plus de 4 caractères de la pièce d’identité', () => {
    expect(handoverSchema.safeParse({ recipientKind: 'CUSTOMER', idDocumentType: 'PASSPORT', idDocumentLast4: 'AB12' }).success).toBe(true);
    for (const bad of ['AB123', 'AB1', 'AB 1', 'AB-1']) {
      expect(handoverSchema.safeParse({ recipientKind: 'CUSTOMER', idDocumentLast4: bad }).success).toBe(false);
    }
  });

  it('une dérogation de solde exige un motif ; les champs inconnus sont refusés', () => {
    expect(handoverSchema.safeParse({ recipientKind: 'CUSTOMER', overrideBalance: {} }).success).toBe(false);
    expect(handoverSchema.safeParse({ recipientKind: 'CUSTOMER', overrideBalance: { reason: '   ' } }).success).toBe(false);
    expect(handoverSchema.safeParse({ recipientKind: 'CUSTOMER', overrideBalance: { reason: 'Promis' } }).success).toBe(true);
    expect(handoverSchema.safeParse({ recipientKind: 'CUSTOMER', status: 'DELIVERED' }).success).toBe(false);
  });

  it('livraison non aboutie : motif dans la liste, reprogrammation en date valide', () => {
    expect(failDeliverySchema.safeParse({ reason: 'ABSENT' }).success).toBe(true);
    expect(failDeliverySchema.safeParse({ reason: 'ABSENT', rescheduleFor: '2026-12-01' }).success).toBe(true);
    expect(failDeliverySchema.safeParse({ reason: 'VOLE' }).success).toBe(false);
    expect(failDeliverySchema.safeParse({ reason: 'ABSENT', rescheduleFor: 'demain' }).success).toBe(false);
  });

  it('réglages : au moins un champ, pas de valeur inventée', () => {
    expect(deliverySettingsSchema.safeParse({}).success).toBe(false);
    expect(deliverySettingsSchema.safeParse({ requirePhoto: true }).data).toEqual({ requirePhoto: true });
    expect(deliverySettingsSchema.safeParse({ requireOtp: 'oui' }).success).toBe(false);
  });

  it('tournée : agence, livreur et date valides', () => {
    expect(createRouteSchema.safeParse({ agencyId: uuid, driverUserId: uuid, plannedDate: '2026-11-02' }).success).toBe(true);
    expect(createRouteSchema.safeParse({ agencyId: uuid, driverUserId: 'x', plannedDate: '2026-11-02' }).success).toBe(false);
    expect(createRouteSchema.safeParse({ agencyId: uuid, driverUserId: uuid, plannedDate: '02/11/2026' }).success).toBe(false);
  });
});

describe('réclamations', () => {
  it('ouverture : catégorie connue, objet et message non vides', () => {
    expect(createClaimSchema.safeParse({ category: 'LOST', subject: 'Perdu', message: 'Mon colis' }).success).toBe(true);
    expect(createClaimSchema.safeParse({ category: 'LOST', subject: '  ', message: 'x' }).success).toBe(false);
    expect(createClaimSchema.safeParse({ category: 'FRAUD', subject: 'x', message: 'x' }).success).toBe(false);
    expect(createClaimSchema.safeParse({ category: 'LOST', subject: 'x', message: 'x', status: 'RESOLVED' }).success).toBe(false);
  });

  it('clôturer (résolue ou rejetée) exige une résolution ; rouvrir non', () => {
    expect(claimStatusSchema.safeParse({ status: 'RESOLVED' }).success).toBe(false);
    expect(claimStatusSchema.safeParse({ status: 'REJECTED', resolution: '  ' }).success).toBe(false);
    expect(claimStatusSchema.safeParse({ status: 'REJECTED', resolution: 'Hors sujet' }).success).toBe(true);
    expect(claimStatusSchema.safeParse({ status: 'IN_PROGRESS' }).success).toBe(true);
  });

  it('affectation : un identifiant ou null', () => {
    expect(assignClaimSchema.safeParse({ userId: uuid }).success).toBe(true);
    expect(assignClaimSchema.safeParse({ userId: null }).success).toBe(true);
    expect(assignClaimSchema.safeParse({}).success).toBe(false);
  });

  it('liste : limites de pagination et filtres connus', () => {
    expect(listClaimsQuerySchema.parse({})).toMatchObject({ limit: 25 });
    expect(listClaimsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(listClaimsQuerySchema.safeParse({ status: 'NOPE' }).success).toBe(false);
  });
});

describe('tableau de bord : période', () => {
  it('sans période, ou période complète et cohérente', () => {
    expect(dashboardQuerySchema.safeParse({}).success).toBe(true);
    expect(dashboardQuerySchema.safeParse({ from: '2026-01-01', to: '2026-01-31' }).success).toBe(true);
  });

  it('refuse une période incomplète, inversée, trop longue ou mal formée', () => {
    for (const bad of [{ from: '2026-01-01' }, { to: '2026-01-01' }, { from: '2026-02-01', to: '2026-01-01' }, { from: '2025-01-01', to: '2026-06-01' }, { from: 'x', to: 'y' }]) {
      expect(dashboardQuerySchema.safeParse(bad).success).toBe(false);
    }
  });
});

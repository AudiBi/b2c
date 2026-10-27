import {
  HOLD_REASON_CODES,
  PACKAGE_STATUSES,
  TERMINAL_STATUSES,
  TRANSITION_RULES,
  findTransition,
  isTerminal,
  isTransitionAllowed,
  type PackageStatus,
} from '../src/package-status';
import { PERMISSIONS } from '../src/permissions';

const key = (from: string, to: string) => `${from}>${to}`;

describe('machine d’états des colis', () => {
  it('définit exactement les 17 statuts du cahier des charges', () => {
    expect(PACKAGE_STATUSES).toHaveLength(17);
    expect(new Set(PACKAGE_STATUSES).size).toBe(17);
  });

  it('la table liste exactement les transitions attendues, sans doublon', () => {
    const pairs = TRANSITION_RULES.map((r) => key(r.from, r.to));
    expect(new Set(pairs).size).toBe(pairs.length);
    // 26 transitions « normales » + 12 vers ON_HOLD (tous les statuts non terminaux sauf la préalerte et ON_HOLD)
    // + 2 sorties de ON_HOLD (retourner, annuler) = 40
    const toHold = TRANSITION_RULES.filter((r) => r.to === 'ON_HOLD');
    expect(toHold.map((r) => r.from).sort()).toEqual(
      PACKAGE_STATUSES.filter((s) => !isTerminal(s) && s !== 'PREALERT_CREATED' && s !== 'ON_HOLD').sort(),
    );
    expect(toHold).toHaveLength(12);
    expect(TRANSITION_RULES).toHaveLength(40);
  });

  it('TEST EXHAUSTIF : sur les 289 paires, seules celles de la table sont autorisées', () => {
    const allowed = new Set(TRANSITION_RULES.map((r) => key(r.from, r.to)));
    let accepted = 0;
    for (const from of PACKAGE_STATUSES) {
      for (const to of PACKAGE_STATUSES) {
        const expected = allowed.has(key(from, to));
        expect({ from, to, allowed: isTransitionAllowed(from, to) }).toEqual({ from, to, allowed: expected });
        if (expected) accepted += 1;
      }
    }
    expect(accepted).toBe(TRANSITION_RULES.length);
    expect(PACKAGE_STATUSES.length ** 2).toBe(289);
  });

  it('aucune transition ne sort d’un statut terminal', () => {
    for (const from of TERMINAL_STATUSES) {
      for (const to of PACKAGE_STATUSES) expect(isTransitionAllowed(from, to, 'IN_TRANSIT')).toBe(false);
    }
  });

  it('aucune transition ne revient à PREALERT_CREATED, ni ne passe de statut à lui-même', () => {
    for (const from of PACKAGE_STATUSES) {
      expect(isTransitionAllowed(from, 'PREALERT_CREATED')).toBe(false);
      expect(isTransitionAllowed(from, from)).toBe(false);
    }
  });

  it('aucun « saut » en avant : on ne peut pas passer de la préalerte directement à livré, ni sauter la pesée', () => {
    expect(isTransitionAllowed('AWAITING_RECEIPT', 'REGISTERED_WEIGHED')).toBe(false);
    expect(isTransitionAllowed('RECEIVED_AT_WAREHOUSE', 'READY_TO_SHIP')).toBe(false);
    expect(isTransitionAllowed('READY_TO_SHIP', 'DELIVERED')).toBe(false);
    expect(isTransitionAllowed('IN_TRANSIT', 'READY_FOR_PICKUP')).toBe(false);
    expect(isTransitionAllowed('PREALERT_CREATED', 'RECEIVED_AT_WAREHOUSE')).toBe(false);
  });

  it('la reprise depuis ON_HOLD n’est possible que vers le statut précédent', () => {
    expect(isTransitionAllowed('ON_HOLD', 'IN_TRANSIT', 'IN_TRANSIT')).toBe(true);
    expect(isTransitionAllowed('ON_HOLD', 'DELIVERED', 'IN_TRANSIT')).toBe(false);
    expect(isTransitionAllowed('ON_HOLD', 'IN_TRANSIT', 'RECEIVED_AT_WAREHOUSE')).toBe(false);
    expect(isTransitionAllowed('ON_HOLD', 'IN_TRANSIT', null)).toBe(false);
    expect(isTransitionAllowed('ON_HOLD', 'IN_TRANSIT')).toBe(false);
    // On ne « reprend » jamais vers un statut qui n'est pas retenable
    expect(isTransitionAllowed('ON_HOLD', 'ON_HOLD', 'ON_HOLD')).toBe(false);
    expect(isTransitionAllowed('ON_HOLD', 'PREALERT_CREATED', 'PREALERT_CREATED')).toBe(false);
    expect(findTransition('ON_HOLD', 'IN_TRANSIT', 'IN_TRANSIT')?.permission).toBe('package:release_hold');
  });

  it('depuis ON_HOLD on peut aussi retourner ou annuler, avec un motif', () => {
    expect(findTransition('ON_HOLD', 'RETURNED')?.reasonRequired).toBe(true);
    expect(findTransition('ON_HOLD', 'CANCELLED')?.reasonRequired).toBe(true);
  });

  it('retenir, retourner, annuler et renvoyer en agence exigent un motif', () => {
    for (const rule of TRANSITION_RULES) {
      if (['ON_HOLD', 'RETURNED', 'CANCELLED'].includes(rule.to)) expect({ rule: key(rule.from, rule.to), reason: rule.reasonRequired }).toEqual({ rule: key(rule.from, rule.to), reason: true });
    }
    expect(findTransition('OUT_FOR_DELIVERY', 'READY_FOR_PICKUP')?.reasonRequired).toBe(true);
  });

  it('chaque permission exigée existe dans le catalogue', () => {
    for (const rule of TRANSITION_RULES) if (rule.permission) expect(PERMISSIONS).toHaveProperty(rule.permission);
  });

  it('seule la création de la préalerte est automatique (sans permission)', () => {
    const automatic = TRANSITION_RULES.filter((r) => r.permission === null);
    expect(automatic.map((r) => key(r.from, r.to))).toEqual(['PREALERT_CREATED>AWAITING_RECEIPT']);
  });

  it('le chemin nominal complet existe de bout en bout', () => {
    const path: PackageStatus[] = [
      'PREALERT_CREATED', 'AWAITING_RECEIPT', 'RECEIVED_AT_WAREHOUSE', 'UNDER_INSPECTION', 'REGISTERED_WEIGHED',
      'AWAITING_PAYMENT', 'READY_TO_SHIP', 'IN_TRANSIT', 'ARRIVED_DESTINATION', 'IN_CUSTOMS', 'RECEIVED_AT_AGENCY',
      'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED',
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect({ step: key(path[i], path[i + 1]), ok: isTransitionAllowed(path[i], path[i + 1]) }).toEqual({ step: key(path[i], path[i + 1]), ok: true });
    }
  });

  it('les motifs d’anomalie sont définis', () => {
    expect(HOLD_REASON_CODES).toContain('DAMAGED');
    expect(HOLD_REASON_CODES).toContain('UNIDENTIFIED');
  });
});

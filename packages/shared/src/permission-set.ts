import type { ScopeType } from './roles';

export interface Grant {
  permission: string;
  scopeType: ScopeType;
  scopeId: string | null;
}

export interface ScopeRef {
  type: Exclude<ScopeType, 'COMPANY'>;
  id: string;
}

/**
 * Ensemble des permissions d'un utilisateur avec leur portée.
 * - une attribution de portée COMPANY vaut pour toute l'entreprise ;
 * - une attribution WAREHOUSE / AGENCY / ROUTE ne vaut que pour l'objet désigné.
 */
export class PermissionSet {
  private readonly company = new Set<string>();
  private readonly scoped = new Map<string, Set<string>>();

  constructor(grants: readonly Grant[]) {
    for (const grant of grants) {
      if (grant.scopeType === 'COMPANY') {
        this.company.add(grant.permission);
      } else if (grant.scopeId) {
        const key = `${grant.scopeType}:${grant.scopeId}`;
        const set = this.scoped.get(key) ?? new Set<string>();
        set.add(grant.permission);
        this.scoped.set(key, set);
      }
    }
  }

  /** Vrai si la permission est détenue dans au moins une portée (contrôle d'entrée de route). */
  has(permission: string): boolean {
    if (this.company.has(permission)) return true;
    for (const set of this.scoped.values()) if (set.has(permission)) return true;
    return false;
  }

  /** Vrai si la permission est détenue pour cet objet précis (ou pour toute l'entreprise). */
  can(permission: string, scope?: ScopeRef): boolean {
    if (this.company.has(permission)) return true;
    if (!scope) return false;
    return this.scoped.get(`${scope.type}:${scope.id}`)?.has(permission) ?? false;
  }

  /** Vrai si toutes les permissions données sont détenues sur toute l'entreprise. */
  coversCompanyWide(permissions: readonly string[]): boolean {
    return permissions.every((permission) => this.company.has(permission));
  }

  /** Identifiants des objets d'un type pour lesquels la permission est détenue. */
  scopeIds(permission: string, type: ScopeRef['type']): string[] {
    const ids: string[] = [];
    for (const [key, set] of this.scoped) {
      const [scopeType, id] = key.split(':');
      if (scopeType === type && set.has(permission)) ids.push(id);
    }
    return ids;
  }

  /** Permissions détenues dans au moins une portée, triées. */
  list(): string[] {
    const all = new Set(this.company);
    for (const set of this.scoped.values()) set.forEach((p) => all.add(p));
    return [...all].sort();
  }
}

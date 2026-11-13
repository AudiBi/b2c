/**
 * Lecture et contrôle d'un export de l'outil de gestion (base JSON `b2c_db_v1`). Aucune écriture : ce module ne fait que
 * transformer et signaler les anomalies. Il sert à la simulation (rapport) et à l'import réel.
 */

export type PackageStatus = 'RECEIVED_AT_WAREHOUSE' | 'IN_TRANSIT' | 'ARRIVED_DESTINATION' | 'IN_CUSTOMS' | 'READY_FOR_PICKUP' | 'DELIVERED' | 'RETURNED';

export const STATUS_MAP: Record<string, PackageStatus> = {
  'Reçu aux USA': 'RECEIVED_AT_WAREHOUSE',
  'En transit': 'IN_TRANSIT',
  'Arrivé en Haïti': 'ARRIVED_DESTINATION',
  'En douane': 'IN_CUSTOMS',
  'Prêt pour livraison': 'READY_FOR_PICKUP',
  'Livré': 'DELIVERED',
  'Retourné': 'RETURNED',
};
export const CLOSED: PackageStatus[] = ['DELIVERED', 'RETURNED'];

const LB_TO_KG = 0.45359237;
const IN_TO_CM = 2.54;
/** Les colis terminés depuis plus longtemps ne sont pas importés (archivés en fichier). */
export const CLOSED_KEEP_MONTHS = 12;

export interface RawClient {
  id: number;
  nom?: string;
  tel?: string;
  telht?: string;
  telht2?: string;
  email?: string;
  adr?: string;
  pays?: string;
  ref?: string;
  cree?: string;
}
export interface RawPackage {
  id: number;
  code?: string;
  client?: number | string;
  mode?: string;
  date?: string;
  dest?: string;
  tel?: string;
  adr?: string;
  suivi_ext?: string;
  desc?: string;
  poids?: number;
  longueur?: number;
  largeur?: number;
  hauteur?: number;
  qte?: number;
  montant?: number;
  paye?: number;
  statut?: string;
  hist?: [string, string, string?][];
}
export interface RawDb {
  clients?: RawClient[];
  colis?: RawPackage[];
}

export interface CustomerPlan {
  legacyId: number;
  firstName: string;
  lastName: string;
  businessName: string | null;
  phone: string | null;
  email: string | null;
  createdAt: Date;
  note: string | null;
}
export interface PackagePlan {
  legacyId: number;
  legacyCode: string;
  customerLegacyId: number;
  mode: 'AIR' | 'SEA';
  status: PackageStatus;
  recipientName: string;
  recipientPhone: string | null;
  recipientCity: string | null;
  description: string | null;
  supplierTracking: string | null;
  weightKg: number | null;
  dimsCm: { length: number; width: number; height: number } | null;
  measuresEstimated: boolean;
  createdAt: Date;
  /** Montant restant dû dans le prototype (information de rapprochement ; aucune facture n'est créée). */
  balanceDue: number;
}

export type Issue = { kind: string; ref: string; detail: string };
export interface ImportPlan {
  customers: CustomerPlan[];
  packages: PackagePlan[];
  issues: Issue[];
  skipped: { closedTooOld: number };
  stats: { clientsRead: number; packagesRead: number; byStatus: Record<string, number>; openBalanceByCustomer: Record<number, number> };
}

/** Téléphone au format international (+ et 8 à 15 chiffres), sinon null. */
export function normalizePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(cleaned) ? cleaned : null;
}

/** Date (AAAA-MM-JJ, éventuellement suivie d'une heure) ; sinon null. */
export function parseDay(raw: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw ?? '');
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().replace(/\s+/g, ' ').split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

const roundMoney = (n: number) => Math.round(n * 100) / 100;

export interface PlanOptions {
  /** Colis avancé sans poids ni dimensions (fûts, conteneurs) : met 1 kg et 1 cm, marqués « estimés » (sinon le colis est écarté). */
  estimateMissingMeasures?: boolean;
}

export function buildPlan(db: RawDb, now: Date = new Date(), options: PlanOptions = {}): ImportPlan {
  const issues: Issue[] = [];
  const customers: CustomerPlan[] = [];
  const packages: PackagePlan[] = [];
  const byStatus: Record<string, number> = {};
  const openBalanceByCustomer: Record<number, number> = {};
  let closedTooOld = 0;

  const seenPhone = new Map<string, number>();
  const knownClients = new Set<number>();
  for (const c of db.clients ?? []) {
    const ref = `client #${c.id}`;
    const name = (c.nom ?? '').trim();
    if (!name) {
      issues.push({ kind: 'CLIENT_SANS_NOM', ref, detail: 'client ignoré (nom vide)' });
      continue;
    }
    const phones = [c.tel, c.telht, c.telht2].filter(Boolean);
    const valid = phones.map((p) => normalizePhone(p)).filter((p): p is string => p !== null);
    if (phones.length > 0 && valid.length === 0) issues.push({ kind: 'TELEPHONE_INVALIDE', ref, detail: `aucun numéro exploitable : ${phones.join(' / ')}` });
    const phone = valid[0] ?? null;
    if (phone) {
      const other = seenPhone.get(phone);
      if (other !== undefined) issues.push({ kind: 'TELEPHONE_EN_DOUBLE', ref, detail: `${phone} déjà utilisé par le client #${other}` });
      else seenPhone.set(phone, c.id);
    }
    const email = (c.email ?? '').trim().toLowerCase();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (email && !emailOk) issues.push({ kind: 'EMAIL_INVALIDE', ref, detail: email });
    const created = parseDay(c.cree) ?? now;
    const { firstName, lastName } = splitName(name);
    const extraPhones = valid.slice(1);
    const notes = [c.adr ? `Adresse : ${c.adr}` : '', c.pays ? `Pays : ${c.pays}` : '', c.ref ? `Référent : ${c.ref}` : '', extraPhones.length ? `Autres téléphones : ${extraPhones.join(', ')}` : '']
      .filter(Boolean)
      .join(' · ');
    knownClients.add(c.id);
    customers.push({ legacyId: c.id, firstName, lastName, businessName: null, phone, email: emailOk ? email : null, createdAt: created, note: notes || null });
  }

  const seenCode = new Set<string>();
  for (const p of db.colis ?? []) {
    const code = (p.code ?? '').trim();
    const ref = `colis ${code || `#${p.id}`}`;
    if (!code) {
      issues.push({ kind: 'CODE_ABSENT', ref, detail: 'colis ignoré (aucun code)' });
      continue;
    }
    if (seenCode.has(code)) {
      issues.push({ kind: 'CODE_EN_DOUBLE', ref, detail: 'colis ignoré (code déjà vu)' });
      continue;
    }
    seenCode.add(code);
    const status = STATUS_MAP[p.statut ?? ''];
    if (!status) {
      issues.push({ kind: 'STATUT_INCONNU', ref, detail: `« ${p.statut ?? ''} » : colis ignoré` });
      continue;
    }
    const customerId = Number(p.client);
    if (!knownClients.has(customerId)) {
      issues.push({ kind: 'CLIENT_INTROUVABLE', ref, detail: `client #${p.client} absent : colis ignoré` });
      continue;
    }
    const mode = p.mode === 'Aérien' ? 'AIR' : p.mode === 'Maritime' ? 'SEA' : null;
    if (!mode) {
      issues.push({ kind: 'MODE_INCONNU', ref, detail: `« ${p.mode ?? ''} » : colis ignoré` });
      continue;
    }
    const lastEvent = p.hist && p.hist.length > 0 ? parseDay(p.hist[p.hist.length - 1][0]?.split(' ')[0]?.replace(',', '').split('/').reverse().join('-')) : null;
    const created = parseDay(p.date) ?? now;
    if (CLOSED.includes(status)) {
      const closedAt = lastEvent ?? created;
      const limit = new Date(now);
      limit.setMonth(limit.getMonth() - CLOSED_KEEP_MONTHS);
      if (closedAt < limit) {
        closedTooOld += 1;
        continue;
      }
    }
    const recipient = (p.dest ?? '').trim();
    if (!recipient) {
      issues.push({ kind: 'DESTINATAIRE_ABSENT', ref, detail: 'colis ignoré (destinataire vide)' });
      continue;
    }
    const phone = normalizePhone(p.tel);
    if (p.tel && !phone) issues.push({ kind: 'TELEPHONE_INVALIDE', ref, detail: `téléphone du destinataire : ${p.tel}` });
    const weight = (p.poids ?? 0) > 0 ? roundMoney((p.poids ?? 0) * LB_TO_KG * 1000) / 1000 : null;
    const hasDims = (p.longueur ?? 0) > 0 && (p.largeur ?? 0) > 0 && (p.hauteur ?? 0) > 0;
    let weightKg = weight;
    let dimsCm = hasDims ? { length: roundMoney((p.longueur ?? 0) * IN_TO_CM), width: roundMoney((p.largeur ?? 0) * IN_TO_CM), height: roundMoney((p.hauteur ?? 0) * IN_TO_CM) } : null;
    let measuresEstimated = false;
    // La base exige poids et dimensions dès que le colis a dépassé l'inspection
    if (status !== 'RECEIVED_AT_WAREHOUSE' && (weightKg === null || dimsCm === null)) {
      if (!options.estimateMissingMeasures) {
        issues.push({ kind: 'MESURES_ABSENTES', ref, detail: `statut « ${p.statut} » sans poids ou sans dimensions : colis écarté (renseignez-les, ou utilisez --estimer-mesures)` });
        continue;
      }
      weightKg = weightKg ?? 1;
      dimsCm = dimsCm ?? { length: 1, width: 1, height: 1 };
      measuresEstimated = true;
      issues.push({ kind: 'MESURES_ESTIMEES', ref, detail: 'poids ou dimensions absents : valeurs minimales posées, à corriger' });
    }
    const balance = CLOSED.includes(status) ? 0 : Math.max(0, roundMoney((p.montant ?? 0) - (p.paye ?? 0)));
    if (balance > 0) openBalanceByCustomer[customerId] = roundMoney((openBalanceByCustomer[customerId] ?? 0) + balance);
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    packages.push({
      legacyId: p.id,
      legacyCode: code,
      customerLegacyId: customerId,
      mode,
      status,
      recipientName: recipient,
      recipientPhone: phone,
      recipientCity: (p.adr ?? '').trim() || null,
      description: (p.desc ?? '').trim() || null,
      supplierTracking: (p.suivi_ext ?? '').trim() || null,
      weightKg,
      dimsCm,
      measuresEstimated,
      createdAt: created,
      balanceDue: balance,
    });
  }

  return {
    customers,
    packages,
    issues,
    skipped: { closedTooOld },
    stats: { clientsRead: db.clients?.length ?? 0, packagesRead: db.colis?.length ?? 0, byStatus, openBalanceByCustomer },
  };
}

export function renderReport(plan: ImportPlan): string {
  const lines: string[] = [];
  lines.push("RAPPORT D'IMPORT (simulation : rien n'a été écrit)");
  lines.push('');
  lines.push(`Clients lus : ${plan.stats.clientsRead} → à importer : ${plan.customers.length}`);
  lines.push(`Colis lus   : ${plan.stats.packagesRead} → à importer : ${plan.packages.length} (terminés trop anciens, archivés : ${plan.skipped.closedTooOld})`);
  lines.push('Colis par statut : ' + (Object.entries(plan.stats.byStatus).map(([s, n]) => `${s} ${n}`).join(', ') || 'aucun'));
  const total = Object.values(plan.stats.openBalanceByCustomer).reduce((a, b) => a + b, 0);
  lines.push(`Soldes ouverts (à réémettre en facture de reprise, hors import) : ${total.toFixed(2)} sur ${Object.keys(plan.stats.openBalanceByCustomer).length} client(s)`);
  lines.push('');
  const counts = new Map<string, number>();
  for (const i of plan.issues) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  lines.push(`Anomalies : ${plan.issues.length}` + (counts.size ? ' (' + [...counts].map(([k, n]) => `${k} ${n}`).join(', ') + ')' : ''));
  for (const i of plan.issues) lines.push(`  - [${i.kind}] ${i.ref} : ${i.detail}`);
  return lines.join('\n');
}

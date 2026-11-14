/**
 * File locale des lectures de colis faites sans connexion (réception en entrepôt).
 *
 * Chaque lecture est gardée dans le navigateur (localStorage) puis rejouée dans l'ordre au retour d'internet. L'API de réception est idempotente :
 * relire un code déjà reçu ne crée jamais de doublon (« Déjà reçu »), donc rejouer deux fois est sans danger. Une lecture refusée par le
 * serveur (code inconnu, droits) n'est PAS rejouée en boucle : elle passe dans la liste des échecs pour être traitée à la main.
 */
export interface QueuedScan {
  id: string;
  warehouseId: string;
  code: string;
  transportMode?: 'AIR' | 'SEA';
  at: string;
}
export interface FailedScan extends QueuedScan {
  error: string;
}

const QUEUE_KEY = 'b2c_offline_scans_v1';
const FAILED_KEY = 'b2c_offline_scans_failed_v1';

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
function write(key: string, value: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage plein ou indisponible : la lecture reste à l'écran, l'agent est averti par l'interface */
  }
}

export const queuedScans = (): QueuedScan[] => read<QueuedScan>(QUEUE_KEY);
export const failedScans = (): FailedScan[] => read<FailedScan>(FAILED_KEY);

export function enqueueScan(scan: Omit<QueuedScan, 'id' | 'at'>): QueuedScan {
  const entry: QueuedScan = { ...scan, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString() };
  write(QUEUE_KEY, [...queuedScans(), entry]);
  return entry;
}

export function clearFailed(): void {
  write(FAILED_KEY, []);
}

export interface SyncResult {
  sent: number;
  failed: number;
  remaining: number;
}

/**
 * Rejoue la file dans l'ordre. `send` lève une erreur dont `kind` vaut 'network' (on s'arrête, on retentera plus tard) ou 'refused' (la lecture
 * passe dans les échecs). Une lecture n'est retirée de la file qu'une fois acceptée ou classée en échec.
 */
export async function syncQueue(send: (scan: QueuedScan) => Promise<void>, classify: (error: unknown) => 'network' | 'refused'): Promise<SyncResult> {
  let sent = 0;
  let failed = 0;
  for (const scan of queuedScans()) {
    try {
      await send(scan);
      sent += 1;
    } catch (error) {
      if (classify(error) === 'network') break;
      write(FAILED_KEY, [...failedScans(), { ...scan, error: error instanceof Error ? error.message : String(error) }]);
      failed += 1;
    }
    write(QUEUE_KEY, queuedScans().filter((q) => q.id !== scan.id));
  }
  return { sent, failed, remaining: queuedScans().length };
}

import type { TransportModeCode } from './schemas/customer';

export interface AddressContext {
  customerName: string;
  customerCode: string;
  mode: TransportModeCode;
}

/**
 * Produit les lignes de l'adresse de réception d'un client à partir du modèle de l'entrepôt.
 * Les variables inconnues sont laissées telles quelles (le modèle est validé à l'enregistrement).
 * Les lignes vides après remplacement sont supprimées.
 */
export function renderAddressTemplate(template: readonly string[], context: AddressContext): string[] {
  return template
    .map((line) =>
      line.replace(/\{(customerName|customerCode|mode)\}/g, (_match, key: keyof AddressContext) => context[key]),
    )
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

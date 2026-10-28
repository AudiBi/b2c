import type { EventCode } from '@b2c/shared';

type Locale = 'fr' | 'ht' | 'en';
interface Text {
  subject: string;
  body: string;
}

/**
 * Modèles par défaut (français, créole, anglais) : texte brut, variables {nom} limitées à EVENT_VARIABLES.
 * Une entreprise peut les remplacer par canal et par langue (notification_templates). Le créole est à relire.
 * Aucun délai, prix ni promesse n'y figure : seulement le constat de l'événement.
 */
export const DEFAULT_TEMPLATES: Record<EventCode, Record<Locale, Text>> = {
  'prealert.created': {
    fr: { subject: 'Achat déclaré', body: 'Bonjour {customerName}, votre achat chez {storeName} est déclaré. Numéro de suivi du colis : {trackingNumber}.' },
    en: { subject: 'Purchase declared', body: 'Hello {customerName}, your purchase from {storeName} is declared. Package tracking number: {trackingNumber}.' },
    ht: { subject: 'Acha deklare', body: 'Bonjou {customerName}, acha ou nan {storeName} deklare. Nimewo swivi kolis la : {trackingNumber}.' },
  },
  'package.received': {
    fr: { subject: 'Colis reçu à l’entrepôt', body: 'Bonjour {customerName}, votre colis {trackingNumber} est arrivé à l’entrepôt de {warehouseCity}.' },
    en: { subject: 'Package received at the warehouse', body: 'Hello {customerName}, your package {trackingNumber} has arrived at the {warehouseCity} warehouse.' },
    ht: { subject: 'Kolis resevwa nan depo a', body: 'Bonjou {customerName}, kolis ou a {trackingNumber} rive nan depo {warehouseCity}.' },
  },
  'package.identified': {
    fr: { subject: 'Colis rattaché à votre compte', body: 'Bonjour {customerName}, le colis {trackingNumber} reçu à l’entrepôt est rattaché à votre compte.' },
    en: { subject: 'Package attached to your account', body: 'Hello {customerName}, package {trackingNumber} received at the warehouse is attached to your account.' },
    ht: { subject: 'Kolis mare ak kont ou', body: 'Bonjou {customerName}, kolis {trackingNumber} ki rive nan depo a mare ak kont ou.' },
  },
  'payment.required': {
    fr: { subject: 'Facture {invoiceNumber} à régler', body: 'Bonjour {customerName}, la facture {invoiceNumber} de {amount} {currency} est émise. Vous pouvez la consulter et la régler depuis votre espace.' },
    en: { subject: 'Invoice {invoiceNumber} to pay', body: 'Hello {customerName}, invoice {invoiceNumber} for {amount} {currency} has been issued. You can view and pay it from your account.' },
    ht: { subject: 'Fakti {invoiceNumber} pou peye', body: 'Bonjou {customerName}, fakti {invoiceNumber} {amount} {currency} emèt. Ou ka wè l epi peye l nan espas ou.' },
  },
  'payment.confirmed': {
    fr: { subject: 'Paiement reçu : {receiptNumber}', body: 'Bonjour {customerName}, nous avons bien reçu votre paiement de {amount} {currency} pour la facture {invoiceNumber}. Reçu n° {receiptNumber}.' },
    en: { subject: 'Payment received: {receiptNumber}', body: 'Hello {customerName}, we received your payment of {amount} {currency} for invoice {invoiceNumber}. Receipt no. {receiptNumber}.' },
    ht: { subject: 'Peman resevwa : {receiptNumber}', body: 'Bonjou {customerName}, nou resevwa peman ou a {amount} {currency} pou fakti {invoiceNumber}. Resi nimewo {receiptNumber}.' },
  },
  'shipment.prepared': {
    fr: { subject: 'Colis intégré à un lot', body: 'Bonjour {customerName}, votre colis {trackingNumber} est chargé dans un lot en préparation pour l’expédition.' },
    en: { subject: 'Package added to a shipment', body: 'Hello {customerName}, your package {trackingNumber} is loaded in a shipment being prepared.' },
    ht: { subject: 'Kolis mete nan yon lo', body: 'Bonjou {customerName}, kolis ou a {trackingNumber} chaje nan yon lo k ap prepare.' },
  },
  'shipment.dispatched': {
    fr: { subject: 'Colis parti', body: 'Bonjour {customerName}, votre colis {trackingNumber} est parti.' },
    en: { subject: 'Package departed', body: 'Hello {customerName}, your package {trackingNumber} has departed.' },
    ht: { subject: 'Kolis pati', body: 'Bonjou {customerName}, kolis ou a {trackingNumber} pati.' },
  },
  'shipment.arrived': {
    fr: { subject: 'Colis arrivé dans le pays de destination', body: 'Bonjour {customerName}, votre colis {trackingNumber} est arrivé dans le pays de destination.' },
    en: { subject: 'Package arrived in the destination country', body: 'Hello {customerName}, your package {trackingNumber} has arrived in the destination country.' },
    ht: { subject: 'Kolis rive nan peyi destinasyon an', body: 'Bonjou {customerName}, kolis ou a {trackingNumber} rive nan peyi destinasyon an.' },
  },
  'package.available_at_agency': {
    fr: { subject: 'Colis prêt pour le retrait', body: 'Bonjour {customerName}, votre colis {trackingNumber} est prêt pour le retrait à l’agence {agencyName} ({agencyCity}).' },
    en: { subject: 'Package ready for pickup', body: 'Hello {customerName}, your package {trackingNumber} is ready for pickup at the {agencyName} agency ({agencyCity}).' },
    ht: { subject: 'Kolis pare pou ranmase', body: 'Bonjou {customerName}, kolis ou a {trackingNumber} pare pou ranmase nan ajans {agencyName} ({agencyCity}).' },
  },
  'delivery.scheduled': {
    fr: { subject: 'Livraison programmée', body: 'Bonjour {customerName}, la livraison de votre colis {trackingNumber} est programmée le {plannedDate}. Pour la recevoir, gardez votre code de remise (disponible dans votre espace) et une pièce d’identité.' },
    en: { subject: 'Delivery scheduled', body: 'Hello {customerName}, the delivery of your package {trackingNumber} is scheduled for {plannedDate}. To receive it, keep your handover code (available in your account) and an ID document.' },
    ht: { subject: 'Livrezon pwograme', body: 'Bonjou {customerName}, livrezon kolis ou a {trackingNumber} pwograme pou {plannedDate}. Pou resevwa l, kenbe kòd livrezon ou an (nan espas ou) ak yon pyès idantite.' },
  },
  'package.delivered': {
    fr: { subject: 'Colis remis', body: 'Bonjour {customerName}, votre colis {trackingNumber} a été remis.' },
    en: { subject: 'Package delivered', body: 'Hello {customerName}, your package {trackingNumber} has been delivered.' },
    ht: { subject: 'Kolis livre', body: 'Bonjou {customerName}, kolis ou a {trackingNumber} livre.' },
  },
  'delivery.failed': {
    fr: { subject: 'Livraison non aboutie', body: 'Bonjour {customerName}, la livraison de votre colis {trackingNumber} n’a pas pu aboutir. Il reste disponible en agence ; consultez son suivi.' },
    en: { subject: 'Delivery not completed', body: 'Hello {customerName}, the delivery of your package {trackingNumber} could not be completed. It remains available at the agency; see its tracking page.' },
    ht: { subject: 'Livrezon pa fèt', body: 'Bonjou {customerName}, livrezon kolis ou a {trackingNumber} pa t kapab fèt. L rete disponib nan ajans la ; gade swivi li a.' },
  },
  'claim.updated': {
    fr: { subject: 'Votre réclamation {claimNumber} a évolué', body: 'Bonjour {customerName}, il y a du nouveau sur votre réclamation {claimNumber}. Consultez-la dans votre espace.' },
    en: { subject: 'Your claim {claimNumber} has an update', body: 'Hello {customerName}, there is news on your claim {claimNumber}. See it in your account.' },
    ht: { subject: 'Reklamasyon ou a {claimNumber} gen nouvèl', body: 'Bonjou {customerName}, gen nouvèl sou reklamasyon ou a {claimNumber}. Gade l nan espas ou.' },
  },
  'package.incident': {
    fr: { subject: 'Votre colis nécessite une vérification', body: 'Bonjour {customerName}, votre colis {trackingNumber} est retenu pour vérification. Consultez son suivi pour le motif.' },
    en: { subject: 'Your package needs a check', body: 'Hello {customerName}, your package {trackingNumber} is on hold for verification. See its tracking page for the reason.' },
    ht: { subject: 'Kolis ou a bezwen verifikasyon', body: 'Bonjou {customerName}, kolis ou a {trackingNumber} kenbe pou verifikasyon. Gade swivi li a pou wè rezon an.' },
  },
};

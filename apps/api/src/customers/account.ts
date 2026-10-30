import type { Customer } from '@prisma/client';
import type { Tx } from '../database/db.service';

/**
 * Compte client (professionnel) auquel un utilisateur est rattaché comme MEMBRE D'ÉQUIPE, ou null s'il n'en est pas membre.
 * Un membre agit sur les données du compte de son propriétaire, dans la limite des droits de son rôle (lecteur / opérateur).
 */
export async function memberAccount(tx: Tx, userId: string): Promise<Customer | null> {
  const membership = await tx.customerMember.findUnique({ where: { userId }, include: { customer: true } });
  return membership?.customer ?? null;
}

/** Identifiant du compte client dont l'utilisateur voit les données : le sien, ou celui de l'équipe dont il est membre. */
export async function accountCustomerId(tx: Tx, userId: string): Promise<string | null> {
  const member = await tx.customerMember.findUnique({ where: { userId }, select: { customerId: true } });
  if (member) return member.customerId;
  return (await tx.customer.findUnique({ where: { userId }, select: { id: true } }))?.id ?? null;
}

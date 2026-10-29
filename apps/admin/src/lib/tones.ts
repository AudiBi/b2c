import type { ClaimStatus } from '../pages/delivery/queries';

/** Classe de badge selon l'état d'une réclamation. */
export const claimTone = (status: ClaimStatus) => (status === 'RESOLVED' ? ' badge-success' : status === 'REJECTED' ? ' badge-danger' : status === 'IN_PROGRESS' ? ' badge-warning' : '');

import { accountCustomerId } from '../customers/account';
import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FileKind, FileObject, FileOwnerType } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors';
import { ConfigService } from '../config/config.module';
import { DbService, type Tx } from '../database/db.service';
import type { AuthContext } from '../security/auth.types';
import { FileStorage } from './file-storage';
import { sanitizeFilename, verifyUpload } from './file-verification';

const MAX_FILES_PER_OWNER = 10;
const LINK_TTL_SECONDS = 300;

/** Types de pièces acceptés selon le propriétaire. */
const ALLOWED_KINDS: Record<FileOwnerType, readonly FileKind[]> = {
  PREALERT: ['INVOICE', 'DOCUMENT'],
  PACKAGE: ['PHOTO', 'DOCUMENT'],
};

export function fileDto(file: FileObject) {
  return { id: file.id, kind: file.kind, name: file.originalName, mimeType: file.mimeType, size: file.sizeBytes, createdAt: file.createdAt };
}

@Injectable()
export class FilesService {
  private readonly signingKey: Buffer;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
    config: ConfigService,
  ) {
    // Clé dérivée : le secret de signature des liens n'est pas celui des jetons d'accès
    this.signingKey = createHmac('sha256', config.env.JWT_ACCESS_SECRET).update('files-links-v1').digest();
  }

  // ---------------------------------------------------------------------------------------------
  // Contrôle d'accès au propriétaire de la pièce (préalerte ou colis)
  // ---------------------------------------------------------------------------------------------

  /**
   * Vérifie le droit d'accès. Un client n'accède qu'à ses propres objets ; un objet qu'il n'a pas le droit de
   * voir est présenté comme inexistant. Le personnel doit détenir la permission pour l'entrepôt du colis.
   */
  private async authorize(tx: Tx, auth: AuthContext, ownerType: FileOwnerType, ownerId: string, mode: 'read' | 'write'): Promise<void> {
    const notFound = () => AppException.notFound('FILE_OWNER_NOT_FOUND', 'Objet introuvable');
    const forbidden = () => AppException.forbidden('FORBIDDEN', 'Permission insuffisante');

    if (ownerType === 'PREALERT') {
      const prealert = await tx.prealert.findUnique({ where: { id: ownerId }, include: { package: true, customer: true } });
      if (!prealert) throw notFound();
      if (auth.kind === 'CUSTOMER') {
        if (prealert.customerId !== (await accountCustomerId(tx, auth.userId))) throw notFound();
        if (!auth.permissions.has(mode === 'write' ? 'prealert:create_own' : 'prealert:read_own')) throw forbidden();
        // Plus de modification de la facture une fois le colis arrivé
        if (mode === 'write' && (prealert.status !== 'OPEN' || prealert.package.status !== 'AWAITING_RECEIPT')) {
          throw AppException.conflict('PREALERT_LOCKED', 'Cette préalerte ne peut plus être modifiée');
        }
        return;
      }
      if (mode === 'write') throw forbidden();
      if (!auth.permissions.can('prealert:read', { type: 'WAREHOUSE', id: prealert.warehouseId })) throw forbidden();
      return;
    }

    const pkg = await tx.package.findUnique({ where: { id: ownerId }, include: { customer: true } });
    if (!pkg) throw notFound();
    if (auth.kind === 'CUSTOMER') {
      if (mode === 'write' || !pkg.customerId || pkg.customerId !== (await accountCustomerId(tx, auth.userId))) throw mode === 'write' ? forbidden() : notFound();
      if (!auth.permissions.has('package:read_own')) throw forbidden();
      return;
    }
    const allowed =
      mode === 'read'
        ? auth.permissions.can('package:read', { type: 'WAREHOUSE', id: pkg.originWarehouseId })
        : auth.permissions.can('package:receive', { type: 'WAREHOUSE', id: pkg.originWarehouseId }) ||
          auth.permissions.can('package:register', { type: 'WAREHOUSE', id: pkg.originWarehouseId });
    if (!allowed) throw forbidden();
  }

  // ---------------------------------------------------------------------------------------------
  // Opérations
  // ---------------------------------------------------------------------------------------------

  async upload(
    auth: AuthContext,
    params: { ownerType: FileOwnerType; ownerId: string; kind: FileKind; filename: string },
    body: unknown,
    declaredType: string | undefined,
  ) {
    if (!ALLOWED_KINDS[params.ownerType].includes(params.kind)) {
      throw AppException.badRequest('FILE_KIND_NOT_ALLOWED', `Type de pièce non accepté pour ce propriétaire (${ALLOWED_KINDS[params.ownerType].join(', ')})`);
    }
    const verified = verifyUpload(body, declaredType);
    const id = uuidv7();
    const storageKey = `companies/${auth.companyId}/${params.ownerType.toLowerCase()}/${params.ownerId}/${randomUUID()}.${verified.extension}`;

    const saved = await this.db.run({ companyId: auth.companyId }, async (tx) => {
      await this.authorize(tx, auth, params.ownerType, params.ownerId, 'write');
      const count = await tx.fileObject.count({ where: { ownerType: params.ownerType, ownerId: params.ownerId } });
      if (count >= MAX_FILES_PER_OWNER) throw AppException.unprocessable('FILE_LIMIT', `Nombre maximal de pièces atteint (${MAX_FILES_PER_OWNER})`);
      const row = await tx.fileObject.create({
        data: {
          id,
          companyId: auth.companyId,
          ownerType: params.ownerType,
          ownerId: params.ownerId,
          kind: params.kind,
          storageKey,
          originalName: sanitizeFilename(params.filename, verified.extension),
          mimeType: verified.mime,
          sizeBytes: verified.size,
          sha256: verified.sha256,
          uploadedBy: auth.userId,
        },
      });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'file.uploaded', entityType: 'file', entityId: id, after: { ownerType: params.ownerType, kind: params.kind, size: verified.size } });
      return row;
    });
    // Le fichier est écrit après la validation de la ligne ; si l'écriture échoue, la ligne est retirée
    try {
      await this.storage.put(storageKey, body as Buffer);
    } catch (error) {
      await this.db.run({ companyId: auth.companyId }, (tx) => tx.fileObject.deleteMany({ where: { id } }));
      throw error;
    }
    return fileDto(saved);
  }

  async list(auth: AuthContext, ownerType: FileOwnerType, ownerId: string) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      await this.authorize(tx, auth, ownerType, ownerId, 'read');
      const rows = await tx.fileObject.findMany({ where: { ownerType, ownerId }, orderBy: { id: 'asc' } });
      return { items: rows.map(fileDto) };
    });
  }

  /** Lien de téléchargement signé et de courte durée. */
  async link(auth: AuthContext, fileId: string) {
    const file = await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const row = await tx.fileObject.findUnique({ where: { id: fileId } });
      if (!row) throw AppException.notFound('FILE_NOT_FOUND', 'Fichier introuvable');
      await this.authorize(tx, auth, row.ownerType, row.ownerId, 'read');
      return row;
    });
    const expires = Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS;
    const signature = this.sign(file.id, auth.companyId, expires);
    return {
      url: `/v1/files/${file.id}/content?c=${auth.companyId}&exp=${expires}&sig=${signature}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  async remove(auth: AuthContext, fileId: string): Promise<void> {
    const key = await this.db.run({ companyId: auth.companyId }, async (tx) => {
      const row = await tx.fileObject.findUnique({ where: { id: fileId } });
      if (!row) throw AppException.notFound('FILE_NOT_FOUND', 'Fichier introuvable');
      await this.authorize(tx, auth, row.ownerType, row.ownerId, 'write');
      await tx.fileObject.delete({ where: { id: fileId } });
      await this.audit.record(tx, { companyId: auth.companyId, action: 'file.deleted', entityType: 'file', entityId: fileId });
      return row.storageKey;
    });
    await this.storage.delete(key);
  }

  /** Lecture via un lien signé : aucune session, mais signature valide, non expirée, et entreprise cohérente. */
  async content(companyId: string, fileId: string, expires: number, signature: string): Promise<{ file: FileObject; data: Buffer }> {
    if (!Number.isFinite(expires) || expires < Date.now() / 1000) throw AppException.forbidden('LINK_EXPIRED', 'Lien expiré');
    const expected = Buffer.from(this.sign(fileId, companyId, expires), 'hex');
    const given = Buffer.from(signature, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw AppException.forbidden('LINK_INVALID', 'Lien invalide');
    const file = await this.db.run({ companyId }, (tx) => tx.fileObject.findUnique({ where: { id: fileId } }));
    if (!file) throw AppException.notFound('FILE_NOT_FOUND', 'Fichier introuvable');
    return { file, data: await this.storage.get(file.storageKey) };
  }

  private sign(fileId: string, companyId: string, expires: number): string {
    return createHmac('sha256', this.signingKey).update(`${fileId}.${companyId}.${expires}`).digest('hex');
  }
}

import { Injectable } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { ConfigService } from '../config/config.module';

/** Abstraction du stockage des pièces jointes. Deux implémentations : disque local (défaut) et stockage objet S3 (`STORAGE_DRIVER=s3`, voir s3-storage.ts). */
export abstract class FileStorage {
  abstract put(key: string, content: Buffer): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
}

/**
 * Stockage sur disque. Les clés sont construites par le serveur (identifiants uuid) ; malgré cela, tout chemin
 * qui sortirait du dossier racine est refusé.
 */
@Injectable()
export class LocalDiskStorage extends FileStorage {
  private readonly root: string;

  constructor(config: ConfigService) {
    super();
    this.root = resolve(config.env.FILES_DIR);
  }

  private path(key: string): string {
    const target = resolve(this.root, key);
    if (!target.startsWith(this.root + sep)) throw new Error('Clé de stockage invalide');
    return target;
  }

  async put(key: string, content: Buffer): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { flag: 'wx' }); // jamais d'écrasement
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.module';
import { FileStorage } from './file-storage';

/**
 * Stockage objet compatible S3 (AWS S3, SeaweedFS, Cloudflare R2, etc.). Les clés sont construites par le serveur
 * (identifiants uuid) : un client ne choisit jamais le nom d'un objet. Le bucket doit exister (npm run s3:init en
 * développement) ; l'adaptateur ne le crée pas, pour ne pas exiger de droit d'administration en production.
 */
@Injectable()
export class S3Storage extends FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    super();
    const env = config.env;
    this.bucket = env.S3_BUCKET as string;
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID as string, secretAccessKey: env.S3_SECRET_ACCESS_KEY as string },
    });
  }

  private checked(key: string): string {
    if (!key || key.startsWith('/') || key.split('/').some((part) => part === '..' || part === '.')) throw new Error('Clé de stockage invalide');
    return key;
  }

  async put(key: string, content: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.checked(key), Body: content, ContentLength: content.length }));
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.checked(key) }));
    if (!response.Body) throw new Error('Objet vide');
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.checked(key) }));
  }

  destroy(): void {
    this.client.destroy();
  }
}

// Crée le bucket des pièces jointes sur le stockage S3 de développement (SeaweedFS du profil Docker « storage »).
//   npm run s3:init
// Idempotent. À ne pas utiliser en production : le bucket y est créé par l'hébergeur, avec une clé qui n'a pas ce droit.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { S3Client, CreateBucketCommand, HeadBucketCommand } = createRequire(resolve(root, 'apps/api/package.json'))('@aws-sdk/client-s3');
const { S3_ENDPOINT, S3_REGION = 'us-east-1', S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE } = process.env;
if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
  throw new Error('S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID et S3_SECRET_ACCESS_KEY sont requis (voir .env.example).');
}
const client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  forcePathStyle: S3_FORCE_PATH_STYLE === 'true',
  credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
});
try {
  await client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
  console.log(`Le bucket « ${S3_BUCKET} » existe déjà.`);
} catch {
  await client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
  console.log(`Bucket « ${S3_BUCKET} » créé sur ${S3_ENDPOINT}.`);
} finally {
  client.destroy();
}

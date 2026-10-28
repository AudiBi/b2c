import { randomBytes } from 'node:crypto';
import { CreateBucketCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { loadEnv } from '../src/config/env';
import { ConfigService } from '../src/config/config.module';
import { S3Storage } from '../src/files/s3-storage';
import { api, bearer, buildTestApp, fixtures, makeCustomer, makePrealert, makeTenant, makeWarehouse, activateRateCard, type TestApp } from './helpers';

// Les tests de l'adaptateur S3 ont besoin d'un vrai stockage objet : « npm run test:s3 » (SeaweedFS du profil Docker « storage »).
// Sans RUN_S3_TESTS=true ils sont ignorés — et la suite le dit, au lieu de passer pour vérifiés.
const enabled = process.env.RUN_S3_TESTS === 'true';
const suite = enabled ? describe : describe.skip;

const BUCKET = 'b2c-files-test';

const baseEnv = () => ({ ...process.env, STORAGE_DRIVER: 's3', S3_BUCKET: BUCKET }) as NodeJS.ProcessEnv;

describe('Configuration du stockage', () => {
  it('reste sur disque par défaut', () => {
    expect(loadEnv({ ...process.env, STORAGE_DRIVER: undefined }).STORAGE_DRIVER).toBe('disk');
  });

  it('refuse le stockage S3 incomplet, en nommant les variables manquantes', () => {
    const source = { ...process.env, STORAGE_DRIVER: 's3', S3_ENDPOINT: undefined, S3_BUCKET: undefined, S3_ACCESS_KEY_ID: undefined, S3_SECRET_ACCESS_KEY: undefined };
    expect(() => loadEnv(source as NodeJS.ProcessEnv)).toThrow(/S3_ENDPOINT[\s\S]*S3_BUCKET[\s\S]*S3_ACCESS_KEY_ID[\s\S]*S3_SECRET_ACCESS_KEY|S3_ENDPOINT/);
  });

  it('refuse un pilote inconnu', () => {
    expect(() => loadEnv({ ...process.env, STORAGE_DRIVER: 'ftp' } as NodeJS.ProcessEnv)).toThrow();
  });
});

suite('Stockage objet compatible S3 (SeaweedFS réel)', () => {
  let storage: S3Storage;
  let client: S3Client;
  const prefix = `tests/${randomBytes(6).toString('hex')}`;

  beforeAll(async () => {
    const env = loadEnv(baseEnv());
    client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID as string, secretAccessKey: env.S3_SECRET_ACCESS_KEY as string },
    });
    try {
      await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
    } catch (e: any) {
      if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(`${e.name}${e.Code}`)) throw e;
    }
    storage = new S3Storage(new ConfigService(env));
  });
  afterAll(() => {
    storage.destroy();
    client.destroy();
  });

  it('restitue exactement les octets écrits (les 256 valeurs d’octet, plus 3 Mio)', async () => {
    const every = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    await storage.put(`${prefix}/octets.bin`, every);
    expect((await storage.get(`${prefix}/octets.bin`)).equals(every)).toBe(true);

    const big = randomBytes(3 * 1024 * 1024);
    await storage.put(`${prefix}/gros.bin`, big);
    expect((await storage.get(`${prefix}/gros.bin`)).equals(big)).toBe(true);
  });

  it('accepte un objet vide et une clé avec accents et espaces', async () => {
    await storage.put(`${prefix}/vide.bin`, Buffer.alloc(0));
    expect((await storage.get(`${prefix}/vide.bin`)).length).toBe(0);
    const key = `${prefix}/dossier avec espaces/é à ü.txt`;
    await storage.put(key, Buffer.from('bonjour'));
    expect((await storage.get(key)).toString()).toBe('bonjour');
  });

  it('supprime l’objet ; supprimer deux fois ou un objet absent ne produit pas d’erreur ; le lire ensuite échoue', async () => {
    const key = `${prefix}/a-supprimer.bin`;
    await storage.put(key, Buffer.from('x'));
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toMatchObject({ name: 'NoSuchKey' });
    await expect(storage.delete(key)).resolves.toBeUndefined();
    await expect(storage.delete(`${prefix}/jamais-existe.bin`)).resolves.toBeUndefined();
  });

  it('refuse les clés qui tenteraient de sortir de leur espace', async () => {
    for (const key of ['', '/absolu', '../x', 'a/../../x', 'a/./b']) {
      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow('Clé de stockage invalide');
      await expect(storage.get(key)).rejects.toThrow('Clé de stockage invalide');
      await expect(storage.delete(key)).rejects.toThrow('Clé de stockage invalide');
    }
  });

  it('échoue franchement (sans rien faire croire) quand le bucket n’existe pas', async () => {
    const env = loadEnv({ ...baseEnv(), S3_BUCKET: `absent-${randomBytes(4).toString('hex')}` });
    const other = new S3Storage(new ConfigService(env));
    await expect(other.put('x/y.bin', Buffer.from('x'))).rejects.toMatchObject({ name: 'NoSuchBucket' });
    other.destroy();
  });

  it('échoue franchement avec de mauvais identifiants', async () => {
    const env = loadEnv({ ...baseEnv(), S3_SECRET_ACCESS_KEY: 'mauvais-secret-mauvais-secret' });
    const other = new S3Storage(new ConfigService(env));
    await expect(other.put(`${prefix}/refuse.bin`, Buffer.from('x'))).rejects.toBeDefined();
    other.destroy();
  });

  describe('de bout en bout, par l’API (STORAGE_DRIVER=s3)', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await buildTestApp({ STORAGE_DRIVER: 's3', S3_BUCKET: BUCKET });
    });
    afterAll(() => t.close());

    it('téléverse, livre par lien signé, puis supprime réellement l’objet du bucket', async () => {
      const tenant = await makeTenant(t);
      const warehouse = await makeWarehouse(t, tenant.token);
      await activateRateCard(t, tenant.token);
      const customer = await makeCustomer(t, tenant.company);
      const prealert = await makePrealert(t, customer, warehouse.id);
      const body = fixtures.pdf();

      const created = await api(t)
        .post('/v1/files')
        .query({ ownerType: 'PREALERT', ownerId: prealert.id, kind: 'INVOICE', filename: 'facture.pdf' })
        .set(bearer(customer.token))
        .set('Content-Type', 'application/pdf')
        .send(body);
      expect(created.status).toBe(201);

      const row = await t.admin.fileObject.findUniqueOrThrow({ where: { id: created.body.id } });
      const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: row.storageKey }));
      expect(head.ContentLength).toBe(body.length);

      const link = await api(t).get(`/v1/files/${created.body.id}/link`).set(bearer(customer.token));
      const content = await api(t).get(link.body.url).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(content.status).toBe(200);
      expect(Buffer.from(content.body).equals(body)).toBe(true);

      const removed = await api(t).delete(`/v1/files/${created.body.id}`).set(bearer(customer.token));
      expect(removed.status).toBeLessThan(300);
      await expect(client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: row.storageKey }))).rejects.toMatchObject({ name: 'NotFound' });
    });
  });
});

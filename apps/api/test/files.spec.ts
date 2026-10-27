import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { FileStorage } from '../src/files/file-storage';
import {
  activateRateCard,
  api,
  bearer,
  buildTestApp,
  fixtures,
  login,
  makeCustomer,
  makePrealert,
  makeTenant,
  makeUser,
  makeWarehouse,
  type TestApp,
} from './helpers';

const errorCode = (res: { body: any }) => res.body?.error?.code;

describe('Pièces jointes', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  async function setup() {
    const tenant = await makeTenant(t);
    const w1 = await makeWarehouse(t, tenant.token);
    const w2 = await makeWarehouse(t, tenant.token);
    await activateRateCard(t, tenant.token);
    const agent = async (warehouseId: string) => {
      const user = await makeUser(t, { company: tenant.company, roleCode: 'RECEPTION_AGENT', scope: { type: 'WAREHOUSE', id: warehouseId } });
      return (await login(t, user)).accessToken;
    };
    const customer1 = await makeCustomer(t, tenant.company);
    const customer2 = await makeCustomer(t, tenant.company);
    const prealert = await makePrealert(t, customer1, w1.id);
    return { ...tenant, w1, w2, agent1: await agent(w1.id), agent2: await agent(w2.id), customer1, customer2, prealert };
  }
  type World = Awaited<ReturnType<typeof setup>>;

  const upload = (
    token: string,
    owner: { ownerType: 'PREALERT' | 'PACKAGE'; ownerId: string },
    kind: string,
    body: Buffer | string,
    contentType: string,
    filename = 'document',
  ) =>
    api(t)
      .post('/v1/files')
      .query({ ...owner, kind, filename })
      .set(bearer(token))
      .set('Content-Type', contentType)
      .send(body as Buffer);

  const invoiceOf = (w: World) => ({ ownerType: 'PREALERT' as const, ownerId: w.prealert.id });
  const packageOf = (w: World) => ({ ownerType: 'PACKAGE' as const, ownerId: w.prealert.package.id });
  const list = (token: string, owner: { ownerType: string; ownerId: string }) => api(t).get('/v1/files').query(owner).set(bearer(token));

  async function uploaded(w: World, body = fixtures.pdf(), mime = 'application/pdf') {
    const res = await upload(w.customer1.token, invoiceOf(w), 'INVOICE', body, mime, 'facture.pdf');
    expect(res.status).toBe(201);
    return res.body as { id: string; name: string; mimeType: string; size: number; kind: string };
  }

  describe('téléversement', () => {
    it('accepte une facture PDF sur sa préalerte, détermine le type par le contenu et calcule l’empreinte', async () => {
      const w = await setup();
      const body = fixtures.pdf();
      const res = await upload(w.customer1.token, invoiceOf(w), 'INVOICE', body, 'application/pdf', 'Facture Nike.pdf');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ kind: 'INVOICE', name: 'Facture Nike.pdf', mimeType: 'application/pdf', size: body.length });

      const row = await t.admin.fileObject.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.sha256).toBe(createHash('sha256').update(body).digest('hex'));
      expect(row.storageKey.startsWith(`companies/${w.company.id}/prealert/${w.prealert.id}/`)).toBe(true);
      expect(row.storageKey.endsWith('.pdf')).toBe(true);
      expect((await t.app.get(FileStorage).get(row.storageKey)).equals(body)).toBe(true);
    });

    it('accepte JPEG, PNG et WebP (photos de colis par le personnel)', async () => {
      const w = await setup();
      // la permission d'entrepôt suffit : le statut du colis n'est pas exigé pour y joindre une photo
      for (const [body, mime, ext] of [
        [fixtures.jpeg(), 'image/jpeg', 'jpg'],
        [fixtures.png(), 'image/png', 'png'],
        [fixtures.webp(), 'image/webp', 'webp'],
      ] as const) {
        const res = await upload(w.token, packageOf(w), 'PHOTO', body, mime, 'photo.bin');
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ mimeType: mime, name: `photo.${ext}` });
      }
    });

    it('assainit le nom du fichier : ni chemin, ni caractère de contrôle, extension imposée par le contenu', async () => {
      const w = await setup();
      for (const filename of ['../../etc/passwd.exe', 'a\\b\\c.pdf', 'we<ir>d:"name*?.pdf', '...', '.htaccess']) {
        const res = await upload(w.customer1.token, invoiceOf(w), 'INVOICE', fixtures.pdf(), 'application/pdf', filename);
        expect(res.status).toBe(201);
        expect(res.body.name).toMatch(/^[^/\\<>:"*?|]+\.pdf$/);
        expect(res.body.name).not.toContain('..');
        expect(res.body.name.startsWith('.')).toBe(false);
      }
    });

    it('refuse un contenu qui n’est pas celui annoncé, ou non reconnu', async () => {
      const w = await setup();
      const mismatch = await upload(w.customer1.token, invoiceOf(w), 'INVOICE', fixtures.png(), 'image/jpeg');
      expect(mismatch.status).toBe(400);
      expect(errorCode(mismatch)).toBe('FILE_CONTENT_MISMATCH');

      const text = await upload(w.customer1.token, invoiceOf(w), 'INVOICE', Buffer.from('MZ ceci est un programme déguisé en image'), 'image/png');
      expect(text.status).toBe(415);
      expect(errorCode(text)).toBe('UNSUPPORTED_FILE');

      // type annoncé non pris en charge : le corps n'est même pas lu
      for (const type of ['text/plain', 'application/octet-stream', 'text/html', 'image/svg+xml']) {
        const res = await upload(w.customer1.token, invoiceOf(w), 'INVOICE', fixtures.pdf(), type);
        expect(res.status).toBe(415);
      }
      const empty = await upload(w.customer1.token, invoiceOf(w), 'INVOICE', Buffer.alloc(0), 'application/pdf');
      expect(empty.status).toBe(415);
      expect(await t.admin.fileObject.count({ where: { companyId: w.company.id } })).toBe(0);
    });

    it('refuse un PDF qui contient du code actif ou des pièces jointes', async () => {
      const w = await setup();
      const res = await upload(w.customer1.token, invoiceOf(w), 'INVOICE', fixtures.pdfWithScript(), 'application/pdf');
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('FILE_REJECTED');
    });

    it('refuse un fichier de plus de 8 Mo', async () => {
      const w = await setup();
      const big = Buffer.concat([fixtures.pdf(), Buffer.alloc(8 * 1024 * 1024, 0x41)]);
      const res = await upload(w.customer1.token, invoiceOf(w), 'INVOICE', big, 'application/pdf');
      expect(res.status).toBe(413);
      const exact = Buffer.concat([fixtures.pdf(), Buffer.alloc(8 * 1024 * 1024 - fixtures.pdf().length, 0x41)]);
      expect(exact.length).toBe(8 * 1024 * 1024);
      expect((await upload(w.customer1.token, invoiceOf(w), 'INVOICE', exact, 'application/pdf')).status).toBe(201);
    });

    it('limite le type de pièce selon le propriétaire et à 10 pièces par objet', async () => {
      const w = await setup();
      const photoOnPrealert = await upload(w.customer1.token, invoiceOf(w), 'PHOTO', fixtures.jpeg(), 'image/jpeg');
      expect(photoOnPrealert.status).toBe(400);
      expect(errorCode(photoOnPrealert)).toBe('FILE_KIND_NOT_ALLOWED');
      expect(errorCode(await upload(w.token, packageOf(w), 'INVOICE', fixtures.pdf(), 'application/pdf'))).toBe('FILE_KIND_NOT_ALLOWED');

      for (let i = 0; i < 10; i += 1) await uploaded(w);
      const eleventh = await upload(w.customer1.token, invoiceOf(w), 'INVOICE', fixtures.pdf(), 'application/pdf');
      expect(eleventh.status).toBe(422);
      expect(errorCode(eleventh)).toBe('FILE_LIMIT');
    });

    it('valide les paramètres et le propriétaire', async () => {
      const w = await setup();
      const raw = (query: Record<string, string>) =>
        api(t).post('/v1/files').query(query).set(bearer(w.customer1.token)).set('Content-Type', 'application/pdf').send(fixtures.pdf());
      const good = { ownerType: 'PREALERT', ownerId: w.prealert.id, kind: 'INVOICE', filename: 'f.pdf' };
      expect((await raw({ ...good, ownerType: 'USER' })).status).toBe(400);
      expect((await raw({ ...good, ownerId: 'pas-un-uuid' })).status).toBe(400);
      expect((await raw({ ...good, kind: 'VIDEO' })).status).toBe(400);
      expect((await raw({ ...good, filename: '' })).status).toBe(400);
      expect((await raw({ ...good, extra: '1' })).status).toBe(400);
      const missing = await raw({ ...good, ownerId: uuidv7() });
      expect(missing.status).toBe(404);
      expect(errorCode(missing)).toBe('FILE_OWNER_NOT_FOUND');
    });
  });

  describe('contrôle d’accès', () => {
    it('sans connexion : 401 partout (sauf le contenu signé)', async () => {
      const w = await setup();
      const file = await uploaded(w);
      expect((await api(t).post('/v1/files').query({ ...invoiceOf(w), kind: 'INVOICE', filename: 'f.pdf' }).set('Content-Type', 'application/pdf').send(fixtures.pdf())).status).toBe(401);
      expect((await api(t).get('/v1/files').query(invoiceOf(w))).status).toBe(401);
      expect((await api(t).get(`/v1/files/${file.id}/link`)).status).toBe(401);
      expect((await api(t).delete(`/v1/files/${file.id}`)).status).toBe(401);
    });

    it('un client n’accède pas aux pièces d’un autre client (présentées comme inexistantes)', async () => {
      const w = await setup();
      const file = await uploaded(w);
      const other = w.customer2.token;
      expect((await upload(other, invoiceOf(w), 'INVOICE', fixtures.pdf(), 'application/pdf')).status).toBe(404);
      expect((await list(other, invoiceOf(w))).status).toBe(404);
      expect((await api(t).get(`/v1/files/${file.id}/link`).set(bearer(other))).status).toBe(404);
      expect((await api(t).delete(`/v1/files/${file.id}`).set(bearer(other))).status).toBe(404);
      expect((await list(w.customer1.token, invoiceOf(w))).body.items.map((f: any) => f.id)).toEqual([file.id]);
    });

    it('une entreprise n’accède pas aux pièces d’une autre', async () => {
      const a = await setup();
      const b = await setup();
      const file = await uploaded(a);
      expect((await list(b.token, invoiceOf(a))).status).toBe(404);
      expect((await api(t).get(`/v1/files/${file.id}/link`).set(bearer(b.token))).status).toBe(404);
      expect((await api(t).delete(`/v1/files/${file.id}`).set(bearer(b.token))).status).toBe(404);
    });

    it('le personnel lit les pièces de son entrepôt seulement, et ne dépose pas sur une préalerte', async () => {
      const w = await setup();
      const file = await uploaded(w);
      expect((await list(w.agent1, invoiceOf(w))).body.items.map((f: any) => f.id)).toEqual([file.id]);
      expect((await api(t).get(`/v1/files/${file.id}/link`).set(bearer(w.agent1))).status).toBe(200);
      // autre entrepôt
      expect((await list(w.agent2, invoiceOf(w))).status).toBe(403);
      expect((await api(t).get(`/v1/files/${file.id}/link`).set(bearer(w.agent2))).status).toBe(403);
      // personne du personnel ne modifie une facture du client
      expect((await upload(w.agent1, invoiceOf(w), 'INVOICE', fixtures.pdf(), 'application/pdf')).status).toBe(403);
      expect((await api(t).delete(`/v1/files/${file.id}`).set(bearer(w.agent1))).status).toBe(403);
    });

    it('photos de colis : le personnel de l’entrepôt dépose, le client propriétaire lit mais ne dépose ni ne supprime', async () => {
      const w = await setup();
      const photo = await upload(w.agent1, packageOf(w), 'PHOTO', fixtures.jpeg(), 'image/jpeg');
      expect(photo.status).toBe(201);
      expect((await upload(w.agent2, packageOf(w), 'PHOTO', fixtures.jpeg(), 'image/jpeg')).status).toBe(403);

      expect((await upload(w.customer1.token, packageOf(w), 'PHOTO', fixtures.jpeg(), 'image/jpeg')).status).toBe(403);
      expect((await list(w.customer1.token, packageOf(w))).body.items).toHaveLength(1);
      expect((await api(t).delete(`/v1/files/${photo.body.id}`).set(bearer(w.customer1.token))).status).toBe(403);
      // un autre client ne voit pas le colis
      expect((await list(w.customer2.token, packageOf(w))).status).toBe(404);
      expect((await api(t).get(`/v1/files/${photo.body.id}/link`).set(bearer(w.customer2.token))).status).toBe(404);
    });

    it('la facture ne se modifie plus une fois le colis arrivé, mais reste lisible', async () => {
      const w = await setup();
      const file = await uploaded(w);
      const received = await api(t).post('/v1/admin/packages/receive').set(bearer(w.token)).send({ warehouseId: w.w1.id, expectedPackageId: w.prealert.package.id });
      expect(received.status).toBe(200);
      const add = await upload(w.customer1.token, invoiceOf(w), 'INVOICE', fixtures.pdf(), 'application/pdf');
      expect(add.status).toBe(409);
      expect(errorCode(add)).toBe('PREALERT_LOCKED');
      expect((await api(t).delete(`/v1/files/${file.id}`).set(bearer(w.customer1.token))).status).toBe(409);
      expect((await api(t).get(`/v1/files/${file.id}/link`).set(bearer(w.customer1.token))).status).toBe(200);
    });
  });

  describe('liens signés', () => {
    it('livre le contenu sans session, avec des en-têtes qui empêchent toute interprétation', async () => {
      const w = await setup();
      const body = fixtures.pdf();
      const file = await uploaded(w, body);
      const link = await api(t).get(`/v1/files/${file.id}/link`).set(bearer(w.customer1.token));
      expect(link.status).toBe(200);
      expect(new Date(link.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(new Date(link.body.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 2000);

      const content = await api(t).get(link.body.url).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(content.status).toBe(200);
      expect(Buffer.from(content.body).equals(body)).toBe(true);
      expect(content.headers['content-type']).toContain('application/pdf');
      expect(content.headers['x-content-type-options']).toBe('nosniff');
      expect(content.headers['content-security-policy']).toContain('sandbox');
      expect(content.headers['cache-control']).toContain('private');
    });

    it('refuse un lien modifié, d’une autre entreprise, ou expiré', async () => {
      const w = await setup();
      const other = await setup();
      const file = await uploaded(w);
      const link = (await api(t).get(`/v1/files/${file.id}/link`).set(bearer(w.customer1.token))).body.url as string;
      const url = new URL(link, 'http://x');
      const get = (params: URLSearchParams, id = file.id) => api(t).get(`/v1/files/${id}/content?${params.toString()}`);

      const tamperedSig = new URLSearchParams(url.searchParams);
      tamperedSig.set('sig', (url.searchParams.get('sig') as string).replace(/^./, (c) => (c === 'a' ? 'b' : 'a')));
      expect(errorCode(await get(tamperedSig))).toBe('LINK_INVALID');

      const extended = new URLSearchParams(url.searchParams);
      extended.set('exp', String(Number(url.searchParams.get('exp')) + 3600));
      expect(errorCode(await get(extended))).toBe('LINK_INVALID');

      const foreignCompany = new URLSearchParams(url.searchParams);
      foreignCompany.set('c', other.company.id);
      expect(errorCode(await get(foreignCompany))).toBe('LINK_INVALID');

      const noSig = new URLSearchParams(url.searchParams);
      noSig.delete('sig');
      expect((await get(noSig)).status).toBe(400);

      // un lien valide pour un fichier ne vaut pas pour un autre
      const second = await uploaded(w);
      expect(errorCode(await get(new URLSearchParams(url.searchParams), second.id))).toBe('LINK_INVALID');

      // expiration : l'horloge avance de plus de 5 minutes
      const real = Date.now;
      const spy = jest.spyOn(Date, 'now').mockImplementation(() => real() + 6 * 60 * 1000);
      try {
        const expired = await get(new URLSearchParams(url.searchParams));
        expect(expired.status).toBe(403);
        expect(errorCode(expired)).toBe('LINK_EXPIRED');
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('suppression et fusion', () => {
    it('supprime la pièce de la base et du stockage ; son lien ne livre plus rien', async () => {
      const w = await setup();
      const file = await uploaded(w);
      const row = await t.admin.fileObject.findUniqueOrThrow({ where: { id: file.id } });
      const link = (await api(t).get(`/v1/files/${file.id}/link`).set(bearer(w.customer1.token))).body.url as string;

      expect((await api(t).delete(`/v1/files/${file.id}`).set(bearer(w.customer1.token))).status).toBe(204);
      expect(await t.admin.fileObject.count({ where: { id: file.id } })).toBe(0);
      await expect(t.app.get(FileStorage).get(row.storageKey)).rejects.toThrow();
      expect((await api(t).get(link)).status).toBe(404);
      expect((await api(t).delete(`/v1/files/${file.id}`).set(bearer(w.customer1.token))).status).toBe(404);
      expect((await list(w.customer1.token, invoiceOf(w))).body.items).toHaveLength(0);
    });

    it('journalise le dépôt et la suppression', async () => {
      const w = await setup();
      const file = await uploaded(w);
      await api(t).delete(`/v1/files/${file.id}`).set(bearer(w.customer1.token));
      const actions = (await t.admin.auditLog.findMany({ where: { companyId: w.company.id, entityId: file.id } })).map((a) => a.action).sort();
      expect(actions).toEqual(['file.deleted', 'file.uploaded']);
    });

    it('la fusion d’un colis non identifié dans le colis attendu transfère ses photos', async () => {
      const w = await setup();
      const physical = (await api(t).post('/v1/admin/packages/receive').set(bearer(w.token)).send({ warehouseId: w.w1.id })).body.package;
      const photo = await upload(w.agent1, { ownerType: 'PACKAGE', ownerId: physical.id }, 'PHOTO', fixtures.jpeg(), 'image/jpeg');
      expect(photo.status).toBe(201);

      const merged = await api(t)
        .post(`/v1/admin/packages/${physical.id}/identify`)
        .set(bearer(w.token))
        .send({ customerCode: w.customer1.customerCode, mergeIntoPackageId: w.prealert.package.id });
      expect(merged.status).toBe(200);
      expect((await list(w.customer1.token, packageOf(w))).body.items.map((f: any) => f.id)).toEqual([photo.body.id]);
    });

    it('la base empêche de ranger un fichier hors du dossier de son entreprise', async () => {
      const w = await setup();
      const other = await setup();
      const data = {
        companyId: w.company.id,
        ownerType: 'PREALERT' as const,
        ownerId: w.prealert.id,
        kind: 'INVOICE' as const,
        originalName: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
        uploadedBy: w.customer1.user.id,
      };
      await expect(t.admin.fileObject.create({ data: { ...data, storageKey: `companies/${other.company.id}/x.pdf` } })).rejects.toThrow();
      await expect(t.admin.fileObject.create({ data: { ...data, storageKey: `companies/${w.company.id}/../x.pdf` } })).rejects.toThrow();
      await expect(t.admin.fileObject.create({ data: { ...data, storageKey: `companies/${w.company.id}/x.pdf`, mimeType: 'text/html' } })).rejects.toThrow();
    });
  });
});

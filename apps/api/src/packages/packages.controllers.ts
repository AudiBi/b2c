import { Controller, Delete, Get, Header, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  addNoteSchema,
  createCounterPackageSchema,
  createPrealertSchema,
  formatTrackingNumber,
  groupPackagesSchema,
  identifyPackageSchema,
  idParamSchema,
  listExpectedQuerySchema,
  listPackagesQuerySchema,
  normalizeTrackingNumber,
  receivePackageSchema,
  registerPackageSchema,
  trackingParamSchema,
  transitionSchema,
  updatePrealertSchema,
} from '@b2c/shared';
import type { z } from 'zod';
import { AppException } from '../common/errors';
import { Validate, VBody, VParams, VQuery } from '../common/validation';
import { DbService } from '../database/db.service';
import type { AuthContext } from '../security/auth.types';
import { AnyAuthenticated, CurrentAuth, Public, RateLimit, RequirePermission } from '../security/decorators';
import { PackagesService, pickupPoint, publicEventDto } from './packages.service';
import { PortalPackagesService, PrealertsService } from './prealerts.service';

type Id = z.infer<typeof idParamSchema>;

@ApiTags('Colis (personnel)')
@ApiBearerAuth()
@Controller('admin/packages')
export class AdminPackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get()
  @RequirePermission('package:read')
  @Validate({ query: listPackagesQuerySchema })
  @ApiOperation({ summary: 'Liste des colis (limitée aux entrepôts de votre périmètre)', description: 'Recherche par numéro de suivi, numéro du marchand ou code client.' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listPackagesQuerySchema>) {
    return this.packages.list(auth, query);
  }

  @Get('expected')
  @RequirePermission('package:receive')
  @Validate({ query: listExpectedQuerySchema })
  @ApiOperation({ summary: 'Colis attendus (préalertes ouvertes), pour retrouver le client à l\'arrivée d\'un colis' })
  expected(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listExpectedQuerySchema>) {
    return this.packages.expected(auth, query);
  }

  @Post('receive')
  @HttpCode(200)
  @RequirePermission('package:receive')
  @Validate({ body: receivePackageSchema })
  @ApiOperation({
    summary: 'Réceptionne un colis en entrepôt et le rapproche d\'une préalerte',
    description:
      "Rapprochement automatique si le numéro de suivi du marchand correspond EXACTEMENT à un seul colis attendu, ou si le code client désigne un seul colis attendu. Plusieurs candidats : 409 AMBIGUOUS_MATCH avec la liste (renvoyer expectedPackageId). Aucune correspondance : nouveau colis, identifié par le code client ou « non identifié ».",
  })
  receive(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof receivePackageSchema>) {
    return this.packages.receive(auth, body);
  }

  @Post('counter')
  @RequirePermission('package:receive')
  @Validate({ body: createCounterPackageSchema })
  @ApiOperation({
    summary: 'Crée un colis au comptoir pour un client (avec ou sans compte) et un destinataire',
    description: 'Le colis naît « reçu en entrepôt » ; la pesée et la facturation suivent le parcours habituel.',
  })
  createAtCounter(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createCounterPackageSchema>) {
    return this.packages.createAtCounter(auth, body);
  }

  @Get(':id')
  @RequirePermission('package:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Détail complet : historique (public et interne), anomalies, préalerte' })
  get(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.packages.get(auth, params.id);
  }

  @Post(':id/register')
  @HttpCode(200)
  @RequirePermission('package:register')
  @Validate({ params: idParamSchema, body: registerPackageSchema })
  @ApiOperation({
    summary: 'Enregistre et pèse un colis : mesures, poids volumétrique et facturable, frais',
    description: "Les frais sont calculés avec la grille active ; sans grille applicable le colis est enregistré sans montant (jamais de prix inventé).",
  })
  register(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof registerPackageSchema>) {
    return this.packages.register(auth, params.id, body);
  }

  @Post(':id/identify')
  @HttpCode(200)
  @RequirePermission('package:update')
  @Validate({ params: idParamSchema, body: identifyPackageSchema })
  @ApiOperation({ summary: 'Rattache un colis non identifié à un client (avec option de fusion dans le colis attendu)' })
  identify(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof identifyPackageSchema>) {
    return this.packages.identify(auth, params.id, body);
  }

  @Post(':id/transitions')
  @HttpCode(200)
  // La permission exigée dépend de la transition demandée : elle est contrôlée par la machine d'états
  // (table partagée), y compris la portée par entrepôt. Un client n'a aucune de ces permissions.
  @AnyAuthenticated()
  @Validate({ params: idParamSchema, body: transitionSchema })
  @ApiOperation({
    summary: 'Change le statut d\'un colis (transitions de la table autorisée uniquement)',
    description:
      "Toute autre paire est refusée (409 INVALID_TRANSITION). Les transitions de transport, d'agence et de livraison sont pilotées par leurs modules (409 TRANSITION_NOT_AVAILABLE). Motif obligatoire pour retenir, retourner, annuler.",
  })
  transition(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof transitionSchema>) {
    if (auth.kind === 'CUSTOMER') throw AppException.forbidden('FORBIDDEN', 'Permission insuffisante');
    return this.packages.transitionByStaff(auth, params.id, body);
  }

  @Post(':id/notes')
  @HttpCode(201)
  @RequirePermission('package:update')
  @Validate({ params: idParamSchema, body: addNoteSchema })
  @ApiOperation({ summary: 'Ajoute une note interne (jamais visible du client)' })
  note(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof addNoteSchema>) {
    return this.packages.addNote(auth, params.id, body.note);
  }
}

@ApiTags('Colis (personnel)')
@ApiBearerAuth()
@Controller('admin/package-groups')
export class PackageGroupsController {
  constructor(private readonly packages: PackagesService) {}

  @Post()
  @RequirePermission('package:update')
  @Validate({ body: groupPackagesSchema })
  @ApiOperation({ summary: 'Regroupe des colis du même client' })
  group(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof groupPackagesSchema>) {
    return this.packages.group(auth, body.packageIds);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('package:update')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Dégroupe' })
  async ungroup(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    await this.packages.ungroup(auth, params.id);
  }
}

@ApiTags('Espace client')
@ApiBearerAuth()
@Controller('me/prealerts')
export class PortalPrealertsController {
  constructor(private readonly prealerts: PrealertsService) {}

  @Get()
  @RequirePermission('prealert:read_own')
  @ApiOperation({ summary: 'Mes préalertes' })
  list(@CurrentAuth() auth: AuthContext) {
    return this.prealerts.list(auth);
  }

  @Post()
  @RequirePermission('prealert:create_own')
  @Validate({ body: createPrealertSchema })
  @ApiOperation({
    summary: 'Déclare un achat (préalerte)',
    description: 'Crée le colis attendu avec son numéro de suivi unique. Le rapprochement avec le colis réellement reçu se fait à l\'entrepôt ; aucune connexion à un marchand n\'existe.',
  })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createPrealertSchema>) {
    return this.prealerts.create(auth, body);
  }

  @Get(':id')
  @RequirePermission('prealert:read_own')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Détail de ma préalerte' })
  get(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.prealerts.get(auth, params.id);
  }

  @Patch(':id')
  @RequirePermission('prealert:create_own')
  @Validate({ params: idParamSchema, body: updatePrealertSchema })
  @ApiOperation({ summary: 'Modifie ma préalerte tant que le colis n\'est pas arrivé' })
  update(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof updatePrealertSchema>) {
    return this.prealerts.update(auth, params.id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('prealert:create_own')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Annule ma préalerte tant que le colis n\'est pas arrivé' })
  async cancel(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    await this.prealerts.cancel(auth, params.id);
  }
}

@ApiTags('Espace client')
@ApiBearerAuth()
@Controller('me/packages')
export class PortalPackagesController {
  constructor(private readonly portal: PortalPackagesService) {}

  @Get()
  @RequirePermission('package:read_own')
  @Validate({ query: listPackagesQuerySchema })
  @ApiOperation({ summary: 'Mes colis (y compris ceux que j\'attends encore)' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listPackagesQuerySchema>) {
    return this.portal.list(auth, query);
  }

  @Get(':id')
  @RequirePermission('package:read_own')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Détail de mon colis et historique des événements', description: 'Les montants calculés à la pesée sont provisoires (fees.provisional) : la facture fait foi.' })
  get(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.portal.get(auth, params.id);
  }
}

/** Suivi public : numéro de suivi (secret à 50 bits) → statut et événements PUBLICS uniquement. */
@ApiTags('Public')
@Controller('public/tracking')
export class PublicTrackingController {
  constructor(private readonly db: DbService) {}

  @Get(':trackingNumber')
  @Public()
  @RateLimit({ name: 'public-tracking', limit: 30, windowSeconds: 60 })
  @Validate({ params: trackingParamSchema })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Suivi public d\'un colis',
    description:
      "Aucune donnée personnelle (nom, téléphone, adresse exacte), aucun document, aucune valeur, aucun acteur. Un numéro invalide, inconnu ou mal saisi donne la même réponse 404. L'estimation de livraison n'est renseignée que lorsqu'une donnée réelle existe (jamais pour l'instant).",
  })
  async track(@VParams() params: z.infer<typeof trackingParamSchema>) {
    const notFound = () => AppException.notFound('TRACKING_NOT_FOUND', 'Aucun colis ne correspond à ce numéro');
    const canonical = normalizeTrackingNumber(params.trackingNumber);
    if (!canonical) throw notFound();

    // L'entreprise n'est pas connue du visiteur : la fonction SQL (SECURITY DEFINER) ne renvoie que son identifiant
    const lookup = await this.db.run({ companyId: '00000000-0000-7000-8000-000000000001', platform: false }, (tx) =>
      tx.$queryRaw<{ company: string | null }[]>`SELECT app_package_company(${canonical}) AS company`,
    );
    const companyId = lookup[0]?.company;
    if (!companyId) throw notFound();

    return this.db.run({ companyId }, async (tx) => {
      const pkg = await tx.package.findUnique({ where: { trackingNumber: canonical }, include: { warehouse: true, agency: true } });
      if (!pkg) throw notFound();
      const events = await tx.packageEvent.findMany({
        where: { packageId: pkg.id, visibility: 'PUBLIC', toStatus: { not: null } },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      });
      const last = events[events.length - 1];
      return {
        trackingNumber: formatTrackingNumber(pkg.trackingNumber),
        status: pkg.status,
        lastUpdate: last?.occurredAt ?? pkg.updatedAt,
        transportMode: pkg.transportMode,
        origin: { country: pkg.originCountry, city: pkg.originCity },
        destination: { country: pkg.destinationCountry, city: pkg.destinationCity },
        estimatedDelivery: null,
        pickup: pickupPoint(pkg.agency, pkg.status, true),
        events: events.map((event) => publicEventDto(event, 'PUBLIC')),
      };
    });
  }
}

import { Controller, Delete, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FILE_OWNER_TYPES, idParamSchema, uploadFileQuerySchema } from '@b2c/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Validate, VParams, VQuery } from '../common/validation';
import { AppException } from '../common/errors';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, Public, RateLimit, AnyAuthenticated } from '../security/decorators';
import { FilesService } from './files.service';

const listQuerySchema = z.strictObject({ ownerType: z.enum(FILE_OWNER_TYPES), ownerId: z.uuid() });
const contentQuerySchema = z.strictObject({ c: z.uuid(), exp: z.coerce.number().int(), sig: z.string().regex(/^[0-9a-f]{64}$/) });

@ApiTags('Fichiers')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @AnyAuthenticated()
  @ApiBearerAuth()
  @RateLimit({ name: 'file-upload', limit: 60, windowSeconds: 600, failClosed: true })
  @Validate({ query: uploadFileQuerySchema })
  @ApiConsumes('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiOperation({
    summary: 'Téléverse une pièce jointe (corps binaire brut)',
    description:
      "JPEG, PNG, WebP ou PDF, 8 Mo maximum, 10 pièces par objet. Le type réel est déterminé par le contenu ; un PDF contenant du code actif est refusé. L'accès est vérifié selon le propriétaire : un client ne dépose que sur ses préalertes, le personnel que sur les colis de son entrepôt.",
  })
  upload(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof uploadFileQuerySchema>, @Req() req: Request) {
    return this.files.upload(auth, query, req.body, req.headers['content-type']);
  }

  @Get()
  @AnyAuthenticated()
  @ApiBearerAuth()
  @Validate({ query: listQuerySchema })
  @ApiOperation({ summary: "Pièces jointes d'une préalerte ou d'un colis" })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listQuerySchema>) {
    return this.files.list(auth, query.ownerType, query.ownerId);
  }

  @Get(':id/link')
  @AnyAuthenticated()
  @ApiBearerAuth()
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Lien de téléchargement signé (5 minutes)' })
  link(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>) {
    return this.files.link(auth, params.id);
  }

  @Get(':id/content')
  @Public()
  @RateLimit({ name: 'file-content', limit: 120, windowSeconds: 60 })
  @Validate({ params: idParamSchema, query: contentQuerySchema })
  @ApiOperation({ summary: 'Contenu du fichier, via un lien signé obtenu par /link' })
  async content(@VParams() params: z.infer<typeof idParamSchema>, @VQuery() query: z.infer<typeof contentQuerySchema>, @Res() res: Response) {
    const { file, data } = await this.files.content(query.c, params.id, query.exp, query.sig);
    if (!data.length) throw AppException.notFound('FILE_NOT_FOUND', 'Fichier introuvable');
    res
      .status(200)
      .set({
        'Content-Type': file.mimeType,
        'Content-Length': String(data.length),
        'Content-Disposition': `inline; filename="${encodeURIComponent(file.originalName)}"`,
        // Contenu inerte : jamais interprété comme une page, jamais mis en cache partagé
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, max-age=60',
      })
      .send(data);
  }

  @Delete(':id')
  @AnyAuthenticated()
  @HttpCode(204)
  @ApiBearerAuth()
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Supprime une pièce jointe' })
  async remove(@CurrentAuth() auth: AuthContext, @VParams() params: z.infer<typeof idParamSchema>) {
    await this.files.remove(auth, params.id);
  }
}

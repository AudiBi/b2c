import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@b2c/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AppException } from '../common/errors';
import { ConfigService } from '../config/config.module';
import { Validate, VBody } from '../common/validation';
import { AnyAuthenticated, CurrentAuth, Public, RateLimit } from '../security/decorators';
import type { AuthContext } from '../security/auth.types';
import { AuthService, type SessionTokens } from './auth.service';

const REFRESH_COOKIE = 'b2c_refresh';
const COOKIE_PATH = '/v1/auth';

type Body<T extends z.ZodType> = z.infer<T>;

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @Public()
  @HttpCode(202)
  @RateLimit({ name: 'auth-register', limit: 10, windowSeconds: 3600, failClosed: true })
  @Validate({ body: registerSchema })
  @ApiOperation({
    summary: 'Inscription d\'un client (individuel ou professionnel)',
    description:
      'Répond toujours 202, que l\'adresse soit déjà utilisée ou non : un e-mail de confirmation (ou d\'information) est envoyé.',
  })
  async register(@VBody() body: Body<typeof registerSchema>) {
    await this.auth.register(body);
    return { status: 'verification_email_sent' };
  }

  @Post('verify-email')
  @Public()
  @HttpCode(200)
  @RateLimit({ name: 'auth-verify', limit: 30, windowSeconds: 3600 })
  @Validate({ body: verifyEmailSchema })
  @ApiOperation({ summary: "Confirme l'adresse e-mail avec le jeton reçu par e-mail" })
  async verifyEmail(@VBody() body: Body<typeof verifyEmailSchema>) {
    await this.auth.verifyEmail(body.token);
    return { status: 'email_verified' };
  }

  @Post('resend-verification')
  @Public()
  @HttpCode(202)
  @RateLimit({ name: 'auth-resend', limit: 10, windowSeconds: 3600 })
  @Validate({ body: resendVerificationSchema })
  @ApiOperation({ summary: "Renvoie l'e-mail de confirmation (réponse identique si le compte n'existe pas)" })
  async resend(@VBody() body: Body<typeof resendVerificationSchema>) {
    await this.auth.resendVerification(body.companySlug, body.email);
    return { status: 'accepted' };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @RateLimit({ name: 'auth-login', limit: 30, windowSeconds: 600, failClosed: true })
  @Validate({ body: loginSchema })
  @ApiOperation({
    summary: 'Connexion',
    description:
      'Renvoie un jeton d\'accès (15 min). Le jeton de renouvellement est posé dans un cookie HttpOnly ; les clients mobiles (en-tête X-Client-Type: mobile) le reçoivent dans le corps.',
  })
  async login(
    @VBody() body: Body<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.login(body, { ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) });
    return this.respondWithTokens(req, res, tokens);
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @RateLimit({ name: 'auth-refresh', limit: 60, windowSeconds: 600, failClosed: true })
  @Validate({ body: refreshSchema })
  @ApiOperation({
    summary: 'Renouvelle les jetons (rotation du jeton de renouvellement)',
    description:
      'Avec le cookie, l\'en-tête X-CSRF-Protection: 1 est obligatoire. Réutiliser un jeton déjà tourné révoque toutes les sessions de la famille.',
  })
  async refresh(
    @VBody() body: Body<typeof refreshSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const fromCookie = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    const raw = body.refreshToken ?? fromCookie;
    if (!raw) throw AppException.unauthorized('INVALID_REFRESH_TOKEN', 'Jeton de renouvellement manquant');
    if (!body.refreshToken && req.headers['x-csrf-protection'] !== '1') {
      throw AppException.forbidden('CSRF_HEADER_REQUIRED', 'En-tête X-CSRF-Protection requis');
    }

    const outcome = await this.auth.refresh(raw, { ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) });
    if (outcome.kind !== 'ok') {
      this.clearCookie(res);
      throw outcome.kind === 'reuse'
        ? AppException.unauthorized('REFRESH_TOKEN_REUSED', 'Session révoquée par sécurité, reconnectez-vous')
        : AppException.unauthorized('INVALID_REFRESH_TOKEN', 'Jeton de renouvellement invalide');
    }
    return this.respondWithTokens(req, res, outcome.tokens);
  }

  @Post('logout')
  @AnyAuthenticated()
  @HttpCode(204)
  @Validate({ body: logoutSchema })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Déconnexion (cette session, ou toutes avec allSessions=true)' })
  async logout(
    @CurrentAuth() auth: AuthContext,
    @VBody() body: Body<typeof logoutSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(auth, body.allSessions);
    this.clearCookie(res);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(202)
  @RateLimit({ name: 'auth-forgot', limit: 10, windowSeconds: 3600 })
  @Validate({ body: forgotPasswordSchema })
  @ApiOperation({ summary: 'Demande un lien de réinitialisation (réponse identique si le compte n\'existe pas)' })
  async forgot(@VBody() body: Body<typeof forgotPasswordSchema>) {
    await this.auth.forgotPassword(body.companySlug, body.email);
    return { status: 'accepted' };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(200)
  @RateLimit({ name: 'auth-reset', limit: 10, windowSeconds: 3600 })
  @Validate({ body: resetPasswordSchema })
  @ApiOperation({
    summary: 'Définit un nouveau mot de passe (réinitialisation ou activation d\'un compte invité)',
    description: 'Toutes les sessions existantes de l\'utilisateur sont révoquées.',
  })
  async reset(@VBody() body: Body<typeof resetPasswordSchema>) {
    await this.auth.resetPassword(body.token, body.newPassword);
    return { status: 'password_updated' };
  }

  @Get('me')
  @AnyAuthenticated()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Profil de l\'utilisateur connecté, rôles et permissions' })
  me(@CurrentAuth() auth: AuthContext) {
    return {
      id: auth.userId,
      companyId: auth.companyId,
      kind: auth.kind,
      email: auth.email,
      firstName: auth.firstName,
      lastName: auth.lastName,
      locale: auth.locale,
      emailVerified: auth.emailVerified,
      roles: auth.roles,
      permissions: auth.permissions.list(),
    };
  }

  private respondWithTokens(req: Request, res: Response, tokens: SessionTokens) {
    const { refreshToken, ...rest } = tokens;
    if (req.headers['x-client-type'] === 'mobile') return { ...rest, refreshToken };
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: this.config.env.COOKIE_SECURE,
      sameSite: 'lax',
      path: COOKIE_PATH,
      maxAge: this.config.env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600_000,
    });
    return rest;
  }

  private clearCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH, httpOnly: true, sameSite: 'lax', secure: this.config.env.COOKIE_SECURE });
  }
}

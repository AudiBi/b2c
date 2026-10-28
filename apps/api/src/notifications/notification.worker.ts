import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../config/config.module';
import { NotificationsService } from './notifications.service';

/**
 * Traitement de fond : à intervalle régulier, transforme les événements en notifications et envoie les e-mails.
 * La file est dans PostgreSQL (verrous SKIP LOCKED) : plusieurs instances de l'API peuvent tourner sans doublon.
 * (Choix documenté : pas de BullMQ — une dépendance et un point de panne de moins ; Redis reste réservé aux limites de débit.)
 */
@Injectable()
export class NotificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('NotificationWorker');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const every = this.config.env.NOTIFICATION_WORKER_INTERVAL_MS;
    if (every > 0) {
      this.timer = setInterval(() => void this.tick(), every);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const companyId of await this.notifications.companiesWithWork()) {
        await this.notifications.processCompany(companyId);
      }
    } catch (error) {
      this.logger.error(`Tour de traitement échoué : ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

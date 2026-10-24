import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { ConfigService } from '../config/config.module';

@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  constructor(private readonly config: ConfigService) {}

  private get options(): argon2.Options {
    return { type: argon2.argon2id, memoryCost: this.config.env.ARGON2_MEMORY_KIB, timeCost: 3, parallelism: 1 };
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, this.options);
  }

  /**
   * Vérifie un mot de passe. Si le compte n'existe pas (hash absent), une vérification factice de même
   * coût est exécutée pour que le temps de réponse ne révèle pas l'existence du compte.
   */
  async verifyOrDummy(hash: string | null | undefined, password: string): Promise<boolean> {
    if (!hash) {
      this.dummyHash ??= this.hash('mot-de-passe-factice-pour-temps-constant');
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}

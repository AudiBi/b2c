import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, DbService],
  exports: [DbService],
})
export class DatabaseModule {}

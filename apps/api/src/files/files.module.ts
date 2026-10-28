import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.module';
import { FileStorage, LocalDiskStorage } from './file-storage';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { S3Storage } from './s3-storage';

@Module({
  controllers: [FilesController],
  providers: [
    FilesService,
    {
      provide: FileStorage,
      inject: [ConfigService],
      useFactory: (config: ConfigService): FileStorage => (config.env.STORAGE_DRIVER === 's3' ? new S3Storage(config) : new LocalDiskStorage(config)),
    },
  ],
  exports: [FilesService],
})
export class FilesModule {}

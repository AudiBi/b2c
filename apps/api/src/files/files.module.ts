import { Module } from '@nestjs/common';
import { FileStorage, LocalDiskStorage } from './file-storage';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService, { provide: FileStorage, useClass: LocalDiskStorage }],
  exports: [FilesService],
})
export class FilesModule {}

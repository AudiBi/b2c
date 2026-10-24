import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { RolesController } from './roles.controller';

@Module({
  controllers: [AdminUsersController, RolesController],
  providers: [AdminUsersService],
})
export class IamModule {}

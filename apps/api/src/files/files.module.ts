import { Module } from '@nestjs/common';

import { AccessModule } from '../access';
import { AuthModule } from '../auth';
import { NodesModule } from '../nodes';
import { StorageModule } from '../storage';
import { FileContentController, UploadsController } from './files.controller';
import { FilesService } from './files.service';

/**
 * L3. `nodes` + `storage`, and the only place the two meet.
 *
 * Exports `FilesService` for one caller that does not exist yet: `jobs` (L4)
 * runs `reapPending` on a schedule. That is the only reason this module exports
 * anything at all.
 */
@Module({
  imports: [NodesModule, StorageModule, AccessModule, AuthModule],
  controllers: [UploadsController, FileContentController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}

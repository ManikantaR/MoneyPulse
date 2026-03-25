import { Injectable, Logger } from '@nestjs/common';
import { mkdir, rename } from 'fs/promises';
import { join, basename, dirname } from 'path';

@Injectable()
export class ArchiverService {
  private readonly logger = new Logger(ArchiverService.name);

  /**
   * Move a successfully imported file to the .archived/ subfolder.
   * Path: {watch-folder}/{account-slug}/.archived/{filename}_{timestamp}
   */
  async archiveFile(filePath: string): Promise<string> {
    const dir = dirname(filePath);
    const file = basename(filePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivedDir = join(dir, '.archived');

    await mkdir(archivedDir, { recursive: true });

    const archivedFilename = `${file}_${timestamp}`;
    const archivedPath = join(archivedDir, archivedFilename);

    await rename(filePath, archivedPath);
    this.logger.log(`Archived: ${filePath} → ${archivedPath}`);

    return archivedPath;
  }
}

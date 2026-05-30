import {
  Controller,
  Get,
  Delete,
  Param,
  UseGuards,
  HttpCode,
  NotFoundException,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AttachmentService } from './attachment.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthTokenPayload } from '@moneypulse/shared';

/** Handles download and deletion of individual attachments. */
@ApiTags('Attachments')
@Controller('attachments')
@UseGuards(JwtAuthGuard)
export class AttachmentDownloadController {
  constructor(private readonly attachmentService: AttachmentService) {}

  /**
   * GET /attachments/:id/download — Serve an attachment file as a download.
   * Verifies that the attachment belongs to the requesting user.
   */
  @Get(':id/download')
  @ApiOperation({ summary: 'Download an attachment file' })
  async download(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
    @Res() res: Response,
  ) {
    const attachment = await this.attachmentService.findById(id);

    if (!attachment || attachment.userId !== user.sub) {
      throw new NotFoundException('Attachment not found');
    }

    res.download(attachment.storagePath, attachment.originalFilename);
  }

  /**
   * DELETE /attachments/:id — Remove an attachment from disk and database.
   * Verifies ownership before deletion.
   */
  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete an attachment' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    await this.attachmentService.deleteAttachment(id, user.sub);
    return { data: { deleted: true } };
  }
}

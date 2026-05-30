import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { AttachmentService } from './attachment.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthTokenPayload } from '@moneypulse/shared';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const ALLOWED_EXTENSIONS = /\.(pdf|png|jpg|jpeg|webp|heic|heif)$/i;

/** Multer file filter: accept only PDF and image files. */
function attachmentFileFilter(
  _req: any,
  file: Express.Multer.File,
  cb: (err: Error | null, accept: boolean) => void,
) {
  if (
    !ALLOWED_EXTENSIONS.test(file.originalname) &&
    !ALLOWED_MIME_TYPES.has(file.mimetype)
  ) {
    return cb(
      new BadRequestException(
        'File type not allowed. Accepted: PDF, PNG, JPG, JPEG, WEBP, HEIC',
      ),
      false,
    );
  }
  cb(null, true);
}

/** Handles upload and listing of attachments on a transaction. */
@ApiTags('Attachments')
@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class AttachmentController {
  constructor(private readonly attachmentService: AttachmentService) {}

  /**
   * POST /transactions/:transactionId/attachments — Upload a receipt or bill.
   * Uses memory storage; ownership is verified before writing to disk.
   */
  @Post(':transactionId/attachments')
  @HttpCode(201)
  @ApiOperation({ summary: 'Upload a receipt or bill for a transaction' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: attachmentFileFilter,
    }),
  )
  async upload(
    @Param('transactionId') transactionId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    if (!file) throw new BadRequestException('No file provided');

    // Ownership check happens before any file is written to disk
    await this.attachmentService.verifyTransactionOwnership(
      transactionId,
      user.sub,
    );

    const attachment = await this.attachmentService.createAttachment(
      transactionId,
      user.sub,
      file,
    );

    return { data: attachment };
  }

  /**
   * GET /transactions/:transactionId/attachments — List all attachments for a transaction.
   */
  @Get(':transactionId/attachments')
  @ApiOperation({ summary: 'List attachments for a transaction' })
  async list(
    @Param('transactionId') transactionId: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const attachments = await this.attachmentService.listAttachments(
      transactionId,
      user.sub,
    );
    return { data: attachments };
  }
}

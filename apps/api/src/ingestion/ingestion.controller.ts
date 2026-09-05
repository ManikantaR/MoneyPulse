import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { z } from 'zod/v4';
import { IngestionService } from './ingestion.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { MAX_UPLOAD_SIZE_BYTES, csvFormatConfigSchema } from '@moneypulse/shared';
import type { AuthTokenPayload } from '@moneypulse/shared';

const reassignUploadSchema = z.object({
  accountId: z.string().min(1),
  csvFormatConfig: csvFormatConfigSchema.optional(),
});
type ReassignUploadInput = z.infer<typeof reassignUploadSchema>;

const watcherEventSchema = z.object({
  stage: z.enum(['detected', 'renamed', 'staged', 'failed']),
  slug: z.string().min(1),
  originalFilename: z.string().min(1),
  renamedFilename: z.string().min(1).optional(),
  bank: z.string().min(1).optional(),
  detectedAt: z.string().optional(),
  stagedAt: z.string().optional(),
  error: z.string().optional(),
});
type WatcherEventInput = z.infer<typeof watcherEventSchema>;

@ApiTags('Uploads')
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  /**
   * POST /uploads — Upload a bank statement file (CSV, XLSX, or PDF).
   * Validates file type and size, enforces account ownership, deduplicates by SHA-256 hash,
   * saves to disk, creates a `file_uploads` record, and enqueues a BullMQ parse job.
   *
   * @param file - Multipart file (memory buffer)
   * @param accountId - Target account UUID (must be owned by the caller)
   * @param user - JWT token payload
   * @returns `{ data: FileUpload }` — the created upload record with status `pending`
   */
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Upload a bank statement file (CSV/Excel/PDF)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
      storage: undefined, // use memory storage (buffer)
      fileFilter: (_req, file, cb) => {
        const allowed = /\.(csv|xlsx|pdf)$/i;
        if (!allowed.test(file.originalname)) {
          return cb(new BadRequestException('File type not allowed. Supported: .csv, .xlsx, .pdf'), false);
        }
        cb(null, true);
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('accountId') accountId: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    if (!accountId) throw new BadRequestException('accountId is required');

    const upload = await this.ingestionService.uploadFile(
      user.sub,
      accountId,
      file,
    );
    return { data: upload };
  }

  /**
   * GET /uploads/:id — Poll the processing status of an upload.
   * Scoped to the authenticated user; returns 404 for uploads not owned by them.
   *
   * @param id - Upload UUID path parameter
   * @param user - JWT token payload
   * @returns `{ data: FileUpload }` — includes `status`, `rowsImported`, `errorLog`, etc.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get upload status (polling)' })
  async getStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const upload = await this.ingestionService.getUploadStatus(id, user.sub);
    return { data: upload };
  }

  /**
   * GET /uploads — List all upload records for the authenticated user, ordered by creation date.
   *
   * @param user - JWT token payload
   * @returns `{ data: FileUpload[] }`
   */
  @Get()
  @ApiOperation({ summary: 'List all uploads for current user' })
  async list(@CurrentUser() user: AuthTokenPayload) {
    const uploads = await this.ingestionService.listUploads(user.sub);
    return { data: uploads };
  }

  /**
   * DELETE /uploads/:id — Delete an upload record and its associated transactions.
   * Only allowed for completed or failed uploads (not in-progress).
   */
  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete an upload and its transactions' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    return this.ingestionService.deleteUpload(id, user.sub);
  }

  /**
   * POST /uploads/:id/reprocess — re-run ingestion for a `failed`, `stalled`,
   * or `empty` upload without re-dropping the file. Locates the source file
   * via `archivedPath` (if the original run archived it) or reconstructs the
   * original staged path from provenance columns. Safe to click twice —
   * rejects with 400 if the upload is already pending/processing.
   */
  @Post(':id/reprocess')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-run ingestion for a failed/stalled/empty upload' })
  async reprocess(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const upload = await this.ingestionService.reprocessUpload(id, user.sub);
    return { data: upload };
  }

  /**
   * POST /uploads/:id/reassign — fix-and-rerun: point an `orphaned` upload
   * (or one imported under the wrong account) at the correct account,
   * optionally overriding CSV format config for this run, deletes any
   * transactions already imported from this file, and re-runs ingestion.
   */
  @Post(':id/reassign')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fix account/mapping and re-run ingestion for an upload' })
  async reassign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reassignUploadSchema)) body: ReassignUploadInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const upload = await this.ingestionService.reassignUpload(id, user.sub, body);
    return { data: upload };
  }
}

/**
 * POST /ingestion/watcher-events — future hand-off point for the laptop
 * watcher (bank-statement-watcher repo). Reports a single stage of the
 * watcher's local pipeline (detected/renamed/staged/failed) so that
 * provenance and watcher-side failures become visible on the matching
 * `file_uploads` row instead of only surfacing (or vanishing) once the file
 * physically reaches the NAS watch folder. Wiring the watcher itself to call
 * this endpoint is a separate follow-up in that repo.
 */
@ApiTags('Ingestion')
@Controller('ingestion')
@UseGuards(JwtAuthGuard)
export class IngestionEventsController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post('watcher-events')
  @HttpCode(202)
  @ApiOperation({ summary: 'Report a watcher pipeline stage event' })
  async watcherEvent(
    @Body(new ZodValidationPipe(watcherEventSchema)) body: WatcherEventInput,
  ) {
    const result = await this.ingestionService.recordWatcherEvent(body);
    return { data: { result } };
  }
}

import {
  Controller,
  Post,
  Get,
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
import { IngestionService } from './ingestion.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MAX_UPLOAD_SIZE_BYTES } from '@moneypulse/shared';
import type { AuthTokenPayload } from '@moneypulse/shared';

@ApiTags('Uploads')
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

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

  @Get(':id')
  @ApiOperation({ summary: 'Get upload status (polling)' })
  async getStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const upload = await this.ingestionService.getUploadStatus(id, user.sub);
    return { data: upload };
  }

  @Get()
  @ApiOperation({ summary: 'List all uploads for current user' })
  async list(@CurrentUser() user: AuthTokenPayload) {
    const uploads = await this.ingestionService.listUploads(user.sub);
    return { data: uploads };
  }
}

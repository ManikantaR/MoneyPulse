import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MerchantAliasService } from './merchant-alias.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { z } from 'zod/v4';
import type { AuthTokenPayload } from '@moneypulse/shared';

const createAliasSchema = z.object({
  pattern: z.string().min(1).max(200),
  matchType: z.enum(['contains', 'startsWith', 'exact', 'regex']),
  displayName: z.string().min(1).max(200),
});

const updateAliasSchema = createAliasSchema.partial();

type CreateAliasInput = z.infer<typeof createAliasSchema>;
type UpdateAliasInput = z.infer<typeof updateAliasSchema>;

@ApiTags('Merchant Aliases')
@Controller('merchant-aliases')
@UseGuards(JwtAuthGuard)
export class MerchantAliasController {
  constructor(private readonly merchantAliasService: MerchantAliasService) {}

  @Get()
  @ApiOperation({ summary: 'List merchant aliases for current user and global aliases' })
  async list(@CurrentUser() user: AuthTokenPayload) {
    const aliases = await this.merchantAliasService.findAllForUser(user.sub);
    return { data: aliases };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new merchant alias' })
  async create(
    @Body(new ZodValidationPipe(createAliasSchema)) body: CreateAliasInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const alias = await this.merchantAliasService.create(user.sub, body);
    return { data: alias };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a merchant alias (must own it)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAliasSchema)) body: UpdateAliasInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const alias = await this.merchantAliasService.update(id, user.sub, body);
    return { data: alias };
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a user-created merchant alias' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthTokenPayload) {
    await this.merchantAliasService.remove(id, user.sub);
    return { data: { deleted: true } };
  }
}

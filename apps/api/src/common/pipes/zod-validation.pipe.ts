import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import type { ZodType, ZodError, ZodIssue } from 'zod/v4';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodType<any>) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const error = result.error as ZodError;
      const messages = error.issues.map((issue: ZodIssue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });
      throw new BadRequestException({
        statusCode: 400,
        message: messages,
        error: 'Validation Error',
      });
    }
    return result.data;
  }
}

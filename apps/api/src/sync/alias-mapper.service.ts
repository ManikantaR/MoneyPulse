import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';

@Injectable()
export class AliasMapperService {
  private getAliasSecret(): string {
    return process.env.ALIAS_SECRET || '';
  }

  toAliasId(entityType: string, localId: string, version = 1): string {
    const secret = this.getAliasSecret();
    if (!secret) {
      throw new Error('ALIAS_SECRET must be set for sync alias mapping');
    }

    const digest = createHmac('sha256', `${secret}:v${version}`)
      .update(`${entityType}:${localId}`)
      .digest('hex');

    return `a${version}_${digest.slice(0, 40)}`;
  }
}

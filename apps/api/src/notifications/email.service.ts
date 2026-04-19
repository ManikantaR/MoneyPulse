import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(this.config.get('SMTP_PORT', 587)),
        secure: false,
        auth: {
          user: this.config.get('SMTP_USER'),
          pass: this.config.get('SMTP_PASS'),
        },
      });
      this.logger.log('SMTP configured');
    } else {
      this.logger.log('SMTP not configured — email notifications disabled');
    }
  }

  async send(to: string, subject: string, text: string): Promise<boolean> {
    if (!this.transporter) return false;

    try {
      await this.transporter.sendMail({
        from: this.config.get(
          'SMTP_FROM',
          'MoneyPulse <noreply@moneypulse.local>',
        ),
        to,
        subject,
        text,
      });
      return true;
    } catch (err: any) {
      this.logger.error(`Email failed to ${to}: ${err.message}`);
      return false;
    }
  }
}

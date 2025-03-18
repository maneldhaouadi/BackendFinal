import { Module } from '@nestjs/common';
import { WebhookController } from './controllers/webhook.controller';

@Module({
  controllers: [WebhookController],
})
export class dialogflowModule {}
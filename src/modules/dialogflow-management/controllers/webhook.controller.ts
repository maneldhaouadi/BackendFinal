import { Controller, Post, Body } from '@nestjs/common';

@Controller('webhook')
export class WebhookController {
  @Post()
  handleWebhook(@Body() body: any) {
    console.log('Received webhook payload:', body);
    // Traitez les données reçues de Dialogflow ici
    return { fulfillmentText: 'Webhook received successfully!' };
  }
}
import { Controller, Post, Body, Logger, Get, Param, Headers } from '@nestjs/common';
import { DialogflowService } from '../services/dialogflow.service';

@Controller('dialogflow')
export class DialogflowController {
  private readonly logger = new Logger(DialogflowController.name);

  constructor(private readonly dialogflowService: DialogflowService) {}

  @Post()
  public async handleDialogflowRequest(
    @Body() fullRequest: {
      languageCode?: string;
      queryText?: string;
      sessionId?: string;
    }
  ): Promise<any> {
    try {
      const response = await this.dialogflowService.detectIntent(
        fullRequest.languageCode,
        fullRequest.queryText || '',
        fullRequest.sessionId || 'default-session'
      );

      this.logger.debug(`Dialogflow response: ${JSON.stringify(response)}`);
      return response;
    } catch (error) {
      this.logger.error(`Dialogflow processing error: ${error.message}`, error.stack);
      return this.buildErrorResponse(error, fullRequest.languageCode || 'en');
    }
  }

  @Get('quotation-status/:number')
  public async getQuotationStatus(
    @Param('number') number: string,
    @Headers('accept-language') acceptLanguage: string
  ) {
    const lang = this.parseLanguageHeader(acceptLanguage);
    
    try {
      const result = await this.dialogflowService.getQuotationStatus(number);
      
      if (!result) {
        return {
          success: false,
          type: 'quotation',
          number,
          status: 'NOT_FOUND',
          message: this.getTranslation(lang).notFound('quotation', number),
          timestamp: new Date().toISOString()
        };
      }

      const statusMessage = this.dialogflowService.getQuotationStatusMessage(result.status, lang);
      
      return {
        success: true,
        type: 'quotation',
        number: result.quotationNumber,
        status: result.status,
        statusMessage,
        details: result.details,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return this.buildErrorResponse(error, lang);
    }
  }

  @Get('invoice-status/:number')
  public async getInvoiceStatus(
    @Param('number') number: string,
    @Headers('accept-language') acceptLanguage: string
  ) {
    const lang = this.parseLanguageHeader(acceptLanguage);
    
    try {
      const result = await this.dialogflowService.getInvoiceStatus(number);
      
      if (!result) {
        return {
          success: false,
          type: 'invoice',
          number,
          status: 'NOT_FOUND',
          message: this.getTranslation(lang).notFound('invoice', number),
          timestamp: new Date().toISOString()
        };
      }

      const statusMessage = this.dialogflowService.getInvoiceStatusMessage(result.status, lang);
      
      return {
        success: true,
        type: 'invoice',
        number: result.invoiceNumber,
        status: result.status,
        statusMessage,
        details: result.details,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return this.buildErrorResponse(error, lang);
    }
  }

  private parseLanguageHeader(acceptLanguage?: string): string {
    if (!acceptLanguage) return 'en';
    const lang = acceptLanguage.split('-')[0].toLowerCase();
    return ['en', 'fr', 'es'].includes(lang) ? lang : 'en';
  }

  private getTranslation(lang: string) {
    return {
      en: {
        notFound: (type: string, num: string) => `${type} ${num} not found`
      },
      fr: {
        notFound: (type: string, num: string) => 
          `${type === 'invoice' ? 'Facture' : 'Devis'} ${num} introuvable`
      },
      es: {
        notFound: (type: string, num: string) => 
          `No se encontró ${type === 'invoice' ? 'la factura' : 'el presupuesto'} ${num}`
      }
    }[lang] || {
      notFound: (type: string, num: string) => `${type} ${num} not found`
    };
  }

  private buildErrorResponse(error: Error, language: string) {
    const errorMessages = {
      en: "Sorry, an error occurred. Please try again.",
      fr: "Désolé, une erreur s'est produite. Veuillez réessayer.",
      es: "Lo sentimos, ocurrió un error. Por favor intente nuevamente."
    };

    this.logger.error(`Error [${language}]: ${error.message}`, error.stack);
    return {
      success: false,
      error: error.message,
      message: errorMessages[language] || errorMessages['en'],
      timestamp: new Date().toISOString()
    };
  }
 
}
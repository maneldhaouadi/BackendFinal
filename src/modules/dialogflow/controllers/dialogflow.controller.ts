import { Controller, Post, Body, Logger, Get, Param, Headers } from '@nestjs/common';
import { DialogflowService } from '../services/dialogflow.service';
import { DISCOUNT_TYPES } from 'src/app/enums/discount-types.enum';
import { EXPENSQUOTATION_STATUS } from 'src/modules/expense_quotation/enums/expensquotation-status.enum';

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
      parameters?: any;
      outputContexts?: Array<{
        name: string;
        lifespanCount: number;
        parameters?: any;
      }>;
      intent?: {
        displayName?: string;
      };
    }
  ): Promise<any> {
    try {
      if ((fullRequest.intent?.displayName === 'CreateQuotation') || 
          (fullRequest.queryText?.toLowerCase().includes('créer une quotation') ||
          (fullRequest.queryText?.toLowerCase().includes('nouveau devis')))) {
        return this.startQuotationCreation(fullRequest);
      }

      if (fullRequest.outputContexts?.some(c => c.name.includes('awaiting_quotation'))) {
        return this.handleQuotationSteps(fullRequest);
      }

      return this.handleDefaultDialogflow(fullRequest);

    } catch (error) {
      this.logger.error(`Dialogflow processing error: ${error.message}`, error.stack);
      return this.buildErrorResponse(error, fullRequest.languageCode || 'fr');
    }
  }

  private async startQuotationCreation(request: any) {
    return {
      fulfillmentText: "Commençons la création de votre devis. Veuillez fournir le numéro séquentiel du devis :",
      outputContexts: [{
        name: `${request.sessionId}/contexts/awaiting_quotation`,
        lifespanCount: 5,
        parameters: {
          currentStep: 'sequentialNumbr',
          quotationData: {
            articles: [],
            status: EXPENSQUOTATION_STATUS.Draft,
            currencyId: 1
          }
        }
      }]
    };
  }

  private async handleQuotationSteps(request: any) {
    const context = request.outputContexts?.find(c => c.name.includes('awaiting_quotation'));
    if (!context) {
      return this.startQuotationCreation(request);
    }

    const currentStep = context.parameters?.currentStep || 'sequentialNumbr';
    const quotationData = context.parameters?.quotationData || {
      articles: [],
      status: EXPENSQUOTATION_STATUS.Draft,
      currencyId: 1
    };

    // Initialiser currentArticle si nécessaire
    if (['articleId', 'quantity', 'unitPrice', 'discount'].includes(currentStep)) {
      quotationData.currentArticle = quotationData.currentArticle || {};
    }

    this.logger.debug(`Processing step: ${currentStep}`);
    this.logger.debug(`Request parameters: ${JSON.stringify(request.parameters)}`);
    this.logger.debug(`Current quotationData: ${JSON.stringify(quotationData)}`);

    try {
      switch (currentStep) {
        case 'sequentialNumbr':
          if (!request.parameters?.sequentialNumbr) {
            return this.promptForInput(request, "Veuillez entrer le numéro séquentiel du devis (ex: QUO-123456)");
          }
          quotationData.sequentialNumbr = request.parameters.sequentialNumbr;
          return this.nextStep(request, 'object', "Veuillez saisir l'objet du devis", { quotationData });

        case 'object':
          if (!request.parameters?.object) {
            return this.promptForInput(request, "Veuillez saisir l'objet du devis");
          }
          quotationData.object = request.parameters.object;
          return this.nextStep(request, 'firmId', "ID de la firme pour ce devis (nombre entier)", { quotationData });

        case 'firmId':
          if (!request.parameters?.firmId || isNaN(request.parameters.firmId)) {
            return this.promptForInput(request, "Veuillez entrer un ID de firme valide (nombre entier)");
          }
          quotationData.firmId = Number(request.parameters.firmId);
          return this.nextStep(request, 'interlocutorId', "ID de l'interlocuteur pour ce devis (nombre entier)", { quotationData });

        case 'interlocutorId':
          if (!request.parameters?.interlocutorId || isNaN(request.parameters.interlocutorId)) {
            return this.promptForInput(request, "Veuillez entrer un ID d'interlocuteur valide (nombre entier)");
          }
          quotationData.interlocutorId = Number(request.parameters.interlocutorId);
          return this.nextStep(request, 'date', "Date du devis (format JJ-MM-AAAA)", { quotationData });

        case 'date':
          if (!request.parameters?.date) {
            return this.promptForInput(request, "Veuillez entrer la date du devis (format JJ-MM-AAAA)");
          }
          try {
            const [day, month, year] = request.parameters.date.split('-').map(Number);
            quotationData.date = new Date(year, month - 1, day);
          } catch (e) {
            return this.promptForInput(request, "Format de date invalide. Veuillez utiliser JJ-MM-AAAA");
          }
          return this.nextStep(request, 'duedate', "Date d'échéance du devis (format JJ-MM-AAAA)", { quotationData });

        case 'duedate':
          if (!request.parameters?.duedate) {
            return this.promptForInput(request, "Veuillez entrer la date d'échéance du devis (format JJ-MM-AAAA)");
          }
          try {
            const [day, month, year] = request.parameters.duedate.split('-').map(Number);
            quotationData.dueDate = new Date(year, month - 1, day);
          } catch (e) {
            return this.promptForInput(request, "Format de date invalide. Veuillez utiliser JJ-MM-AAAA");
          }
          return this.nextStep(request, 'status', "Statut du devis (Brouillon, En attente, Validé, Refusé)", { quotationData });

        case 'status':
          if (!request.parameters?.status) {
            return this.promptForInput(request, "Veuillez entrer le statut du devis");
          }
          quotationData.status = this.mapStatus(request.parameters.status);
          return this.nextStep(request, 'articleId', "Ajout d'un article. Veuillez entrer l'ID de l'article", { quotationData });

        case 'articleId':
          if (!request.parameters?.articleId || isNaN(request.parameters.articleId)) {
            return this.promptForInput(request, "Veuillez entrer un ID d'article valide (nombre entier)");
          }
          quotationData.currentArticle = { 
            articleId: Number(request.parameters.articleId) 
          };
          return this.nextStep(request, 'quantity', "Entrez la quantité (nombre entier)", { quotationData });

        case 'quantity':
          if (!request.parameters?.quantity || isNaN(request.parameters.quantity)) {
            return this.promptForInput(request, "Veuillez entrer une quantité valide (nombre entier)");
          }
          quotationData.currentArticle.quantity = Number(request.parameters.quantity);
          return this.nextStep(request, 'unitPrice', "Entrez le prix unitaire (nombre décimal ou 'défaut')", { quotationData });

        case 'unitPrice':
          if (request.parameters?.unitPrice && request.parameters.unitPrice !== 'défaut') {
            if (isNaN(request.parameters.unitPrice)) {
              return this.promptForInput(request, "Veuillez entrer un prix unitaire valide (nombre décimal)");
            }
            quotationData.currentArticle.unit_price = Number(request.parameters.unitPrice);
          }
          return this.nextStep(request, 'discount', "Entrez la remise (nombre décimal ou pourcentage, ex: 10 ou 10%)", { quotationData });

        case 'discount':
          if (request.parameters?.discount && !isNaN(request.parameters.discount)) {
            quotationData.currentArticle.discount = Number(request.parameters.discount);
            quotationData.currentArticle.discount_type = 
              request.parameters.discountType || DISCOUNT_TYPES.PERCENTAGE;
          }
          return this.nextStep(request, 'moreArticles', "Voulez-vous ajouter un autre article ? (Oui/Non)", { quotationData });

          case 'moreArticles':
            if (quotationData.currentArticle) {
              // Ajouter l'article à la liste
              quotationData.articles.push({...quotationData.currentArticle});
              
              // Récupérer les infos de l'article pour le message
              const article = await this.dialogflowService.getArticleInfo(
                quotationData.currentArticle.articleId,
                request.languageCode || 'fr'
              );
              
              const articleName = article?.title || `ID ${quotationData.currentArticle.articleId}`;
              const quantity = quotationData.currentArticle.quantity;
              const unitPrice = quotationData.currentArticle.unit_price;
              
              delete quotationData.currentArticle;
          
              return {
                fulfillmentText: `Article "${articleName}" ajouté avec succès!\n` +
                               `• Quantité: ${quantity}\n` +
                               `• Prix unitaire: ${unitPrice}€\n\n` +
                               `Voulez-vous ajouter un autre article ? (Oui/Non)`,
                outputContexts: [{
                  name: `${request.sessionId}/contexts/awaiting_quotation`,
                  lifespanCount: 5,
                  parameters: {
                    ...context.parameters,
                    quotationData
                  }
                }]
              };
            }

          if (request.queryText?.toLowerCase().includes('oui')) {
            return this.nextStep(request, 'articleId', "Ajout d'un nouvel article. ID de l'article ?", { quotationData });
          }
          return this.nextStep(request, 'finalize', "Voulez-vous créer le devis maintenant ? (Oui/Non)", { quotationData });

        case 'finalize':
          if (request.queryText?.toLowerCase().includes('oui')) {
            // Log final avant création
            this.logger.debug('Final quotation data before creation:', quotationData);
            
            const result = await this.dialogflowService.createQuotation(
              quotationData, 
              request.languageCode || 'fr'
            );
            
            return {
              fulfillmentText: `Devis créé avec succès! Numéro: ${result.quotationNumber}\nTotal: ${result.total}€`,
              outputContexts: []
            };
          }
          return this.nextStep(request, 'sequentialNumbr', "Création annulée. Recommençons.", { 
            quotationData: {
              articles: [],
              status: EXPENSQUOTATION_STATUS.Draft,
              currencyId: 1
            }
          });

        default:
          return {
            fulfillmentText: "Je n'ai pas compris cette étape. Recommençons.",
            outputContexts: []
          };
      }
    } catch (error) {
      this.logger.error(`Error in handleQuotationSteps: ${error.message}`, error.stack);
      return this.buildErrorResponse(error, request.languageCode || 'fr');
    }
  }

  private nextStep(request: any, nextStep: string, message: string, additionalParams: any = {}) {
    const context = request.outputContexts?.find(c => c.name.includes('awaiting_quotation')) || {
      name: `${request.sessionId}/contexts/awaiting_quotation`,
      lifespanCount: 5,
      parameters: {}
    };

    return {
      fulfillmentText: message,
      outputContexts: [{
        name: context.name,
        lifespanCount: 5,
        parameters: {
          ...context.parameters,
          ...additionalParams,
          currentStep: nextStep
        }
      }]
    };
  }

  private promptForInput(request: any, message: string) {
    const context = request.outputContexts?.find(c => c.name.includes('awaiting_quotation'));
    
    if (!context) {
      return this.startQuotationCreation(request);
    }

    return {
      fulfillmentText: message,
      outputContexts: [{
        name: context.name,
        lifespanCount: 5,
        parameters: context.parameters
      }]
    };
  }

  private mapStatus(status: string): EXPENSQUOTATION_STATUS {
    const statusMap = {
      'brouillon': EXPENSQUOTATION_STATUS.Draft,
      'validé': EXPENSQUOTATION_STATUS.Validated,
      'expense_quotation.status.draft': EXPENSQUOTATION_STATUS.Draft,
      'expense_quotation.status.validated': EXPENSQUOTATION_STATUS.Validated
    };
    return statusMap[status.toLowerCase()] || EXPENSQUOTATION_STATUS.Draft;
  }

  private async handleDefaultDialogflow(request: any) {
    const response = await this.dialogflowService.detectIntent(
      request.languageCode,
      request.queryText || '',
      request.sessionId || 'default-session',
      request.parameters
    );
    this.logger.debug(`Dialogflow response: ${JSON.stringify(response)}`);
    return response;
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
          `${type === 'invoice' ? 'Facture' : 'Devis'} ${num} introuvable`,
        
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
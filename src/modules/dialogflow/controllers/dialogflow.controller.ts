import { Controller, Post, Body, Logger, Get, Param, Headers, Query } from '@nestjs/common';
import { DialogflowService } from '../services/dialogflow.service';
import { DISCOUNT_TYPES } from 'src/app/enums/discount-types.enum';
import { EXPENSQUOTATION_STATUS } from 'src/modules/expense_quotation/enums/expensquotation-status.enum';

@Controller('dialogflow')
export class DialogflowController {
  private readonly logger = new Logger(DialogflowController.name);
  private readonly PROJECT_ID = 'votre-project-id-dialogflow'; 
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
    const languageCode = request.languageCode || 'fr';
    if (!context) {
        return this.startQuotationCreation(request);
    }
    const ensureCurrentArticle = () => {
      if (!quotationData.currentArticle) {
          quotationData.currentArticle = {
              articleId: null,
              quantity: 1,
              unit_price: null,
              discount: 0,
              discount_type: DISCOUNT_TYPES.PERCENTAGE
          };
      }
      return quotationData.currentArticle;
  };

  const currentStep = (context.parameters?.currentStep || 'sequentialNumbr').toLowerCase();    const quotationData = context.parameters?.quotationData || {
        articles: [],
        status: EXPENSQUOTATION_STATUS.Draft,
        currencyId: 1
    };

    // Extraction robuste des paramètres
    const getParam = (name: string) => {
        return request.parameters?.fields?.[name]?.stringValue 
            || request.parameters?.[name]?.stringValue
            || request.queryText;
    };

    try {
        switch (currentStep) {
          case 'sequentialnumbr': // Utilisez lowercase pour la cohérence
          console.log('Sequential number step - raw parameters:', JSON.stringify(request.parameters, null, 2));
          
          // Méthode robuste pour récupérer le paramètre
          const seqNumberParam = request.parameters?.fields?.sequentialnumbr || 
                               request.parameters?.sequentialNumbr ||
                               request.parameters?.fields?.sequentialNumbr;
          
          const seqNumber = seqNumberParam?.stringValue || request.queryText;
          console.log('Extracted sequential number:', seqNumber);
      
          if (!seqNumber || !/^QUO-\d{6}$/i.test(seqNumber)) {
              return this.promptForInput(request, 
                  "Format invalide. Veuillez entrer un numéro séquentiel valide (ex: QUO-123456)");
          }
          
          // Mise à jour des données
          quotationData.sequentialNumbr = seqNumber.toUpperCase(); // Standardisation en majuscules
          console.log('Updated quotation data:', JSON.stringify(quotationData, null, 2));
          
          return this.nextStep(request, 'object', "Veuillez saisir l'objet du devis", { 
              quotationData 
          });

            case 'object':
                const object = getParam('object');
                if (!object) {
                    return this.promptForInput(request, "L'objet du devis est requis");
                }
                quotationData.object = object;
                return this.nextStep(request, 'firmName', "Veuillez entrer le nom de la firme", { 
                    quotationData 
                });

                case 'firmname': // Tout en minuscules pour la cohérence
                console.log('Firm step - raw parameters:', JSON.stringify(request.parameters, null, 2));
                
                // Récupération robuste du paramètre
                const firmNameParam = request.parameters?.fields?.firmname || 
                                    request.parameters?.firmName ||
                                    request.parameters?.fields?.firmName;
                
                const firmName = firmNameParam?.stringValue || request.queryText;
                console.log('Extracted firm name:', firmName);
            
                if (!firmName?.trim()) {
                    return this.promptForInput(request, "Veuillez entrer le nom de la firme");
                }
            
                // Recherche de la firme
                const firm = await this.dialogflowService.getFirmByName(firmName.trim());
                if (!firm) {
                    return this.promptForInput(request, `Firme "${firmName}" introuvable. Veuillez réessayer.`);
                }
            
                // Formatage des noms d'interlocuteurs
                const availableInterlocutors = firm.interlocutorsToFirm.map(i => 
                    `${i.interlocutor.name} ${i.interlocutor.surname}`);
                
                console.log('Available interlocutors:', availableInterlocutors);
            
                // Préparation des données pour l'étape suivante
                const updatedQuotationData = {
                    ...quotationData,
                    firmId: firm.id,
                    firmName: firm.name,
                    currencyId: firm.currencyId,
                    cabinetId: firm.cabinetId
                };
            
                return this.nextStep(request, 'interlocutorname', // Tout en minuscules
                    `Firme "${firm.name}" sélectionnée. Veuillez choisir un interlocuteur parmi : ${availableInterlocutors.join(', ')}`, {
                        quotationData: updatedQuotationData,
                        availableInterlocutors
                    });

                      case 'interlocutorname':
    console.log('Interlocutor step - raw parameters:', JSON.stringify(request.parameters, null, 2));
    
    // Méthode robuste pour récupérer le paramètre
    const interlocutorName = request.parameters?.fields?.interlocutorname?.stringValue 
                          || request.parameters?.interlocutorName?.stringValue
                          || request.queryText;
    
    if (!interlocutorName?.trim()) {
        const availableNames = context.parameters?.availableInterlocutors || [];
        return this.promptForInput(request, 
            `Interlocuteur requis. Choisissez parmi : ${availableNames.join(', ')}`);
    }

    // Logique de validation
    const currentFirm = await this.dialogflowService.getFirmByName(quotationData.firmName);
    if (!currentFirm) {
        return this.promptForInput(request, "Erreur: Firme introuvable");
    }

    const normalizedInput = interlocutorName.toLowerCase().trim();
    const interlocutorEntry = currentFirm.interlocutorsToFirm.find(i => {
        const fullName = `${i.interlocutor.name} ${i.interlocutor.surname}`.toLowerCase().trim();
        return fullName === normalizedInput;
    });

    if (!interlocutorEntry) {
        const availableNames = currentFirm.interlocutorsToFirm.map(i => 
            `${i.interlocutor.name} ${i.interlocutor.surname}`);
        return this.promptForInput(request, 
            `Interlocuteur introuvable. Choisissez parmi : ${availableNames.join(', ')}`);
    }

    // Mise à jour des données
    quotationData.interlocutorId = interlocutorEntry.interlocutorId;
    quotationData.interlocutorName = `${interlocutorEntry.interlocutor.name} ${interlocutorEntry.interlocutor.surname}`;
    
    return this.nextStep(request, 'date', "Date du devis (format JJ-MM-AAAA)", { 
        quotationData 
    });
    case 'date':
      const dateValue = getParam('date');
      if (!dateValue) {
          return this.promptForInput(request, "Veuillez entrer la date du devis (format JJ-MM-AAAA)");
      }
      try {
          const [day, month, year] = dateValue.split('-').map(Number);
          quotationData.date = new Date(year, month - 1, day); // Création correcte de l'objet Date
      } catch (e) {
          return this.promptForInput(request, "Format de date invalide. Veuillez utiliser JJ-MM-AAAA");
      }
      return this.nextStep(request, 'duedate', "Date d'échéance du devis (format JJ-MM-AAAA)", { 
          quotationData 
      });
            case 'duedate':
                const dueDateValue = getParam('duedate');
                if (!dueDateValue) {
                    return this.promptForInput(request, "Veuillez entrer la date d'échéance (format JJ-MM-AAAA)");
                }
                try {
                    const [day, month, year] = dueDateValue.split('-').map(Number);
                    quotationData.dueDate = new Date(year, month - 1, day);
                } catch (e) {
                    return this.promptForInput(request, "Format de date invalide. Veuillez utiliser JJ-MM-AAAA");
                }
                return this.nextStep(request, 'status', "Statut du devis (Brouillon, Validé, Expiré)", { 
                    quotationData 
                });

            case 'status':
                const statusValue = getParam('status');
                if (!statusValue) {
                    return this.promptForInput(request, "Veuillez entrer le statut du devis");
                }
                quotationData.status = this.mapStatus(statusValue);
                return this.nextStep(request, 'articleId', "Ajout d'un article. Veuillez entrer l'ID de l'article", { 
                    quotationData 
                });
                case 'articleid':
    console.log('Article ID step - raw input:', JSON.stringify({
        parameters: request.parameters,
        queryText: request.queryText,
        contexts: request.outputContexts
    }, null, 2));

    // Extraction ultra-robuste de l'ID
    const articleId = this.extractArticleId(request);
    console.log('Extracted article ID:', articleId);

    if (!articleId || isNaN(articleId)) {
        return this.promptForInput(request,
            languageCode === 'fr' 
                ? "ID d'article invalide. Veuillez entrer uniquement le numéro (ex: '135')." 
                : "Invalid article ID. Please enter just the number (ex: '135').");
    }

    // Vérification de l'article avec gestion d'erreur
    try {
        const articleInfo = await this.dialogflowService.getArticleInfo(articleId);
        if (!articleInfo) {
            return this.promptForInput(request,
                languageCode === 'fr'
                    ? `Article #${articleId} introuvable. Veuillez vérifier l'ID.`
                    : `Article #${articleId} not found. Please check the ID.`);
        }

        // Initialisation avec vérification de null
        quotationData.currentArticle = {
            articleId: articleId,
            quantity: 1,
            unit_price: articleInfo.unitPrice,
            discount: 0,
            discount_type: DISCOUNT_TYPES.PERCENTAGE,
            articleName: articleInfo.title // Pour référence ultérieure
        };

        return this.nextStep(request, 'quantity',
            languageCode === 'fr'
                ? `Article "${articleInfo.title}" (ID: ${articleId}) sélectionné. Quantité souhaitée ?`
                : `Article "${articleInfo.title}" (ID: ${articleId}) selected. Desired quantity?`,
            { 
                quotationData,
                // Conservation des infos importantes
                lastArticleId: articleId 
            });

    } catch (error) {
        console.error('Article verification failed:', error);
        return this.promptForInput(request,
            languageCode === 'fr'
                ? "Erreur technique lors de la vérification de l'article. Veuillez réessayer."
                : "Technical error verifying article. Please try again.");
    }

case 'quantity':
    console.log('Quantity step - raw input:', JSON.stringify({
        parameters: request.parameters,
        queryText: request.queryText,
        currentArticle: quotationData.currentArticle
    }, null, 2));

    // Vérification préalable de l'article
    if (!quotationData.currentArticle?.articleId) {
        console.error('No article selected before quantity input');
        return this.nextStep(request, 'articleId',
            languageCode === 'fr'
                ? "Veuillez d'abord sélectionner un article."
                : "Please select an article first.");
    }

    // Extraction robuste avec plages valides
    const quantity = this.extractValidQuantity(request);
    console.log('Validated quantity:', quantity);

    if (quantity === null) {
        return this.promptForInput(request,
            languageCode === 'fr'
                ? "Quantité invalide. Veuillez entrer un nombre entier entre 1 et 1000."
                : "Invalid quantity. Please enter an integer between 1 and 1000.");
    }

    // Mise à jour garantie avec opérateur de coalescence null
    quotationData.currentArticle = {
        ...(quotationData.currentArticle || {}),
        quantity: quantity
    };

    // Message contextuel
    const articleReference = quotationData.currentArticle.articleName 
        ? `"${quotationData.currentArticle.articleName}"` 
        : `#${quotationData.currentArticle.articleId}`;

    return this.nextStep(request, 'unitPrice',
        languageCode === 'fr'
            ? `${quantity} unité(s) ${articleReference}. Prix unitaire (ou "défaut") ?`
            : `${quantity} unit(s) ${articleReference}. Unit price (or "default")?`,
        { 
            quotationData,
            // Pour traçabilité
            lastQuantity: quantity 
        });
  
                  case 'unitprice':
                    case 'unitPrice': // Gestion des deux cas possibles
                        const priceParam = request.parameters?.fields?.unitPrice || request.parameters?.unitPrice;
                        const unitPrice = priceParam?.numberValue?.toString() || priceParam?.stringValue || request.queryText;
                        
                        if (unitPrice && unitPrice !== 'défaut') {
                            const priceNum = parseFloat(unitPrice.replace(',', '.'));
                            if (isNaN(priceNum)) {
                                return this.promptForInput(request, "Veuillez entrer un prix unitaire valide (ex: 50.99)");
                            }
                            
                            ensureCurrentArticle();
                            quotationData.currentArticle.unit_price = priceNum;
                        }
                        
                        return this.nextStep(request, 'discount', "Entrez la remise (nombre décimal ou pourcentage, ex: 10 ou 10%)", { 
                            quotationData 
                        });
                  case 'discount':
                    const discount = this.extractNumberFromParams(request.parameters, 'discount');
                    const currentArticle = ensureCurrentArticle();
                    
                    if (discount !== null && !isNaN(discount)) {
                        currentArticle.discount = Math.max(0, discount); // Garantit un discount positif
                        currentArticle.discount_type = 
                            request.parameters?.discountType?.stringValue?.toUpperCase() === 'AMOUNT' 
                                ? DISCOUNT_TYPES.AMOUNT 
                                : DISCOUNT_TYPES.PERCENTAGE;
                    }
                    return this.nextStep(request, 'moreArticles', "Voulez-vous ajouter un autre article ? (Oui/Non)", { 
                        quotationData 
                    });
    

            case 'morearticles':
                if (quotationData.currentArticle) {
                    // Ajout de l'article à la liste
                    quotationData.articles.push({...quotationData.currentArticle});
                    
                    // Récupération des infos de l'article
                    const article = await this.dialogflowService.getArticleInfo(
                        quotationData.currentArticle.articleId,
                        request.languageCode || 'fr'
                    );
                    
                    const articleName = article?.title || `ID ${quotationData.currentArticle.articleId}`;
                    delete quotationData.currentArticle;
                
                    return {
                        fulfillmentText: `Article "${articleName}" ajouté avec succès!\nVoulez-vous ajouter un autre article ? (Oui/Non)`,
                        outputContexts: [{
                            name: `projects/${this.PROJECT_ID}/agent/sessions/${request.sessionId}/contexts/awaiting_quotation`,
                            lifespanCount: 5,
                            parameters: {
                                ...context.parameters,
                                quotationData
                            }
                        }]
                    };
                }

                if (request.queryText?.toLowerCase().includes('oui')) {
                    return this.nextStep(request, 'articleId', "Ajout d'un nouvel article. ID de l'article ?", { 
                        quotationData 
                    });
                }
                return this.nextStep(request, 'finalize', "Voulez-vous créer le devis maintenant ? (Oui/Non)", { 
                    quotationData 
                });

                case 'finalize':
    if (request.queryText?.toLowerCase().includes('oui')) {
        // Vérification complète avec récupération des données du contexte
        const contextData = request.outputContexts?.find(c => 
            c.name.includes('awaiting_quotation'))?.parameters?.quotationData || {};
        
        const missingFields = [];
        if (!contextData.firmId) missingFields.push("firme");
        if (!contextData.interlocutorId) missingFields.push("interlocuteur");
        if (!contextData.articles || contextData.articles.length === 0) missingFields.push("au moins un article");
        
        if (missingFields.length > 0) {
            return this.nextStep(request, missingFields.includes("firme") ? 'firmName' : 
                missingFields.includes("interlocuteur") ? 'InterlocutorName' : 'articleId',
                `Pour finaliser, veuillez spécifier : ${missingFields.join(', ')}.`, {
                    quotationData: contextData
                });
        }

        try {
            const result = await this.dialogflowService.createQuotation(
                contextData, 
                request.languageCode || 'fr'
            );
            
            return {
                fulfillmentText: `Devis créé avec succès! Numéro: ${result.quotationNumber}`,
                outputContexts: [] // Nettoyage des contextes
            };
        } catch (error) {
            this.logger.error('Creation error:', error);
            return this.promptForInput(request,
                "Erreur technique lors de la création. Veuillez réessayer.");
        }
    }
    
    // Si réponse négative
    return this.nextStep(request, 'sequentialNumbr', "Création annulée. Nous recommençons.", {
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
  const contextName = `projects/${this.PROJECT_ID}/agent/sessions/${request.sessionId}/contexts/awaiting_quotation`;
  let context = request.outputContexts?.find(c => c.name.includes('awaiting_quotation'));
  
  if (!context) {
      context = {
          name: contextName,
          lifespanCount: 5,
          parameters: {
              fields: {},
              quotationData: {
                  articles: [],
                  status: EXPENSQUOTATION_STATUS.Draft,
                  currencyId: 1
              }
          }
      };
  }

  // Fusion des données existantes avec les nouvelles
  const mergedQuotationData = {
    ...context.parameters?.quotationData,
    ...additionalParams.quotationData
};

// Vérification et conversion des dates si nécessaire
if (mergedQuotationData.date && typeof mergedQuotationData.date === 'string') {
    mergedQuotationData.date = new Date(mergedQuotationData.date);
}
if (mergedQuotationData.dueDate && typeof mergedQuotationData.dueDate === 'string') {
    mergedQuotationData.dueDate = new Date(mergedQuotationData.dueDate);
}

const mergedParams = {
  fields: {
      ...context.parameters?.fields,
      sequentialNumbr: { stringValue: mergedQuotationData.sequentialNumbr || '' },
      object: { stringValue: mergedQuotationData.object || '' },
      firmName: { stringValue: mergedQuotationData.firmName || '' },
      InterlocutorName: { stringValue: mergedQuotationData.interlocutorName || '' },
      // Conversion des Dates en ISO string seulement pour l'affichage
      date: { stringValue: mergedQuotationData.date?.toISOString() || '' },
      duedate: { stringValue: mergedQuotationData.dueDate?.toISOString() || '' },
      status: { stringValue: mergedQuotationData.status || '' }
  },
  currentStep: nextStep,
  // Conservation des objets Date dans quotationData
  quotationData: {
      ...mergedQuotationData,
      date: mergedQuotationData.date, // reste un objet Date
      dueDate: mergedQuotationData.dueDate // reste un objet Date
  },
  availableInterlocutors: additionalParams.availableInterlocutors || []
};
  return {
      fulfillmentText: message,
      outputContexts: [
          {
              name: contextName,
              lifespanCount: 5,
              parameters: mergedParams
          },
          ...(request.outputContexts?.filter(c => !c.name.includes('awaiting_quotation')) || [])
      ],
      allRequiredParamsPresent: false
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
 

private extractNumberFromParams(parameters: any, paramName: string): number | null {
  // Essayer différentes variantes de noms de paramètres
  const paramVariations = [
      paramName.toLowerCase(), // articleid
      paramName, // articleId
      paramName.charAt(0).toUpperCase() + paramName.slice(1) // ArticleId
  ];

  for (const variation of paramVariations) {
      // Essayer dans fields
      if (parameters?.fields?.[variation]?.numberValue) {
          return parameters.fields[variation].numberValue;
      }
      if (parameters?.fields?.[variation]?.stringValue) {
          const num = parseInt(parameters.fields[variation].stringValue);
          if (!isNaN(num)) return num;
      }
      
      // Essayer directement dans les paramètres
      if (parameters?.[variation]?.numberValue) {
          return parameters[variation].numberValue;
      }
      if (parameters?.[variation]?.stringValue) {
          const num = parseInt(parameters[variation].stringValue);
          if (!isNaN(num)) return num;
      }
  }

  // Essayer de parser depuis queryText si tout le reste échoue
  if (parameters?.queryText?.stringValue) {
      const num = parseInt(parameters.queryText.stringValue);
      if (!isNaN(num)) return num;
  }

  return null;
}

  private mapStatus(status: string): EXPENSQUOTATION_STATUS {
    const statusMap = {
      'brouillon': EXPENSQUOTATION_STATUS.Draft,
      'expense_quotation.status.draft': EXPENSQUOTATION_STATUS.Draft,
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
  // Dans DialogflowController
// Dans DialogflowController
@Get('late-invoices/:firmId')
public async getLateInvoices(
  @Param('firmId') firmId: number,
  @Query('minAmount') minAmount: number,
  @Query('currency') currency: string,
  @Query('days') daysAhead: number,
  @Headers('accept-language') acceptLanguage: string
) {
  const lang = this.parseLanguageHeader(acceptLanguage);
  
  try {
    // Appliquer les valeurs par défaut
    minAmount = minAmount ? Number(minAmount) : 100;
    currency = currency || 'EUR';
    daysAhead = daysAhead ? Number(daysAhead) : 30;

    const result = await this.dialogflowService.getPredictedLatePayments(
      Number(firmId),
      minAmount,
      currency,
      daysAhead
    );

    if (!result.success) {
      
    }

    // Formater la réponse
    return {
      success: true,
      firmId: Number(firmId),
      minAmount,
      currency,
      daysAhead,
      lateInvoices: result.invoices,
      count: result.count,
      totalRemaining: result.totalRemaining,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Erreur lors de la récupération des factures en retard',
      timestamp: new Date().toISOString()
    };
  }
}
private extractArticleId(request: any): number | null {
  // 1. Vérifier d'abord dans les paramètres standards
  const standardParam = request.parameters?.fields?.articleId?.numberValue 
                     || request.parameters?.fields?.articleid?.numberValue
                     || request.parameters?.articleId?.numberValue
                     || request.parameters?.articleid?.numberValue;
  
  if (standardParam) return standardParam;

  // 2. Vérifier dans les stringValue
  const stringParam = request.parameters?.fields?.articleId?.stringValue 
                    || request.parameters?.fields?.articleid?.stringValue
                    || request.parameters?.articleId?.stringValue
                    || request.parameters?.articleid?.stringValue;
  
  if (stringParam) {
      const num = parseInt(stringParam);
      if (!isNaN(num)) return num;
  }

  // 3. Extraire de queryText (méthode ultime)
  if (request.queryText) {
      // Supprimer tous les caractères non numériques
      const numericOnly = request.queryText.replace(/\D/g, '');
      if (numericOnly) {
          return parseInt(numericOnly);
      }
  }

  return null;
}
private extractValidQuantity(request: any): number | null {
  const MIN_QTY = 1;
  const MAX_QTY = 1000;

  // 1. Essayez d'abord d'extraire depuis queryText directement
  const queryTextValue = parseInt(request.queryText);
  if (!isNaN(queryTextValue)) {
      if (queryTextValue >= MIN_QTY && queryTextValue <= MAX_QTY) {
          return queryTextValue;
      }
      return null;
  }

  // 2. Essayez depuis les paramètres
  const paramsValue = this.extractNumberFromParams(request.parameters, 'quantity');
  if (paramsValue !== null) {
      if (paramsValue >= MIN_QTY && paramsValue <= MAX_QTY) {
          return paramsValue;
      }
      return null;
  }

  // 3. Essayez depuis le champ quantity directement
  if (request.parameters?.quantity?.numberValue) {
      const qty = request.parameters.quantity.numberValue;
      if (qty >= MIN_QTY && qty <= MAX_QTY) {
          return qty;
      }
  }

  // 4. Si tout échoue, essayez de parser le texte brut
  const textValue = parseInt(request.queryText?.replace(/\D/g, ''));
  if (!isNaN(textValue) && textValue >= MIN_QTY && textValue <= MAX_QTY) {
      return textValue;
  }

  return null;
}
}
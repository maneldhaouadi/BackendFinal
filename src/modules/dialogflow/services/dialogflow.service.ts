import { Injectable } from '@nestjs/common';
import * as dialogflow from '@google-cloud/dialogflow';
import * as fs from 'fs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExpensQuotationEntity } from 'src/modules/expense_quotation/repositories/entities/expensquotation.entity';
import { EXPENSQUOTATION_STATUS } from 'src/modules/expense_quotation/enums/expensquotation-status.enum';
import { EXPENSE_INVOICE_STATUS } from 'src/modules/expense-invoice/enums/expense-invoice-status.enum';
import { ExpenseInvoiceEntity } from 'src/modules/expense-invoice/repositories/entities/expense-invoice.entity';
import { ArticleExpensQuotationEntryEntity } from 'src/modules/expense_quotation/repositories/entities/article-expensquotation-entry.entity';
import { CurrencyRepository } from 'src/modules/currency/repositories/repository/currency.repository';
import { ArticleRepository } from 'src/modules/article/repositories/repository/article.repository';
import { InterlocutorRepository } from 'src/modules/interlocutor/repositories/repository/interlocutor.repository';
import { ExpenseArticleQuotationEntryRepository } from 'src/modules/expense_quotation/repositories/repository/article-expensquotation-entry.repository';
import { CreateExpensQuotationDto } from 'src/modules/expense_quotation/dtos/expensquotation.create.dto';

@Injectable()
export class DialogflowService {
  public readonly CREDENTIALS: any;
  public readonly PROJECT_ID: string;
  public sessionClient: dialogflow.SessionsClient;

  constructor(
    @InjectRepository(ExpensQuotationEntity)
    public readonly expensQuotationRepository: Repository<ExpensQuotationEntity>,
    @InjectRepository(ExpenseInvoiceEntity)
    public readonly expenseInvoiceRepository: Repository<ExpenseInvoiceEntity>,
    private readonly currencyRepository: CurrencyRepository,
    private readonly articleRepository: ArticleRepository,
    private readonly interlocutorRepository: InterlocutorRepository,
    private readonly articleEntryRepository: ExpenseArticleQuotationEntryRepository
  ) {
    const filePath = 'src/projetadopet-9d2f2-7bd0022ebee4.json';
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      this.CREDENTIALS = JSON.parse(fileContent);
      this.CREDENTIALS.private_key = this.CREDENTIALS.private_key.replace(/\\n/g, '\n');
      this.PROJECT_ID = this.CREDENTIALS.project_id;

      this.sessionClient = new dialogflow.SessionsClient({
        credentials: {
          private_key: this.CREDENTIALS['private_key'],
          client_email: this.CREDENTIALS['client_email'],
        },
      });
    } catch (error) {
      console.error('Error initializing Dialogflow:', error);
      throw error;
    }
  }

  private getTranslation(lang: string) {
    const translations = {
      en: {
        quotation: 'quotation',
        invoice: 'invoice',
        statusResponse: (type: string, num: string, status: string) => 
          `Status of ${type} ${num}: ${status}`,
        notFound: (type: string, num: string) => `${type} ${num} not found`,
        missingNumber: (type: string) => `Please provide a valid ${type} number`,
        error: 'An error occurred. Please try again.',
        fallback: "I didn't understand. Could you rephrase?",
        missingRequiredFields: "Interlocutor ID and articles are required.",
        interlocutorNotFound: "Interlocutor not found.",
        articleNotFound: "Article with ID {{id}} not found.",
        quotationCreated: "Quotation {{object}} created successfully.\n- Reference: {{number}}\n- Total: {{total}} €",
        reminderSent: "Payment reminder sent successfully",
        reportGenerated: "Report generated successfully"
      },
      fr: {
        quotation: 'devis',
        invoice: 'facture',
        statusResponse: (type: string, num: string, status: string) => 
          `Statut ${type === 'invoice' ? 'de la facture' : 'du devis'} ${num}: ${status}`,
        notFound: (type: string, num: string) => 
          `${type === 'invoice' ? 'Facture' : 'Devis'} ${num} introuvable`,
        missingNumber: (type: string) => 
          `Veuillez fournir un numéro de ${type === 'invoice' ? 'facture' : 'devis'} valide`,
        error: 'Une erreur est survenue. Veuillez réessayer.',
        fallback: "Je n'ai pas compris. Pouvez-vous reformuler ?",
        missingRequiredFields: "L'ID interlocuteur et les articles sont obligatoires.",
        interlocutorNotFound: "Interlocuteur introuvable.",
        articleNotFound: "Article avec l'ID {{id}} introuvable.",
        quotationCreated: "Devis {{object}} créé avec succès.\n- Référence : {{number}}\n- Total : {{total}} €",
        reminderSent: "Rappel de paiement envoyé avec succès",
        reportGenerated: "Rapport généré avec succès"
      },
      es: {
        quotation: 'presupuesto',
        invoice: 'factura',
        statusResponse: (type: string, num: string, status: string) => 
          `Estado del ${type === 'invoice' ? 'factura' : 'presupuesto'} ${num}: ${status}`,
        notFound: (type: string, num: string) => 
          `No se encontró ${type === 'invoice' ? 'la factura' : 'el presupuesto'} ${num}`,
        missingNumber: (type: string) => 
          `Por favor proporcione un número de ${type === 'invoice' ? 'factura' : 'presupuesto'} válido`,
        error: 'Ocurrió un error. Por favor intente nuevamente.',
        fallback: "No entendí. ¿Podrías repetirlo?",
        missingRequiredFields: "Se requieren ID de interlocutor y artículos.",
        interlocutorNotFound: "Interlocutor no encontrado.",
        articleNotFound: "Artículo con ID {{id}} no encontrado.",
        quotationCreated: "Presupuesto {{object}} creado correctamente.\n- Referencia: {{number}}\n- Total: {{total}} €",
        reminderSent: "Recordatorio de pago enviado correctamente",
        reportGenerated: "Informe generado correctamente"
      }
    };
    
    return translations[lang] || translations['en'];
  }

  private extractDocumentNumber(text: string, type: 'invoice' | 'quotation'): string | null {
    const patterns = {
      invoice: [
        /(?:factura|recibo)\s+([A-Za-z0-9-]+)/i,
        /(?:la\s+)?factura\s+([A-Za-z0-9-]+)/i,
        /(?:número|num|#)\s+([A-Za-z0-9-]+)/i
      ],
      quotation: [
        /(?:presupuesto|devis|quotation)\s+([A-Za-z0-9-]+)/i,
        /(?:el\s+)?presupuesto\s+([A-Za-z0-9-]+)/i,
        /(?:número|num|#)\s+([A-Za-z0-9-]+)/i
      ]
    };

    for (const pattern of patterns[type]) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].toUpperCase();
      }
    }
    return null;
  }

  private extractBracketParams(text: string): Record<string, string> {
    const params: Record<string, string> = {};
    const regex = /\[([^:]+):([^\]]+)\]/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      params[match[1].trim()] = match[2].trim();
    }

    return params;
  }

  
  

  public async detectIntent(
    languageCode: string,
    queryText: string,
    sessionId: string,
  ): Promise<any> {
    const lang = languageCode || 'en';
    const t = this.getTranslation(lang);
    

    const sessionPath = this.sessionClient.projectAgentSessionPath(
      this.PROJECT_ID,
      sessionId,
    );

    const request = {
      session: sessionPath,
      queryInput: {
        text: {
          text: queryText,
          languageCode: lang,
        },
      },
    };

    try {
      const responses = await this.sessionClient.detectIntent(request);
      const result = responses[0].queryResult;

      if (lang === 'es') {
        const invoiceNumber = this.extractDocumentNumber(queryText, 'invoice');
        const quotationNumber = this.extractDocumentNumber(queryText, 'quotation');

        if (invoiceNumber) {
          return this.processInvoiceRequest(invoiceNumber, lang, sessionPath);
        }

        if (quotationNumber) {
          return this.processQuotationRequest(quotationNumber, lang, sessionPath);
        }
      }

      if (result.intent?.displayName.includes('Quotation') || 
          result.intent?.displayName.includes('Invoice')) {
        return this.handleDocumentRequest(result, lang, sessionPath);
      }

      if (result.intent?.displayName === 'Default Fallback Intent') {
        return {
          fulfillmentText: t.fallback,
          isFallback: true
        };
      }

      return {
        fulfillmentText: result.fulfillmentText,
        intent: result.intent?.displayName,
        parameters: result.parameters,
        allRequiredParamsPresent: result.allRequiredParamsPresent
      };
    } catch (error) {
      console.error('Error in detectIntent:', error);
      return {
        fulfillmentText: t.error,
        diagnosticInfo: {
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        }
      };
    }
  }

  private async processInvoiceRequest(invoiceNumber: string, lang: string, sessionPath: string) {
    const t = this.getTranslation(lang);
    const cleanedNumber = invoiceNumber.trim().toUpperCase();
    
    try {
      const invoiceStatus = await this.getInvoiceStatus(cleanedNumber);
      
      if (invoiceStatus) {
        const statusMessage = this.getInvoiceStatusMessage(invoiceStatus.status, lang);
        return {
          fulfillmentText: t.statusResponse(t.invoice, cleanedNumber, statusMessage),
          fulfillmentMessages: [
            {
              text: {
                text: [
                  `${t.invoice.toUpperCase()} ${cleanedNumber}`,
                  `${lang === 'es' ? 'Estado' : lang === 'fr' ? 'Statut' : 'Status'}: ${statusMessage}`,
                  `${lang === 'es' ? 'Monto total' : lang === 'fr' ? 'Montant total' : 'Total amount'}: ${this.formatCurrency(invoiceStatus.details?.amount, lang)}`,
                  `${lang === 'es' ? 'Monto pagado' : lang === 'fr' ? 'Montant payé' : 'Paid amount'}: ${this.formatCurrency(invoiceStatus.details?.paidAmount, lang)}`,
                  `${lang === 'es' ? 'Fecha vencimiento' : lang === 'fr' ? 'Date d\'échéance' : 'Due date'}: ${this.formatDate(invoiceStatus.details?.dueDate, lang)}`
                ]
              }
            }
          ],
          payload: {
            type: 'invoice',
            number: cleanedNumber,
            status: invoiceStatus.status,
            statusMessage,
            details: invoiceStatus.details,
            timestamp: new Date().toISOString()
          }
        };
      } else {
        return {
          fulfillmentText: t.notFound(t.invoice, cleanedNumber),
          outputContexts: [{
            name: `${sessionPath}/contexts/document-not-found`,
            lifespanCount: 2,
            parameters: { 
              documentType: 'invoice',
              number: cleanedNumber 
            }
          }]
        };
      }
    } catch (error) {
      console.error('Error processing invoice:', error);
      return {
        fulfillmentText: t.error,
        outputContexts: [{
          name: `${sessionPath}/contexts/error`,
          lifespanCount: 1
        }]
      };
    }
  }

  private async processQuotationRequest(quotationNumber: string, lang: string, sessionPath: string) {
    const t = this.getTranslation(lang);
    const cleanedNumber = quotationNumber.trim().toUpperCase();
    
    try {
      const quotationStatus = await this.getQuotationStatus(cleanedNumber);
      
      if (quotationStatus) {
        const statusMessage = this.getQuotationStatusMessage(quotationStatus.status, lang);
        return {
          fulfillmentText: t.statusResponse(t.quotation, cleanedNumber, statusMessage),
          fulfillmentMessages: [
            {
              text: {
                text: [
                  `${t.quotation.toUpperCase()} ${cleanedNumber}`,
                  `${lang === 'es' ? 'Estado' : lang === 'fr' ? 'Statut' : 'Status'}: ${statusMessage}`,
                  `${lang === 'es' ? 'Monto' : lang === 'fr' ? 'Montant' : 'Amount'}: ${this.formatCurrency(quotationStatus.details?.amount, lang)}`,
                ]
              }
            }
          ],
          payload: {
            type: 'quotation',
            number: cleanedNumber,
            status: quotationStatus.status,
            statusMessage,
            details: quotationStatus.details,
            timestamp: new Date().toISOString()
          }
        };
      } else {
        return {
          fulfillmentText: t.notFound(t.quotation, cleanedNumber),
          outputContexts: [{
            name: `${sessionPath}/contexts/document-not-found`,
            lifespanCount: 2,
            parameters: { 
              documentType: 'quotation',
              number: cleanedNumber 
            }
          }]
        };
      }
    } catch (error) {
      console.error('Error processing quotation:', error);
      return {
        fulfillmentText: t.error,
        outputContexts: [{
          name: `${sessionPath}/contexts/error`,
          lifespanCount: 1
        }]
      };
    }
  }

  private async handleDocumentRequest(result: any, lang: string, sessionPath: string) {
    const t = this.getTranslation(lang);
    const isInvoice = result.intent.displayName.includes('Invoice');
    const paramName = isInvoice ? 'invoice_number' : 'quotation_number';
    const number = result.parameters.fields[paramName]?.stringValue;

    if (!number) {
      return {
        fulfillmentText: t.missingNumber(isInvoice ? 'invoice' : 'quotation'),
        outputContexts: [{
          name: `${sessionPath}/contexts/missing-number`,
          lifespanCount: 1,
          parameters: { documentType: isInvoice ? 'invoice' : 'quotation' }
        }]
      };
    }

    if (isInvoice) {
      return this.processInvoiceRequest(number, lang, sessionPath);
    } else {
      return this.processQuotationRequest(number, lang, sessionPath);
    }
  }

  public async getQuotationStatus(sequentialNumber: string): Promise<{ 
    quotationNumber: string, 
    status: EXPENSQUOTATION_STATUS,
    details?: {
      amount?: number;
      date?: Date;
    }
  } | null> {
    try {
      const quotation = await this.expensQuotationRepository.findOne({
        where: { sequentialNumbr: sequentialNumber }
      });

      if (!quotation) return null;

      return {
        quotationNumber: quotation.sequentialNumbr,
        status: quotation.status,
        details: {
          amount: quotation.total,
          date: quotation.date
        }
      };
    } catch (error) {
      console.error('Database error (quotation):', error);
      throw error;
    }
  }

  public getQuotationStatusMessage(status: EXPENSQUOTATION_STATUS, lang: string = 'en'): string {
    const statusMap = {
      en: {
        [EXPENSQUOTATION_STATUS.Nonexistent]: 'Non Existent',
        [EXPENSQUOTATION_STATUS.Expired]: 'Expired',
        [EXPENSQUOTATION_STATUS.Draft]: 'Draft',
        [EXPENSQUOTATION_STATUS.Validated]: 'Validated'
      },
      fr: {
        [EXPENSQUOTATION_STATUS.Nonexistent]: 'Inexistant',
        [EXPENSQUOTATION_STATUS.Expired]: 'Expiré',
        [EXPENSQUOTATION_STATUS.Draft]: 'Brouillon',
        [EXPENSQUOTATION_STATUS.Validated]: 'Validé'
      },
      es: {
        [EXPENSQUOTATION_STATUS.Nonexistent]: 'Inexistente',
        [EXPENSQUOTATION_STATUS.Expired]: 'Expirado',
        [EXPENSQUOTATION_STATUS.Draft]: 'Borrador',
        [EXPENSQUOTATION_STATUS.Validated]: 'Validado'
      }
    };
    
    return statusMap[lang]?.[status] || statusMap['en'][status] || 'Unknown Status';
  }

  public async getInvoiceStatus(invoiceNumber: string): Promise<{ 
    invoiceNumber: string, 
    status: EXPENSE_INVOICE_STATUS,
    details?: {
      amount?: number;
      dueDate?: string;
      paidAmount?: number;
    }
  } | null> {
    try {
      const invoice = await this.expenseInvoiceRepository.findOne({
        where: { sequentialNumbr: invoiceNumber },
        relations: ['payments']
      });

      if (!invoice) return null;

      return {
        invoiceNumber: invoice.sequentialNumbr,
        status: invoice.status,
        details: {
          amount: invoice.total,
          dueDate: invoice.dueDate?.toISOString(),
          paidAmount: invoice.payments?.reduce((sum, payment) => sum + payment.amount, 0)
        }
      };
    } catch (error) {
      console.error('Database error (invoice):', error);
      throw error;
    }
  }

  public getInvoiceStatusMessage(status: EXPENSE_INVOICE_STATUS, lang: string = 'en'): string {
    const statusMap = {
      en: {
        [EXPENSE_INVOICE_STATUS.Nonexistent]: 'Non Existent',
        [EXPENSE_INVOICE_STATUS.Draft]: 'Draft',
        [EXPENSE_INVOICE_STATUS.Validated]: 'Validated',
        [EXPENSE_INVOICE_STATUS.Paid]: 'Paid',
        [EXPENSE_INVOICE_STATUS.PartiallyPaid]: 'Partially Paid',
        [EXPENSE_INVOICE_STATUS.Unpaid]: 'Unpaid',
        [EXPENSE_INVOICE_STATUS.Expired]: 'Expired',
        [EXPENSE_INVOICE_STATUS.Archived]: 'Archived'
      },
      fr: {
        [EXPENSE_INVOICE_STATUS.Nonexistent]: 'Inexistant',
        [EXPENSE_INVOICE_STATUS.Draft]: 'Brouillon',
        [EXPENSE_INVOICE_STATUS.Validated]: 'Validé',
        [EXPENSE_INVOICE_STATUS.Paid]: 'Payé',
        [EXPENSE_INVOICE_STATUS.PartiallyPaid]: 'Partiellement payé',
        [EXPENSE_INVOICE_STATUS.Unpaid]: 'Impayé',
        [EXPENSE_INVOICE_STATUS.Expired]: 'Expiré',
        [EXPENSE_INVOICE_STATUS.Archived]: 'Archivé'
      },
      es: {
        [EXPENSE_INVOICE_STATUS.Nonexistent]: 'Inexistente',
        [EXPENSE_INVOICE_STATUS.Draft]: 'Borrador',
        [EXPENSE_INVOICE_STATUS.Validated]: 'Validado',
        [EXPENSE_INVOICE_STATUS.Paid]: 'Pagado',
        [EXPENSE_INVOICE_STATUS.PartiallyPaid]: 'Parcialmente pagado',
        [EXPENSE_INVOICE_STATUS.Unpaid]: 'No pagado',
        [EXPENSE_INVOICE_STATUS.Expired]: 'Expirado',
        [EXPENSE_INVOICE_STATUS.Archived]: 'Archivado'
      }
    };
    
    return statusMap[lang]?.[status] || statusMap['en'][status] || 'Unknown Status';
  }

  private formatCurrency(amount?: number, lang: string = 'es'): string {
    if (amount === undefined) return 'N/A';
    return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : lang === 'fr' ? 'fr-FR' : 'en-US', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount);
  }

  private formatDate(dateString?: string, lang: string = 'es'): string {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString(lang === 'es' ? 'es-ES' : lang === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  private startQuotationCreation(sessionId: string, lang: string) {
    const t = this.getTranslation(lang);
    return {
      fulfillmentText: t.startCreation,
      outputContexts: [{
        name: `projects/${this.PROJECT_ID}/agent/sessions/${sessionId}/contexts/quotation-creation`,
        lifespanCount: 5,
        parameters: {
          fields: {
            currentStep: { stringValue: 'firmId' },
            collectedData: { structValue: {} }
          }
        }
      }]
    };
  }
  
  
  public async createQuotation(
    params: {
      firmId: number;
      cabinetId: number;
      interlocutorId: number;
      currencyId?: number;
      object?: string;
      articles: Array<{
        articleId: number;
        quantity: number;
        discount?: number;
        discount_type?: 'PERCENTAGE' | 'AMOUNT';
      }>;
      bankAccountId?: number;
      pdfFileId?: number;
      generalConditions?: string;
    },
    lang: string = 'fr'
  ) {
    const t = this.getTranslation(lang);
  
    // Valider l'interlocutor
    const interlocutor = await this.interlocutorRepository.findOne({ 
      where: { id: params.interlocutorId } 
    });
    if (!interlocutor) {
      throw new Error(t.interlocutorNotFound);
    }
  
    // Récupérer les articles
    const articleEntries = [];
    let subTotal = 0;
  
    for (const item of params.articles) {
      const article = await this.articleRepository.findOne({ 
        where: { id: item.articleId } 
      });
      if (!article) {
        throw new Error(t.articleNotFound.replace('{{id}}', item.articleId.toString()));
      }
  
      // Calculer le total pour chaque article
      const unitPrice = article.salePrice;
      let discountAmount = 0;
      
      if (item.discount) {
        discountAmount = item.discount_type === 'AMOUNT' 
          ? item.discount 
          : (unitPrice * item.quantity * item.discount / 100);
      }
  
      const total = (unitPrice * item.quantity) - discountAmount;
  
      articleEntries.push({
        article,
        quantity: item.quantity,
        unit_price: unitPrice,
        discount: item.discount || 0,
        discount_type: item.discount_type || 'PERCENTAGE',
        total
      });
  
      subTotal += total;
    }
  
    // Créer le DTO complet
    const quotationDto: CreateExpensQuotationDto = {
      firmId: params.firmId,
      interlocutorId: params.interlocutorId,
      currencyId: params.currencyId || 1, // Devise par défaut
      object: params.object || 'Nouveau devis',
      status:EXPENSQUOTATION_STATUS.Draft,
      articleQuotationEntries: articleEntries,
      generalConditions: params.generalConditions,
      bankAccountId: params.bankAccountId,
      pdfFileId: params.pdfFileId,
       // À ajuster avec les taxes si nécessaire
      sequentialNumbr: `QUO-${new Date().getFullYear()}-${(await this.getNextQuotationNumber()).toString().padStart(4, '0')}`,
      date: new Date(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // +30 jours
    };
  
    // Utiliser la méthode save existante
    try {
      const quotation = await this.expensQuotationRepository.save(quotationDto);
      
      return {
        success: true,
        quotationNumber: quotation.sequentialNumbr,
        total: quotation.total,
        message: t.quotationCreated
          .replace('{{object}}', quotation.object || '')
          .replace('{{number}}', quotation.sequentialNumbr)
          .replace('{{total}}', quotation.total.toFixed(2))
      };
    } catch (error) {
      console.error('Error saving quotation:', error);
      throw new Error(t.creationError);
    }
  }
  
  private async getNextQuotationNumber(): Promise<number> {
    const lastQuote = await this.expensQuotationRepository.findOne({
      order: { createdAt: 'DESC' },
      select: ['sequentialNumbr']
    });
  
    if (!lastQuote || !lastQuote.sequentialNumbr) {
      return 1;
    }
  
    const matches = lastQuote.sequentialNumbr.match(/QUO-\d{4}-(\d+)/);
    return matches ? parseInt(matches[1]) + 1 : 1;
  }
}
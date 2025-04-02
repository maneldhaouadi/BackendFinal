import { Injectable } from '@nestjs/common';
import * as dialogflow from '@google-cloud/dialogflow';
import * as fs from 'fs';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ExpensQuotationEntity } from 'src/modules/expense_quotation/repositories/entities/expensquotation.entity';
import { EXPENSQUOTATION_STATUS } from 'src/modules/expense_quotation/enums/expensquotation-status.enum';
import { EXPENSE_INVOICE_STATUS } from 'src/modules/expense-invoice/enums/expense-invoice-status.enum';
import { ExpenseInvoiceEntity } from 'src/modules/expense-invoice/repositories/entities/expense-invoice.entity';
import { ArticleExpensQuotationEntryEntity } from 'src/modules/expense_quotation/repositories/entities/article-expensquotation-entry.entity';
import { CurrencyRepository } from 'src/modules/currency/repositories/repository/currency.repository';
import { ArticleRepository } from 'src/modules/article/repositories/repository/article.repository';
import { InterlocutorRepository } from 'src/modules/interlocutor/repositories/repository/interlocutor.repository';
import { ExpenseArticleQuotationEntryRepository } from 'src/modules/expense_quotation/repositories/repository/article-expensquotation-entry.repository';
import { DISCOUNT_TYPES } from 'src/app/enums/discount-types.enum';

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
    private readonly articleEntryRepository: ExpenseArticleQuotationEntryRepository,
    private readonly dataSource: DataSource

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
        reportGenerated: "Report generated successfully",
        creationError: "Error creating quotation"
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
        reportGenerated: "Rapport généré avec succès",
        creationError: "Erreur lors de la création du devis"
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
        reportGenerated: "Informe generado correctamente",
        creationError: "Error al crear presupuesto"
      }
    };
    
    return translations[lang] || translations['en'];
  }

  private validateQuotationNumberFormat(number: string): boolean {
    // Format: QUO- suivi de 4 chiffres (QUO-1234)
    return /^QUO-\d{4}$/i.test(number);
  }
  
  public async detectIntent(
    languageCode: string,
    queryText: string,
    sessionId: string,
    parameters?: any
  ): Promise<any> {
    const lang = languageCode || 'fr';
    const t = this.getTranslation(lang);
    const sessionPath = this.sessionClient.projectAgentSessionPath(
      this.PROJECT_ID,
      sessionId
    );
  
    // 1. D'abord vérifier les numéros de documents
    const invoiceNumber = this.extractInvoiceNumber(queryText);
    const quotationNumber = this.extractQuotationNumber(queryText);
  
    // 2. Traitement personnalisé pour les documents
    if (invoiceNumber) {
      return this.handleInvoiceStatus(invoiceNumber, lang, sessionId);
    }
  
    if (quotationNumber) {
      return this.handleQuotationStatus(quotationNumber, lang, sessionId);
    }
  
    // 3. Ensuite vérifier la création de devis
    if (/(créer|nouveau|faire)\s*(un\s+)?(devis|quotation)/i.test(queryText)) {
      return {
        fulfillmentText: "Veuillez fournir le numéro séquentiel du devis (format QUO-XXXX)",
        outputContexts: [{
          name: `${sessionPath}/contexts/quotation-creation`,
          lifespanCount: 5,
          parameters: {
            quotationCreation: true,
            step: 'sequential'
          }
        }],
        intent: 'CreateQuotation'
      };
    }
  
    // 4. Fallback à Dialogflow
    const request = {
      session: sessionPath,
      queryInput: {
        text: {
          text: queryText,
          languageCode: lang
        }
      },
      queryParams: {
        contexts: parameters?.outputContexts || []
      }
    };
  
    try {
      const responses = await this.sessionClient.detectIntent(request);
      const result = responses[0].queryResult;
  
      // Gérer la création de devis
      if (result.intent?.displayName === 'CreateQuotation' && 
          result.allRequiredParamsPresent) {
        const params = result.parameters.fields;
        
        // Préparer les articles
        const articles = [];
        if (params.articleId) {
          articles.push({
            articleId: params.articleId.numberValue,
            quantity: params.quantity?.numberValue || 1,
            discount: params.discount?.numberValue,
            discount_type: params.discount_type?.stringValue as DISCOUNT_TYPES || DISCOUNT_TYPES.PERCENTAGE
          });
        }
  
        // Créer le devis
        const creationResult = await this.createQuotation({
          firmId: params.firmId?.numberValue || 1,
          cabinetId: params.cabinetId?.numberValue || 1,
          interlocutorId: params.InterlocutorId.numberValue,
          currencyId: params.currencyId?.numberValue,
          object: params.object?.stringValue,
          sequentialNumbr: params.sequentialNumbr?.stringValue,
          articles: articles,
          status: this.mapStatusStringToEnum(params.status?.stringValue),
          dueDate: params.duedate?.stringValue ? new Date(params.duedate.stringValue) : undefined,
          date: params.date?.stringValue ? new Date(params.date.stringValue) : undefined
        }, lang);
  
        return {
          fulfillmentText: creationResult.message,
          intent: result.intent.displayName,
          parameters: result.parameters,
          outputContexts: result.outputContexts,
          allRequiredParamsPresent: true
        };
      }
  
      // Intercepter les réponses FAQ_Invoice et FAQ_Quotation
      if (result.intent?.displayName === 'FAQ_Invoice' && 
          result.parameters.fields.invoice_number?.stringValue) {
        return this.handleInvoiceStatus(
          result.parameters.fields.invoice_number.stringValue, 
          lang, 
          sessionId
        );
      }
  
      if (result.intent?.displayName === 'FAQ_Quotation' && 
          result.parameters.fields.quotation_number?.stringValue) {
        return this.handleQuotationStatus(
          result.parameters.fields.quotation_number.stringValue, 
          lang, 
          sessionId
        );
      }
  
      return {
        fulfillmentText: result.fulfillmentText,
        intent: result.intent?.displayName,
        parameters: result.parameters,
        outputContexts: result.outputContexts,
        allRequiredParamsPresent: result.allRequiredParamsPresent
      };
    } catch (error) {
      console.error('Dialogflow error:', error);
      return {
        fulfillmentText: t.error,
        outputContexts: []
      };
    }
  }
  
  // Ajoutez cette méthode pour convertir le statut string en enum
  private mapStatusStringToEnum(statusString?: string): EXPENSQUOTATION_STATUS {
    if (!statusString) return EXPENSQUOTATION_STATUS.Draft;
    
    const statusMap = {
      'expense_quotation.status.draft': EXPENSQUOTATION_STATUS.Draft,
      'expense_quotation.status.validated': EXPENSQUOTATION_STATUS.Validated,
      'expense_quotation.status.expired': EXPENSQUOTATION_STATUS.Expired
    };
  
    return statusMap[statusString] || EXPENSQUOTATION_STATUS.Draft;
  }
  private async handleQuotationStatus(
    quotationNumber: string,
    lang: string,
    sessionId: string
  ): Promise<any> {
    const t = this.getTranslation(lang);
    
    try {
      const quotationStatus = await this.getQuotationStatus(quotationNumber);
      
      if (!quotationStatus) {
        return {
          fulfillmentText: t.notFound(t.quotation, quotationNumber),
          outputContexts: []
        };
      }
  
      const statusMessage = this.getQuotationStatusMessage(quotationStatus.status, lang);
      const amount = this.formatCurrency(quotationStatus.details?.amount || 0, lang);
      const date = this.formatDate(quotationStatus.details?.date?.toISOString(), lang);
  
      return {
        fulfillmentText: lang === 'fr' 
          ? `Statut du devis ${quotationNumber}: ${statusMessage}\nMontant total: ${amount}\nDate de création: ${date}`
          : `Status of quotation ${quotationNumber}: ${statusMessage}\nTotal amount: ${amount}\nCreation date: ${date}`,
        outputContexts: [{
          name: `projects/${this.PROJECT_ID}/agent/sessions/${sessionId}/contexts/quotation-status`,
          lifespanCount: 5,
          parameters: {
            quotationNumber,
            status: quotationStatus.status,
            amount: quotationStatus.details?.amount,
            date: quotationStatus.details?.date
          }
        }]
      };
    } catch (error) {
      console.error('Error handling quotation status:', error);
      return {
        fulfillmentText: t.error,
        outputContexts: []
      };
    }
  }
  
  private extractQuotationNumber(text: string): string | null {
    const patterns = [
      /(?:quotation|devis|presupuesto)\s+(QUO-\d{4})/i,
      /(?:numero|num|#)\s+(QUO-\d{4})/i,
      /(?:status|statut|estado)\s+(?:of|pour|de)\s+(QUO-\d{4})/i,
      /^(QUO-\d{4})$/i
    ];
  
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].toUpperCase();
      }
    }
    return null;
  }

  private parseArticlesInput(input: string): Array<{
    articleId: number;
    quantity: number;
    discount?: number;
    discount_type?: DISCOUNT_TYPES;
  }> {
    try {
      // Expected format: [id:1,quantity:2,discount:10], [id:3,quantity:1]
      const articles = input.split('], [').map(item => 
        item.replace(/[\[\]]/g, '').split(',')
      );
      
      return articles.map(articleParts => {
        const articleData: any = {};
        articleParts.forEach(part => {
          const [key, value] = part.split(':');
          articleData[key] = value;
        });
        
        return {
          articleId: parseInt(articleData.id),
          quantity: parseInt(articleData.quantity),
          discount: articleData.discount ? parseFloat(articleData.discount) : undefined,
          discount_type: articleData.discount_type as DISCOUNT_TYPES || DISCOUNT_TYPES.PERCENTAGE
        };
      });
    } catch (error) {
      throw new Error("Format d'articles invalide. Utilisez [id:XX,quantity:XX,discount:XX]");
    }
  }

  private extractInvoiceNumber(text: string): string | null {
    const patterns = [
      /(?:invoice|facture)\s+(INV-\d+)/i,
      /(?:numero|num|#)\s+(INV-\d+)/i,
      /(?:status|statut)\s+(?:of|pour)?\s*(?:invoice|facture)?\s*(?:no|num|number)?\s*[:#]?\s*(INV-\d+)/i,
      /^(INV-\d+)$/i
    ];
  
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].toUpperCase();
      }
    }
    return null;
  }

  private async handleInvoiceStatus(
    invoiceNumber: string,
    lang: string,
    sessionId: string
  ): Promise<any> {
    const t = this.getTranslation(lang);
    
    try {
      const invoiceStatus = await this.getInvoiceStatus(invoiceNumber);
      
      if (!invoiceStatus) {
        return {
          fulfillmentText: t.notFound(t.invoice, invoiceNumber),
          outputContexts: []
        };
      }
  
      const statusMessage = this.getInvoiceStatusMessage(invoiceStatus.status, lang);
      const amount = this.formatCurrency(invoiceStatus.details?.amount || 0, lang);
      const paidAmount = this.formatCurrency(invoiceStatus.details?.paidAmount || 0, lang);
      const dueDate = this.formatDate(invoiceStatus.details?.dueDate, lang);
  
      return {
        fulfillmentText: lang === 'fr' 
          ? `Statut de la facture ${invoiceNumber}: ${statusMessage}\nMontant: ${amount}\nMontant payé: ${paidAmount}\nDate d'échéance: ${dueDate}`
          : `Status of invoice ${invoiceNumber}: ${statusMessage}\nAmount: ${amount}\nPaid amount: ${paidAmount}\nDue date: ${dueDate}`,
        outputContexts: [{
          name: `projects/${this.PROJECT_ID}/agent/sessions/${sessionId}/contexts/invoice-status`,
          lifespanCount: 5,
          parameters: {
            invoiceNumber,
            status: invoiceStatus.status,
            amount: invoiceStatus.details?.amount,
            paidAmount: invoiceStatus.details?.paidAmount,
            dueDate: invoiceStatus.details?.dueDate
          }
        }]
      };
    } catch (error) {
      console.error('Error handling invoice status:', error);
      return {
        fulfillmentText: t.error,
        outputContexts: []
      };
    }
  }

  public async getQuotationStatus(sequentialNumber: string): Promise<{ 
    quotationNumber: string, 
    status: EXPENSQUOTATION_STATUS,
    details?: {
      amount?: number;
      date?: Date;
      articleCount?: number;
    }
  } | null> {
    try {
        const quotation = await this.expensQuotationRepository
            .createQueryBuilder('quotation')
            .leftJoinAndSelect('quotation.expensearticleQuotationEntries', 'articles')
            .where('quotation.sequentialNumbr = :number', { number: sequentialNumber })
            .getOne();

        if (!quotation) {
            return null;
        }

        return {
            quotationNumber: quotation.sequentialNumbr,
            status: quotation.status,
            details: {
                amount: quotation.total,
                date: quotation.date,
                articleCount: quotation.expensearticleQuotationEntries?.length || 0
            }
        };
    } catch (error) {
        console.error('Database error (quotation):', error);
        throw new Error(this.getTranslation('en').error);
    }
  }

  public getQuotationStatusMessage(status: EXPENSQUOTATION_STATUS, lang: string = 'en'): string {
    const translations = {
        en: {
            [EXPENSQUOTATION_STATUS.Nonexistent]: 'Non Existent',
            [EXPENSQUOTATION_STATUS.Expired]: 'Expired',
            [EXPENSQUOTATION_STATUS.Draft]: 'Draft',
            [EXPENSQUOTATION_STATUS.Validated]: 'Validated',
            unknown: 'Unknown Status'
        },
        fr: {
            [EXPENSQUOTATION_STATUS.Nonexistent]: 'Inexistant',
            [EXPENSQUOTATION_STATUS.Expired]: 'Expiré',
            [EXPENSQUOTATION_STATUS.Draft]: 'Brouillon',
            [EXPENSQUOTATION_STATUS.Validated]: 'Validé',
            unknown: 'Statut inconnu'
        },
        es: {
            [EXPENSQUOTATION_STATUS.Nonexistent]: 'Inexistente',
            [EXPENSQUOTATION_STATUS.Expired]: 'Expirado',
            [EXPENSQUOTATION_STATUS.Draft]: 'Borrador',
            [EXPENSQUOTATION_STATUS.Validated]: 'Validado',
            unknown: 'Estado desconocido'
        }
    };
    
    const langMap = translations[lang] || translations.en;
    return langMap[status] || langMap.unknown;
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

  public async createQuotation(
    params: {
      firmId: number;
      cabinetId?: number; // Maintenant optionnel
      interlocutorId: number;
      currencyId?: number;
      object?: string;
      sequentialNumbr?: string;
      articles: Array<{
        articleId: number;
        quantity: number;
        unit_price?: number;
        discount?: number;
        discount_type?: DISCOUNT_TYPES;
      }>;
      bankAccountId?: number;
      pdfFileId?: number;
      generalConditions?: string;
      status?: EXPENSQUOTATION_STATUS;
      dueDate?: Date;
      notes?: string;
      date?: Date;
      discount?: number;
      discount_type?: DISCOUNT_TYPES;
      taxStamp?: number;
      expenseMetaDataId?: number;
      isDeletionRestricted?: boolean;
    },
    lang: string = 'fr'
  ) {
    const t = this.getTranslation(lang);
    const queryRunner = this.dataSource.createQueryRunner();
    
    await queryRunner.connect();
    await queryRunner.startTransaction();
  
    try {
      // Validation des champs obligatoires
      if (!params.interlocutorId || !params.articles || params.articles.length === 0) {
        throw new Error(t.missingRequiredFields);
      }
  
      // Vérification de l'interlocuteur
      const interlocutor = await this.interlocutorRepository.findOne({
        where: { id: params.interlocutorId }
      });
      
      if (!interlocutor) {
        throw new Error(t.interlocutorNotFound);
      }
  
      // Vérification du cabinet (si fourni)
     
  
      // Traitement des articles
      const articleEntries: ArticleExpensQuotationEntryEntity[] = [];
      let subTotal = 0;
  
      for (const item of params.articles) {
        const article = await this.articleRepository.findOne({
          where: { id: item.articleId }
        });
        
        if (!article) {
          throw new Error(t.articleNotFound.replace('{{id}}', item.articleId.toString()));
        }
  
        const unitPrice = item.unit_price ?? article.salePrice;
        const discountAmount = item.discount 
          ? (item.discount_type === DISCOUNT_TYPES.AMOUNT 
              ? item.discount 
              : (unitPrice * item.quantity * item.discount / 100))
          : 0;
  
        const articleSubTotal = unitPrice * item.quantity;
        const articleTotal = articleSubTotal - discountAmount;
  
        const articleEntry = new ArticleExpensQuotationEntryEntity();
        articleEntry.article = article;
        articleEntry.quantity = item.quantity;
        articleEntry.unit_price = unitPrice;
        articleEntry.discount = item.discount || 0;
        articleEntry.discount_type = item.discount_type || DISCOUNT_TYPES.PERCENTAGE;
        articleEntry.subTotal = articleSubTotal;
        articleEntry.total = articleTotal;
  
        articleEntries.push(articleEntry);
        subTotal += articleTotal;
      }
  
      // Calcul du total
      let total = subTotal;
  
      if (params.discount) {
        total = params.discount_type === DISCOUNT_TYPES.AMOUNT
          ? total - params.discount
          : total * (1 - (params.discount / 100));
      }
  
      if (params.taxStamp) {
        total += params.taxStamp;
      }
  
      // Génération du numéro séquentiel si non fourni
      const sequentialNumbr = params.sequentialNumbr 
        ?? `QUO-${new Date().getFullYear()}-${(await this.getNextQuotationNumber()).toString().padStart(4, '0')}`;
  
      // Création du devis
      const quotation = new ExpensQuotationEntity();
      quotation.firmId = params.firmId;
      quotation.cabinetId = params.cabinetId ?? 1; // Valeur par défaut 1 si non fourni
      quotation.interlocutor = interlocutor;
      quotation.currencyId = params.currencyId ?? 1;
      quotation.object = params.object ?? `Devis ${new Date().toLocaleDateString()}`;
      quotation.status = params.status ?? EXPENSQUOTATION_STATUS.Draft;
      quotation.generalConditions = params.generalConditions ?? '';
      quotation.bankAccountId = params.bankAccountId ?? null;
      quotation.pdfFileId = params.pdfFileId ?? null;
      quotation.sequentialNumbr = sequentialNumbr;
      quotation.sequential = sequentialNumbr;
      quotation.date = params.date ?? new Date();
      quotation.dueDate = params.dueDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      quotation.subTotal = subTotal;
      quotation.total = total;
      quotation.notes = params.notes ?? '';
      quotation.discount = params.discount ?? 0;
      quotation.discount_type = params.discount_type ?? DISCOUNT_TYPES.PERCENTAGE;
      quotation.taxStamp = params.taxStamp ?? 0;
      quotation.expenseMetaDataId = params.expenseMetaDataId ?? null;
      quotation.isDeletionRestricted = params.isDeletionRestricted ?? false;
  
      // Sauvegarde transactionnelle
      const savedQuotation = await queryRunner.manager.save(quotation);
      
      // Sauvegarde des articles
      for (const entry of articleEntries) {
        entry.expenseQuotation = savedQuotation;
        await queryRunner.manager.save(entry);
      }
  
      await queryRunner.commitTransaction();
  
      return {
        success: true,
        quotationNumber: savedQuotation.sequentialNumbr,
        total: savedQuotation.total,
        subTotal: savedQuotation.subTotal,
        message: t.quotationCreated
          .replace('{{object}}', savedQuotation.object)
          .replace('{{number}}', savedQuotation.sequentialNumbr)
          .replace('{{total}}', savedQuotation.total.toFixed(2)),
        details: {
          quotationId: savedQuotation.id,
          date: savedQuotation.date,
          dueDate: savedQuotation.dueDate,
          articleCount: articleEntries.length,
          cabinetId: savedQuotation.cabinetId // Retourne l'ID du cabinet utilisé
        }
      };
  
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw new Error(`${t.creationError}: ${error.message}`);
    } finally {
      await queryRunner.release();
    }
  }
  
  private async getNextQuotationNumber(): Promise<number> {
    const lastQuote = await this.expensQuotationRepository
      .createQueryBuilder('quotation')
      .where('quotation.sequentialNumbr LIKE :pattern', { pattern: 'QUO-%' })
      .orderBy('quotation.createdAt', 'DESC')
      .getOne();
  
    if (!lastQuote || !lastQuote.sequentialNumbr) {
      return 1;
    }
  
    const matches = lastQuote.sequentialNumbr.match(/QUO-(\d{4})-(\d+)/);
    
    if (matches && matches[2]) {
      return parseInt(matches[2], 10) + 1;
    }
    
    return 1;
  }
  public async getArticleInfo(articleId: number, lang: string = 'fr') {
    try {
      return await this.articleRepository.findOne({
        where: { id: articleId },
        select: ['id', 'title', 'salePrice'] // Sélectionnez les champs nécessaires
      });
    } catch (error) {
      return null;
    }
  }
}
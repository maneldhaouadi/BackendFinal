import { BadRequestException, Injectable, NotFoundException, StreamableFile } from "@nestjs/common";
import { ExpenseInvoiceRepository } from "../repositories/repository/expense-invoice.repository";
import { ExpenseArticleInvoiceEntryService } from "./expense-article-invoice-entry.service";
import { ExpenseInvoiceUploadService } from "./expense-invoice-upload.service";
import { BankAccountService } from "src/modules/bank-account/services/bank-account.service";
import { CurrencyService } from "src/modules/currency/services/currency.service";
import { FirmService } from "src/modules/firm/services/firm.service";
import { InterlocutorService } from "src/modules/interlocutor/services/interlocutor.service";
import { ExpenseInvoiceMetaDataService } from "./expense-invoice-meta-data.service";
import { TaxService } from "src/modules/tax/services/tax.service";
import { TaxWithholdingService } from "src/modules/tax-withholding/services/tax-withholding.service";
import { InvoicingCalculationsService } from "src/common/calculations/services/invoicing.calculations.service";
import { PdfService } from "src/common/pdf/services/pdf.service";
import { format } from "date-fns";
import { ExpenseInvoiceNotFoundException } from "../errors/expense-invoice.notfound.error";
import { ExpenseInvoiceEntity } from "../repositories/entities/expense-invoice.entity";
import { IQueryObject } from "src/common/database/interfaces/database-query-options.interface";
import { QueryBuilder } from "src/common/database/utils/database-query-builder";
import { FindManyOptions, FindOneOptions, UpdateResult } from "typeorm";
import { PageDto } from "src/common/database/dtos/database.page.dto";
import { ExpenseResponseInvoiceDto } from "../dtos/expense-invoice.response.dto";
import { PageMetaDto } from "src/common/database/dtos/database.page-meta.dto";
import { Transactional } from "@nestjs-cls/transactional";
import { ExpenseCreateInvoiceDto } from "../dtos/expense-invoice-create.dto";
import { EXPENSE_INVOICE_STATUS } from "../enums/expense-invoice-status.enum";
import { ExpenseUpdateInvoiceDto } from "../dtos/expense-invoice.update.dto";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { ExpenseDuplicateInvoiceDto } from "../dtos/expense-invoice.duplicate.dto";
import { ExpensQuotationEntity } from "src/modules/expense_quotation/repositories/entities/expensquotation.entity";
import { StorageService } from "src/common/storage/services/storage.service";
import { ExpenseResponseInvoiceUploadDto } from "../dtos/expense-invoice-upload.response.dto";
import { ExpensQuotationService } from "src/modules/expense_quotation/services/expensquotation.service";
import { TemplateService } from "src/modules/template/services/template.service";
import { TemplateType } from "src/modules/template/enums/TemplateType";
import ejs from "ejs";

@Injectable()
export class ExpenseInvoiceService {
  constructor(
    //repositories
    private readonly invoiceRepository: ExpenseInvoiceRepository,
    //entity services
    private readonly articleInvoiceEntryService: ExpenseArticleInvoiceEntryService,
    private readonly invoiceUploadService: ExpenseInvoiceUploadService,
    private readonly bankAccountService: BankAccountService,
    private readonly currencyService: CurrencyService,
    private readonly firmService: FirmService,
    private readonly interlocutorService: InterlocutorService,
    private readonly invoiceMetaDataService: ExpenseInvoiceMetaDataService,
    private readonly taxService: TaxService,
    private readonly taxWithholdingService: TaxWithholdingService,
    private readonly storageService: StorageService,

    //abstract services
    private readonly calculationsService: InvoicingCalculationsService,
    private readonly pdfService: PdfService,
    private readonly expenseQuotationService:ExpensQuotationService,
    private readonly templateService:TemplateService
  ) {}
 
  async findOneById(id: number): Promise<ExpenseInvoiceEntity> {
    const invoice = await this.invoiceRepository.findOneById(id);
    if (!invoice) {
      throw new ExpenseInvoiceNotFoundException();
    }
    return invoice;
  }

  async findOneByCondition(
    query: IQueryObject = {},
  ): Promise<ExpenseInvoiceEntity | null> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const invoice = await this.invoiceRepository.findByCondition(
      queryOptions as FindOneOptions<ExpenseInvoiceEntity>,
    );
    if (!invoice) return null;
    return invoice;
  }

  async findAll(query: IQueryObject = {}): Promise<ExpenseInvoiceEntity[]> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    return await this.invoiceRepository.findAll(
      queryOptions as FindManyOptions<ExpenseInvoiceEntity>,
    );
  }

  async findAllPaginated(
    query: IQueryObject,
  ): Promise<PageDto<ExpenseResponseInvoiceDto>> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const count = await this.invoiceRepository.getTotalCount({
      where: queryOptions.where,
    });

    const entities = await this.invoiceRepository.findAll(
      queryOptions as FindManyOptions<ExpenseInvoiceEntity>,
    );

    const pageMetaDto = new PageMetaDto({
      pageOptionsDto: {
        page: parseInt(query.page),
        take: parseInt(query.limit),
      },
      itemCount: count,
    });

    return new PageDto(entities, pageMetaDto);
  }


  @Transactional()
async save(createInvoiceDto: ExpenseCreateInvoiceDto): Promise<ExpenseInvoiceEntity> {
  const [firm, bankAccount, currency] = await Promise.all([
    this.firmService.findOneByCondition({
      filter: `id||$eq||${createInvoiceDto.firmId}`,
    }),
    createInvoiceDto.bankAccountId
      ? this.bankAccountService.findOneById(createInvoiceDto.bankAccountId)
      : Promise.resolve(null),
    createInvoiceDto.currencyId
      ? this.currencyService.findOneById(createInvoiceDto.currencyId)
      : Promise.resolve(null),
  ]);

  if (!firm) {
    throw new Error('Firm not found');
  }

  await this.interlocutorService.findOneById(createInvoiceDto.interlocutorId);

  const articleEntries =
    createInvoiceDto.articleInvoiceEntries &&
    (await this.articleInvoiceEntryService.saveMany(
      createInvoiceDto.articleInvoiceEntries,
    ));

  if (!articleEntries) {
    throw new Error('Article entries are missing');
  }

  const { subTotal, total } =
    this.calculationsService.calculateLineItemsTotal(
      articleEntries.map((entry) => entry.total),
      articleEntries.map((entry) => entry.subTotal),
    );

  const taxStamp = createInvoiceDto.taxStampId
    ? await this.taxService.findOneById(createInvoiceDto.taxStampId)
    : null;

  const totalAfterGeneralDiscount =
    this.calculationsService.calculateTotalDiscount(
      total,
      createInvoiceDto.discount,
      createInvoiceDto.discount_type,
      taxStamp?.value || 0,
    );

  const lineItems = await this.articleInvoiceEntryService.findManyAsLineItem(
    articleEntries.map((entry) => entry.id),
  );

  const taxSummary = await Promise.all(
    this.calculationsService
      .calculateTaxSummary(lineItems)
      .map(async (item) => {
        const tax = await this.taxService.findOneById(item.taxId);
        return {
          ...item,
          label: tax.label,
          value: tax.isRate ? tax.value * 100 : tax.value,
          isRate: tax.isRate,
        };
      }),
  );

  // ✅ Vérifier et générer le numéro séquentiel
  let sequentialNumbr = createInvoiceDto.sequentialNumbr || await this.generateSequentialNumber();
  console.log('Sequential Number (Backend):', sequentialNumbr);

  if (!/^INV-\d+$/.test(sequentialNumbr)) {
    throw new Error('Invalid invoice number format. Expected format: INV-XXXX');
  }

  const invoiceMetaData = await this.invoiceMetaDataService.save({
    ...createInvoiceDto.invoiceMetaData,
    taxSummary,
  });

  let taxWithholdingAmount = 0;
  if (createInvoiceDto.taxWithholdingId) {
    const taxWithholding = await this.taxWithholdingService.findOneById(
      createInvoiceDto.taxWithholdingId,
    );

    if (taxWithholding.rate !== undefined && taxWithholding.rate !== null) {
      taxWithholdingAmount =
        totalAfterGeneralDiscount * (taxWithholding.rate / 100);
    }
  }

  let uploadPdfField = null;
  if (createInvoiceDto.pdfFileId) {
    uploadPdfField = await this.storageService.findOneById(
      createInvoiceDto.pdfFileId,
    );
    if (!uploadPdfField) {
      throw new NotFoundException('Uploaded PDF file not found');
    }
  }

  const invoice = await this.invoiceRepository.save({
    ...createInvoiceDto,
    sequential: sequentialNumbr,
    bankAccountId: bankAccount ? bankAccount.id : null,
    currencyId: currency ? currency.id : firm.currencyId,
    cabinetId: 1,
    sequentialNumbr,
    articleExpenseEntries: articleEntries,
    expenseInvoiceMetaData: invoiceMetaData,
    subTotal,
    taxWithholdingAmount: taxWithholdingAmount || 0,
    total: totalAfterGeneralDiscount,
    uploadPdfField: uploadPdfField ? uploadPdfField.id : null,
  });

  if (createInvoiceDto.uploads) {
    await Promise.all(
      createInvoiceDto.uploads.map((u) =>
        this.invoiceUploadService.save(invoice.id, u.uploadId),
      ),
    );
  }
  return invoice;
}

private async generateSequentialNumber(): Promise<string> {
  const lastInvoice = await this.invoiceRepository.findOne({
    order: { id: 'DESC' },
  });

  const lastNumber = lastInvoice?.sequentialNumbr
    ? parseInt(lastInvoice.sequentialNumbr.split('-')[1], 10)
    : 0;

  return `INV-${lastNumber + 1}`;
}



  async saveMany(
    createInvoiceDtos: ExpenseCreateInvoiceDto[],
  ): Promise<ExpenseInvoiceEntity[]> {
    const invoices = [];
    for (const createInvoiceDto of createInvoiceDtos) {
      const invoice = await this.save(createInvoiceDto);
      invoices.push(invoice);
    }
    return invoices;
  }

  @Transactional()
  async saveFromQuotation(quotation: ExpensQuotationEntity): Promise<ExpenseInvoiceEntity> {
    return this.save({
      quotationId: quotation.id,
      currencyId: quotation.currencyId,
      bankAccountId: quotation.bankAccountId,
      interlocutorId: quotation.interlocutorId,
      firmId: quotation.firmId,
      discount: quotation.discount,
      discount_type: quotation.discount_type,
      object: quotation.object,
      status: EXPENSE_INVOICE_STATUS.Draft,
      date: new Date(),
      dueDate: null,
      articleInvoiceEntries: quotation.expensearticleQuotationEntries.map((entry) => {
        return {
          unit_price: entry.unit_price,
          quantity: entry.quantity,
          discount: entry.discount,
          discount_type: entry.discount_type,
          subTotal: entry.subTotal,
          total: entry.total,
          articleId: entry.article.id,
          article: entry.article,
          reference:entry.reference,
          taxes: entry.articleExpensQuotationEntryTaxes.map((entry) => {
            return entry.taxId;
          }),
        };
      }),
    });
  }

  async update(
    id: number,
    updateInvoiceDto: ExpenseUpdateInvoiceDto,
  ): Promise<ExpenseInvoiceEntity> {
    const existingInvoice = await this.invoiceRepository.findOne({ where: { id } });
    if (!existingInvoice) {
      throw new Error('Invoice not found');
    }
  
    console.log('PDF File ID reçu du frontend:', updateInvoiceDto.pdfFileId);
    console.log('IDs des fichiers supplémentaires reçus du frontend:', updateInvoiceDto.uploads?.map(u => u.uploadId));
  
    const existingUploadEntities = await this.invoiceUploadService.findByInvoiceId(id);
    const existingUploads = existingUploadEntities.map(upload => ({
      id: upload.id,
      uploadId: upload.uploadId,
    }));
  
    const { keptUploads, newUploads, eliminatedUploads } = await this.updateExpenseInvoiceUpload(
      id,
      updateInvoiceDto,
      existingUploads,
    );
  
    const sequentialNumbr = updateInvoiceDto.sequentialNumbr || existingInvoice.sequentialNumbr || null;
  
    const [firm, bankAccount, currency] = await Promise.all([
      this.firmService.findOneByCondition({ filter: `id||$eq||${updateInvoiceDto.firmId}` }),
      updateInvoiceDto.bankAccountId ? this.bankAccountService.findOneById(updateInvoiceDto.bankAccountId) : null,
      updateInvoiceDto.currencyId ? this.currencyService.findOneById(updateInvoiceDto.currencyId) : null,
    ]);
  
    if (!firm) {
      throw new Error('Firm not found');
    }
  
    const articleEntries = updateInvoiceDto.articleInvoiceEntries && await this.articleInvoiceEntryService.saveMany(
      updateInvoiceDto.articleInvoiceEntries,
    );
  
    if (!articleEntries) {
      throw new Error('Article entries are missing');
    }
  
    const { subTotal, total } = this.calculationsService.calculateLineItemsTotal(
      articleEntries.map(entry => entry.total),
      articleEntries.map(entry => entry.subTotal),
    );
  
    const taxStamp = updateInvoiceDto.taxStampId ? await this.taxService.findOneById(updateInvoiceDto.taxStampId) : null;
  
    const totalAfterGeneralDiscount = this.calculationsService.calculateTotalDiscount(
      total,
      updateInvoiceDto.discount,
      updateInvoiceDto.discount_type,
      taxStamp?.value || 0,
    );
  
    const lineItems = await this.articleInvoiceEntryService.findManyAsLineItem(
      articleEntries.map(entry => entry.id),
    );
  
    const taxSummary = await Promise.all(
      this.calculationsService.calculateTaxSummary(lineItems).map(async (item) => {
        const tax = await this.taxService.findOneById(item.taxId);
        return {
          ...item,
          label: tax.label,
          value: tax.isRate ? tax.value * 100 : tax.value,
          isRate: tax.isRate,
        };
      }),
    );
  
    const invoiceMetaData = await this.invoiceMetaDataService.save({
      ...updateInvoiceDto.invoiceMetaData,
      taxSummary,
    });
  
    let taxWithholdingAmount = 0;
    if (updateInvoiceDto.taxWithholdingId) {
      const taxWithholding = await this.taxWithholdingService.findOneById(updateInvoiceDto.taxWithholdingId);
      if (taxWithholding.rate !== undefined && taxWithholding.rate !== null) {
        taxWithholdingAmount = totalAfterGeneralDiscount * (taxWithholding.rate / 100);
      }
    }
  
    let pdfFileId = existingInvoice.pdfFileId;
    if (updateInvoiceDto.pdfFileId) {
      console.log('PDF File ID reçu du frontend:', updateInvoiceDto.pdfFileId);
      pdfFileId = updateInvoiceDto.pdfFileId;
    }
  
    const updatedInvoice = await this.invoiceRepository.save({
      ...updateInvoiceDto,
      sequential: sequentialNumbr,
      bankAccountId: bankAccount ? bankAccount.id : null,
      currencyId: currency ? currency.id : firm.currencyId,
      cabinetId: 1,
      sequentialNumbr,
      articleExpenseEntries: articleEntries,
      expenseInvoiceMetaData: invoiceMetaData,
      subTotal,
      taxWithholdingAmount,
      total: totalAfterGeneralDiscount,
      pdfFileId,
    });
  
    // Dans la fonction update, supprimez cette partie :
if (updateInvoiceDto.uploads) {
  console.log('Uploads reçus du frontend:', updateInvoiceDto.uploads);
  await Promise.all(
    updateInvoiceDto.uploads.map((u) => {
      console.log('Upload ID:', u.uploadId);
      return this.invoiceUploadService.save(updatedInvoice.id, u.uploadId);
    }),
  );
}
  
    console.log('Updated Invoice:', updatedInvoice);
    return updatedInvoice;
  }
  
  async updateExpenseInvoiceUpload(
    id: number, // ID de la facture
    updateInvoiceDto: ExpenseUpdateInvoiceDto,
    existingUploads: ExpenseResponseInvoiceUploadDto[],
  ) {
    const newUploads = [];
    const keptUploads = [];
    const eliminatedUploads = [];
  
    if (updateInvoiceDto.uploads) {
      try {
        // Gestion des fichiers existants
        for (const upload of existingUploads) {
          const exists = updateInvoiceDto.uploads.some(
            (u) => u.uploadId === upload.uploadId,
          );
          if (!exists) {
            console.log(`Suppression du fichier avec l'uploadId ${upload.uploadId}`);
            const deletedUpload = await this.invoiceUploadService.softDelete(upload.id);
            eliminatedUploads.push(deletedUpload);
          } else {
            keptUploads.push(upload); // Conserver le fichier existant
          }
        }
  
        // Ajout des nouveaux fichiers
        const existingUploadIds = existingUploads.map(u => u.uploadId);
        for (const upload of updateInvoiceDto.uploads) {
          if (!existingUploadIds.includes(upload.uploadId)) { // Vérifier si c'est un nouveau fichier
            console.log(`Ajout d'un nouveau fichier avec l'uploadId ${upload.uploadId}`);
            const newUpload = await this.invoiceUploadService.save(id, upload.uploadId); // Associer l'ID de la facture
            newUploads.push(newUpload);
          }
        }
      } catch (error) {
        console.error('Erreur lors de la mise à jour des fichiers uploadés :', error);
        throw new Error('Erreur lors de la mise à jour des fichiers uploadés');
      }
    }
  
    // Log des fichiers conservés, ajoutés et supprimés
    console.log('Fichiers conservés:', keptUploads);
    console.log('Nouveaux fichiers ajoutés:', newUploads);
    console.log('Fichiers supprimés:', eliminatedUploads);
  
    return {
      keptUploads,
      newUploads,
      eliminatedUploads,
    };
  }
  


  async updateFields(
    id: number,
    dict: QueryDeepPartialEntity<ExpenseInvoiceEntity>,
  ): Promise<UpdateResult> {
    return this.invoiceRepository.update(id, dict);
  }

  async duplicate(duplicateInvoiceDto: ExpenseDuplicateInvoiceDto): Promise<ExpenseResponseInvoiceDto> {
    try {
      const existingInvoice = await this.findOneByCondition({
        filter: `id||$eq||${duplicateInvoiceDto.id}`,
        join: 'expenseInvoiceMetaData,articleExpenseEntries,articleExpenseEntries.expenseArticleInvoiceEntryTaxes,uploads,uploadPdfField',
      });
  
      if (!existingInvoice) {
        throw new Error(`Invoice with id ${duplicateInvoiceDto.id} not found`);
      }
  
      const invoiceMetaData = await this.invoiceMetaDataService.duplicate(
        existingInvoice.expenseInvoiceMetaData.id
      );
  
      // Création de la nouvelle facture (sans fichiers)
      const baseData = {
        ...existingInvoice,
        id: undefined,
        createdAt: undefined,
        updatedAt: undefined,
        sequential: null,
        sequentialNumbr: null,
        status: EXPENSE_INVOICE_STATUS.Draft,
        expenseInvoiceMetaData: invoiceMetaData,
        articleExpenseEntries: [],
        uploads: [], // Initialisé à vide
        uploadPdfField: null, // Initialisé à null
        amountPaid: 0,
      };
  
      const newInvoice = await this.invoiceRepository.save(baseData);
  
      // Duplication des articles
      const duplicatedArticles = existingInvoice.articleExpenseEntries?.length
        ? await this.articleInvoiceEntryService.duplicateMany(
            existingInvoice.articleExpenseEntries.map(e => e.id),
            newInvoice.id
          )
        : [];
  
      // Gestion des fichiers
      let finalUploads = [];
      let finalPdfField = null;
  
      if (duplicateInvoiceDto.includeFiles) {
        // Duplication des uploads
        if (existingInvoice.uploads?.length > 0) {
          finalUploads = await this.invoiceUploadService.duplicateMany(
            existingInvoice.uploads.map(u => u.id),
            newInvoice.id
          );
        }
  
        // Duplication du PDF
        if (existingInvoice.uploadPdfField?.id) {
          finalPdfField = await this.storageService.duplicate(existingInvoice.uploadPdfField.id);
        }
      }
  
      // Mise à jour finale
      const result = await this.invoiceRepository.save({
        ...newInvoice,
        articleExpenseEntries: duplicatedArticles,
        uploads: finalUploads,
        uploadPdfField: finalPdfField,
      });
  
      return result;
    } catch (error) {
      console.error("[DUPLICATION FAILED]", error);
      throw error;
    }
  }
  
  

  async updateMany(
    updateInvoiceDtos: ExpenseUpdateInvoiceDto[],
  ): Promise<ExpenseInvoiceEntity[]> {
    return this.invoiceRepository.updateMany(updateInvoiceDtos);
  }
  async deletePdfFile(invoiceId: number): Promise<void> {
    const invoice = await this.invoiceRepository.findOneById(invoiceId);
    if (!invoice) {
      throw new Error("Quotation not found");
    }
  
    if (invoice.pdfFileId) {
      // Supprimer le fichier PDF de la base de données
      await this.storageService.delete(invoice.pdfFileId);
  
      // Mettre à jour le devis pour retirer l'ID du fichier PDF
      await this.invoiceRepository.save({
        ...invoice,
        pdfFileId: null,
        uploadPdfField: null,
      });
    }
  }


  async softDelete(id: number): Promise<ExpenseInvoiceEntity> {
    await this.findOneById(id);
    return this.invoiceRepository.softDelete(id);
  }
  async deleteAll() {
    return this.invoiceRepository.deleteAll();
  }
  

  async getTotal(): Promise<number> {
    return this.invoiceRepository.getTotalCount();
  }
  async updateInvoiceStatusIfExpired(invoiceId: number): Promise<ExpenseInvoiceEntity> {
    const invoice = await this.findOneById(invoiceId);
    const currentDate = new Date();
    const dueDate = new Date(invoice.dueDate);
  
    if (dueDate < currentDate && invoice.status !== EXPENSE_INVOICE_STATUS.Expired) {
      invoice.status = EXPENSE_INVOICE_STATUS.Expired;
      return this.invoiceRepository.save(invoice);
    }
  
    return invoice;
  }


  async getInvoiceForExport(id: number) {
    return this.invoiceRepository.findOne({
      where: { id },
      relations: [
        'firm',
        'interlocutor',
        'articleExpenseEntries',
        'articleExpenseEntries.article',
        'currency'
      ]
    });
 
  }
  async generateInvoicePdf(invoiceId: number, templateId?: number): Promise<Buffer> {
    // 1. Récupérer la facture avec toutes les relations nécessaires
    const invoice = await this.invoiceRepository.findOne({
        where: { id: invoiceId },
        relations: [
            'firm', 
            'interlocutor', 
            'articleExpenseEntries', 
            'articleExpenseEntries.article',
            'articleExpenseEntries.expenseArticleInvoiceEntryTaxes',
            'articleExpenseEntries.expenseArticleInvoiceEntryTaxes.tax',
            'currency',
            'expenseInvoiceMetaData',
            'taxStamp',
            'taxWithholding',
            'cabinet',
            'cabinet.address',
            'bankAccount'
        ]
    });

    if (!invoice) {
        throw new NotFoundException(`Facture avec ID ${invoiceId} non trouvée`);
    }

    // 2. Récupérer le template
    const template = templateId 
        ? await this.templateService.getTemplateById(templateId)
        : await this.templateService.getDefaultTemplate(TemplateType.INVOICE);
    
    if (!template) {
        throw new NotFoundException('Aucun template de facture trouvé');
    }

    // 3. Calculer les totaux
    const totalTVA = this.calculationsService.calculateTotalTax(invoice);
    const totalFODEC = this.calculationsService.calculateFodec(invoice);

    // 4. Préparer les données pour le template
    const templateData = {
        invoice: {
            ...invoice,
            // Formatage des dates
            date: format(invoice.date, 'dd/MM/yyyy'),
            dueDate: invoice.dueDate ? format(invoice.dueDate, 'dd/MM/yyyy') : 'Non spécifié',
            
            // Articles avec formatage spécifique
            articles: invoice.articleExpenseEntries?.map(entry => ({
              reference: entry.article?.reference,
                title: entry.article?.title,
                description: entry.article?.description || '',
                quantity: entry.quantity,
                unit_price: entry.unit_price,
                discount: entry.discount,
                discount_type: entry.discount_type,
                subTotal: entry.subTotal,
                total: entry.total,
                taxes: entry.expenseArticleInvoiceEntryTaxes?.map(taxEntry => ({
                    label: taxEntry.tax?.label,
                    rate: taxEntry.tax?.value,
                    amount: taxEntry.tax?.value * entry.subTotal / 100
                })) || []
            })) || [],
            
            // Totaux calculés
            totalHT: invoice.subTotal,
            totalTVA,
            totalFODEC,
            total: invoice.total,
            
            // Gestion des valeurs nulles
            firm: {
                ...invoice.firm,
                deliveryAddress: invoice.firm.deliveryAddress || {
                    address: '',
                    zipcode: '',
                    region: '',
                    country: ''
                },
                invoicingAddress: invoice.firm.invoicingAddress || invoice.firm.deliveryAddress || {
                    address: '',
                    zipcode: '',
                    region: '',
                    country: ''
                }
            },
            cabinet: invoice.cabinet || {
                enterpriseName: '',
                taxIdentificationNumber: '',
                address: {
                    address: '',
                    zipcode: '',
                    region: '',
                    country: ''
                },
                phone: ''
            },
            currency: invoice.currency || {
                symbol: '€'
            }
        }
    };

    // 5. Nettoyer et compiler le template
    const cleanedContent = template.content
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');

    const compiledHtml = ejs.render(cleanedContent, templateData);

    // 6. Générer le PDF
    return this.pdfService.generateFromHtml(compiledHtml, {
        format: 'A4',
        margin: { top: '20mm', right: '10mm', bottom: '20mm', left: '10mm' },
        printBackground: true
    });
}

async findUnpaidByFirm(firmId: number): Promise<ExpenseInvoiceEntity[]> {
  return this.invoiceRepository.findAll({
    where: {
      firmId,
      status: EXPENSE_INVOICE_STATUS.Unpaid,
      // Ajoutez ici d'autres conditions si nécessaire
    },
    relations: ['currency', 'firm'] // Ajoutez les relations nécessaires
  });
}

 async checkSequentialNumberExists(sequentialNumber: string): Promise<boolean> {
    // Vérification du format
    if (!/^INV-\d+$/.test(sequentialNumber)) {
        throw new BadRequestException('Format de numéro séquentiel invalide. Format attendu: QUO-XXXX');
    }

    // Recherche dans la base de données
    const existingQuotation = await this.invoiceRepository.findOne({
        where: { sequential: sequentialNumber }
    });

    return !!existingQuotation;
}


}





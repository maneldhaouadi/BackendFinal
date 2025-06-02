import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PageDto } from 'src/common/database/dtos/database.page.dto';
import { PageMetaDto } from 'src/common/database/dtos/database.page-meta.dto';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { FindManyOptions, FindOneOptions } from 'typeorm';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { Transactional } from '@nestjs-cls/transactional';
import { CurrencyService } from 'src/modules/currency/services/currency.service';
import { ExpensePaymentRepository } from '../repositories/repository/expense-payment-file.entity';
import { ExpensePaymentInvoiceEntryService } from './expense-payment-invoice-entry.service';
import { ExpensePaymentUploadService } from './expense-payment-upload.service';
import { ExpenseInvoiceService } from 'src/modules/expense-invoice/services/expense-invoice.service';
import { ExpensePaymentEntity } from '../repositories/entities/expense-payment.entity';
import { ExpensePaymentNotFoundException } from '../errors/expense-payment.notfound.error';
import { ResponseExpensePaymentDto } from '../dtos/expense-payment.response.dto';
import { ResponseExpensePaymentUploadDto } from '../dtos/expense-payment-upload.response.dto';
import { UpdateExpensePaymentDto } from '../dtos/expense-payment.update.dto';
import { ExpenseCreatePaymentDto } from '../dtos/expense-payment.create.dto';
import { StorageService } from 'src/common/storage/services/storage.service';
import { createDineroAmountFromFloatWithDynamicCurrency } from 'src/utils/money.utils';
import { EXPENSE_INVOICE_STATUS } from 'src/modules/expense-invoice/enums/expense-invoice-status.enum';
import { ResponseExpensePaymentInvoiceEntryDto } from '../dtos/expense-payment-invoice-entry.response.dto';
import { CurrencyEntity } from 'src/modules/currency/repositories/entities/currency.entity';

import dinero from 'dinero.js';
import { TemplateType } from 'src/modules/template/enums/TemplateType';
import { TemplateService } from 'src/modules/template/services/template.service';
import { PdfService } from 'src/common/pdf/services/pdf.service';
import ejs from "ejs";
import { format } from 'date-fns/format';
import { PAYMENT_MODE } from 'src/modules/payment/enums/payment-mode.enum';
import { ExpensePaymentInvoiceEntryEntity } from '../repositories/entities/expense-payment-invoice-entry.entity';
import { ExpensePaymentInvoiceEntryRepository } from '../repositories/repository/expense-payment-invoice-entry.entity';


@Injectable()
export class ExpensePaymentService {
  constructor(
    private readonly expenesePaymentRepository: ExpensePaymentRepository,
    private readonly expensePaymentInvoiceEntryService: ExpensePaymentInvoiceEntryService,
    private readonly expensePaymentUploadService: ExpensePaymentUploadService,
    private readonly expenseInvoiceService: ExpenseInvoiceService,
    private readonly currencyService: CurrencyService,
    private readonly storageService: StorageService,
    private readonly templateService:TemplateService,
    private readonly pdfService:PdfService,
    private readonly expensePaymentInvoiceEntryRepository:ExpensePaymentInvoiceEntryRepository
    
  ) {}

  async findOneById(id: number): Promise<ExpensePaymentEntity> {
    const expensePayment = await this.expenesePaymentRepository.findOneById(id);
    if (!expensePayment) {
      throw new ExpensePaymentNotFoundException();
    }
    return expensePayment;
  }

  async findOneByCondition(
    query: IQueryObject,
  ): Promise<ResponseExpensePaymentDto | null> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const payment = await this.expenesePaymentRepository.findOne(
      queryOptions as FindOneOptions<ExpensePaymentEntity>,
    );
    if (!payment) return null;
    return payment;
  }

  async findAll(query: IQueryObject): Promise<ResponseExpensePaymentDto[]> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    return await this.expenesePaymentRepository.findAll(
      queryOptions as FindManyOptions<ExpensePaymentEntity>,
    );
  }

  async findAllPaginated(
    query: IQueryObject,
  ): Promise<PageDto<ResponseExpensePaymentDto>> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const count = await this.expenesePaymentRepository.getTotalCount({
      where: queryOptions.where,
    });

    const entities = await this.expenesePaymentRepository.findAll(
      queryOptions as FindManyOptions<ExpensePaymentEntity>,
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
async save(createPaymentDto: ExpenseCreatePaymentDto): Promise<ExpensePaymentEntity> {
  try {
    // 1. Validation initiale
    if (!createPaymentDto.invoices || createPaymentDto.invoices.length === 0) {
      throw new Error('Au moins une facture doit être associée au paiement');
    }

    const sequentialNumbr = await this.generateSequentialNumber();

    // 2. Gestion du fichier PDF
    let uploadPdfField = null;
    if (createPaymentDto.pdfFileId) {
      uploadPdfField = await this.storageService.findOneById(createPaymentDto.pdfFileId);
      if (!uploadPdfField) {
        throw new NotFoundException('Fichier PDF introuvable');
      }
    }

    // 3. Traitement des factures
    let totalInvoicesAmount = 0;
    const processedInvoices = [];
    const currencyCache = new Map<number, CurrencyEntity>();

    for (const entry of createPaymentDto.invoices) {
      if (entry.amount <= 0) continue;

      // 3.1 Récupération de la facture
      const invoice = await this.expenseInvoiceService.findOneById(entry.expenseInvoiceId);
      if (!invoice) {
        throw new Error(`Facture ${entry.expenseInvoiceId} introuvable`);
      }

      // 3.2 Vérification du statut
      if (invoice.status === EXPENSE_INVOICE_STATUS.Paid) {
        throw new Error(`La facture ${invoice.sequential} est déjà payée intégralement`);
      }

      // 3.3 Récupération de la devise (avec cache)
      let invoiceCurrency = currencyCache.get(invoice.currencyId);
      if (!invoiceCurrency) {
        invoiceCurrency = await this.currencyService.findOneById(invoice.currencyId);
        currencyCache.set(invoice.currencyId, invoiceCurrency);
      }

      const createDinero = (amount: number) => dinero({
        amount: createDineroAmountFromFloatWithDynamicCurrency(amount, invoiceCurrency.digitAfterComma),
        precision: invoiceCurrency.digitAfterComma,
      });

      // 3.4 Calcul des montants
      const invoiceTotal = createDinero(invoice.total);
      const amountPaid = createDinero(invoice.amountPaid || 0);
      const taxWithholding = createDinero(invoice.taxWithholdingAmount || 0);
      const remainingAmount = invoiceTotal.subtract(amountPaid).subtract(taxWithholding);
      const tolerance = createDinero(0.01);

      let paymentAmountInPaymentCurrency: dinero.Dinero;
      let paymentAmountInInvoiceCurrency: dinero.Dinero;

      // 3.5 Conversion devise si nécessaire
      if (invoice.currencyId !== createPaymentDto.currencyId) {
        if (!entry.exchangeRate || entry.exchangeRate <= 0) {
          throw new Error(`Taux de change manquant ou invalide pour la facture ${invoice.sequential}`);
        }

        // CORRECTION CLÉ : Conversion correcte devise paiement → devise facture
        // Montant en devise paiement (TND) → devise facture (EUR)
        paymentAmountInPaymentCurrency = createDinero(entry.amount);
        paymentAmountInInvoiceCurrency = paymentAmountInPaymentCurrency.divide(entry.exchangeRate);

        // Validation du montant maximum (convertir le reste en devise paiement)
        const maxAllowedInPaymentCurrency = remainingAmount.multiply(entry.exchangeRate);
        
        if (paymentAmountInPaymentCurrency.greaterThan(maxAllowedInPaymentCurrency.add(tolerance))) {
          throw new Error(
            `Le paiement (${paymentAmountInPaymentCurrency.toUnit()} ${createPaymentDto.currencyId}) ` +
            `dépasse le montant restant (${maxAllowedInPaymentCurrency.toUnit()} ${createPaymentDto.currencyId}) ` +
            `pour la facture ${invoice.sequential}. ` +
            `Maximum autorisé: ${maxAllowedInPaymentCurrency.toUnit()} ${createPaymentDto.currencyId}`
          );
        }

        // Ajustement automatique si proche du montant restant
        if (maxAllowedInPaymentCurrency.subtract(paymentAmountInPaymentCurrency).toUnit() < 0.01) {
          paymentAmountInPaymentCurrency = maxAllowedInPaymentCurrency;
          paymentAmountInInvoiceCurrency = paymentAmountInPaymentCurrency.divide(entry.exchangeRate);
        }
      } else {
        // Même devise
        paymentAmountInPaymentCurrency = createDinero(entry.amount);
        paymentAmountInInvoiceCurrency = paymentAmountInPaymentCurrency;

        if (paymentAmountInInvoiceCurrency.greaterThan(remainingAmount.add(tolerance))) {
          throw new Error(
            `Le montant (${paymentAmountInInvoiceCurrency.toUnit()} ${invoice.currencyId}) ` +
            `dépasse le reste à payer (${remainingAmount.toUnit()} ${invoice.currencyId}) ` +
            `pour la facture ${invoice.sequential}`
          );
        }

        // Ajustement automatique
        if (remainingAmount.subtract(paymentAmountInInvoiceCurrency).toUnit() < 0.01) {
          paymentAmountInInvoiceCurrency = remainingAmount;
          paymentAmountInPaymentCurrency = paymentAmountInInvoiceCurrency;
        }
      }

      // 3.6 Mise à jour du total (en devise paiement)
      totalInvoicesAmount += paymentAmountInPaymentCurrency.toUnit();

      // 3.7 Préparation de l'entrée de paiement
      processedInvoices.push({
        payment: null,
        expenseInvoice: invoice,
        amount: paymentAmountInInvoiceCurrency.toUnit(), // Montant en devise facture
        originalAmount: paymentAmountInPaymentCurrency.toUnit(), // Montant en devise paiement
        originalCurrency: await this.currencyService.findOneById(createPaymentDto.currencyId),
        exchangeRate: entry.exchangeRate || 1,
        digitAfterComma: invoiceCurrency.digitAfterComma,
      });

      // 3.8 Mise à jour du statut de la facture
      const newAmountPaid = amountPaid.add(paymentAmountInInvoiceCurrency);
      const newRemaining = invoiceTotal.subtract(newAmountPaid).subtract(taxWithholding);
      
      const newStatus = newRemaining.lessThanOrEqual(tolerance)
        ? EXPENSE_INVOICE_STATUS.Paid
        : EXPENSE_INVOICE_STATUS.PartiallyPaid;

      await this.expenseInvoiceService.updateFields(invoice.id, {
        amountPaid: newAmountPaid.toUnit(),
        status: newStatus,
      });
    }

    // 4. Création du paiement principal
    const payment = await this.expenesePaymentRepository.save({
      ...createPaymentDto,
      sequential: sequentialNumbr,
      sequentialNumbr,
      pdfFileId: uploadPdfField?.id || null,
      uploadPdfField: uploadPdfField || null,
      amount: totalInvoicesAmount, // Total en devise paiement
    });

    // 5. Sauvegarde des entrées de facture
    await Promise.all(
      processedInvoices.map(entry => 
        this.expensePaymentInvoiceEntryRepository.save({
          ...entry,
          paymentId: payment.id,
        })
      )
    );

    // 6. Gestion des fichiers joints
    if (createPaymentDto.uploads?.length > 0) {
      await Promise.all(
        createPaymentDto.uploads.map(upload =>
          this.expensePaymentUploadService.save(payment.id, upload.uploadId)
        )
      );
    }

    // 7. Retour du paiement complet
    return this.expenesePaymentRepository.findOne({
      where: { id: payment.id },
      relations: [
        'invoices', 
        'invoices.expenseInvoice',
        'invoices.expenseInvoice.currency',
        'uploads',
        'currency'
      ],
    });
  } catch (error) {
    console.error('Erreur lors de la sauvegarde du paiement:', {
      error: error.message,
      stack: error.stack,
      dto: createPaymentDto
    });
    throw new Error(`Échec de la sauvegarde du paiement: ${error.message}`);
  }
}


// Méthode pour générer un numéro séquentiel
private async generateSequentialNumber(): Promise<string> {
  const lastPayment = await this.expenesePaymentRepository.findOne({
      where: {},
      order: { createdAt: 'DESC' }, // Utilisez createdAt pour plus de fiabilité
  });

  if (!lastPayment || !lastPayment.sequentialNumbr) {
      return 'PAY-1';
  }

  // Utilisation d'une regex plus robuste
  const matches = lastPayment.sequentialNumbr.match(/^PAY-(\d+)$/);
  if (!matches) {
      return 'PAY-1';
  }

  const lastNumber = parseInt(matches[1], 10);
  return `PAY-${lastNumber + 1}`;
}

// Dans votre service backend (expensquotation.service.ts)
async deletePdfFile(paymentId: number): Promise<void> {
  const payment = await this.expenesePaymentRepository.findOneById(paymentId);
  if (!payment) {
    throw new Error("Quotation not found");
  }

  if (payment.pdfFileId) {
    // Supprimer le fichier PDF de la base de données
    await this.storageService.delete(payment.pdfFileId);

    // Mettre à jour le devis pour retirer l'ID du fichier PDF
    await this.expenesePaymentRepository.save({
      ...payment,
      pdfFileId: null,
      uploadPdfField: null,
    });
  }
}


@Transactional()
async update(
  id: number,
  updatePaymentDto: UpdateExpensePaymentDto,
): Promise<ExpensePaymentEntity> {
  try {
    // 1. Récupérer le paiement existant avec toutes ses entrées
    const existingPayment = await this.findOneByCondition({
      filter: `id||$eq||${id}`,
      join: 'invoices,invoices.expenseInvoice,invoices.expenseInvoice.currency',
    });

    if (!existingPayment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    // 2. Préparer les données de base
    const paymentData = {
      ...existingPayment,
      ...updatePaymentDto,
      sequential: existingPayment.sequential,
      sequentialNumbr: existingPayment.sequentialNumbr,
    };

    // 3. Traitement des entrées de facture
    if (updatePaymentDto.invoices) {
      const paymentCurrency = await this.currencyService.findOneById(
        updatePaymentDto.currencyId || existingPayment.currencyId
      );
      
      if (!paymentCurrency) {
        throw new Error('Payment currency not found');
      }

      // 4. Récupérer toutes les entrées existantes pour ce paiement
      const existingEntries = existingPayment.invoices || [];
      
      // 5. Calculer l'impact total des modifications
      let totalPaymentAmount = 0;
      const invoiceEntries = await Promise.all(
        updatePaymentDto.invoices.map(async (newEntry) => {
          // Vérifier si c'est une entrée existante ou nouvelle
          const existingEntry = existingEntries.find(e => e.expenseInvoiceId === newEntry.expenseInvoiceId);
          
          const invoice = await this.expenseInvoiceService.findOneByCondition({
            filter: `id||$eq||${newEntry.expenseInvoiceId}`,
            join: 'currency,payments',
          });

          if (!invoice) {
            throw new Error(`Invoice with ID ${newEntry.expenseInvoiceId} not found`);
          }

          // 6. Fonctions dinero avec la devise de la facture
          const createDinero = (amount: number) => dinero({
            amount: createDineroAmountFromFloatWithDynamicCurrency(
              amount,
              invoice.currency.digitAfterComma
            ),
            precision: invoice.currency.digitAfterComma,
          });

          const zero = createDinero(0);
          const tolerance = createDinero(0.01);

          // 7. Calcul du montant déjà payé sur cette facture (hors le paiement actuel)
          const paidFromOtherPayments = (invoice.payments || [])
            .filter(p => p.id !== id)
            .reduce((sum, p) => sum + p.amount, 0);

          // 8. Montant actuellement payé via ce paiement (avant modification)
          const oldAmountInInvoiceCurrency = existingEntry 
            ? createDinero(existingEntry.amount)
            : zero;

          // 9. Calcul du montant supplémentaire à ajouter
          let additionalAmountInPaymentCurrency = createDinero(newEntry.originalAmount);
          let additionalAmountInInvoiceCurrency: dinero.Dinero;
          let exchangeRate = newEntry.exchangeRate || existingPayment.convertionRate || 1;

          if (invoice.currencyId !== paymentCurrency.id) {
            if (!exchangeRate || exchangeRate <= 0) {
              throw new Error(`Invalid exchange rate for invoice ${invoice.id}`);
            }
            additionalAmountInInvoiceCurrency = additionalAmountInPaymentCurrency.divide(exchangeRate);
          } else {
            additionalAmountInInvoiceCurrency = additionalAmountInPaymentCurrency;
            exchangeRate = 1;
          }

          // 10. Calcul du nouveau montant total pour cette entrée
          const newAmountInInvoiceCurrency = existingEntry
            ? createDinero(existingEntry.amount).add(additionalAmountInInvoiceCurrency)
            : additionalAmountInInvoiceCurrency;

          const newAmountInPaymentCurrency = existingEntry
            ? createDinero(existingEntry.originalAmount).add(additionalAmountInPaymentCurrency)
            : additionalAmountInPaymentCurrency;

          // 11. Calcul du nouveau montant total payé sur la facture
          const newTotalPaid = createDinero(paidFromOtherPayments)
            .subtract(oldAmountInInvoiceCurrency)
            .add(newAmountInInvoiceCurrency);

          // 12. Validation du montant
          const invoiceTotal = createDinero(invoice.total);
          const taxWithholding = createDinero(invoice.taxWithholdingAmount || 0);
          const remainingBefore = invoiceTotal
            .subtract(createDinero(paidFromOtherPayments))
            .subtract(taxWithholding);

          // Vérifier que le montant supplémentaire ne dépasse pas le restant dû
          if (additionalAmountInInvoiceCurrency.greaterThan(remainingBefore.add(tolerance))) {
            throw new Error(
              `Additional payment of ${additionalAmountInInvoiceCurrency.toUnit()} ${invoice.currency.code} ` +
              `exceeds remaining amount of ${remainingBefore.toUnit()} for invoice ${invoice.id}. ` +
              `Maximum allowed: ${remainingBefore.toUnit()}`
            );
          }

          // 13. Mise à jour du statut de la facture
          const newRemaining = invoiceTotal
            .subtract(newTotalPaid)
            .subtract(taxWithholding);

          let newStatus;
          if (newTotalPaid.equalsTo(zero)) {
            newStatus = EXPENSE_INVOICE_STATUS.Unpaid;
          } else if (newRemaining.lessThanOrEqual(tolerance)) {
            newStatus = EXPENSE_INVOICE_STATUS.Paid;
          } else {
            newStatus = EXPENSE_INVOICE_STATUS.PartiallyPaid;
          }

          // 14. Mise à jour de la facture
          await this.expenseInvoiceService.updateFields(invoice.id, {
            amountPaid: newTotalPaid.toUnit(),
            status: newStatus,
          });

          totalPaymentAmount += newAmountInPaymentCurrency.toUnit();

          return {
            paymentId: id,
            expenseInvoiceId: invoice.id,
            amount: newAmountInInvoiceCurrency.toUnit(),
            originalAmount: newAmountInPaymentCurrency.toUnit(),
            originalCurrencyId: paymentCurrency.id,
            exchangeRate,
            digitAfterComma: invoice.currency.digitAfterComma,
          };
        })
      );

      // 15. Sauvegarde des nouvelles entrées
      await this.expensePaymentInvoiceEntryService.saveMany(
        invoiceEntries.filter(entry => entry !== null)
      );

      paymentData.amount = totalPaymentAmount;
    }

    // 16. Sauvegarde finale du paiement
    const updatedPayment = await this.expenesePaymentRepository.save(paymentData);
    return updatedPayment;
  } catch (error) {
    console.error('Error in update method:', error);
    throw new InternalServerErrorException(`Failed to update expense payment: ${error.message}`);
  }
}

// Helper method to revert payment impact on invoices
private async revertPaymentImpact(
  entries: ResponseExpensePaymentInvoiceEntryDto[]
): Promise<void> {
  await Promise.all(
    entries.map(async (entry) => {
      const invoice = await this.expenseInvoiceService.findOneByCondition({
        filter: `id||$eq||${entry.expenseInvoiceId}`,
        join: 'currency',
      });

      const currentAmountPaid = dinero({
        amount: createDineroAmountFromFloatWithDynamicCurrency(
          invoice.amountPaid,
          invoice.currency.digitAfterComma,
        ),
        precision: invoice.currency.digitAfterComma,
      });

      const entryAmount = dinero({
        amount: createDineroAmountFromFloatWithDynamicCurrency(
          entry.amount,
          invoice.currency.digitAfterComma,
        ),
        precision: invoice.currency.digitAfterComma,
      });

      const newAmountPaid = currentAmountPaid.subtract(entryAmount);
      const zero = dinero({ amount: 0, precision: invoice.currency.digitAfterComma });

      const newStatus = newAmountPaid.equalsTo(zero)
        ? EXPENSE_INVOICE_STATUS.Unpaid
        : EXPENSE_INVOICE_STATUS.PartiallyPaid;

      await this.expenseInvoiceService.updateFields(invoice.id, {
        amountPaid: newAmountPaid.toUnit(),
        status: newStatus,
      });
    })
  );
}

// Helper method to process new invoice entries
private async processInvoiceEntries(
  entries: ResponseExpensePaymentInvoiceEntryDto[],
  paymentId: number,
  paymentCurrency: CurrencyEntity,
  conversionRate: number
): Promise<any[]> {
  return Promise.all(
    entries.map(async (entry) => {
      const invoice = await this.expenseInvoiceService.findOneByCondition({
        filter: `id||$eq||${entry.expenseInvoiceId}`,
        join: 'currency',
      });

      // Convert amount if currencies are different
      const amount = invoice.currencyId === paymentCurrency.id
        ? entry.amount
        : entry.amount * conversionRate;

      // Update invoice status and amount paid
      const currentAmountPaid = dinero({
        amount: createDineroAmountFromFloatWithDynamicCurrency(
          invoice.amountPaid,
          invoice.currency.digitAfterComma,
        ),
        precision: invoice.currency.digitAfterComma,
      });

      const entryAmount = dinero({
        amount: createDineroAmountFromFloatWithDynamicCurrency(
          amount,
          invoice.currency.digitAfterComma,
        ),
        precision: invoice.currency.digitAfterComma,
      });

      const newAmountPaid = currentAmountPaid.add(entryAmount);
      const invoiceTotal = dinero({
        amount: createDineroAmountFromFloatWithDynamicCurrency(
          invoice.total,
          invoice.currency.digitAfterComma,
        ),
        precision: invoice.currency.digitAfterComma,
      });

      const taxWithholdingAmount = dinero({
        amount: createDineroAmountFromFloatWithDynamicCurrency(
          invoice.taxWithholdingAmount || 0,
          invoice.currency.digitAfterComma,
        ),
        precision: invoice.currency.digitAfterComma,
      });

      const zero = dinero({ amount: 0, precision: invoice.currency.digitAfterComma });

      let newStatus;
      if (newAmountPaid.equalsTo(zero)) {
        newStatus = EXPENSE_INVOICE_STATUS.Unpaid;
      } else if (newAmountPaid.add(taxWithholdingAmount).equalsTo(invoiceTotal)) {
        newStatus = EXPENSE_INVOICE_STATUS.Paid;
      } else {
        newStatus = EXPENSE_INVOICE_STATUS.PartiallyPaid;
      }

      await this.expenseInvoiceService.updateFields(invoice.id, {
        amountPaid: newAmountPaid.toUnit(),
        status: newStatus,
      });

      return {
        paymentId,
        expenseInvoiceId: invoice.id,
        amount,
        digitAfterComma: invoice.currency.digitAfterComma,
        exchangeRate: invoice.currencyId === paymentCurrency.id ? 1 : conversionRate,
        originalAmount: entry.amount,
        originalCurrencyId: paymentCurrency.id,
      };
    })
  );
}
@Transactional()
async softDelete(id: number): Promise<ExpensePaymentEntity> {
  const existingPayment = await this.expenesePaymentRepository.findOne({
    where: { id },
    relations: ['invoices'],
  });

  if (!existingPayment) {
    throw new NotFoundException('Payment not found');
  }

  // Supprimez d'abord toutes les entrées liées
  for (const invoiceEntry of existingPayment.invoices) {
    await this.expensePaymentInvoiceEntryService.softDelete(invoiceEntry.id);
  }

  // Puis supprimez le paiement principal
  return this.expenesePaymentRepository.softDelete(id);
}
@Transactional()
async softDeleteMany(ids: number[]): Promise<void> {
  for (const id of ids) {
    await this.softDelete(id);
  }
}


  async deleteAll() {
    return this.expenesePaymentRepository.deleteAll();
  }

  async getTotal(): Promise<number> {
    return this.expenesePaymentRepository.getTotalCount();
  }

  async generatePaymentPdf(paymentId: number, templateId?: number): Promise<Buffer> {
    const payment = await this.expenesePaymentRepository.findOne({
        where: { id: paymentId },
        relations: [
            'invoices',
            'invoices.expenseInvoice',
            'invoices.expenseInvoice.firm',
            'invoices.expenseInvoice.interlocutor',
            'invoices.expenseInvoice.currency',
            'currency',
            'uploads',
            'uploadPdfField'
        ]
    });

    if (!payment) {
        throw new NotFoundException(`Paiement avec ID ${paymentId} non trouvé`);
    }

    const template = templateId 
        ? await this.templateService.getTemplateById(templateId)
        : await this.templateService.getDefaultTemplate(TemplateType.PAYMENT);
    
    if (!template) {
        throw new NotFoundException('Aucun template de paiement trouvé');
    }

    // Enregistrer le templateId dans le paiement si différent ou non défini
    if (payment.templateId !== template.id) {
        payment.templateId = template.id;
        await this.expenesePaymentRepository.save(payment);
    }

    const templateData = {
        payment: {
            ...payment,
            paymentMethod: PAYMENT_MODE[payment.mode] || payment.mode,
            date: format(payment.date, 'dd/MM/yyyy'),
            createdAt: format(payment.createdAt, 'dd/MM/yyyy'),
            invoices: payment.invoices?.map(entry => ({
                invoiceNumber: entry.expenseInvoice?.sequential,
                invoiceDate: entry.expenseInvoice?.date ? format(entry.expenseInvoice.date, 'dd/MM/yyyy') : 'N/A',
                dueDate: entry.expenseInvoice?.dueDate ? format(entry.expenseInvoice.dueDate, 'dd/MM/yyyy') : 'N/A',
                amount: entry.amount,
                originalAmount: entry.originalAmount,
                currency: entry.expenseInvoice?.currency?.code || 'N/A',
                exchangeRate: entry.exchangeRate,
                firm: entry.expenseInvoice?.firm?.name || 'N/A',
                total: entry.expenseInvoice?.total || 0,
                remainingAmount: (entry.expenseInvoice?.total || 0) - (entry.amount || 0)
            })) || [],
            currency: payment.currency || { code: 'EUR', symbol: '€' }
        }
    };

    const cleanedContent = template.content
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');

    const compiledHtml = ejs.render(cleanedContent, templateData);

    return this.pdfService.generateFromHtml(compiledHtml, {
        format: 'A4',
        margin: { top: '20mm', right: '10mm', bottom: '20mm', left: '10mm' },
        printBackground: true
    });
}


}

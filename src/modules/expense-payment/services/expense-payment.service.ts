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

  
  async save(createPaymentDto: ExpenseCreatePaymentDto): Promise<ExpensePaymentEntity> {
    try {
      console.log('Saving payment...', createPaymentDto);
  
      const sequentialNumbr = await this.generateSequentialNumber();

      let uploadPdfField = null;
      if (createPaymentDto.pdfFileId) {
        uploadPdfField = await this.storageService.findOneById(createPaymentDto.pdfFileId);
        if (!uploadPdfField) {
          throw new NotFoundException('Uploaded PDF file not found');
        }
      }
  
      // 1. Calculer le montant total AVANT de créer le paiement principal
      let totalInvoicesAmount = 0;
      const invoiceEntries = await Promise.all(
        createPaymentDto.invoices.map(async (entry) => {
          if (entry.amount <= 0) return null;
  
          const invoice = await this.expenseInvoiceService.findOneById(entry.expenseInvoiceId);
          const invoiceCurrency = await this.currencyService.findOneById(invoice.currencyId);
  
          if (invoice.status === EXPENSE_INVOICE_STATUS.Paid) {
            throw new Error(`La facture ${invoice.sequential} est déjà complètement payée`);
          }
  
          const createDinero = (amount: number) => dinero({
            amount: createDineroAmountFromFloatWithDynamicCurrency(amount, invoiceCurrency.digitAfterComma),
            precision: invoiceCurrency.digitAfterComma,
          });
  
          const invoiceTotal = createDinero(invoice.total);
          const amountPaid = createDinero(invoice.amountPaid || 0);
          const taxWithholding = createDinero(invoice.taxWithholdingAmount || 0);
          const remainingAmount = invoiceTotal.subtract(amountPaid).subtract(taxWithholding);
          const tolerance = createDinero(0.01);
  
          if (invoice.currencyId !== createPaymentDto.currencyId) {
            if (!entry.exchangeRate || entry.exchangeRate <= 0) {
              throw new Error(`Taux de change manquant ou invalide pour la facture ${invoice.sequential}`);
            }
  
            const paymentAmount = createDinero(entry.amount);
            const maxAllowedInPaymentCurrency = remainingAmount.divide(entry.exchangeRate);
  
            if (paymentAmount.greaterThan(maxAllowedInPaymentCurrency.add(tolerance))) {
              throw new Error(`Le paiement dépasse le montant restant pour la facture ${invoice.sequential}`);
            }
  
            // Ajustement d'arrondi
            if (maxAllowedInPaymentCurrency.subtract(paymentAmount).toUnit() < 0.01) {
              entry.amount = maxAllowedInPaymentCurrency.toUnit();
            }
  
            const amountInInvoiceCurrency = paymentAmount.multiply(entry.exchangeRate);
            totalInvoicesAmount += paymentAmount.toUnit();
  
            const newAmountPaid = amountPaid.add(amountInInvoiceCurrency);
            const newRemaining = invoiceTotal.subtract(newAmountPaid).subtract(taxWithholding);
            
            const newStatus = newRemaining.lessThanOrEqual(tolerance)
              ? EXPENSE_INVOICE_STATUS.Paid
              : EXPENSE_INVOICE_STATUS.PartiallyPaid;
  
            await this.expenseInvoiceService.updateFields(invoice.id, {
              amountPaid: newAmountPaid.toUnit(),
              status: newStatus,
            });
  
            return {
              payment: null, // Relation sera établie après
              expenseInvoice: invoice,
              amount: amountInInvoiceCurrency.toUnit(),
              originalAmount: paymentAmount.toUnit(),
              originalCurrency: await this.currencyService.findOneById(createPaymentDto.currencyId),
              exchangeRate: entry.exchangeRate,
              digitAfterComma: invoiceCurrency.digitAfterComma,
            } as Partial<ExpensePaymentInvoiceEntryEntity>;
          } else {
            const paymentAmount = createDinero(entry.amount);
  
            if (paymentAmount.greaterThan(remainingAmount.add(tolerance))) {
              throw new Error(`Le montant dépasse le reste à payer pour la facture ${invoice.sequential}`);
            }
  
            if (remainingAmount.subtract(paymentAmount).toUnit() < 0.01) {
              entry.amount = remainingAmount.toUnit();
            }
  
            totalInvoicesAmount += paymentAmount.toUnit();
  
            const newAmountPaid = amountPaid.add(paymentAmount);
            const newRemaining = invoiceTotal.subtract(newAmountPaid).subtract(taxWithholding);
            
            const newStatus = newRemaining.lessThanOrEqual(tolerance)
              ? EXPENSE_INVOICE_STATUS.Paid
              : EXPENSE_INVOICE_STATUS.PartiallyPaid;
  
            await this.expenseInvoiceService.updateFields(invoice.id, {
              amountPaid: newAmountPaid.toUnit(),
              status: newStatus,
            });
  
            return {
              payment: null,
              expenseInvoice: invoice,
              amount: paymentAmount.toUnit(),
              originalAmount: paymentAmount.toUnit(),
              originalCurrency: await this.currencyService.findOneById(createPaymentDto.currencyId),
              exchangeRate: 1,
              digitAfterComma: invoiceCurrency.digitAfterComma,
            } as Partial<ExpensePaymentInvoiceEntryEntity>;
          }
        })
      );
  
      const validEntries = invoiceEntries.filter(entry => entry !== null) as Partial<ExpensePaymentInvoiceEntryEntity>[];
  
      // 2. Créer le paiement principal AVEC le montant calculé
      const payment = await this.expenesePaymentRepository.save({
        ...createPaymentDto,
        sequential: sequentialNumbr,
        sequentialNumbr,
        pdfFileId: uploadPdfField?.id || null,
        uploadPdfField: uploadPdfField || null,
        amount: totalInvoicesAmount,
      });
  
      // 3. Sauvegarder les entrées de paiement avec la relation établie
      const savedEntries = await Promise.all(
        validEntries.map(entry => 
          this.expensePaymentInvoiceEntryRepository.save({
            ...entry,
            paymentId: payment.id,
          })
        )
      );
  
      // 4. Gestion des fichiers joints
      if (createPaymentDto.uploads) {
        await Promise.all(
          createPaymentDto.uploads.map(u =>
            this.expensePaymentUploadService.save(payment.id, u.uploadId)
          )
        );
      }
  
      // 5. Retourner le paiement complet avec les relations chargées
      return this.expenesePaymentRepository.findOne({
        where: { id: payment.id },
        relations: ['invoices', 'invoices.expenseInvoice', 'uploads']
      });
    } catch (error) {
      console.error('Error in save method:', error);
      throw new Error(`Failed to save expense payment: ${error.message}`);
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
    console.log('Updating payment...', updatePaymentDto);

    // 1. Récupérer le paiement existant avec toutes les relations nécessaires
    const existingPayment = await this.findOneByCondition({
      filter: `id||$eq||${id}`,
      join: 'invoices,invoices.expenseInvoice,invoices.expenseInvoice.currency,uploads,uploadPdfField',
    });

    if (!existingPayment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    // 2. Préparer les données pour la mise à jour
    const paymentData = {
      ...existingPayment,
      ...updatePaymentDto,
      sequential: existingPayment.sequential,
      sequentialNumbr: existingPayment.sequentialNumbr,
    };

    // 3. Traiter les entrées de facture si elles sont fournies
    if (updatePaymentDto.invoices) {
      // 3a. Récupérer la devise du paiement
      const paymentCurrency = await this.currencyService.findOneById(
        updatePaymentDto.currencyId || existingPayment.currencyId
      );
      
      if (!paymentCurrency) {
        throw new Error('Payment currency not found');
      }

      // 3b. Sauvegarder les montants actuels des entrées avant suppression
      const oldEntriesData = await Promise.all(
        existingPayment.invoices.map(async (entry) => {
          const invoice = await this.expenseInvoiceService.findOneByCondition({
            filter: `id||$eq||${entry.expenseInvoiceId}`,
            join: 'currency',
          });
          return {
            invoiceId: entry.expenseInvoiceId,
            oldAmount: entry.amount,
            currentInvoiceAmountPaid: invoice.amountPaid || 0
          };
        })
      );

      // 3c. Annuler l'impact des anciennes entrées
      await this.revertPaymentImpact(existingPayment.invoices);

      // 3d. Soft delete des anciennes entrées
      await this.expensePaymentInvoiceEntryService.softDeleteMany(
        existingPayment.invoices.map((entry) => entry.id)
      );

      // 3e. Créer les nouvelles entrées
      let totalPaymentAmount = 0;
      const invoiceEntries = await Promise.all(
        updatePaymentDto.invoices.map(async (entry) => {
          const invoice = await this.expenseInvoiceService.findOneByCondition({
            filter: `id||$eq||${entry.expenseInvoiceId}`,
            join: 'currency',
          });

          if (!invoice) {
            throw new Error(`Invoice with ID ${entry.expenseInvoiceId} not found`);
          }

          // Trouver les données de l'ancienne entrée pour cette facture
          const oldEntryData = oldEntriesData.find(e => e.invoiceId === invoice.id);

          // Préparer les fonctions dinero
          const createDinero = (amount: number) => dinero({
            amount: createDineroAmountFromFloatWithDynamicCurrency(
              amount,
              invoice.currency.digitAfterComma
            ),
            precision: invoice.currency.digitAfterComma,
          });

          const zero = createDinero(0);
          const tolerance = createDinero(0.01);

          // Calculer le montant existant payé avant toute modification
          const currentAmountPaid = oldEntryData 
            ? createDinero(oldEntryData.currentInvoiceAmountPaid)
            : createDinero(invoice.amountPaid || 0);

          const invoiceTotal = createDinero(invoice.total);
          const taxWithholding = createDinero(invoice.taxWithholdingAmount || 0);
          
          // Calculer le montant restant avant modification
          const remainingBeforePayment = invoiceTotal
            .subtract(currentAmountPaid)
            .subtract(taxWithholding);

          // Calculer le nouveau montant
          let amountInInvoiceCurrency: dinero.Dinero;
          let amountInPaymentCurrency: dinero.Dinero;
          let exchangeRate = 1;

          if (invoice.currencyId !== paymentCurrency.id) {
            exchangeRate = entry.exchangeRate || existingPayment.convertionRate || 1;
            if (!exchangeRate || exchangeRate <= 0) {
                throw new Error(`Exchange rate missing or invalid for invoice ${invoice.id}`);
            }

            amountInPaymentCurrency = createDinero(entry.originalAmount || entry.amount);
            amountInInvoiceCurrency = amountInPaymentCurrency.multiply(exchangeRate);

            // Validation
            const maxAllowedInPaymentCurrency = remainingBeforePayment.divide(exchangeRate);
            if (amountInPaymentCurrency.greaterThan(maxAllowedInPaymentCurrency.add(tolerance))) {
              throw new Error(
                `Payment of ${amountInPaymentCurrency.toUnit()} ${paymentCurrency.code} ` +
                `exceeds remaining amount for invoice ${invoice.id}`
              );
            }
          } else {
            // Même devise
            amountInInvoiceCurrency = createDinero(entry.amount);
            amountInPaymentCurrency = amountInInvoiceCurrency;
          }

          // Ajouter au total du paiement (dans la devise du paiement)
          totalPaymentAmount += amountInPaymentCurrency.toUnit();

          // Calculer le nouveau montant payé en tenant compte de l'ancien montant
          const newAmountPaid = currentAmountPaid
            .subtract(oldEntryData ? createDinero(oldEntryData.oldAmount) : zero)
            .add(amountInInvoiceCurrency);

          const newRemaining = invoiceTotal.subtract(newAmountPaid).subtract(taxWithholding);

          // Déterminer le nouveau statut
          let newStatus;
          if (newAmountPaid.equalsTo(zero)) {
            newStatus = EXPENSE_INVOICE_STATUS.Unpaid;
          } else if (newRemaining.lessThanOrEqual(tolerance)) {
            newStatus = EXPENSE_INVOICE_STATUS.Paid;
          } else {
            newStatus = EXPENSE_INVOICE_STATUS.PartiallyPaid;
          }

          // Mettre à jour la facture
          await this.expenseInvoiceService.updateFields(invoice.id, {
            amountPaid: newAmountPaid.toUnit(),
            status: newStatus,
          });

          return {
            paymentId: id,
            expenseInvoiceId: invoice.id,
            amount: amountInInvoiceCurrency.toUnit(),
            originalAmount: amountInPaymentCurrency.toUnit(),
            originalCurrencyId: paymentCurrency.id,
            exchangeRate: invoice.currencyId !== paymentCurrency.id ? exchangeRate : 1,
            digitAfterComma: invoice.currency.digitAfterComma,
          };
        })
      );

      // Sauvegarder les nouvelles entrées
      await this.expensePaymentInvoiceEntryService.saveMany(
        invoiceEntries.filter(entry => entry !== null)
      );

      // Mettre à jour le montant total du paiement
      paymentData.amount = totalPaymentAmount;
    }

    // 4. Gérer les uploads (inchangé)
    if (updatePaymentDto.uploads) {
      const { keptItems, newItems } = await this.expenesePaymentRepository.updateAssociations({
        updatedItems: updatePaymentDto.uploads,
        existingItems: existingPayment.uploads,
        onDelete: (id: number) => this.expensePaymentUploadService.softDelete(id),
        onCreate: (entity: ResponseExpensePaymentUploadDto) =>
          this.expensePaymentUploadService.save(entity.expensePaymentId, entity.uploadId),
      });

      paymentData.uploads = [...keptItems, ...newItems];
    }

    // 5. Sauvegarder le paiement mis à jour
    const updatedPayment = await this.expenesePaymentRepository.save(paymentData);
    console.log('Payment updated successfully:', updatedPayment);
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
    // 1. Récupérer le paiement avec toutes les relations nécessaires
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

    // 2. Récupérer le template
    const template = templateId 
        ? await this.templateService.getTemplateById(templateId)
        : await this.templateService.getDefaultTemplate(TemplateType.PAYMENT);
    
    if (!template) {
        throw new NotFoundException('Aucun template de paiement trouvé');
    }

    // 3. Préparer les données pour le template
    // 3. Préparer les données pour le template
const templateData = {
  payment: {
      ...payment,
      paymentMethod: PAYMENT_MODE[payment.mode] || payment.mode,
      // Formatage des dates
      date: format(payment.date, 'dd/MM/yyyy'),
      createdAt: format(payment.createdAt, 'dd/MM/yyyy'),
      
      // Invoices avec formatage spécifique et calcul du montant restant
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
      
      // Gestion des valeurs nulles
      currency: payment.currency || {
          code: 'EUR',
          symbol: '€'
      }
  }
};

    // 4. Nettoyer et compiler le template
    const cleanedContent = template.content
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');

    const compiledHtml = ejs.render(cleanedContent, templateData);

    // 5. Générer le PDF
    return this.pdfService.generateFromHtml(compiledHtml, {
        format: 'A4',
        margin: { top: '20mm', right: '10mm', bottom: '20mm', left: '10mm' },
        printBackground: true
    });
}

}

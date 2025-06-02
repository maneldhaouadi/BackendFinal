import { Injectable, NotFoundException } from '@nestjs/common';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { FindOneOptions } from 'typeorm';
import { Transactional } from '@nestjs-cls/transactional';
import { createDineroAmountFromFloatWithDynamicCurrency } from 'src/utils/money.utils';
import dinero from 'dinero.js';
import { ExpensePaymentInvoiceEntryRepository } from '../repositories/repository/expense-payment-invoice-entry.entity';
import { ExpenseInvoiceService } from 'src/modules/expense-invoice/services/expense-invoice.service';
import { ExpensePaymentInvoiceEntryEntity } from '../repositories/entities/expense-payment-invoice-entry.entity';
import { ResponseExpensePaymentInvoiceEntryDto } from '../dtos/expense-payment-invoice-entry.response.dto';
import { ExpensePaymentInvoiceEntryNotFoundException } from '../errors/expense-payment-invoice-entry.notfound.error';
import { ExpenseCreatePaymentInvoiceEntryDto } from '../dtos/expense-payment-invoice-entry.create.dto';
import { UpdateExpensePaymentInvoiceEntryDto } from '../dtos/expense-payment-invoice-entry.update.dto';
import { EXPENSE_INVOICE_STATUS } from 'src/modules/expense-invoice/enums/expense-invoice-status.enum';
import { CurrencyService } from 'src/modules/currency/services/currency.service';

@Injectable()
export class ExpensePaymentInvoiceEntryService {
  constructor(
    private readonly expensePaymentInvoiceEntryRepository: ExpensePaymentInvoiceEntryRepository,
    private readonly expenseInvoiceService: ExpenseInvoiceService,
    private readonly currencyService:CurrencyService,
  ) {}

  async findOneByCondition(query: IQueryObject): Promise<ExpensePaymentInvoiceEntryEntity | null> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    return this.expensePaymentInvoiceEntryRepository.findOne(queryOptions as FindOneOptions<ExpensePaymentInvoiceEntryEntity>);
  }

  async findOneById(id: number): Promise<ResponseExpensePaymentInvoiceEntryDto> {
    const entry = await this.expensePaymentInvoiceEntryRepository.findOneById(id);
    if (!entry) {
      throw new ExpensePaymentInvoiceEntryNotFoundException();
    }
    return entry;
  }

  @Transactional()
async save(createPaymentInvoiceEntryDto: ExpenseCreatePaymentInvoiceEntryDto): Promise<ExpensePaymentInvoiceEntryEntity> {
  // 1. Récupération de la facture avec les paiements existants
  const invoice = await this.expenseInvoiceService.findOneByCondition({
    filter: `id||$eq||${createPaymentInvoiceEntryDto.expenseInvoiceId}`,
    join: 'currency,firm,payments',
  });

  if (!invoice) {
    throw new Error(`Invoice with ID ${createPaymentInvoiceEntryDto.expenseInvoiceId} not found`);
  }

  // 2. Initialisation des montants
  invoice.amountPaid = invoice.amountPaid ?? 0;

  // 3. Configuration de Dinero pour les calculs précis
  const createDinero = (amount: number) => dinero({
    amount: createDineroAmountFromFloatWithDynamicCurrency(amount, invoice.currency.digitAfterComma),
    precision: invoice.currency.digitAfterComma,
  });

  // 4. Calcul du cumul existant des paiements (dans la devise de la facture)
  const existingPaymentsSum = invoice.payments?.reduce((sum, entry) => {
    return sum + (entry.amount || 0);
  }, 0) || 0;

  const zero = createDinero(0);
  const invoiceTotal = createDinero(invoice.total);
  const taxWithholdingAmount = createDinero(invoice.taxWithholdingAmount || 0);
  const tolerance = createDinero(0.01);

  // 5. Calcul du remaining amount avant nouveau paiement
  const remainingBeforePayment = invoiceTotal
    .subtract(createDinero(existingPaymentsSum))
    .subtract(taxWithholdingAmount);

  // 6. Traitement du nouveau paiement
  let paymentAmountInInvoiceCurrency: dinero.Dinero;
  let paymentAmountInPaymentCurrency: dinero.Dinero;

  if (createPaymentInvoiceEntryDto.exchangeRate) {
    // 6.1 Conversion devise étrangère → devise facture (EUR → TND)
    paymentAmountInPaymentCurrency = createDinero(createPaymentInvoiceEntryDto.originalAmount);
    paymentAmountInInvoiceCurrency = paymentAmountInPaymentCurrency.multiply(createPaymentInvoiceEntryDto.exchangeRate);

    // 6.2 Vérification du plafond
    const maxAllowedPayment = remainingBeforePayment.divide(createPaymentInvoiceEntryDto.exchangeRate);
    if (paymentAmountInPaymentCurrency.greaterThan(maxAllowedPayment.add(tolerance))) {
      throw new Error(`Maximum payment allowed: ${maxAllowedPayment.toUnit()} ${createPaymentInvoiceEntryDto.originalCurrencyId}`);
    }
  } else {
    // 6.3 Même devise
    paymentAmountInInvoiceCurrency = createDinero(createPaymentInvoiceEntryDto.amount);
    paymentAmountInPaymentCurrency = paymentAmountInInvoiceCurrency;
  }

  // 7. Calcul du nouveau cumul
  const newCumulativeAmount = existingPaymentsSum + paymentAmountInInvoiceCurrency.toUnit();
  const newRemainingAmount = invoiceTotal
    .subtract(createDinero(newCumulativeAmount))
    .subtract(taxWithholdingAmount);

  // 8. Détermination du statut
  let newInvoiceStatus;
  if (newCumulativeAmount <= 0) {
    newInvoiceStatus = EXPENSE_INVOICE_STATUS.Unpaid;
  } else if (newRemainingAmount.lessThanOrEqual(tolerance)) {
    newInvoiceStatus = EXPENSE_INVOICE_STATUS.Paid;
  } else {
    newInvoiceStatus = EXPENSE_INVOICE_STATUS.PartiallyPaid;
  }

  // 9. Mise à jour de la facture
  await this.expenseInvoiceService.updateFields(invoice.id, {
    amountPaid: newCumulativeAmount,
    status: newInvoiceStatus,
  });

  // 10. Journalisation des calculs
  console.log('Payment details:', {
    invoiceId: invoice.id,
    total: invoiceTotal.toUnit(),
    existingPayments: existingPaymentsSum,
    newPayment: paymentAmountInInvoiceCurrency.toUnit(),
    newTotal: newCumulativeAmount,
    remaining: newRemainingAmount.toUnit(),
    status: newInvoiceStatus
  });

  // 11. Sauvegarde du paiement
  return this.expensePaymentInvoiceEntryRepository.save({
    ...createPaymentInvoiceEntryDto,
    amount: paymentAmountInInvoiceCurrency.toUnit(), // Montant dans la devise de la facture (TND)
    originalAmount: paymentAmountInPaymentCurrency.toUnit(), // Montant dans la devise de paiement (EUR)
    exchangeRate: createPaymentInvoiceEntryDto.exchangeRate || 1,
    digitAfterComma: invoice.currency.digitAfterComma,
  });
}

@Transactional()
async findAllByPaymentId(paymentId: number): Promise<ExpensePaymentInvoiceEntryEntity[]> {
  return this.expensePaymentInvoiceEntryRepository.findAll({
    where: { paymentId },
    relations: ['expenseInvoice', 'expenseInvoice.currency']
  });
}

  @Transactional()
  async saveMany(
    createPaymentInvoiceEntryDtos: ExpenseCreatePaymentInvoiceEntryDto[],
  ): Promise<{ savedEntries: ExpensePaymentInvoiceEntryEntity[]; skippedEntries: ExpenseCreatePaymentInvoiceEntryDto[] }> {
    const savedEntries = [];
    const skippedEntries = [];
  
    for (const dto of createPaymentInvoiceEntryDtos) {
      try {
        // Skip null or invalid DTOs
        if (!dto || !dto.expenseInvoiceId) {
          console.warn(`Skipping invalid invoice entry: expenseInvoiceId is missing in DTO`, dto);
          skippedEntries.push(dto);
          continue;
        }
    
        // Save the valid entry
        const savedEntry = await this.save(dto);
        savedEntries.push(savedEntry);
      } catch (error) {
        console.error(`Failed to save invoice entry:`, error);
        skippedEntries.push(dto);
      }
    }
  
    return { savedEntries, skippedEntries };
  }
 @Transactional()
async update(
  id: number,
  updatePaymentInvoiceEntryDto: UpdateExpensePaymentInvoiceEntryDto,
): Promise<ExpensePaymentInvoiceEntryEntity> {
  // 1. Récupérer l'entrée existante
  const existingEntry = await this.expensePaymentInvoiceEntryRepository.findOneById(id);
  if (!existingEntry) {
    throw new ExpensePaymentInvoiceEntryNotFoundException();
  }

  // 2. Récupérer la facture associée
  const invoice = await this.expenseInvoiceService.findOneByCondition({
    filter: `id||$eq||${existingEntry.expenseInvoiceId}`,
    join: 'currency,payments',
  });

  if (!invoice) {
    throw new Error(`Invoice with ID ${existingEntry.expenseInvoiceId} not found`);
  }

  // 3. Calculer le montant déjà payé (hors l'entrée actuelle)
  const totalPaidExcludingCurrent = (invoice.payments || [])
    .filter(payment => payment.id !== existingEntry.id)
    .reduce((sum, entry) => sum + (entry.amount || 0), 0);

  // 4. Récupérer le montant actuel de l'entrée
  const currentAmount = existingEntry.amount;
  const currentOriginalAmount = existingEntry.originalAmount;

  // 5. Calculer le NOUVEAU montant (ancien + nouveau)
  const newAmount = currentAmount + (updatePaymentInvoiceEntryDto.amount || 0);
  const newOriginalAmount = currentOriginalAmount + (updatePaymentInvoiceEntryDto.originalAmount || 0);

  // 6. Vérifier que le nouveau total ne dépasse pas le montant de la facture
  const invoiceTotal = invoice.total;
  const remainingAmount = invoiceTotal - totalPaidExcludingCurrent - currentAmount; // Montant restant avant modification

  if ((updatePaymentInvoiceEntryDto.amount || 0) > remainingAmount) {
    throw new Error(`Le montant ajouté (${updatePaymentInvoiceEntryDto.amount}) dépasse le restant dû (${remainingAmount})`);
  }

  // 7. Mettre à jour l'entrée avec le NOUVEAU MONTANT CUMULÉ
  const updatedEntry = await this.expensePaymentInvoiceEntryRepository.save({
    ...existingEntry,
    amount: newAmount,
    originalAmount: newOriginalAmount,
    exchangeRate: updatePaymentInvoiceEntryDto.exchangeRate || existingEntry.exchangeRate,
    originalCurrencyId: updatePaymentInvoiceEntryDto.originalCurrencyId || existingEntry.originalCurrencyId,
  });

  // 8. Mettre à jour le montant total payé sur la facture
  const newTotalPaid = totalPaidExcludingCurrent + newAmount;
  await this.expenseInvoiceService.updateFields(invoice.id, {
  amountPaid: newTotalPaid,
  status: newTotalPaid >= invoice.total 
    ? EXPENSE_INVOICE_STATUS.Paid 
    : EXPENSE_INVOICE_STATUS.PartiallyPaid,
});

  return updatedEntry;
}

@Transactional()
async softDelete(id: number): Promise<ExpensePaymentInvoiceEntryEntity> {
  const existingEntry = await this.findOneByCondition({
    filter: `id||$eq||${id}`,
  });

  if (!existingEntry) {
    throw new NotFoundException('Payment entry not found');
  }

  const invoice = await this.expenseInvoiceService.findOneByCondition({
    filter: `id||$eq||${existingEntry.expenseInvoiceId}`,
    join: 'currency',
  });

  const createDinero = (amount: number) => dinero({
    amount: createDineroAmountFromFloatWithDynamicCurrency(
      amount, 
      invoice.currency.digitAfterComma
    ),
    precision: invoice.currency.digitAfterComma,
  });

  const currentPaid = createDinero(invoice.amountPaid);
  const entryAmount = createDinero(existingEntry.amount);
  const updatedPaid = currentPaid.subtract(entryAmount);

  // Garantir que le montant ne devient pas négatif
  const finalAmountPaid = Math.max(updatedPaid.toUnit(), 0);

  await this.expenseInvoiceService.updateFields(invoice.id, {
    amountPaid: finalAmountPaid,
    status: this.calculateNewStatus(
      createDinero(finalAmountPaid),
      createDinero(invoice.total),
      createDinero(invoice.taxWithholdingAmount || 0)
    ),
  });

  return this.expensePaymentInvoiceEntryRepository.softDelete(id);
}

private calculateNewStatus(
  amountPaid: dinero.Dinero,
  total: dinero.Dinero,
  taxWithholding: dinero.Dinero
): EXPENSE_INVOICE_STATUS {
  const zero = dinero({ amount: 0, precision: amountPaid.getPrecision() });
  const totalWithTax = total.subtract(taxWithholding);

  if (amountPaid.equalsTo(zero)) {
    return EXPENSE_INVOICE_STATUS.Unpaid;
  } else if (amountPaid.equalsTo(totalWithTax)) {
    return EXPENSE_INVOICE_STATUS.Paid;
  } else {
    return EXPENSE_INVOICE_STATUS.PartiallyPaid;
  }
}

  @Transactional()
  async softDeleteMany(ids: number[]): Promise<void> {
    for (const id of ids) {
      await this.softDelete(id);
    }
  }
}

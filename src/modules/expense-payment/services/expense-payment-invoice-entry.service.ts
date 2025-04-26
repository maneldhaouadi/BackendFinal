import { Injectable } from '@nestjs/common';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { FindOneOptions } from 'typeorm';
import { Transactional } from '@nestjs-cls/transactional';
import { createDineroAmountFromFloatWithDynamicCurrency } from 'src/utils/money.utils';
import * as dinero from 'dinero.js';
import { ExpensePaymentInvoiceEntryRepository } from '../repositories/repository/expense-payment-invoice-entry.entity';
import { ExpenseInvoiceService } from 'src/modules/expense-invoice/services/expense-invoice.service';
import { ExpensePaymentInvoiceEntryEntity } from '../repositories/entities/expense-payment-invoice-entry.entity';
import { ResponseExpensePaymentInvoiceEntryDto } from '../dtos/expense-payment-invoice-entry.response.dto';
import { ExpensePaymentInvoiceEntryNotFoundException } from '../errors/expense-payment-invoice-entry.notfound.error';
import { ExpenseCreatePaymentInvoiceEntryDto } from '../dtos/expense-payment-invoice-entry.create.dto';
import { UpdateExpensePaymentInvoiceEntryDto } from '../dtos/expense-payment-invoice-entry.update.dto';
import { EXPENSE_INVOICE_STATUS } from 'src/modules/expense-invoice/enums/expense-invoice-status.enum';

@Injectable()
export class ExpensePaymentInvoiceEntryService {
  constructor(
    private readonly expensePaymentInvoiceEntryRepository: ExpensePaymentInvoiceEntryRepository,
    private readonly expenseInvoiceService: ExpenseInvoiceService,
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
    join: 'currency,firm,paymentEntries',
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
    const existingEntry = await this.findOneById(id);
    
    const existingInvoice = await this.expenseInvoiceService.findOneByCondition({
      filter: `id||$eq||${existingEntry.expenseInvoiceId}`,
      join: 'currency',
    });
  
    // Convertir tous les montants en dinero pour les calculs précis
    const toDinero = (amount: number) => dinero({
      amount: createDineroAmountFromFloatWithDynamicCurrency(
        amount,
        existingInvoice.currency.digitAfterComma,
      ),
      precision: existingInvoice.currency.digitAfterComma,
    });
  
    // Calculer le montant effectif à utiliser (en tenant compte du taux de change si nécessaire)
    let effectiveAmount = updatePaymentInvoiceEntryDto.amount;
    if (updatePaymentInvoiceEntryDto.exchangeRate && updatePaymentInvoiceEntryDto.exchangeRate !== 1) {
      // Si un taux de change est fourni et différent de 1, utiliser le originalAmount
      effectiveAmount = updatePaymentInvoiceEntryDto.originalAmount * updatePaymentInvoiceEntryDto.exchangeRate;
    }
  
    const currentAmountPaid = toDinero(existingInvoice.amountPaid);
    const oldEntryAmount = toDinero(existingEntry.amount);
    const updatedEntryAmount = toDinero(effectiveAmount); // Utiliser le montant calculé
    const taxWithholdingAmount = toDinero(existingInvoice.taxWithholdingAmount);
    const invoiceTotal = toDinero(existingInvoice.total);
    const zero = toDinero(0);
    const tolerance = toDinero(0.01); // Tolérance pour les calculs
  
    // Calculer le nouveau montant payé
    const newAmountPaid = currentAmountPaid
      .subtract(oldEntryAmount)
      .add(updatedEntryAmount);
  
    // Calculer le montant restant
    const remainingAmount = invoiceTotal
      .subtract(newAmountPaid)
      .subtract(taxWithholdingAmount);
  
    // Déterminer le nouveau statut
    let newInvoiceStatus;
    if (newAmountPaid.equalsTo(zero)) {
      newInvoiceStatus = EXPENSE_INVOICE_STATUS.Unpaid;
    } else if (newAmountPaid.add(taxWithholdingAmount).subtract(invoiceTotal).lessThanOrEqual(tolerance)) {
      newInvoiceStatus = EXPENSE_INVOICE_STATUS.Paid;
    } else {
      newInvoiceStatus = EXPENSE_INVOICE_STATUS.PartiallyPaid;
    }
  
    // Mettre à jour la facture
    await this.expenseInvoiceService.updateFields(existingInvoice.id, {
      amountPaid: newAmountPaid.toUnit(),
      status: newInvoiceStatus,
    });
  
    // Mettre à jour l'entrée de paiement avec les informations de conversion
    return this.expensePaymentInvoiceEntryRepository.save({
      ...existingEntry,
      ...updatePaymentInvoiceEntryDto,
      amount: effectiveAmount, // Montant dans la devise de la facture
      // Conserver les informations originales si elles existent
      originalAmount: updatePaymentInvoiceEntryDto.originalAmount ?? existingEntry.originalAmount ?? effectiveAmount,
      exchangeRate: updatePaymentInvoiceEntryDto.exchangeRate ?? existingEntry.exchangeRate ?? 1,
      originalCurrencyId: updatePaymentInvoiceEntryDto.originalCurrencyId ?? existingEntry.originalCurrencyId ?? existingInvoice.currency.id,
    });
  }

  @Transactional()
  async softDelete(id: number): Promise<ExpensePaymentInvoiceEntryEntity> {
    const existingEntry = await this.findOneByCondition({
      filter: `id||$eq||${id}`,
      join: 'payment',
    });

    const existingInvoice = await this.expenseInvoiceService.findOneByCondition({
      filter: `id||$eq||${existingEntry.expenseInvoiceId}`,
      join: 'currency',
    });

    const zero = dinero({
      amount: createDineroAmountFromFloatWithDynamicCurrency(
        0,
        existingInvoice.currency.digitAfterComma,
      ),
      precision: existingInvoice.currency.digitAfterComma,
    });

    const totalAmountPaid = dinero({
      amount: createDineroAmountFromFloatWithDynamicCurrency(
        existingInvoice.amountPaid,
        existingInvoice.currency.digitAfterComma,
      ),
      precision: existingInvoice.currency.digitAfterComma,
    });

    const amountToDeduct = dinero({
      amount: createDineroAmountFromFloatWithDynamicCurrency(
        existingEntry.amount,
        existingInvoice.currency.digitAfterComma,
      ),
      precision: existingInvoice.currency.digitAfterComma,
    });

    const taxWithholdingAmount = dinero({
      amount: createDineroAmountFromFloatWithDynamicCurrency(
        existingInvoice.taxWithholdingAmount,
        existingInvoice.currency.digitAfterComma,
      ),
      precision: existingInvoice.currency.digitAfterComma,
    });

    const updatedAmountPaid = totalAmountPaid.subtract(amountToDeduct);

    const invoiceTotal = dinero({
      amount: createDineroAmountFromFloatWithDynamicCurrency(
        existingInvoice.total,
        existingInvoice.currency.digitAfterComma,
      ),
      precision: existingInvoice.currency.digitAfterComma,
    });

    const newInvoiceStatus = updatedAmountPaid.equalsTo(zero)
      ? EXPENSE_INVOICE_STATUS.Unpaid
      : updatedAmountPaid.add(taxWithholdingAmount).equalsTo(invoiceTotal)
        ? EXPENSE_INVOICE_STATUS.Paid
        : EXPENSE_INVOICE_STATUS.PartiallyPaid;

    await this.expenseInvoiceService.updateFields(existingInvoice.id, {
      amountPaid: updatedAmountPaid.toUnit(),
      status: newInvoiceStatus,
    });
    return this.expensePaymentInvoiceEntryRepository.softDelete(id);
  }

  @Transactional()
  async softDeleteMany(ids: number[]): Promise<void> {
    for (const id of ids) {
      await this.softDelete(id);
    }
  }
}

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
  // Récupérer la facture
  const invoice = await this.expenseInvoiceService.findOneByCondition({
    filter: `id||$eq||${createPaymentInvoiceEntryDto.expenseInvoiceId}`,
    join: 'currency',
  });

  if (!invoice) {
    throw new Error(`Invoice with ID ${createPaymentInvoiceEntryDto.expenseInvoiceId} not found`);
  }

  // Initialiser amountPaid si nécessaire
  if (invoice.amountPaid === null || invoice.amountPaid === undefined) {
    invoice.amountPaid = 0;
  }

  // Calculer le montant à ajouter dans la devise de la facture
  const amountToAddInInvoiceCurrency = createPaymentInvoiceEntryDto.exchangeRate
    ? createPaymentInvoiceEntryDto.originalAmount
    : createPaymentInvoiceEntryDto.amount;

  // Préparer les objets Dinero.js
  const zero = dinero({
    amount: createDineroAmountFromFloatWithDynamicCurrency(0, invoice.currency.digitAfterComma),
    precision: invoice.currency.digitAfterComma,
  });

  const amountAlreadyPaid = dinero({
    amount: createDineroAmountFromFloatWithDynamicCurrency(invoice.amountPaid, invoice.currency.digitAfterComma),
    precision: invoice.currency.digitAfterComma,
  });

  const amountToBePaid = dinero({
    amount: createDineroAmountFromFloatWithDynamicCurrency(amountToAddInInvoiceCurrency, invoice.currency.digitAfterComma),
    precision: invoice.currency.digitAfterComma,
  });

  const taxWithholdingAmount = dinero({
    amount: createDineroAmountFromFloatWithDynamicCurrency(invoice.taxWithholdingAmount || 0, invoice.currency.digitAfterComma),
    precision: invoice.currency.digitAfterComma,
  });

  // Calculer le nouveau montant payé
  const totalAmountPaid = amountAlreadyPaid.add(amountToBePaid);
  const invoiceTotal = dinero({
    amount: createDineroAmountFromFloatWithDynamicCurrency(invoice.total, invoice.currency.digitAfterComma),
    precision: invoice.currency.digitAfterComma,
  });

  const tolerance = dinero({
    amount: createDineroAmountFromFloatWithDynamicCurrency(0.01, invoice.currency.digitAfterComma),
    precision: invoice.currency.digitAfterComma,
  });

  // Déterminer le nouveau statut
  let newInvoiceStatus;
  if (totalAmountPaid.equalsTo(zero)) {
    newInvoiceStatus = EXPENSE_INVOICE_STATUS.Unpaid;
  } else if (invoiceTotal.subtract(totalAmountPaid.add(taxWithholdingAmount)).lessThanOrEqual(tolerance)) {
    newInvoiceStatus = EXPENSE_INVOICE_STATUS.Paid;
  } else {
    newInvoiceStatus = EXPENSE_INVOICE_STATUS.PartiallyPaid;
  }

  // Mettre à jour la facture
  await this.expenseInvoiceService.updateFields(invoice.id, {
    amountPaid: totalAmountPaid.toUnit(),
    status: newInvoiceStatus,
  });

  // Sauvegarder l'entrée de paiement
  return this.expensePaymentInvoiceEntryRepository.save({
    ...createPaymentInvoiceEntryDto,
    amount: createPaymentInvoiceEntryDto.exchangeRate
      ? createPaymentInvoiceEntryDto.originalAmount * createPaymentInvoiceEntryDto.exchangeRate
      : createPaymentInvoiceEntryDto.amount,
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

    const currentAmountPaid = dinero({
      amount: createDineroAmountFromFloatWithDynamicCurrency(
        existingInvoice.amountPaid,
        existingInvoice.currency.digitAfterComma,
      ),
      precision: existingInvoice.currency.digitAfterComma,
    });

    const oldEntryAmount = dinero({
      amount: createDineroAmountFromFloatWithDynamicCurrency(
        existingEntry.amount,
        existingInvoice.currency.digitAfterComma,
      ),
      precision: existingInvoice.currency.digitAfterComma,
    });

    const updatedEntryAmount = dinero({
      amount: createDineroAmountFromFloatWithDynamicCurrency(
        updatePaymentInvoiceEntryDto.amount,
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

    const newAmountPaid = currentAmountPaid
      .subtract(oldEntryAmount)
      .add(updatedEntryAmount);

    const zero = dinero({
      amount: createDineroAmountFromFloatWithDynamicCurrency(
        0,
        existingInvoice.currency.digitAfterComma,
      ),
      precision: existingInvoice.currency.digitAfterComma,
    });

    const invoiceTotal = dinero({
      amount: createDineroAmountFromFloatWithDynamicCurrency(
        existingInvoice.total,
        existingInvoice.currency.digitAfterComma,
      ),
      precision: existingInvoice.currency.digitAfterComma,
    });
    const tolerance = dinero({
      amount: createDineroAmountFromFloatWithDynamicCurrency(0.01, existingInvoice.currency.digitAfterComma),
      precision: existingInvoice.currency.digitAfterComma,
    });

    const newInvoiceStatus = newAmountPaid.equalsTo(zero)
    ? EXPENSE_INVOICE_STATUS.Unpaid
    : invoiceTotal.subtract(newAmountPaid.add(taxWithholdingAmount)).lessThanOrEqual(tolerance)
      ? EXPENSE_INVOICE_STATUS.Paid
      : EXPENSE_INVOICE_STATUS.PartiallyPaid;
    await this.expenseInvoiceService.updateFields(existingInvoice.id, {
      amountPaid: newAmountPaid.toUnit(),
      status: newInvoiceStatus,
    });

    return this.expensePaymentInvoiceEntryRepository.save({
      ...existingEntry,
      ...updatePaymentInvoiceEntryDto,
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

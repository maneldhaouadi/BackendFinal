// src/modules/expense-invoice/dtos/import-expense-invoice.dto.ts
import { IsOptional, IsString, IsNumber, IsPositive, IsEnum, IsDateString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { EXPENSE_INVOICE_STATUS } from 'src/modules/expense-invoice/enums/expense-invoice-status.enum';
import { DISCOUNT_TYPES } from 'src/app/enums/discount-types.enum';

export class ExpenseInvoiceEntryDto {
  @IsString()
  reference: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  unit_price?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  quantity?: number;

  @IsOptional()
  @IsNumber()
  discount?: number;

  @IsOptional()
  @IsEnum(DISCOUNT_TYPES)
  discount_type?: DISCOUNT_TYPES;
}

export class ImportExpenseInvoiceDto {
  @IsOptional()
  @IsString()
  sequential?: string;

  @IsOptional()
  @IsDateString()
  date?: Date;

  @IsOptional()
  @IsDateString()
  dueDate?: Date;

  @IsOptional()
  @IsString()
  object?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(EXPENSE_INVOICE_STATUS)
  status?: EXPENSE_INVOICE_STATUS;

  @IsOptional()
  @IsNumber()
  discount?: number;

  @IsOptional()
  @IsEnum(DISCOUNT_TYPES)
  discount_type?: DISCOUNT_TYPES;

  @IsOptional()
  @IsString()
  interlocutorName?: string;

  @IsOptional()
  @IsString()
  interlocutorReference?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpenseInvoiceEntryDto)
  entries: ExpenseInvoiceEntryDto[];
}